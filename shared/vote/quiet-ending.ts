/** The slow quiet ending, replayed from the chain: tiers settle one at a time on the
 * contract's dates (vote/docs/quiet-ending-rules.md, 11 November 2026). Each window
 * has an opening tally, one after every block holding a receipt or an ask event (a
 * donation, a pledge, a pool change), and a closing tally; only the settling tier's
 * funded set is compared. Every tally uses the asks and pool at its own block, and a
 * project asking $0 is covered: no candidate, and left out of every comparison. A project
 * withdrawn at a tally's block is no candidate there either and is left out of the
 * comparison the same way, but unlike covered that is not final: undone, it competes
 * again in the tiers still open. The
 * tally itself is the Python's stage tally (./stage.ts). Amounts are micro-USD bigints.
 * Browser and Deno. */
import { effectiveRanks } from "../../vote/shared/ranks.ts";
import { isValidOnchainBallot, type Tier } from "./ballot.ts";
import { type ChainInputs, chainTally } from "./chain.ts";
import { tierOf } from "./stage.ts";

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
  /** Its log's index in the block: orders it against pool changes and new projects. */
  logIndex?: number;
  timestamp: number;
};
/** The asks and pool at one block. `event`: the block holds an ask-side tally event
 * (a pledge, a pool change, a balance change). `asks` may be shorter than the project
 * count for a block before later projects joined. */
export type ValuationEvidence = {
  available: boolean;
  issues: { project: number; currency: number; flags: number }[];
};
export type ChainState = {
  block: number;
  timestamp: number;
  asks: bigint[];
  poolUsd: bigint;
  poolInitialized: boolean;
  valuation?: ValuationEvidence;
  /** Flags by project; may be shorter than the project count (missing = false). */
  withdrawn: boolean[];
  event: boolean;
};
export type Settled = {
  tier: Tier;
  at: number;
  forced: boolean;
  funded: number[];
  awards: Map<number, bigint>;
  /** What each badge paid for each funded initiative. */
  shares: Map<number, Map<string, bigint>>;
  /** Asking $0 at the cutoff: covered by donations, final, never a candidate again. */
  covered: number[];
  /** Withdrawn at the cutoff ($0 award), and not covered: not final, a candidate again in
   * the tiers still open if the withdrawal is undone. */
  withdrawn: number[];
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
    /** The latest tally's covered projects ($0 asks). */
    covered: number[];
    /** The latest tally's withdrawn projects. */
    withdrawn: number[];
  }
  | ({ status: "settled" } & Settled);
export type Rejection = {
  tokenId: string;
  nonce: number;
  reason: "tier_settled" | "registration_closed" | "invalid_ballot";
};
export type RoundState = {
  poolInitialized: boolean;
  registrationClosesAt: number | null;
  tiers: [TierState, TierState, TierState];
  accepted: Map<string, Uint8Array>;
  rejected: Rejection[];
  closed: boolean;
  /** Each voting badge's equal share of the pool (micro-USD), before it pays anything. */
  share: bigint;
  /** "If it settled now": the open tiers' chained tallies, from the first unsettled one. */
  live: {
    order: number[];
    awards: Map<number, bigint>;
    tiers: Map<number, Tier>;
    /** What each badge would pay for each initiative, if it settled now. */
    shares: Map<number, Map<string, bigint>>;
    /** Asking $0 now, so in no tier. */
    covered: number[];
    /** Withdrawn now, so in no tier (and not covered). */
    withdrawn: number[];
  };
  /** The live tally's inputs, to re-run it with another ballot; null once closed. */
  liveInputs: ChainInputs | null;
  /** How many tiers have settled: the live tally starts at this tier. */
  firstOpen: number;
  /** The inputs each tier settled from (index = tier; null until it settles): what the
   * tally saw at that moment, to ask later what the settlement would have taken. */
  settleInputs: (ChainInputs | null)[];
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
type Look = { funded: number[]; covered: number[]; withdrawn: number[] };
/** Two tallies fund the same projects once every project covered or withdrawn at either
 * is left out of both: crossing $0, withdrawing or undoing alone is no change. */
const sameFunded = (a: Look, b: Look) => {
  const free = new Set([...a.covered, ...a.withdrawn, ...b.covered, ...b.withdrawn]);
  return sameSet(a.funded.filter((c) => !free.has(c)), b.funded.filter((c) => !free.has(c)));
};
/** The last item of `xs` for which `ok` holds, `ok` being true up to some index. */
function lastWhere<T>(xs: T[], ok: (x: T) => boolean): T | undefined {
  let lo = 0, hi = xs.length; // xs[..lo) ok, xs[hi..) not
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ok(xs[mid])) lo = mid + 1;
    else hi = mid;
  }
  return lo ? xs[lo - 1] : undefined;
}

