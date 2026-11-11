import { Hono } from "hono";
import { type Hex, hexToBytes, isHex, verifyTypedData } from "viem";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAdmin, requireAuth } from "../middleware/auth.ts";
import { jsonBody } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";
import { verifyCode } from "../../shared/vote/code.ts";
import { isValidOnchainBallot, tierName } from "../../shared/vote/ballot.ts";
import { voteTypedData } from "../../shared/vote/typed-data.ts";
import { recordVote } from "../../shared/vote/record.ts";
import type { VoteRound } from "../services/vote-chain.ts";
import { type BoardCache, createBoardCache, readBoard } from "./board.ts";
import {
  finalWhatIfsAsync,
  liveLeadsAsync,
  type NextTier,
  nextTiersAsync,
  STEP,
} from "../../shared/vote/next-tier.ts";
import type { ChainInputs } from "../../shared/vote/chain.ts";
import {
  type Receipt,
  refusal,
  replay,
  type RoundState,
  type Settled,
  type TierState,
} from "../../shared/vote/quiet-ending.ts";
import { rulesRound } from "../../shared/vote/manifest.ts";
import { checkBallot, findProof } from "../../shared/vote/rules.ts";
import type { Tier } from "../../shared/vote/ballot.ts";

const PER_MINUTE = 30;
const PENDING_MS = 10 * 60_000;
// Covers one send with viem's RPC retries; a lease that outlives its holder just expires.
const LEASE_MS = 120_000;
/** A relayed tx the node has never heard of this long after sending was dropped. */
const UNSEEN_SECS = 60;
/** The relay pays for this many ballots per badge; after that, "send it yourself".
 * Mainnet gas is real money, so the real round gets fewer. */
const relaysPerBadge = (d: VoteRound) => d.manifest.kind === "real" ? 5 : 20;
/** The contract's ballot-rule reverts (vote/contracts/SignedBallots.sol). */
const RULE_REVERT = /\b(BallotTooSmall|TooFewIndependent|BadProof|GroupOverHalf|TooManyTiers)\b/;

/** Below this the real round's relayer stops and voters send it themselves. */
const RELAY_FLOOR_WEI = 10_000_000_000_000_000n; // 0.01 ETH
/** Long enough for any mint to land; the chain is the record after that. */
const MINTING_MS = 60 * 60_000;
const BALLOTS_CACHE_SECS = 5;
/** Blocks before the close are final well within this, so ballots can't change after. */
const FINAL_AFTER_SECS = 30 * 60;
const DRIP_WEI = 5_000_000_000_000_000n; // 0.005 Sepolia ETH
/** Deno KV refuses values over 64 KiB; JSON longer than this is kept out with room to spare. */
const KV_VALUE_MAX = 60_000;
/** A closed round's final what-ifs that failed (the search, or the replay to start it)
 * are tried again after this long. */
const FINAL_RETRY_SECS = 60;

const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  new HttpError(status, message, { code, ...extra });

type Call = Parameters<VoteRound["chain"]["send"]>[0];

/** Inside the lease: the relayer's next nonce is kept in KV and never goes below
 * the chain's pending count, so a lagging RPC node can't hand out a used nonce.
 * If the last send was dropped (the node still hasn't seen it a minute later and
 * the chain is behind), fall back to the chain's count so nothing queues behind
 * the gap. */
async function sendNext(kv: Deno.Kv, d: VoteRound, now: number, call: Call): Promise<Hex> {
  const key = ["vote", "relayer-nonce"];
  const stored = (await kv.get<{ next: number; hash: Hex; at: number }>(key)).value;
  const pending = await d.chain.relayerNonce();
  let nonce = Math.max(stored?.next ?? 0, pending);
  if (stored && stored.next > pending && now - stored.at > UNSEEN_SECS) {
    if ((await d.chain.txStatus(stored.hash)) === "unknown") nonce = pending;
  }
  try {
    const hash = await d.chain.send(call, nonce);
    await kv.set(key, { next: nonce + 1, hash, at: now });
    return hash;
  } catch (e) {
    // Resync from the chain next time (e.g. "nonce too low" after a manual tx).
    await kv.delete(key);
    throw e;
  }
}

/** One relayer send at a time across isolates, so account nonces and the
 * one-per-person check never race. */
async function withRelayer<T>(kv: Deno.Kv, fn: () => Promise<T>): Promise<T> {
  const key = ["vote", "relayer"];
  const id = crypto.randomUUID();
  for (let tries = 0; tries < 200; tries++) {
    const cur = await kv.get(key);
    if (cur.value === null) {
      const ok = await kv.atomic().check(cur).set(key, id, { expireIn: LEASE_MS }).commit();
      if (ok.ok) {
        try {
          return await fn();
        } finally {
          const now = await kv.get(key);
          if (now.value === id) await kv.atomic().check(now).delete(key).commit();
        }
      }
    }
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
  }
  throw fail(503, "busy", "The vote relayer is busy; try again in a moment.");
}

