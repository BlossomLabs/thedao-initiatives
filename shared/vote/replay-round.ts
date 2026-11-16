/** The round replayed from the chain, the one way everyone does it: the site's server
 * (api/routes/vote.ts) and the standalone script anyone can run against an archive node
 * (scripts/vote-replay.ts). The ballots are read and checked against what the contract
 * committed to (its transcript, record count and each badge's ballot hash), then the
 * chain states are read at the blocks the replay needs (./chain-states.ts), then the
 * quiet ending is replayed (./quiet-ending.ts). Nothing here knows about viem's
 * transports, KV or env: browser and Deno. */
import { type Hex, hexToBytes } from "viem";
import {
  chainStates,
  finalizedBlock,
  judgedAt,
  type StateCache,
  type StateSource,
} from "./chain-states.ts";
import { liveInputsJson } from "./live-inputs.ts";
import type { VoteManifest } from "./manifest.ts";
import {
  type ChainState,
  type Receipt,
  replay,
  type RoundState,
  type TierState,
  type ValuationEvidence,
} from "./quiet-ending.ts";
import { transcriptOf } from "./transcript.ts";

/** In chain order; `block` and `nonce` let the quiet ending group a block's receipts. */
export type BallotEvent =
  | {
    tokenId: string;
    ballot: Hex;
    voter: Hex;
    nonce: number;
    timestamp: number;
    block?: number;
    logIndex?: number;
  }
  | { tokenId: string; revoked: true; timestamp: number; block?: number };

export type RulesHistory = {
  addedAt: ({ block: number; logIndex: number } | null)[];
  pool: { block: number; logIndex: number; poolUsd: bigint }[];
};

/** Everything a replay reads from the chain: the ballots, what the contract committed to,
 * the projects added on-chain, and the chain states. */
export interface RoundSource extends StateSource {
  /** Every BallotRecorded and RegistrationRevoked since the deploy block, in chain order,
   * up to the pinned `block` (what `committed` must be read at). */
  ballots(): Promise<{ events: BallotEvent[]; block: bigint }>;
  /** What the contract committed to at `block`: its running transcript hash, its record
   * count, and each token's current ballot hash (zero when revoked). */
  committed(
    block: bigint,
    tokenIds: bigint[],
  ): Promise<{ transcript: Hex; recordCount: bigint; hashes: Hex[] }>;
  /** When each project joined and every PoolUsdSet (rounds with the ballot rules). */
  rulesHistory(): Promise<RulesHistory>;
}

/** Why a replay has no result, apart from a failed read (which is thrown as it is). */
export class ReplayError extends Error {
  constructor(
    readonly code: "transcript_mismatch" | "round_out_of_date" | "no_head",
    message: string,
  ) {
    super(message);
    this.name = "ReplayError";
  }
}

/** The replay, with what the rules judge by now (the pool and each project's ask at the
 * head state; asks absent when the head has fewer projects than the manifest), the
 * transcript check it passed and the head state it read. */
export type Round = RoundState & {
  poolUsd: bigint;
  asks?: bigint[];
  valuation?: ValuationEvidence;
  settlementValuations: Record<string, ValuationEvidence>;
  /** The contract's withdrawn flags at the head, by project index, a settled project's
   * too: what the ballot rules count (`live.withdrawn` leaves settled ones out). */
  withdrawnFlags?: number[];
  transcript: { block: bigint; records: number; hash: Hex; legacy: boolean };
  head: { block: number; timestamp: number };
  finalized: { block: number; timestamp: number; hash?: `0x${string}` } | null;
};

/** An error for a log or a terminal, with URLs cut out: viem's messages name the RPC's
 * URL, and an archive RPC's URL may carry its API key. */
export const errorText = (e: unknown): string =>
  String(e instanceof Error ? e.message : e).replace(/\b(?:https?|wss?):\/\/\S+/g, "<rpc>");

/** The round at `now`, replayed from `src`. Throws a ReplayError when the ballots read
 * don't match the contract or the chain has a project the manifest lacks, and the read
 * error itself when any read fails: never a partial result. `states` replaces the plain
 * chain-states read (the server waits for it a bounded time and shares one read). */