export function replay(
  input: {
    schedule: Schedule;
    m: number;
    /** Strictly ascending by block (one state per block); at least one before the first
     * S-Tier tally. */
    states: ChainState[];
    receipts: Receipt[];
  },
  now: number,
): RoundState {
  const { schedule: s, m, states } = input;
  // The lookups below search by block and by time (lastWhere): one state per block, and
  // time never goes down.
  for (let i = 1; i < states.length; i++) {
    if (states[i].block <= states[i - 1].block || states[i].timestamp < states[i - 1].timestamp) {
      throw new Error("chain states must be strictly ascending by block");
    }
  }
  // First ballots: until S-Tier settles (the contract takes them until its latest
  // possible settlement). Every tally until then splits the pool among the ballots in,
  // so a newcomer shrinks the others' shares; S-Tier's charges fix them.
  const head = lastWhere(states, (x) => x.timestamp < now);
  if (!head || typeof head.poolInitialized !== "boolean") throw new Error("missing funding state");
  const chainDeadline = head.poolInitialized ? windowEnds(s, 0).at(-1)! : Infinity;
  const rollClosesAt = () => settled.find((x) => x.tier === "S")?.at ?? chainDeadline;
  const receipts = input.receipts.filter((r) => r.timestamp < now);
  const events = states.filter((x) => x.event && x.timestamp < now);
  const accepted = new Map<string, number[]>();
  const roll = new Set<string>();
  const rejected: Rejection[] = [];
  const settled: Settled[] = [];
  let next = 0; // the next receipt to apply
  let nextEvent = 0; // the next ask event

  /** The state a tally at block `b` uses: the last one at or before it. */
  const atBlock = (b: number) => {
    const x = lastWhere(states, (y) => y.block <= b);
    if (!x) throw new Error("no chain state");
    return x;
  };
  /** The state a tally at time `t` uses (a window's opening or cutoff, or now): the
   * last one strictly before it. */
  const before = (t: number) => {
    const x = lastWhere(states, (y) => y.timestamp < t);
    if (!x) throw new Error("no chain state");
    return x;
  };

  /** The contract judged the rules (size, groups) when it recorded the ballot, and the
   * transcript proves it did; only a ballot this replay can't read is refused. */
  const readable = (ballot: Uint8Array): boolean =>
    ballot.length >= 1 && ballot.length <= m &&
    isValidOnchainBallot(Uint8Array.from([...ballot, ...Array(m - ballot.length).fill(255)]), m);

  const apply = (r: Receipt) => {
    if (r.ballot === null) {
      accepted.delete(r.tokenId);
      if (r.timestamp < rollClosesAt()) roll.delete(r.tokenId);
      return;
    }
    if (!roll.has(r.tokenId) && r.timestamp >= rollClosesAt()) {
      rejected.push({ tokenId: r.tokenId, nonce: r.nonce, reason: "registration_closed" });
      return;
    }
    if (!readable(r.ballot)) {
      rejected.push({ tokenId: r.tokenId, nonce: r.nonce, reason: "invalid_ballot" });
      return;
    }
    // A ballot recorded before later projects joined leaves them unplaced.
    const ballot = [...r.ballot, ...Array(Math.max(0, m - r.ballot.length)).fill(255)];
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
  /** Applies every receipt and passes every ask event before `time`, block by block;
   * `perBlock` runs once per block, after everything in it. */
  const applyBefore = (time: number, perBlock?: (block: number) => void) => {
    for (;;) {
      const r = next < receipts.length && receipts[next].timestamp < time
        ? receipts[next].block
        : Infinity;
      const e = nextEvent < events.length && events[nextEvent].timestamp < time
        ? events[nextEvent].block
        : Infinity;
      const blockNo = Math.min(r, e);
      if (blockNo === Infinity) return;
      while (
        next < receipts.length && receipts[next].block === blockNo &&
        receipts[next].timestamp < time
      ) apply(receipts[next++]);
      while (nextEvent < events.length && events[nextEvent].block === blockNo) nextEvent++;
      perBlock?.(blockNo);
    }
  };

  /** Settled for good: funded in a settled tier, or covered at its settlement. Withdrawn
   * at a settlement is not final. */
  const finished = () => new Set(settled.flatMap((x) => [...x.funded, ...x.covered]));
  /** The projects withdrawn in `state` that nothing settled yet: a finished project's
   * flag is ignored, its award stands. */
  const withdrawnIn = (state: ChainState) => {
    const done = finished();
    return [...Array(m).keys()].filter((c) => state.withdrawn[c] === true && !done.has(c));
  };
  /** The projects asking $0 in `state` that nothing settled yet and that are not
   * withdrawn (withdrawn wins over covered). */
  const coveredIn = (state: ChainState) => {
    const done = finished();
    const out = new Set(withdrawnIn(state));
    return [...Array(m).keys()].filter((c) => state.asks[c] === 0n && !done.has(c) && !out.has(c));
  };
  /** What the chained tally starts from in `state`: the voters, after the settled
   * tiers' payments, its pool and asks (a project not in it yet asks $0: no candidate),
   * and its withdrawn projects (their costs stay their real asks). */
  const inputs = (state: ChainState): ChainInputs => {
    const { poolUsd } = state;
    const costs = Array.from({ length: m }, (_, c) => state.asks[c] ?? 0n);
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
    const done = finished();
    const spent = settled.reduce(
      (a, x) => a + [...x.awards.values()].reduce((p, q) => p + q, 0n),
      0n,
    );
    const withdrawn = new Set(withdrawnIn(state));
    return { m, costs, voters, weights, ranks, ballots, poolUsd, spent, done, withdrawn };
  };
  /** Stages `first` up to (not including) `upTo`; the comparisons need only the first. */
  const tally = (first: number, state: ChainState, upTo = TIERS.length) =>
    chainTally(inputs(state), first, upTo);
  /** Tier `t`'s funded set and the covered and withdrawn projects at `state`. */
  const look = (t: number, state: ChainState): Look => ({
    funded: tally(t, state, t + 1)[0].order,
    covered: coveredIn(state),
    withdrawn: withdrawnIn(state),
  });
  const settleInputs: (ChainInputs | null)[] = TIERS.map(() => null);
  /** Settles tier `t` with the state at its cutoff `at`. */
  const settle = (t: number, at: number, forced: boolean) => {
    const state = before(at);
    settleInputs[t] = inputs(state);
    const covered = coveredIn(state);
    const withdrawn = withdrawnIn(state);
    const { order, shares } = tally(t, state, t + 1)[0];
    const awards = new Map(
      order.map((c) => [c, [...shares.get(c)!.values()].reduce((a, b) => a + b, 0n)] as const),
    );
    settled.push({
      tier: TIERS[t],
      at,
      forced,
      funded: order,
      awards,
      shares,
      covered,
      withdrawn,
    });
  };

  const tiers: TierState[] = [];
  for (let t = 0; t < TIERS.length; t++) {
    const start = s.firstTallyAt[t];
    const ends = windowEnds(s, t);
    if (!head.poolInitialized || now < start) {
      tiers.push({ tier: TIERS[t], status: "waiting", startsAt: start });
      continue;
    }
    applyBefore(start);
    let baseline = look(t, before(start));
    let state: TierState | null = null;
    for (let k = 0; k < ends.length; k++) {
      const end = ends[k];
      let quiet = true;
      const same = (x: Look) => sameFunded(x, baseline);
      const check = (blockNo: number) => {
        if (!same(look(t, atBlock(blockNo)))) quiet = false;
      };
      if (now < end) {
        applyBefore(now, check);
        const latest = look(t, before(now));
        state = {
          tier: TIERS[t],
          status: "settling",
          window: k + 1,
          windowEndsAt: end,
          latestEndAt: ends[ends.length - 1],
          quiet,
          funded: latest.funded,
          covered: latest.covered,
          withdrawn: latest.withdrawn,
        };
        break;
      }
      applyBefore(end, check);
      const closing = look(t, before(end));
      if (!same(closing)) quiet = false;
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

  const voters = [...roll].filter((t) => accepted.has(t)).length;
  const firstOpen = settled.length;
  const live = {
    order: [] as number[],
    awards: new Map<number, bigint>(),
    tiers: new Map<number, Tier>(),
    shares: new Map<number, Map<string, bigint>>(),
    covered: [] as number[],
    withdrawn: [] as number[],
  };
  if (firstOpen < TIERS.length) {
    live.covered = coveredIn(head);
    live.withdrawn = withdrawnIn(head);
    for (const [k, stage] of tally(firstOpen, head).entries()) {
      for (const c of stage.order) {
        live.order.push(c);
        live.tiers.set(c, TIERS[firstOpen + k]);
        live.awards.set(c, [...stage.shares.get(c)!.values()].reduce((a, b) => a + b, 0n));
        live.shares.set(c, new Map(stage.shares.get(c)!));
      }
    }
  }
  return {
    poolInitialized: head.poolInitialized,
    registrationClosesAt: head.poolInitialized ? rollClosesAt() : null,
    tiers: tiers as RoundState["tiers"],
    accepted: new Map([...accepted].map(([k, v]) => [k, Uint8Array.from(v)])),
    rejected,
    closed: settled.length === TIERS.length,
    share: voters ? head.poolUsd / BigInt(voters) : 0n,
    live,
    liveInputs: firstOpen < TIERS.length ? inputs(head) : null,
    firstOpen,
    settleInputs,
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
  if (!old) {
    return state.registrationClosesAt !== null && now >= state.registrationClosesAt
      ? { code: "registration_closed" }
      : null;
  }
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
