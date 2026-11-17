import { roundId, roundKey } from "../../shared/vote/keys.ts";
import { Hono } from "hono";
import { type Hex, hexToBytes, isHex, verifyTypedData } from "viem";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAdmin, requireAuth } from "../middleware/auth.ts";
import { jsonBody } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";
import { isValidBallotShape, tierName } from "../../shared/vote/ballot.ts";
import { voteTypedData } from "../../shared/vote/typed-data.ts";
import { contractOwner, recordCall } from "../../shared/vote/record.ts";
import { kvStateCache, type VoteRound } from "../services/vote-chain.ts";
import { RelayBudgetError } from "../services/vote-relay-policy.ts";
import { currentVote } from "../services/vote-active.ts";
import { etagOf, matchesEtag } from "./feeds.ts";
import { chainStates, type StateSource } from "../../shared/vote/chain-states.ts";
import {
  finalWhatIfsAsync,
  giftGapsAsync,
  type NextTier,
  nextTiersAsync,
} from "../../shared/vote/next-tier.ts";
import { type Threats, threatsAsync } from "../../shared/vote/threat.ts";
import type { ChainInputs } from "../../shared/vote/chain.ts";
import { type ChainState, refusal, type RoundState } from "../../shared/vote/quiet-ending.ts";
import type { LastChangeMemo } from "../../shared/vote/last-change.ts";
import {
  errorText,
  ReplayError,
  replayRound,
  type Round,
  roundJson,
  type RoundSource,
} from "../../shared/vote/replay-round.ts";
import { rulesRound } from "../../shared/vote/manifest.ts";
import { checkBallot, findProof } from "../../shared/vote/rules.ts";

const PER_MINUTE = 30;
const PENDING_MS = 10 * 60_000;
// Covers one send with viem's RPC retries; a lease that outlives its holder just expires.
const LEASE_MS = 120_000;
/** A relayed tx the node has never heard of this long after sending was dropped. */
const UNSEEN_SECS = 60;
/** The relay pays for this many ballots per badge; after that, "send it yourself".
 * Mainnet gas is real money, so the real round gets fewer. */
const relaysPerBadge = (d: VoteRound) => d.manifest.kind === "real" ? 5 : 20;
/** A ballot sent before the contract opens: before `opensAt`, or in its first seconds,
 * while the chain's latest block is still older than it. */
const NOT_OPEN = "Voting hasn't opened yet. Send your ballot again in a moment.";
/** The contract's ballot-rule reverts (vote/contracts/SignedBallots.sol). */
const RULE_REVERT = /\b(BallotTooSmall|TooFewIndependent|BadProof|GroupOverHalf|TooManyTiers)\b/;

/** Below this the real round's relayer stops and voters send it themselves. */
const RELAY_FLOOR_WEI = 10_000_000_000_000_000n; // 0.01 ETH
const BALLOTS_CACHE_SECS = 5;
/** A replay pinned to one head block (the manifest's `readAt`: every read names that
 * block, so the replay is the same however often it runs) is reused this long. The key
 * changes with the next head, so a new ballot still shows at the next block; the cap keeps
 * the lagging-node check (CUTOFF_GRACE_SECS in chain-states.ts) about as prompt. */
const PINNED_REPLAY_SECS = 30;
/** How long a request waits for the round's chain states. A cold read (a long window's
 * balance scan on an archive node) can take longer: it goes on in the background, fills
 * the cache, and the request is a 503 meanwhile. */
const STATES_WAIT_MS = 20_000;
const DRIP_WEI = 5_000_000_000_000_000n; // 0.005 Sepolia ETH
/** Deno KV refuses values over 64 KiB; JSON longer than this is kept out with room to spare. */
const KV_VALUE_MAX = 60_000;
/** A closed round's final what-ifs that failed (the search, or the replay to start it)
 * are tried again after this long. */
const FINAL_RETRY_SECS = 60;

export { errorText };

/** The states half of a round's source when the round has none (tests set `states`):
 * the route reads states through `statesFor`, never through this. */
