/** The slow quiet ending, replayed from the chain: tiers settle one at a time on the
 * contract's dates (vote/docs/quiet-ending-rules.md, 11 November 2026). Each window
 * has an opening tally, one after every block holding a receipt, and a closing tally;
 * only the settling tier's funded set is compared. The tally itself is the Python's
 * stage tally (./stage.ts). Amounts are micro-USD bigints.
 * Browser and Deno. */
import { effectiveRanks } from "../../vote/shared/ranks.ts";
import type { Tier } from "./ballot.ts";
import { stageBound, stageTally, tierOf } from "./stage.ts";

export type Schedule = {
  opensAt: number;
  firstTallyAt: [number, number, number];
  initialWindow: number;
  maxWindows: number;
};
/** A BallotRecorded (ballot) or RegistrationRevoked (null) event, in chain order. */
export type Receipt = {
  tokenId: string;
  nonce: number;
  ballot: Uint8Array | null;
  block: number;
  timestamp: number;
};
export type Settled = {
  tier: Tier;
  at: number;
  forced: boolean;
  funded: number[];
  awards: Map<number, bigint>;
  /** What each badge paid for each funded initiative. */
  shares: Map<number, Map<string, bigint>>;
};
export type TierState =
  | { tier: Tier; status: "waiting"; startsAt: number }
  | {
    tier: Tier;
    status: "settling";
    window: number;
    windowEndsAt: number;
    latestEndAt: number;
    /** Every tally so far in this window funds what the window opened with. */
    quiet: boolean;
    /** The latest tally's funded set for this tier. */
    funded: number[];
  }
  | ({ status: "settled" } & Settled);
export type Rejection = {
  tokenId: string;
  nonce: number;
  reason: "tier_settled" | "registration_closed";
};
export type RoundState = {
  registrationClosesAt: number;
  tiers: [TierState, TierState, TierState];
  accepted: Map<string, Uint8Array>;
  rejected: Rejection[];
  closed: boolean;
  /** "If it settled now": the open tiers' chained tallies, from the first unsettled one. */
  live: { order: number[]; awards: Map<number, bigint>; tiers: Map<number, Tier> };
};

const TIERS: Tier[] = ["S", "A", "B"];

/** The cutoffs of tier `tier`'s windows 1..N: each window half the one before. */
export function windowEnds(s: Schedule, tier: number): number[] {
  const out: number[] = [];
  let at = s.firstTallyAt[tier];
  for (let k = 0; k < s.maxWindows; k++) {
    at += Math.floor(s.initialWindow / 2 ** k);
    out.push(at);
  }
  return out;
}

const sameSet = (a: number[], b: number[]) => {
  if (a.length !== b.length) return false;
  const y = new Set(b);
  return a.every((x) => y.has(x));
};
/** When and how a tier settled, kept the first time it was seen settled. */
export type SettleNeeds = { at: number; forced: boolean; needs: bigint[] };