export async function replayRound(
  m: VoteManifest,
  src: RoundSource,
  opts: {
    now: number;
    cache?: StateCache;
    states?: (receiptBlocks: number[]) => Promise<ChainState[]>;
    log?: (msg: string) => void;
  },
): Promise<Round> {
  const { now } = opts;
  const { events, block: readAt } = await src.ballots();
  // The replay counts only what the contract committed to: the events read must hash
  // to its transcript, and each token's last ballot to its stored hash, at that block.
  const read = events.map((b) =>
    "revoked" in b
      ? { tokenId: b.tokenId, revoked: true as const }
      : { tokenId: b.tokenId, voter: b.voter, nonce: BigInt(b.nonce), ballot: b.ballot }
  );
  let proof = transcriptOf(read);
  let legacy = false;
  const tokenIds = [...proof.lastHash.keys()];
  const onChain = await src.committed(readAt, tokenIds.map(BigInt));
  // A round deployed before Nov 14 hashes a sixth, zero word into each entry.
  if (onChain.transcript !== proof.transcript) {
    const old = transcriptOf(read, true);
    if (onChain.transcript === old.transcript) [proof, legacy] = [old, true];
  }
  if (
    onChain.transcript !== proof.transcript ||
    onChain.recordCount !== BigInt(proof.count) ||
    tokenIds.some((id, i) => onChain.hashes[i] !== proof.lastHash.get(id))
  ) {
    throw new ReplayError(
      "transcript_mismatch",
      `transcript_mismatch: the ${events.length} ballot events read don't match what the contract committed to at block ${readAt}`,
    );
  }
  const receipts: Receipt[] = events.map((b, i) => ({
    tokenId: b.tokenId,
    nonce: "revoked" in b ? 0 : b.nonce,
    ballot: "revoked" in b ? null : hexToBytes(b.ballot),
    block: b.block ?? i + 1,
    ...("logIndex" in b && b.logIndex !== undefined ? { logIndex: b.logIndex } : {}),
    timestamp: b.timestamp,
  }));
  // Rounds deployed with the ballot rules: the projects added on-chain since the deploy.
  // One the manifest doesn't have yet: its ballots can't be read, so hold the round
  // rather than refuse them (or settle without them).
  if (m.ballotRules) {
    const history = await src.rulesHistory();
    if (history.addedAt.length > m.slugs.length) {
      throw new ReplayError(
        "round_out_of_date",
        `round_out_of_date: the contract has ${history.addedAt.length} projects, the manifest ${m.slugs.length}`,
      );
    }
  }
  const receiptBlocks = events.flatMap((b) => (b.block === undefined ? [] : [b.block]));
  const states = opts.states ? await opts.states(receiptBlocks) : await chainStates(m, src, {
    now,
    receiptBlocks,
    cache: opts.cache,
  });
  // Judged at the newest block's time (never past `now`): a tally time counts as passed
  // only once the chain has every block before it. The states end at the node's head.
  const tip = states.filter((x) => x.timestamp < now).at(-1);
  const at = tip ? judgedAt(now, tip.timestamp) : now;
  // The head: what the live tally, the page and the relay judge by.
  const head = states.filter((x) => x.timestamp < at).at(-1);
  if (!head) throw new ReplayError("no_head", "no_head: no chain state before now");
  let asks: bigint[] | undefined = head.asks;
  if (asks.length !== m.slugs.length) {
    opts.log?.(`vote asks: ${asks.length} at the head for ${m.slugs.length} projects`);
    asks = undefined;
  }
  const finalized = await finalizedBlock(src, { block: head.block, timestamp: head.timestamp });
  const st = replay({
    schedule: m.schedule,
    m: m.slugs.length,
    states,
    receipts,
  }, at);
  return Object.assign(st, {
    finalized,
    ...(head.valuation ? { valuation: head.valuation } : {}),
    settlementValuations: Object.fromEntries(st.tiers.flatMap((t) => {
      if (t.status !== "settled") return [];
      const state = states.filter((x) => x.timestamp < t.at).at(-1);
      return state?.valuation ? [[t.tier, state.valuation]] : [];
    })),
    poolUsd: head.poolUsd,
    ...(asks ? { asks } : {}),
    withdrawnFlags: [...Array(m.slugs.length).keys()].filter((i) => head.withdrawn?.[i] === true),
    transcript: { block: readAt, records: proof.count, hash: proof.transcript, legacy },
    head: { block: head.block, timestamp: head.timestamp },
  });
}

/** The round as JSON (what /api/vote/round serves, before its what-ifs): slugs for
 * initiatives, decimal strings for micro-USD. */
export function roundJson(st: Round, slugs: string[]) {
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
        confirmed: st.finalized !== null && st.finalized.timestamp >= t.at,
        ...(st.settlementValuations[t.tier] ? { valuation: st.settlementValuations[t.tier] } : {}),
        funded: named(t.funded),
        covered: named(t.covered),
        withdrawn: named(t.withdrawn),
        awards: money(t.awards),
        paid: paidBy(t.shares),
      }
      : t.status === "settling"
      ? {
        ...t,
        funded: named(t.funded),
        covered: named(t.covered),
        withdrawn: named(t.withdrawn),
      }
      : t;
  return {
    /** The newest block the round was judged at: nothing after it has happened yet. */
    head: st.head,
    finalized: st.finalized,
    ...(st.valuation ? { valuation: st.valuation } : {}),
    settlementCoverage: Object.fromEntries(
      st.tiers.flatMap((t) =>
        t.status !== "settled" ? [] : [...t.funded, ...t.covered].flatMap((i) => {
          const ask = st.asks?.[i];
          if (ask === undefined) return [];
          const award = t.awards.get(i) ?? 0n;
          return [[slugs[i], {
            awardUsd: award.toString(),
            askUsd: ask.toString(),
            shortfallUsd: (ask > award ? ask - award : 0n).toString(),
            excessAwardUsd: (award > ask ? award - ask : 0n).toString(),
          }]];
        })
      ),
    ),
    registrationClosesAt: st.registrationClosesAt,
    closed: st.closed,
    share: st.share.toString(),
    /** The pool on-chain now (micro-USD): what a new ballot's size is judged against. */
    poolUsd: st.poolUsd.toString(),
    /** Each initiative's ask on-chain now (micro-USD, manifest order): the head state's,
     * the same the live tally and the relay use; absent when the head has fewer projects
     * than the manifest. */
    ...(st.asks ? { asks: st.asks.map(String) } : {}),
    /** The contract's withdrawn flags at the head (slugs), a settled project's too: what
     * the ballot rules count. For display, `live.withdrawn`. */
    withdrawnFlags: named(st.withdrawnFlags ?? []),
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
      paid: paidBy(st.live.shares),
      /** Asking $0 now: covered by donations, in no tier. */
      covered: named(st.live.covered),
      /** Withdrawn now: in no tier, and not covered. */
      withdrawn: named(st.live.withdrawn),
      // The live tally's inputs, so a donation's preview re-runs it in the browser.
      ...(st.liveInputs ? { inputs: liveInputsJson(st.liveInputs, st.firstOpen) } : {}),
    },
  };
}