const noStateSource: StateSource = {
  head: () => Promise.reject(new Error("no chain state source")),
  blockBefore: () => Promise.reject(new Error("no chain state source")),
  stateAt: () => Promise.reject(new Error("no chain state source")),
  accountingEventBlocks: () => Promise.reject(new Error("no chain state source")),
  balanceChangeBlocks: () => Promise.reject(new Error("no chain state source")),
};

const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  new HttpError(status, message, { code, ...extra });

const relayBudgetFailure = () =>
  fail(503, "relay_budget", "The relay can't cover this ballot. Use “Send it yourself”.");

type Call = Parameters<VoteRound["chain"]["send"]>[0];

/** Inside the lease: the relayer's next nonce is kept in KV and never goes below
 * the chain's pending count, so a lagging RPC node can't hand out a used nonce.
 * If the last send was dropped (the node still hasn't seen it a minute later and
 * the chain is behind), fall back to the chain's count so nothing queues behind
 * the gap. */
export async function sendNext(kv: Deno.Kv, d: VoteRound, now: number, call: Call): Promise<Hex> {
  // One nonce journal per chain and signing account, shared across its rounds.
  const key = relayerKey(d, "relayer-nonce");
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
type RelayerScope = {
  manifest: { chainId: number };
  chain: { relayerAddress(): Hex | null };
};
const relayerKey = (d: RelayerScope, kind: "relayer" | "relayer-nonce") => {
  const sender = d.chain.relayerAddress();
  if (!sender) throw new Error("VOTE_RELAYER_KEY is not configured");
  return ["vote", kind, d.manifest.chainId, sender.toLowerCase()];
};
export async function withRelayer<T>(
  kv: Deno.Kv,
  d: RelayerScope,
  fn: () => Promise<T>,
): Promise<T> {
  const key = relayerKey(d, "relayer");
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
const round = (d: VoteRound) => roundKey(d.manifest);

const uint = (v: unknown): bigint | null => {
  if (typeof v !== "string" || !/^\d{1,20}$/.test(v)) return null;
  return BigInt(v);
};

const configurationKey = (d: VoteRound) =>
  `${d.manifest.chainId}:${d.manifest.contract.toLowerCase()}:${
    d.manifest.configRevision ?? "legacy"
  }:${d.manifest.configAnchor?.hash ?? ""}:${d.manifest.readAt?.hash ?? ""}`;
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
    log(`vote cache: ${key.join("/")} not cached (${errorText(e)})`);
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
  [...inp.withdrawn].sort((a, b) => a - b),
];

/** The what-if search's own version, part of every cache digest: when the way gaps, threats or
 * final figures are computed changes, bump it, and figures cached under the old code are
 * computed again instead of being served. */
export const WHAT_IFS_VERSION = 8;

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
/** How far ahead each initiative is, as JSON. Nothing ahead: nothing to tell. */
const leadJson = (lead: Map<number, bigint>, slugs: string[]): Record<string, string> =>
  Object.fromEntries(
    [...lead].filter(([, v]) => v > 0n).map(([c, v]) => [slugs[c], v.toString()]),
  );
/** A checked donation elsewhere that pushes each one out, as JSON: micro-USD as a string,
 * or null when none was found. Smaller threats can be missed; null does not mean safe. */
const threatJson = (t: Threats, slugs: string[]): Record<string, string | null> =>
  Object.fromEntries([...t].map(([c, v]) => [slugs[c], v === null ? null : v.toString()]));
/** The searches a round runs in the background; tests replace one to make it fail. */
export const voteSearches = { threats: threatsAsync };
/** A finished search: the digest of its inputs, the open tier it looked from, and when,
 * with the threats to the initiatives in the tier settling now. */
type KnownNext = {
  key: string;
  firstOpen: number;
  at: number;
  next: NextJson;
  threat?: Record<string, string | null>;
  /** The donation that gets each initiative one tier higher. */
  give?: NextJson;
};
type FinalJson = { next: NextJson; lead: Record<string, string> };
/** A closed round's final what-ifs, with the digest of what they were judged from. */
type KnownFinal = { key: string; at: number; final: FinalJson };

export function voteRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const dc = async (): Promise<VoteRound> => {
    const d = await currentVote(deps);
    if (!d) throw fail(503, "off", "No vote is deployed right now.");
    return d;
  };
  /** The gas drip belongs to test rounds only. */
  const testOnly = (d: VoteRound) => {
    if (d.manifest.kind !== "test") throw fail(404, "off", "This is the real vote.");
  };
  const asksUnavailable = () =>
    fail(503, "asks_unavailable", "The vote results can't be read from the chain right now.");
  /** The chain read in flight per round (contract): the time it reads at, the receipt
   * blocks it has states for, and `done`, which settles with it and never rejects (handed
   * to the background once a request stops waiting for it). */
  type Reading = {
    at: number;
    receipts: Set<number>;
    states: Promise<ChainState[]>;
    done: Promise<void>;
    inBackground: boolean;
  };
  const reading = new Map<string, Reading>();
  /** The round's chain states at `now`, waited for at most STATES_WAIT_MS. One read per
   * round at a time: a request joins one started within the last few seconds that has a
   * state for each of its receipts; otherwise it waits for it (it warms the cache) and
   * starts its own. A read that outlasts
   * the wait goes on in the background; the request is a 503. */
  const statesFor = async (d: VoteRound, now: number, receiptBlocks: number[]) => {
    const contract = `${configurationKey(d)}:${d.manifest.readAt?.block ?? "live"}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waited: Reading | undefined;
    const late = new Promise<never>((_, no) => {
      timer = setTimeout(() => no(asksUnavailable()), d.statesWaitMs ?? STATES_WAIT_MS);
    });
    try {
      for (;;) {
        const cur = reading.get(contract);
        waited = cur;
        if (
          cur && now - cur.at < BALLOTS_CACHE_SECS &&
          receiptBlocks.every((b) => cur.receipts.has(b))
        ) return await Promise.race([cur.states, late]);
        if (cur) {
          await Promise.race([cur.done, late]);
          continue;
        }
        const m = d.manifest;
        const states = (async () => {
          if (d.states) return await d.states(now);
          if (!d.source) throw new Error("no chain state source");
          return await chainStates(m, d.source, {
            now,
            receiptBlocks,
            cache: kvStateCache(deps.db.kv, m),
          });
        })();
        const entry: Reading = {
          at: now,
          receipts: new Set(receiptBlocks),
          states,
          done: states.then(
            () => {},
            (e) => deps.log(`vote states: read failed (${errorText(e)})`),
          ).finally(() => {
            if (reading.get(contract) === entry) reading.delete(contract);
          }),
          inBackground: false,
        };
        reading.set(contract, entry);
        waited = entry;
        return await Promise.race([states, late]);
      }
    } catch (e) {
      // Out of time: the read goes on and fills the cache for the next request.
      if (waited && !waited.inBackground) {
        waited.inBackground = true;
        deps.background?.(waited.done);
      }
      if (e instanceof HttpError) throw e;
      throw asksUnavailable();
    } finally {
      clearTimeout(timer);
    }
  };
  /** Every settlement is derived again from canonical chain inputs. Stored result
   * snapshots never select a settlement time, award or accepted ballot. */
  /** The last change to TheDAO's ballot, found again only after a new input (#118). */
  let lastChangeMemo: { contract: string; memo: LastChangeMemo } | null = null;
  const roundState = async (d: VoteRound): Promise<Round> => {
    const now = deps.now();
    if (lastChangeMemo?.contract !== configurationKey(d)) {
      lastChangeMemo = { contract: configurationKey(d), memo: {} };
    }
    const memo = lastChangeMemo.memo;
    // Ballots through the VoteChain, states through the bounded, shared read below.
    const { ballots, committed, rulesHistory } = d.chain;
    const src: RoundSource = {
      ...(d.source ?? noStateSource),
      ballots: () => ballots(),
      committed: (block, tokenIds) => committed(block, tokenIds),
      rulesHistory: () => rulesHistory(),
    };
    let st: Round;
    try {
      st = await replayRound(d.manifest, src, {
        now,
        states: (receiptBlocks) => statesFor(d, now, receiptBlocks),
        log: deps.log,
        lastChangeMemo: memo,
      });
    } catch (e) {
      if (!(e instanceof ReplayError)) throw asksUnavailable();
      if (e.code === "transcript_mismatch") {
        throw fail(
          503,
          "transcript_mismatch",
          "The ballots read don't match the contract; the results are back once they do.",
        );
      }
      if (e.code === "round_out_of_date") {
        throw fail(
          503,
          "round_out_of_date",
          "A project was just added to the vote; the results are back once this site knows it.",
        );
      }
      throw asksUnavailable();
    }
    return st;
  };

  /** The replay, reused in this isolate while the head it read is the newest (a few
   * seconds when unpinned): every results poll and relayed ballot asks. */
  let recent:
    | { at: number; contract: string; state: Promise<Round>; ready: boolean }
    | null = null;
  const recentRound = (d: VoteRound): Promise<Round> => {
    // Pinned, a replay in flight reads the very block this request would, so it is
    // joined (and cleared if it fails); polls arriving during one used to start their
    // own. Unpinned, a later request may see a newer ballot: it starts its own.
    const pinned = Boolean(d.manifest.readAt?.hash);
    if (
      !recent || recent.contract !== configurationKey(d) ||
      (!recent.ready && !pinned) ||
      (recent.ready &&
        deps.now() - recent.at >= (pinned ? PINNED_REPLAY_SECS : BALLOTS_CACHE_SECS))
    ) {
      const state = roundState(d);
      const entry = { at: deps.now(), contract: configurationKey(d), state, ready: false };
      recent = entry;
      state.then(() => {
        entry.ready = true;
      }, () => {
        if (recent === entry) recent = null;
      });
    }
    return recent.state;
  };

  /** The last gap search finished in this isolate. The search is long for a large round
   * and shares the isolate with the ballot relays, so it yields between tallies, only
   * one runs at a time, and no request waits for it. */
  let lastNext: (KnownNext & { contract: string }) | null = null;
  let searching = false;
  const nextKey = (d: VoteRound) => [...round(d), "next"];
  type Ahead = Pick<KnownNext, "key" | "next" | "threat" | "give">;
  /** The newest search known (this isolate's or the stored one) for the open tier
   * `firstOpen`, whichever inputs it ran on; none once no tier is open. */
  const knownNext = async (d: VoteRound, firstOpen: number | null, stored?: KnownNext | null) => {
    if (firstOpen === null) return undefined;
    stored ??= (await deps.db.kv.get<KnownNext>(nextKey(d))).value;
    const mine = lastNext?.contract === roundId(d.manifest) ? lastNext : null;
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
    const contract = roundId(d.manifest);
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
        // What it takes to push out each initiative in the tier settling now. A failed
        // threat search still keeps the gaps.
        let threat: Record<string, string | null> | undefined;
        try {
          threat = threatJson(await voteSearches.threats(liveInputs, firstOpen), slugs);
        } catch (e) {
          deps.log(`vote threat: ${errorText(e)}`);
        }
        // The donation that gets each initiative one tier higher; a failed search still
        // keeps the gaps.
        let give: NextJson | undefined;
        try {
          give = nextJson(await giftGapsAsync(liveInputs, firstOpen), slugs);
        } catch (e) {
          deps.log(`vote give: ${errorText(e)}`);
        }
        const known: KnownNext = {
          key,
          firstOpen,
          at: deps.now(),
          next,
          ...(threat ? { threat } : {}),
          ...(give ? { give } : {}),
        };
        lastNext = { ...known, contract };
        await cacheSet(deps.db.kv, nextKey(d), known, undefined, deps.log);
      })().catch((e) => deps.log(`vote next: ${errorText(e)}`))
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
    if (lastFinal?.contract === roundId(d.manifest) && lastFinal.key === key) {
      return lastFinal.final;
    }
    const stored = (await deps.db.kv.get<KnownFinal>(finalStoreKey(d))).value;
    if (stored?.key !== key) return undefined;
    lastFinal = { ...stored, contract: roundId(d.manifest) };
    return stored.final;
  };
  /** The digest a closed round's final what-ifs are judged from; none while it is open. */
  const finalDigest = (d: VoteRound, st: RoundState) => {
    if (!st.closed) return Promise.resolve(undefined);
    const funded = st.tiers.map((t) => (t.status === "settled" ? t.funded : []));
    return finalKey(roundId(d.manifest), st.settleInputs, funded);
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
    const contract = roundId(d.manifest);
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
    })().catch((e) => deps.log(`vote final: ${errorText(e)}`))
      .finally(() => (searching = false));
    deps.background?.(work);
    return undefined;
  };

  const open = async (d: VoteRound) => {
    if (deps.now() >= d.manifest.closesAt && (await recentRound(d)).poolInitialized) {
      throw fail(410, "closed", "Voting has closed.");
    }
  };
  const limit = async (name: string, ip: string | null) => {
    if (
      !(await deps.db.rateLimit(
        `vote-${deps.voteEnvironment ?? "production"}-${name}:${ip ?? "?"}`,
        PER_MINUTE,
        60,
      ))
    ) {
      throw new HttpError(429, "slow down");
    }
  };
  /** The round the site runs now: the pages load it before they show the vote. The
   * browser may keep it a few seconds (an admin's change shows within ~10 s; the server
   * reads the setting every 5 s anyway), then asks again with its ETag (304 when the same).
   * Private: a response can carry a refreshed session cookie. */
  r.get("/manifest", async (c) => {
    const d = await currentVote(deps);
    const body = JSON.stringify({ manifest: d?.manifest ?? null });
    const etag = await etagOf(body);
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=10, stale-while-revalidate=60",
      ETag: etag,
    };
    if (matchesEtag(c.req.header("If-None-Match"), etag)) return c.body(null, 304, headers);
    return c.body(body, 200, headers);
  });

  /** The badges the signed-in account votes with, so the menu and /vote lead to its ballot. */
  r.get("/mine", requireAuth, async (c) => {
    const d = await dc();
    await limit("mine", c.var.ip);
    const ids = await d.chain.idsOf(c.var.user!.address as Hex);
    return c.json({ ids: [...ids].sort((a, b) => a - b) });
  });

  /** Admin → Vote: who pays for relayed ballots, and what it has left. */
  r.get("/relayer", requireAdmin, async (c) => {
    const d = await dc();
    const address = d.chain.relayerAddress();
    const balanceWei = address ? (await d.chain.balance(address)).toString() : null;
    return c.json({ address, balanceWei, chainId: d.manifest.chainId });
  });

  r.post("/ballot", async (c) => {
    const d = await dc();
    await limit("ballot", c.var.ip);
    await open(d);
    if (deps.now() < d.manifest.opensAt) throw fail(409, "not_open", NOT_OPEN);
    const body = await jsonBody(c, ["tokenId", "nonce", "ballot", "signature"]);
    const tokenId = uint(body.tokenId);
    const nonce = uint(body.nonce);
    const ballot = body.ballot;
    const signature = body.signature;
    const m = d.manifest.slugs.length;
    // Short ballots leave later initiatives unplaced; validate their original bytes.
    const bytes = typeof ballot === "string" && isHex(ballot) ? hexToBytes(ballot) : null;
    if (
      tokenId === null || nonce === null || typeof ballot !== "string" || !isHex(ballot) ||
      !bytes || typeof signature !== "string" ||
      !isHex(signature) || !isValidBallotShape(bytes, m)
    ) throw fail(400, "bad_ballot", "That ballot isn't valid.");
    const owner = await d.chain.ownerOf(tokenId);
    if (!owner) throw fail(404, "no_badge", "No such badge.");
    const isContract = contractOwner(await d.chain.codeOf(owner));
    const valid = await (isContract
      ? d.chain.verifyContractVote(owner, tokenId, nonce, ballot, signature)
      : verifyTypedData({
        address: owner,
        ...voteTypedData(d.manifest, tokenId, owner, nonce, ballot),
        signature,
      })).catch((e) => {
        if (e instanceof RelayBudgetError) {
          throw relayBudgetFailure();
        }
        return false;
      });
    if (!valid) {
      throw fail(401, "bad_signature", "The signature doesn't match the badge's owner.");
    }
    // The ballot rules, judged with the pool on-chain now: the contract would refuse it.
    let asks: bigint[] | undefined;
    if (d.manifest.ballotRules) {
      const now = await recentRound(d);
      asks = now.asks;
      if (!asks) {
        throw fail(
          503,
          "asks_unavailable",
          "The asks on-chain can't be read right now; try again in a minute.",
        );
      }
      // A withdrawn project asks $0 for the size rule, by the contract's raw flags.
      const checked = checkBallot(
        hexToBytes(ballot),
        rulesRound(d.manifest, asks, now.poolUsd, now.withdrawnFlags ?? []),
      );
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
    // Nothing can be refused before S-Tier's first window ends: no tier settles before
    // it, and first ballots are taken until S-Tier settles.
    const firstWindowEnds = d.manifest.schedule.firstTallyAt[0] +
      d.manifest.schedule.initialWindow;
    const no = deps.now() < firstWindowEnds ? null : refusal(
      await recentRound(d),
      tokenId.toString(),
      // Compare settled sets with omitted tail projects explicitly unplaced.
      Uint8Array.from([...bytes, ...Array(m - bytes.length).fill(255)]),
      deps.now(),
      d.manifest.slugs.length,
    );
    if (no?.code === "closed") {
      throw fail(410, "closed", "Voting has closed.");
    }
    if (no?.code === "registration_closed") {
      throw fail(403, "registration_closed", "S-Tier settled before this badge voted.");
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
    const hash = await withRelayer(kv, d, async () => {
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
      const h = await sendNext(
        kv,
        d,
        deps.now(),
        recordCall({
          tokenId,
          nonce,
          ballot: ballot as Hex,
          signature: signature as Hex,
          // The proof is about groups only; rounds before the rules have no asks to read.
          proof: findProof(
            hexToBytes(ballot as Hex),
            rulesRound(
              d.manifest,
              asks ?? d.manifest.projects.map((p) =>
                BigInt(p.goalUsd)
              ),
            ),
          ) ?? [],
        }, isContract),
      ).catch((e) => {
        if (e instanceof RelayBudgetError) throw relayBudgetFailure();
        // The contract enforced a rule this check passed: the pool rose meanwhile (the
        // check uses a replay up to a few seconds old). Say so, not "internal error".
        // The server's clock is a few seconds ahead of the chain's at the opening.
        if (/\bVotingNotStarted\b/.test(String(e))) throw fail(409, "not_open", NOT_OPEN);
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
    const d = await dc();
    testOnly(d);
    await limit("gas", c.var.ip);
    await open(d);
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
    const hash = await withRelayer(kv, d, async () => {
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
    const d = await dc();
    /** The round with the gaps known for its open tier. Gaps searched on earlier inputs
     * (before the latest ballot, donation, pledge or pool change) are still served while
     * the new search runs, marked `aheadStale`: the page says they are being updated. */
    const withAhead = (
      body: ReturnType<typeof roundJson>,
      ahead: Ahead | undefined,
      final: FinalJson | undefined,
      inputs: string | undefined,
    ) => ({
      ...body,
      live: {
        ...body.live,
        ...(ahead ? { next: ahead.next } : {}),
        ...(ahead?.threat ? { threat: ahead.threat } : {}),
        ...(ahead?.give ? { give: ahead.give } : {}),
        ...(ahead && inputs && ahead.key !== inputs ? { aheadStale: true } : {}),
      },
      ...(final ? { final } : {}),
    });
    const st = await recentRound(d);
    const body = roundJson(st, d.manifest.slugs);
    const fk = await finalDigest(d, st);
    const ik = st.liveInputs
      ? await inputsKey(roundId(d.manifest), st.liveInputs, st.firstOpen)
      : undefined;
    return c.json(withAhead(body, await nextFor(d, st), await finalFor(d, st, fk), ik));
  });

  // Accepted ballots are derived from the same short-lived in-memory replay as results.
  // Old persistent round and ballot caches are deliberately not read.
  r.get("/ballots", async (c) => {
    const d = await dc();
    const body = roundJson(await recentRound(d), d.manifest.slugs);
    const ballots = Object.entries(body.accepted).map(([tokenId, ballot]) => ({ tokenId, ballot }));
    return c.json({ at: deps.now(), ballots });
  });

  // The replay alone (no gap or final searches), shared with this instance's reads.
  return Object.assign(r, { replay: (d: VoteRound) => recentRound(d) });
}

/** The replay a vote instance reads (its in-flight chain read and few-second cache). */
export type VoteReplay = ReturnType<typeof voteRoutes>["replay"];