export function replay(
  input: {
    schedule: Schedule;
    m: number;
    poolUsd: bigint;
    needs: bigint[];
    receipts: Receipt[];
    snapshots?: Settled[];
    /** The needs each tier settled with, kept when it first settled: a later donation
     * never moves a settled tier, even before its settlement is stored for good. */
    settleNeeds?: Partial<Record<Tier, SettleNeeds>>;
  },
  now: number,
): RoundState {
  const { schedule: s, m, poolUsd, needs } = input;
  const regDeadline = s.firstTallyAt[0] + s.initialWindow;
  const receipts = input.receipts.filter((r) => r.timestamp < now);
  const accepted = new Map<string, number[]>();
  const roll = new Set<string>();
  const rejected: Rejection[] = [];
  const settled: Settled[] = [];
  let next = 0; // the next receipt to apply

  const apply = (r: Receipt) => {
    if (r.ballot === null) {
      accepted.delete(r.tokenId);
      if (r.timestamp < regDeadline) roll.delete(r.tokenId);
      return;
    }
    const ballot = [...r.ballot];
    if (!roll.has(r.tokenId) && r.timestamp >= regDeadline) {
      rejected.push({ tokenId: r.tokenId, nonce: r.nonce, reason: "registration_closed" });
      return;
    }
    const old = accepted.get(r.tokenId);
    if (old) {
      // Tiers settle in order, so the settled ones are tiers 0..k-1 of the ballot.
      for (const [t] of settled.filter((x) => x.at <= r.timestamp).entries()) {
        const before = [...Array(m).keys()].filter((c) => tierOf(old, c) === t);
        const after = [...Array(m).keys()].filter((c) => tierOf(ballot, c) === t);
        if (!sameSet(before, after)) {
          rejected.push({ tokenId: r.tokenId, nonce: r.nonce, reason: "tier_settled" });
          return;
        }
      }
    }
    accepted.set(r.tokenId, ballot);
    roll.add(r.tokenId);
  };
  /** Applies every receipt before `time`; returns the blocks applied, in order. */
  const applyBefore = (time: number, perBlock?: () => void) => {
    while (next < receipts.length && receipts[next].timestamp < time) {
      const blockNo = receipts[next].block;
      while (
        next < receipts.length && receipts[next].block === blockNo &&
        receipts[next].timestamp < time
      ) apply(receipts[next++]);
      perBlock?.();
    }
  };

  /** The chained stage tallies from tier `first` on, after the settled tiers' payments. */
  /** Stages `first` up to (not including) `upTo`; the comparisons need only the first. */
  const tally = (first: number, costs: bigint[] = needs, upTo = TIERS.length) => {
    const voters = [...roll].filter((t) => accepted.has(t)).sort();
    const n = BigInt(voters.length);
    const each = n ? poolUsd / n : 0n;
    const weights = voters.map((t) => {
      let w = each;
      for (const x of settled) for (const paid of x.shares.values()) w -= paid.get(t) ?? 0n;
      return w;
    });
    const ballots = voters.map((t) => accepted.get(t)!);
    const ranks = ballots.map((b) => effectiveRanks(b, m));
    const done = new Set(settled.flatMap((x) => x.funded));
    let spent = settled.reduce(
      (a, x) => a + [...x.awards.values()].reduce((p, q) => p + q, 0n),
      0n,
    );
    const stages: { order: number[]; shares: Map<number, Map<string, bigint>> }[] = [];
    for (let t = first; t < upTo; t++) {
      // B, the last tier, counts to the last level (the Python's stage after the tiers).
      const bound = t === TIERS.length - 1 ? m : stageBound(ballots, t, TIERS.length, m);
      const candidates = [...Array(m).keys()].filter((c) => !done.has(c));
      const got = stageTally(costs, weights, ranks, poolUsd, spent, candidates, bound);
      const shares = new Map<number, Map<string, bigint>>();
      for (const c of got.order) {
        const paid = new Map<string, bigint>();
        for (const [i, d] of got.shares.get(c)!) paid.set(voters[i], d);
        shares.set(c, paid);
        done.add(c);
        spent += [...paid.values()].reduce((a, b) => a + b, 0n);
      }
      stages.push({ order: got.order, shares });
    }
    return stages;
  };
  const settle = (t: number, at: number, forced: boolean) => {
    const snap = input.snapshots?.find((x) => x.tier === TIERS[t]);
    if (snap) return settled.push(snap);
    const { order, shares } = tally(t, input.settleNeeds?.[TIERS[t]]?.needs ?? needs, t + 1)[0];
    const awards = new Map(
      order.map((c) => [c, [...shares.get(c)!.values()].reduce((a, b) => a + b, 0n)] as const),
    );
    settled.push({ tier: TIERS[t], at, forced, funded: order, awards, shares });
  };

  const tiers: TierState[] = [];
  for (let t = 0; t < TIERS.length; t++) {
    const start = s.firstTallyAt[t];
    const ends = windowEnds(s, t);
    if (now < start) {
      tiers.push({ tier: TIERS[t], status: "waiting", startsAt: start });
      continue;
    }
    // A tier already seen settled stays settled when it was: today's needs must not
    // re-judge its windows (they could reopen it, or close it earlier after the fact).
    const snap = input.snapshots?.find((x) => x.tier === TIERS[t]);
    const kept = input.settleNeeds?.[TIERS[t]];
    const pinned = snap ?? (kept && { at: kept.at, forced: kept.forced });
    if (pinned && now >= pinned.at) {
      applyBefore(pinned.at);
      settle(t, pinned.at, pinned.forced);
      tiers.push({ status: "settled", ...settled[settled.length - 1] });
      continue;
    }
    applyBefore(start);
    const first = () => tally(t, needs, t + 1)[0].order;
    let baseline = first();
    let state: TierState | null = null;
    for (let k = 0; k < ends.length; k++) {
      const end = ends[k];
      let quiet = true;
      const check = () => {
        if (!sameSet(first(), baseline)) quiet = false;
      };
      if (now < end) {
        applyBefore(now, check);
        state = {
          tier: TIERS[t],
          status: "settling",
          window: k + 1,
          windowEndsAt: end,
          latestEndAt: ends[ends.length - 1],
          quiet,
          funded: first(),
        };
        break;
      }
      applyBefore(end, check);
      const closing = first();
      if (!sameSet(closing, baseline)) quiet = false;
      if (quiet || k === ends.length - 1) {
        settle(t, end, !quiet);
        const x = settled[settled.length - 1];
        state = { status: "settled", ...x };
        break;
      }
      baseline = closing;
    }
    tiers.push(state!);
    if (state!.status !== "settled") {
      for (let u = t + 1; u < TIERS.length; u++) {
        tiers.push({ tier: TIERS[u], status: "waiting", startsAt: s.firstTallyAt[u] });
      }
      break;
    }
  }
  applyBefore(now);

  const firstOpen = settled.length;
  const live = {
    order: [] as number[],
    awards: new Map<number, bigint>(),
    tiers: new Map<number, Tier>(),
  };
  if (firstOpen < TIERS.length) {
    for (const [k, stage] of tally(firstOpen).entries()) {
      for (const c of stage.order) {
        live.order.push(c);
        live.tiers.set(c, TIERS[firstOpen + k]);
        live.awards.set(c, [...stage.shares.get(c)!.values()].reduce((a, b) => a + b, 0n));
      }
    }
  }
  return {
    registrationClosesAt: regDeadline,
    tiers: tiers as RoundState["tiers"],
    accepted: new Map([...accepted].map(([k, v]) => [k, Uint8Array.from(v)])),
    rejected,
    closed: settled.length === TIERS.length,
    live,
  };
}

/** Why the replay would not count `ballot` for `tokenId` if it landed now: the round
 * is over, registration closed before the badge voted, or it changes a settled tier. */
export function refusal(
  state: RoundState,
  tokenId: string,
  ballot: Uint8Array,
  now: number,
  m: number,
):
  | { code: "closed" }
  | { code: "registration_closed" }
  | { code: "tier_settled"; tier: Tier }
  | null {
  if (state.closed) return { code: "closed" };
  const old = state.accepted.get(tokenId);
  if (!old) return now >= state.registrationClosesAt ? { code: "registration_closed" } : null;
  const before = [...old];
  const after = [...ballot];
  for (const [t, tier] of state.tiers.entries()) {
    if (tier.status !== "settled") break;
    const a = [...Array(m).keys()].filter((c) => tierOf(before, c) === t);
    const b = [...Array(m).keys()].filter((c) => tierOf(after, c) === t);
    if (!sameSet(a, b)) return { code: "tier_settled", tier: tier.tier };
  }
  return null;
}