/** A round's own records (claims in flight, relays, gas, the ballot cache) live
 * under its contract, so a redeployed round starts clean with the same codes.
 * The relayer's nonce and lease are the account's, shared by every round. */
const round = (d: VoteRound): string[] => ["vote", d.manifest.contract.toLowerCase()];

const uint = (v: unknown): bigint | null => {
  if (typeof v !== "string" || !/^\d{1,20}$/.test(v)) return null;
  return BigInt(v);
};

type StoredSettled = Omit<Settled, "awards" | "shares"> & {
  awards: [number, string][];
  shares: [number, [string, string][]][];
};
const storeSettled = (x: Settled): StoredSettled => ({
  ...x,
  awards: [...x.awards].map(([c, v]) => [c, v.toString()]),
  shares: [...x.shares].map(([c, m]) => [c, [...m].map(([t, v]) => [t, v.toString()])]),
});
const loadSettled = (x: StoredSettled): Settled => ({
  ...x,
  awards: new Map(x.awards.map(([c, v]) => [c, BigInt(v)])),
  shares: new Map(x.shares.map(([c, m]) => [c, new Map(m.map(([t, v]) => [t, BigInt(v)]))])),
});

/** Over, and the blocks before the last settlement are final: nothing can change it. */
function isFinal(body: { closed: boolean; tiers: { status: string; at?: number }[] }, now: number) {
  const last = body.tiers[body.tiers.length - 1];
  return body.closed && last.status === "settled" &&
    now >= (last.at ?? Infinity) + FINAL_AFTER_SECS;
}

/** A cache write that never fails the request: a value too large for one KV entry is
 * not cached (the caller still serves it), and a failed write is only logged. */
export async function cacheSet(
  kv: Deno.Kv,
  key: Deno.KvKey,
  value: unknown,
  opts?: { expireIn?: number },
  log: (msg: string) => void = () => {},
): Promise<boolean> {
  const size = new TextEncoder().encode(JSON.stringify(value)).length;
  if (size > KV_VALUE_MAX) {
    log(`vote cache: ${key.join("/")} not cached (${size} bytes)`);
    return false;
  }
  try {
    await kv.set(key, value, opts);
    return true;
  } catch (e) {
    log(`vote cache: ${key.join("/")} not cached (${e instanceof Error ? e.message : e})`);
    return false;
  }
}

/** Everything a tally reads, in a fixed order. */
const inputsParts = (inp: ChainInputs) => [
  inp.m,
  inp.costs,
  inp.voters,
  inp.weights,
  inp.ranks,
  inp.ballots,
  inp.poolUsd,
  inp.spent,
  [...inp.done].sort((a, b) => a - b),
];

/** The what-if search's own version, part of every cache digest: when the way gaps, leads or
 * final figures are computed changes, bump it, and figures cached under the old code are
 * computed again instead of being served. */
export const WHAT_IFS_VERSION = 2;

async function digest(parts: unknown[]) {
  const text = JSON.stringify(
    [WHAT_IFS_VERSION, ...parts],
    (_, v) => typeof v === "bigint" ? v.toString() : v,
  );
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** A digest of everything the gap search reads, so the same tally is searched once. */
const inputsKey = (contract: string, inp: ChainInputs, firstOpen: number) =>
  digest([contract, firstOpen, ...inputsParts(inp)]);

/** A digest of what the final what-ifs read: each settlement's inputs and what each tier
 * funded. A closed round never changes, so it is searched once. */
const finalKey = (contract: string, settleInputs: (ChainInputs | null)[], funded: number[][]) =>
  digest([contract, settleInputs.map((x) => x && inputsParts(x)), funded]);

/** Each initiative's gap to its next tier, as JSON (slugs for indices, a string for the gap). */
function nextJson(next: Map<number, NextTier>, slugs: string[]) {
  return Object.fromEntries([...next].map(([c, n]) => [slugs[c], {
    tier: n.tier,
    gap: n.gap === null ? null : n.gap.toString(),
    comesIn: n.comesIn.map(([i, tier]) => ({ slug: slugs[i], tier })),
    dropsOut: n.dropsOut.map(([i, tier]) => ({ slug: slugs[i], tier })),
    moves: n.moves.map(([i, from, to]) => ({ slug: slugs[i], from, to })),
  }]));
}
type NextJson = ReturnType<typeof nextJson>;
/** How far ahead each initiative is, as JSON. Under one step there's nothing to tell. */
const leadJson = (lead: Map<number, bigint>, slugs: string[]): Record<string, string> =>
  Object.fromEntries(
    [...lead].filter(([, v]) => v >= STEP).map(([c, v]) => [slugs[c], v.toString()]),
  );
/** A finished search: the digest of its inputs, the open tier it looked from, and when.
 * Tier-S's leads come with it while Tier-S is open. */
type KnownNext = {
  key: string;
  firstOpen: number;
  at: number;
  next: NextJson;
  lead?: Record<string, string>;
};
type FinalJson = { next: NextJson; lead: Record<string, string> };
/** A closed round's final what-ifs, with the digest of what they were judged from. */
type KnownFinal = { key: string; at: number; final: FinalJson };

/** The round state as JSON: slugs for initiatives, decimal strings for micro-USD. */
function roundJson(st: RoundState & { poolUsd: bigint }, slugs: string[]) {
  const named = (cs: number[]) => cs.map((c) => slugs[c]);
  const money = (m: Map<number, bigint>) =>
    Object.fromEntries([...m].map(([c, v]) => [slugs[c], v.toString()]));
  /** tokenId → slug → what that badge paid for it (only what it paid). */
  const paidBy = (shares: Map<number, Map<string, bigint>>) => {
    const out: Record<string, Record<string, string>> = {};
    for (const [c, byBadge] of shares) {
      for (const [t, v] of byBadge) if (v > 0n) (out[t] ??= {})[slugs[c]] = v.toString();
    }
    return out;
  };
  const tier = (t: TierState) =>
    t.status === "settled"
      ? {
        tier: t.tier,
        status: t.status,
        at: t.at,
        forced: t.forced,
        funded: named(t.funded),
        awards: money(t.awards),
        paid: paidBy(t.shares),
      }
      : t.status === "settling"
      ? { ...t, funded: named(t.funded) }
      : t;
  return {
    registrationClosesAt: st.registrationClosesAt,
    closed: st.closed,
    share: st.share.toString(),
    /** The pool on-chain now (micro-USD): what a new ballot's size is judged against. */
    poolUsd: st.poolUsd.toString(),
    tiers: st.tiers.map(tier),
    accepted: Object.fromEntries(
      [...st.accepted].map((
        [t, b],
      ) => [t, `0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`]),
    ),
    rejected: st.rejected,
    live: {
      funded: named(st.live.order),
      awards: money(st.live.awards),
      tiers: Object.fromEntries([...st.live.tiers].map(([c, t]) => [slugs[c], t])),
    },
  };
}

export function voteRoutes(deps: Deps, boardCache?: BoardCache) {
  const r = new Hono<Vars>();
  const dc = (): VoteRound => {
    if (!deps.vote) throw fail(503, "off", "No vote is deployed right now.");
    return deps.vote;
  };
  /** Paper codes, claims and the gas drip belong to test rounds only. */
  const testOnly = (d: VoteRound) => {
    if (d.manifest.kind !== "test") throw fail(404, "off", "This vote doesn't use paper codes.");
  };
  const board = boardCache ?? createBoardCache(deps);
  /** Each initiative's need, micro-USD, as the vote results count it: goal − raised. */
  const needsOf = async (d: VoteRound): Promise<bigint[]> => {
    if (d.needs) return await d.needs();
    const cards = new Map((await readBoard(deps, board)).cards.map((c) => [c.initiative.slug, c]));
    return d.manifest.slugs.map((slug) => {
      const c = cards.get(slug);
      // Never $0: that would fund it at the first level that opens it, maybe for good.
      if (!c) {
        throw fail(
          503,
          "needs_unavailable",
          "An initiative in the vote isn't on the board right now.",
        );
      }
      return BigInt(Math.max(0, Math.round((c.initiative.goalUsd - c.summary.total) * 1e6)));
    });
  };
  /** The quiet ending replayed now. A tier's settlement is written once and reused, so
   * later donations (needs) never move it. */
  const roundState = async (d: VoteRound): Promise<RoundState & { poolUsd: bigint }> => {
    const kv = deps.db.kv;
    const tiers: Tier[] = ["S", "A", "B"];
    const stored = await Promise.all(
      tiers.map((t) => kv.get<StoredSettled>([...round(d), "settled", t])),
    );
    const snapshots = stored.flatMap((x) => (x.value ? [loadSettled(x.value)] : []));
    // When each tier settled and the needs it settled with, kept the first time it
    // was seen settled: later replays don't re-judge its windows.
    type Kept = { at: number; forced: boolean; needs: string[] };
    const kept = await Promise.all(
      tiers.map((t) => kv.get<Kept>([...round(d), "settle-needs", t])),
    );
    const settleNeeds = Object.fromEntries(
      tiers.flatMap((t, i) => {
        const k = kept[i].value;
        if (!k) return [];
        const final = deps.now() >= k.at + FINAL_AFTER_SECS;
        return [[t, { at: k.at, forced: k.forced, needs: k.needs.map(BigInt), final }]];
      }),
    );
    const needs = await needsOf(d);
    const receipts: Receipt[] = (await d.chain.ballots()).map((b, i) => ({
      tokenId: b.tokenId,
      nonce: "revoked" in b ? 0 : b.nonce ?? 0,
      ballot: "revoked" in b ? null : hexToBytes(b.ballot),
      block: b.block ?? i + 1,
      ...("logIndex" in b && b.logIndex !== undefined ? { logIndex: b.logIndex } : {}),
      timestamp: b.timestamp,
    }));
    const m = d.manifest;
    // Rounds deployed with the ballot rules: judge each ballot by the projects and pool
    // on-chain when it landed (projects missing from the history were there at deploy).
    const history = m.ballotRules ? await d.chain.rulesHistory() : null;
    // A project the admin added on-chain that this site's manifest doesn't have yet
    // (before `vote-deploy --added` and a redeploy): its ballots can't be read, so hold
    // the round rather than refuse them (or settle without them).
    if (history && history.addedAt.length > m.slugs.length) {
      throw fail(
        503,
        "round_out_of_date",
        "A project was just added to the vote; the results are back once this site knows it.",
      );
    }
    const poolUsd = history?.pool.at(-1)?.poolUsd ?? BigInt(m.poolUsd);
    const st = replay({
      schedule: m.schedule,
      m: m.slugs.length,
      poolUsd: BigInt(m.poolUsd),
      needs,
      receipts,
      snapshots,
      settleNeeds,
      ...(history
        ? {
          rules: {
            round: rulesRound(m),
            addedAt: m.slugs.map((_, i) => history.addedAt[i] ?? null),
            pool: history.pool,
          },
        }
        : {}),
    }, deps.now());
    for (const [i, t] of st.tiers.entries()) {
      const k = kept[i].value;
      const keyT = [...round(d), "settle-needs", tiers[i]];
      if (!k && t.status === "settled") {
        // First seen settled: keep its needs (a donation can't move it from here on).
        await kv.atomic().check(kept[i]).set(keyT, {
          at: t.at,
          forced: t.forced,
          needs: needs.map(String),
        }).commit();
      } else if (k && deps.now() < k.at + FINAL_AFTER_SECS) {
        // Not final yet: follow the replay (a late ballot may move or undo it), same needs.
        if (t.status !== "settled") await kv.atomic().check(kept[i]).delete(keyT).commit();
        else if (t.at !== k.at || t.forced !== k.forced) {
          await kv.atomic().check(kept[i]).set(keyT, { ...k, at: t.at, forced: t.forced }).commit();
        }
      }
      // Kept only once the blocks before the settlement are final: until then a
      // lagging RPC may still be missing a ballot that changes it.
      if (t.status !== "settled" || stored[i].value) continue;
      if (deps.now() < t.at + FINAL_AFTER_SECS) continue;
      const { status: _, ...x } = t;
      await kv.atomic().check(stored[i]).set([...round(d), "settled", t.tier], storeSettled(x))
        .commit();
    }
    return Object.assign(st, { poolUsd });
  };

  /** The replay, reused for a few seconds in this isolate: every relayed ballot asks. */
  let recent:
    | { at: number; contract: string; state: Promise<RoundState & { poolUsd: bigint }> }
    | null = null;
  const recentRound = (d: VoteRound): Promise<RoundState & { poolUsd: bigint }> => {
    if (
      !recent || recent.contract !== d.manifest.contract ||
      deps.now() - recent.at >= BALLOTS_CACHE_SECS
    ) {
      const state = roundState(d);
      recent = { at: deps.now(), contract: d.manifest.contract, state };
      state.catch(() => (recent = null));
    }
    return recent.state;
  };

  /** The last gap search finished in this isolate. The search is long for a large round
   * and shares the isolate with the ballot relays, so it yields between tallies, only
   * one runs at a time, and no request waits for it. */
  let lastNext: (KnownNext & { contract: string }) | null = null;
  let searching = false;
  const nextKey = (d: VoteRound) => [...round(d), "next"];
  type Ahead = Pick<KnownNext, "next" | "lead">;
  /** The newest search known (this isolate's or the stored one) for the open tier
   * `firstOpen`, whichever inputs it ran on; none once no tier is open. */
  const knownNext = async (d: VoteRound, firstOpen: number | null, stored?: KnownNext | null) => {
    if (firstOpen === null) return undefined;
    stored ??= (await deps.db.kv.get<KnownNext>(nextKey(d))).value;
    const mine = lastNext?.contract === d.manifest.contract ? lastNext : null;
    const known = [stored, mine].filter((k): k is KnownNext => k?.firstOpen === firstOpen);
    return known.sort((a, b) => b.at - a.at)[0];
  };
  /** The gap to the next tier for this replay. The same inputs are searched once (across
   * isolates through KV); new ones start a search in the background, and until it is
   * done the last one known for the same open tier is served (or none). */
  const nextFor = async (
    d: VoteRound,
    st: RoundState,
  ): Promise<Ahead | undefined> => {
    if (!st.liveInputs) return undefined;
    const contract = d.manifest.contract;
    const key = await inputsKey(contract, st.liveInputs, st.firstOpen);
    if (lastNext?.contract === contract && lastNext.key === key) return lastNext;
    const stored = (await deps.db.kv.get<KnownNext>(nextKey(d))).value;
    if (stored?.key === key) {
      lastNext = { ...stored, contract };
      return stored;
    }
    if (!searching) {
      searching = true;
      const { liveInputs, firstOpen } = st;
      const work = (async () => {
        const slugs = d.manifest.slugs;
        const next = nextJson(await nextTiersAsync(liveInputs, firstOpen), slugs);
        // A lead only means something while Tier-S can still change. A failed lead search
        // still keeps the gaps.
        let lead: Record<string, string> | undefined;
        if (firstOpen === 0) {
          try {
            lead = leadJson(await liveLeadsAsync(liveInputs, firstOpen), slugs);
          } catch (e) {
            deps.log(`vote lead: ${e instanceof Error ? e.message : e}`);
          }
        }
        const known: KnownNext = {
          key,
          firstOpen,
          at: deps.now(),
          next,
          ...(lead ? { lead } : {}),
        };
        lastNext = { ...known, contract };
        await cacheSet(deps.db.kv, nextKey(d), known, undefined, deps.log);
      })().catch((e) => deps.log(`vote next: ${e instanceof Error ? e.message : e}`))
        .finally(() => (searching = false));
      deps.background?.(work);
    }
    return await knownNext(d, st.firstOpen, stored);
  };

  /** The final what-ifs, the same way: searched once per digest in the background (one
   * search at a time, shared with the gap search), kept in KV, never waited for. */
  let lastFinal: (KnownFinal & { contract: string }) | null = null;
  /** The digest this isolate last tried to find the final what-ifs for (a search started,
   * or the replay to start one failed), and when: a failure is retried about once a
   * minute, not on every request. */
  let finalTried: { key: string; at: number } | null = null;
  const triedRecently = (key: string) =>
    finalTried?.key === key && deps.now() - finalTried.at < FINAL_RETRY_SECS;
  const finalStoreKey = (d: VoteRound) => [...round(d), "final"];
  /** The final what-ifs judged from `key`, if this isolate or KV has them. */
  const knownFinal = async (d: VoteRound, key: string | undefined) => {
    if (key === undefined) return undefined;
    if (lastFinal?.contract === d.manifest.contract && lastFinal.key === key) {
      return lastFinal.final;
    }
    const stored = (await deps.db.kv.get<KnownFinal>(finalStoreKey(d))).value;
    if (stored?.key !== key) return undefined;
    lastFinal = { ...stored, contract: d.manifest.contract };
    return stored.final;
  };
  /** The digest a closed round's final what-ifs are judged from; none while it is open. */
  const finalDigest = (d: VoteRound, st: RoundState) => {
    if (!st.closed) return Promise.resolve(undefined);
    const funded = st.tiers.map((t) => (t.status === "settled" ? t.funded : []));
    return finalKey(d.manifest.contract, st.settleInputs, funded);
  };
  const finalFor = async (
    d: VoteRound,
    st: RoundState,
    key: string | undefined,
  ): Promise<FinalJson | undefined> => {
    if (key === undefined) return undefined;
    const known = await knownFinal(d, key);
    if (known || searching || triedRecently(key)) return known;
    searching = true;
    finalTried = { key, at: deps.now() };
    const contract = d.manifest.contract;
    // Each initiative's final tier: the settled tier that funded it.
    const finalTier = new Map<number, number>();
    for (const [k, t] of st.tiers.entries()) {
      if (t.status !== "settled") continue;
      for (const c of t.funded) finalTier.set(c, k);
    }
    const { settleInputs } = st;
    const work = (async () => {
      const slugs = d.manifest.slugs;
      const got = await finalWhatIfsAsync(settleInputs, finalTier, slugs.length);
      const final = { next: nextJson(got.next, slugs), lead: leadJson(got.lead, slugs) };
      const known = { key, at: deps.now(), final };
      lastFinal = { ...known, contract };
      await cacheSet(deps.db.kv, finalStoreKey(d), known, undefined, deps.log);
    })().catch((e) => deps.log(`vote final: ${e instanceof Error ? e.message : e}`))
      .finally(() => (searching = false));
    deps.background?.(work);
    return undefined;
  };

  const open = (d: VoteRound) => {
    if (deps.now() >= d.manifest.closesAt) throw fail(410, "closed", "Voting has closed.");
  };
  const limit = async (name: string, ip: string | null) => {
    if (!(await deps.db.rateLimit(`vote-${name}:${ip ?? "?"}`, PER_MINUTE, 60))) {
      throw new HttpError(429, "slow down");
    }
  };
  const codeNumber = async (d: VoteRound, code: unknown) => {
    const n = typeof code === "string" ? await verifyCode(code, d.manifest.issuer ?? "") : null;
    if (n === null) throw fail(400, "bad_code", "This code doesn't look right.");
    return BigInt(n);
  };

  r.get("/code/:code", async (c) => {
    const d = dc();
    testOnly(d);
    const n = await codeNumber(d, c.req.param("code"));
    const owner = await d.chain.ownerOf(n);
    return c.json({ n: Number(n), claimed: owner !== null, owner });
  });

  /** The badges the signed-in account votes with, so the menu and /vote lead to its ballot. */
  r.get("/mine", requireAuth, async (c) => {
    const d = dc();
    await limit("mine", c.var.ip);
    const ids = await d.chain.idsOf(c.var.user!.address as Hex);
    return c.json({ ids: [...ids].sort((a, b) => a - b) });
  });

  /** Admin → Vote: who pays for relayed ballots, and what it has left. */
  r.get("/relayer", requireAdmin, async (c) => {
    const d = dc();
    const address = d.chain.relayerAddress();
    const balanceWei = address ? (await d.chain.balance(address)).toString() : null;
    return c.json({ address, balanceWei, chainId: d.manifest.chainId });
  });

  r.post("/claim", requireAuth, async (c) => {
    const d = dc();
    testOnly(d);
    await limit("claim", c.var.ip);
    open(d);
    const body = await jsonBody(c, ["code"]);
    const n = await codeNumber(d, body.code);
    const to = c.var.user!.address as Hex;
    // An EIP-7702 account (code 0xef0100 + delegate) is still a key-held wallet:
    // its ECDSA signatures verify (the relay uses record()). Other code is a
    // contract wallet, which can't sign on Sepolia like the voter's key does.
    const code = (await d.chain.codeOf(to)).toLowerCase();
    const delegated = code.startsWith("0xef0100") && code.length === 2 + 2 * 23;
    if (code !== "0x" && !delegated) {
      throw fail(422, "smart_wallet", "Use email or a regular wallet for this one.");
    }
    const kv = deps.db.kv;
    const tokenKey = [...round(d), "minting", "token", n.toString()];
    const addrKey = [...round(d), "minting", "address", to.toLowerCase()];
    // A mint just sent is not on-chain yet: its markers hold the token and the
    // address until it lands, and are dropped if it reverted or was dropped.
    const stillMinting = async (key: Deno.KvKey) => {
      const m = await kv.get<string>(key);
      if (!m.value) return false;
      const status = await d.chain.txStatus(m.value as Hex);
      if (status === "pending" || status === "success") return true;
      await kv.delete(key);
      return false;
    };
    const hash = await withRelayer(kv, async () => {
      if ((await d.chain.ownerOf(n)) !== null || (await stillMinting(tokenKey))) {
        throw fail(409, "claimed", "This badge is already taken.");
      }
      if ((await d.chain.balanceOf(to)) > 0n || (await stillMinting(addrKey))) {
        throw fail(409, "one_per_person", "One badge per person.");
      }
      // _safeMint asks a delegated wallet's code to accept the badge; check first.
      if (delegated && !(await d.chain.canMint(to, n))) {
        throw fail(
          422,
          "cannot_receive",
          "This wallet can't receive the badge. Use email or another wallet.",
        );
      }
      const h = await sendNext(kv, d, deps.now(), { fn: "mint", args: [to, n] });
      await kv.atomic()
        .set(tokenKey, h, { expireIn: MINTING_MS })
        .set(addrKey, h, { expireIn: MINTING_MS })
        .commit();
      return h;
    });
    return c.json({ hash });
  });

  r.post("/ballot", async (c) => {
    const d = dc();
    await limit("ballot", c.var.ip);
    open(d);
    const body = await jsonBody(c, ["tokenId", "nonce", "ballot", "signature"]);
    const tokenId = uint(body.tokenId);
    const nonce = uint(body.nonce);
    const ballot = body.ballot;
    const signature = body.signature;
    const m = d.manifest.slugs.length;
    // With the ballot rules a ballot may be shorter than the projects (signed before one
    // was added): the missing ones are unplaced. Older rounds need every byte.
    const bytes = typeof ballot === "string" && isHex(ballot) ? hexToBytes(ballot) : null;
    const padded = bytes && d.manifest.ballotRules && bytes.length >= 1 && bytes.length <= m
      ? Uint8Array.from([...bytes, ...Array(m - bytes.length).fill(255)])
      : bytes;
    if (
      tokenId === null || nonce === null || typeof ballot !== "string" || !isHex(ballot) ||
      !padded || typeof signature !== "string" ||
      !isHex(signature) || !isValidOnchainBallot(padded, m)
    ) throw fail(400, "bad_ballot", "That ballot isn't valid.");
    const owner = await d.chain.ownerOf(tokenId);
    if (!owner) throw fail(404, "no_badge", "No such badge.");
    const valid = await verifyTypedData({
      address: owner,
      ...voteTypedData(d.manifest, tokenId, owner, nonce, ballot),
      signature,
    }).catch(() => false);
    if (!valid) throw fail(401, "bad_signature", "The signature doesn't match the badge's owner.");
    // The ballot rules, judged with the pool on-chain now: the contract would refuse it.
    if (d.manifest.ballotRules) {
      const { poolUsd } = await recentRound(d);
      const checked = checkBallot(hexToBytes(ballot), rulesRound(d.manifest, poolUsd));
      if (!checked.ok) {
        throw fail(422, "invalid_ballot", "This ballot breaks the ballot rules.", {
          errors: checked.errors.map((e) =>
            Object.fromEntries(
              Object.entries(e).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
            )
          ),
        });
      }
    }
    // What the quiet ending would refuse is refused here, before anyone pays gas for it.
    // Nothing can be refused before registration closes (no tier settles before it).
    const regDeadline = d.manifest.schedule.firstTallyAt[0] + d.manifest.schedule.initialWindow;
    const no = deps.now() < regDeadline ? null : refusal(
      await recentRound(d),
      tokenId.toString(),
      padded,
      deps.now(),
      d.manifest.slugs.length,
    );
    if (no?.code === "closed") throw fail(410, "closed", "Voting has closed.");
    if (no?.code === "registration_closed") {
      throw fail(403, "registration_closed", "Registration closed before this badge voted.");
    }
    if (no?.code === "tier_settled") {
      throw fail(
        409,
        "tier_settled",
        `${tierName(no.tier)} has settled: its initiatives can't move.`,
        {
          tier: no.tier,
        },
      );
    }
    if (d.manifest.kind === "real") {
      const relayer = d.chain.relayerAddress();
      if (!relayer || (await d.chain.balance(relayer)) < RELAY_FLOOR_WEI) {
        throw fail(503, "relay_low", "The relay is out of gas for now. Use “Send it yourself”.");
      }
    }

    const kv = deps.db.kv;
    const pendingKey = [...round(d), "pending", tokenId.toString(), nonce.toString()];
    const countKey = [...round(d), "relays", tokenId.toString()];
    const hash = await withRelayer(kv, async () => {
      const pending = await kv.get<{ hash: Hex; at: number }>(pendingKey);
      if (pending.value) {
        // Still on its way (or landed): the same hash. Reverted, or never seen
        // by the node a minute on (dropped): let this one go out again.
        const status = await d.chain.txStatus(pending.value.hash);
        const dropped = status === "reverted" ||
          (status === "unknown" && deps.now() - pending.value.at > UNSEEN_SECS);
        if (!dropped) {
          throw fail(409, "pending", "This ballot is already on its way.", {
            hash: pending.value.hash,
          });
        }
        await kv.delete(pendingKey);
      }
      if (nonce !== (await d.chain.nonceOf(tokenId)) + 1n) {
        throw fail(409, "stale_nonce", "This ballot was replaced; reload to see the latest.");
      }
      const relays = (await kv.get<number>(countKey)).value ?? 0;
      if (relays >= relaysPerBadge(d)) {
        throw fail(
          429,
          "relay_limit",
          "This badge has used its relayed ballots. Use “Send it yourself” to change it again.",
        );
      }
      const h = await sendNext(kv, d, deps.now(), {
        fn: "record",
        args: [[
          recordVote({
            tokenId,
            nonce,
            ballot: ballot as Hex,
            signature: signature as Hex,
            proof: findProof(hexToBytes(ballot as Hex), rulesRound(d.manifest)) ?? [],
          }),
        ]],
      }).catch((e) => {
        // The contract enforced a rule this check passed: the pool rose meanwhile (the
        // check uses a replay up to a few seconds old). Say so, not "internal error".
        if (RULE_REVERT.test(String(e))) {
          throw fail(
            422,
            "invalid_ballot",
            "This ballot breaks the ballot rules: the pool may have just changed. Check it and send again.",
            { errors: [] },
          );
        }
        throw e;
      });
      await kv.atomic()
        .set(pendingKey, { hash: h, at: deps.now() }, { expireIn: PENDING_MS })
        .set(countKey, relays + 1)
        .commit();
      return h;
    });
    return c.json({ hash });
  });

  // "Send it yourself": a voter with no Sepolia ETH gets one small top-up, ever.
  r.post("/gas", requireAuth, async (c) => {
    const d = dc();
    testOnly(d);
    await limit("gas", c.var.ip);
    open(d);
    const body = await jsonBody(c, ["tokenId"]);
    const tokenId = uint(body.tokenId);
    if (tokenId === null) throw fail(400, "bad_badge", "No such badge.");
    const me = c.var.user!.address as Hex;
    const owner = await d.chain.ownerOf(tokenId);
    if (!owner || owner.toLowerCase() !== me.toLowerCase()) {
      throw fail(403, "not_owner", "Only the badge's owner can ask for gas.");
    }
    if ((await d.chain.balance(me)) >= 2n * (await d.chain.estimateRecordFor())) {
      return c.json({ hash: null });
    }
    const kv = deps.db.kv;
    const key = [...round(d), "gas", tokenId.toString()];
    const hash = await withRelayer(kv, async () => {
      // Marked before sending: a failed send never pays twice.
      const marked = await kv.atomic().check({ key, versionstamp: null }).set(key, me).commit();
      if (!marked.ok) throw fail(409, "already_dripped", "This badge already got its gas.");
      return await sendNext(kv, d, deps.now(), { fn: "drip", to: me, value: DRIP_WEI });
    });
    return c.json({ hash });
  });

  /** The quiet ending: each tier's state, the accepted ballots, refusals, and what the
   * open tiers would fund if they settled now. Polled; read at most once per window. */
  r.get("/round", async (c) => {
    const d = dc();
    const kv = deps.db.kv;
    const key = [...round(d), "round"];
    // firstOpen: the first open tier, or null once none is (no live tally to look ahead from).
    // finalKey: once closed, the digest its final what-ifs are judged from.
    type Cached = {
      at: number;
      body: ReturnType<typeof roundJson>;
      firstOpen?: number | null;
      finalKey?: string;
    };
    const cached = (await kv.get<Cached>(key)).value;
    const withAhead = (
      body: Cached["body"],
      ahead: Ahead | undefined,
      final: FinalJson | undefined,
    ) => ({
      ...body,
      live: {
        ...body.live,
        ...(ahead ? { next: ahead.next } : {}),
        ...(ahead?.lead ? { lead: ahead.lead } : {}),
      },
      ...(final ? { final } : {}),
    });
    let replayed: (RoundState & { poolUsd: bigint }) | undefined;
    if (
      cached &&
      (isFinal(cached.body, cached.at) || deps.now() - cached.at < BALLOTS_CACHE_SECS)
    ) {
      const final = await knownFinal(d, cached.finalKey);
      const fromCache = async () =>
        c.json(withAhead(cached.body, await knownNext(d, cached.firstOpen ?? null), final));
      // A closed round whose what-ifs nobody here has, or is searching for, is replayed
      // once more below: the cached round has no inputs to start the search from.
      // (An entry cached before it carried a digest is tried under "".)
      const tried = cached.finalKey ?? "";
      if (!cached.body.closed || final || searching || triedRecently(tried)) {
        return await fromCache();
      }
      // That replay is only for the what-ifs: if it fails (RPC or board down), the
      // cached round is still served, and the replay waits a minute before trying again.
      try {
        replayed = await roundState(d);
      } catch (e) {
        deps.log(`vote final: replay failed (${e instanceof Error ? e.message : e})`);
        finalTried = { key: tried, at: deps.now() };
        return await fromCache();
      }
    }
    const st = replayed ?? await roundState(d);
    const body = roundJson(st, d.manifest.slugs);
    const at = deps.now();
    const firstOpen = st.liveInputs ? st.firstOpen : null;
    const fk = await finalDigest(d, st);
    await cacheSet(
      kv,
      key,
      { at, body, firstOpen, ...(fk ? { finalKey: fk } : {}) },
      isFinal(body, at) ? undefined : { expireIn: 60_000 },
      deps.log,
    );
    return c.json(withAhead(body, await nextFor(d, st), await finalFor(d, st, fk)));
  });

  // The ballots that count (the quiet ending's accepted ones), for the vote results.
  // Read at most once per few seconds; once the round's end is final, read once, kept.
  r.get("/ballots", async (c) => {
    const d = dc();
    const key = [...round(d), "ballots"];
    const cached = await deps.db.kv.get<{ at: number; final: boolean; ballots: unknown[] }>(key);
    if (cached.value?.final) return c.json({ at: cached.value.at, ballots: cached.value.ballots });
    if (cached.value && deps.now() - cached.value.at < BALLOTS_CACHE_SECS) {
      return c.json({ at: cached.value.at, ballots: cached.value.ballots });
    }
    const body = roundJson(await roundState(d), d.manifest.slugs);
    const ballots = Object.entries(body.accepted).map(([tokenId, ballot]) => ({ tokenId, ballot }));
    const at = deps.now();
    const final = isFinal(body, at);
    await cacheSet(
      deps.db.kv,
      key,
      { at, final, ballots },
      final ? undefined : { expireIn: 60_000 },
      deps.log,
    );
    return c.json({ at, ballots });
  });

  return r;
}
