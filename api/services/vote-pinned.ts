/** A round's chain reads when its manifest is pinned to one head block (`readAt`, with
 * its hash): what every reader of that pin shares, so a replay costs a handful of RPC
 * calls instead of dozens.
 *
 * - One eth_getLogs for every event of the round's contract (ballots, revokes, projects,
 *   pool, pledges, withdrawals), deploy block to head. Logs up to a finalized block
 *   are kept across pins: a later pin reads only what came after. Each log carries its
 *   block's timestamp where the node includes it (`blockTimestamp`).
 * - One head multicall, called by the head's hash with `requireCanonical` (EIP-1898):
 *   what the contract committed to, the head state, and the finalized block's hash as the
 *   head sees it (Multicall3's getBlockHash). The node refuses a head that is no longer
 *   canonical, so the call checks itself.
 * - One read of the finalized block.
 *
 * Unpinned manifests (no `readAt` hash) read as before; see ./vote-chain.ts. */
import {
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  multicall3Abi,
  parseAbi,
  parseAbiItem,
  type PublicClient,
} from "viem";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
import type { ChainBlock } from "../../shared/vote/chain-states.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import type { ValuationEvidence } from "../../shared/vote/quiet-ending.ts";

export const BALLOT_RECORDED = parseAbiItem(
  "event BallotRecorded(uint256 indexed tokenId, address indexed voter, uint64 nonce, bytes ballot)",
);
export const REGISTRATION_REVOKED = parseAbiItem(
  "event RegistrationRevoked(uint256 indexed tokenId)",
);
export const INITIATIVE_CONFIGURED = parseAbiItem(
  "event InitiativeConfigured(uint256 indexed initiativeId, address indexed account, uint256 goalUsd, bool rfp, uint256 groups)",
);
export const POOL_USD_SET = parseAbiItem(
  "event PoolUsdSet(uint256 previousAmountUsd, uint256 amountUsd)",
);
export const INITIATIVE_WITHDRAWN = parseAbiItem(
  "event InitiativeWithdrawn(uint256 indexed initiativeId, bool withdrawn)",
);
export const PLEDGE_SET = parseAbiItem(
  "event PledgeSet(bytes32 indexed pledgeId, uint256 indexed initiativeId, uint256 indexed currencyId, uint256 amount)",
);
/** Every event of the round's contract a replay reads. */
const ROUND_EVENTS = [
  BALLOT_RECORDED,
  REGISTRATION_REVOKED,
  INITIATIVE_CONFIGURED,
  POOL_USD_SET,
  INITIATIVE_WITHDRAWN,
  PLEDGE_SET,
] as const;
/** The events that change a chain state (./chain-states.ts accountingEventBlocks). */
const ACCOUNTING = new Set([
  "PledgeSet",
  "PoolUsdSet",
  "InitiativeWithdrawn",
  "InitiativeConfigured",
]);

export const MULTICALL3: Hex = "0xcA11bde05977b3631167028862bE2a173976CA11";
const BLOCK_HASH_ABI = parseAbi(["function getBlockHash(uint256) view returns (bytes32)"]);
/** BLOCKHASH answers only for the last 256 blocks. */
const BLOCK_HASH_WINDOW = 256;
const LOG_CHUNK = 50_000;

/** A log of the round's contract, decoded. */
export type RoundLog = {
  eventName: string;
  // deno-lint-ignore no-explicit-any
  args: any;
  block: number;
  blockHash: Hex;
  logIndex: number;
  /** The block's time, when the node sends it with the log. */
  timestamp?: number;
};

/** One multicall result, as viem's multicall gives it with allowFailure. */
export type CallResult = { status: "success"; result: unknown } | {
  status: "failure";
  error: Error;
};

type Snapshot = {
  committed: { transcript: Hex; recordCount: bigint; hashes: Hex[] };
  state: CallResult[];
  /** The finalized block's hash in the head's own history; absent beyond 256 blocks. */
  finalizedHash?: Hex;
};
type Pin = {
  logs?: Promise<RoundLog[]>;
  finalized?: Promise<ChainBlock>;
  snapshots: Map<string, Promise<Snapshot>>;
  /** The head answered a call by its hash: canonical as of then. */
  checked: boolean;
};

/** Shared by every reader of a round's pins in the isolate (one per round
 * configuration; see stateSourceMemo in ./vote-chain.ts). */
export type PinMemo = {
  pins: Map<string, Pin>;
  /** The round's logs up to `to`, a block that was already final when they were read. */
  logPrefix?: { to: number; logs: RoundLog[] };
  /** The newest finalized block number seen: nothing at or below it changes. */
  finalizedSeen: number;
  /** `blockBefore(time)` answers: the block before the time and the one after it. */
  before: Map<number, { lo: ChainBlock; hi: ChainBlock }>;
  /** Config anchors ("block:hash") read canonical at or below a finalized block. */
  finalAnchors: Set<string>;
  /** Blocks read at or below a finalized block: they never change. */
  finalBlocks: Map<number, ChainBlock>;
};
export const pinMemo = (): PinMemo => ({
  pins: new Map(),
  finalizedSeen: -1,
  before: new Map(),
  finalAnchors: new Set(),
  finalBlocks: new Map(),
});

/** The calls of a chain state: the count, the pool, the withdrawn mask, then an ask and
 * a valuation diagnostic for every manifest project. */
export function stateContracts(m: VoteManifest) {
  const contract = { address: m.contract, abi: SIGNED_BALLOTS_ABI } as const;
  return [
    { ...contract, functionName: "initiativeCount" },
    { ...contract, functionName: "poolUsd" },
    { ...contract, functionName: "withdrawnMask" },
    ...m.slugs.map((_, i) => ({ ...contract, functionName: "initiativeUsd", args: [BigInt(i)] })),
    ...m.slugs.map((_, i) => ({
      ...contract,
      functionName: "valuationDiagnostics",
      args: [BigInt(i)],
    })),
    { ...contract, functionName: "poolInitialized" },
  ];
}

/** A chain state from stateContracts' results. A project the contract doesn't have yet
 * reverts and is left out; more projects than the manifest is an error. */
export function decodeState(m: VoteManifest, block: number, timestamp: number, r: CallResult[]) {
  // allowFailure turns a failed eth_call into failed results: the read failed.
  for (const x of r.slice(0, 2)) if (x.status !== "success") throw x.error;
  const result = (x: CallResult) => (x as { result: unknown }).result;
  const count = Number(result(r[0]) as bigint);
  if (count > m.slugs.length) {
    throw new Error(
      `vote manifest: the contract has ${count} projects at block ${block}, the manifest ${m.slugs.length}`,
    );
  }
  const asks = r.slice(3, 3 + count).map((x) => {
    if (x.status !== "success") throw x.error;
    return BigInt((x.result as readonly bigint[])[3]);
  });
  // A contract without withdrawnMask (the first test round) fails just that entry.
  const mask = r[2].status === "success" ? BigInt(r[2].result as bigint) : 0n;
  const withdrawn = Array.from({ length: count }, (_, i) => ((mask >> BigInt(i)) & 1n) === 1n);
  const diagnostics = r.slice(3 + m.slugs.length, 3 + m.slugs.length + count);
  const valuation: ValuationEvidence = {
    available: diagnostics.every((x) => x.status === "success"),
    issues: diagnostics.flatMap((x, project) => {
      if (x.status !== "success") return [];
      const packed = x.result as bigint;
      return Array.from(
        { length: 32 },
        (_, currency) => ({
          project,
          currency,
          flags: Number((packed >> BigInt(4 * currency)) & 15n),
        }),
      ).filter((d) => d.flags !== 0);
    }),
  };
  const funding = r.at(-1)!;
  if (funding.status !== "success") throw funding.error;
  if (typeof funding.result !== "boolean") throw new Error("missing funding state");
  return {
    timestamp,
    asks,
    poolUsd: BigInt(result(r[1]) as bigint),
    poolInitialized: funding.result,
    withdrawn,
    valuation,
  };
}

type Call = {
  address: Hex;
  // deno-lint-ignore no-explicit-any
  abi: any;
  functionName: string;
  args?: readonly unknown[];
};

/** Multicall3's aggregate3 (every call allowed to fail), run at a block named by its
 * hash: the node refuses it if that block is not canonical. */
export async function multicallAtHash(
  pub: PublicClient,
  hash: Hex,
  calls: Call[],
): Promise<CallResult[]> {
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [calls.map((c) => ({
      target: c.address,
      allowFailure: true,
      callData: encodeFunctionData(c as never),
    }))],
  });
  const raw = await pub.request({
    method: "eth_call",
    params: [{ to: MULTICALL3, data }, { blockHash: hash, requireCanonical: true }],
  } as never) as Hex;
  const out = decodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    data: raw,
  }) as readonly { success: boolean; returnData: Hex }[];
  return out.map((x, i): CallResult => {
    if (!x.success) {
      return { status: "failure", error: new Error(`${calls[i].functionName} reverted`) };
    }
    try {
      return {
        status: "success",
        result: decodeFunctionResult({
          abi: calls[i].abi,
          functionName: calls[i].functionName,
          data: x.returnData,
        } as never),
      };
    } catch (e) {
      return { status: "failure", error: e as Error };
    }
  });
}

/** The reads of `m`'s pin, or undefined when `m` isn't pinned to a block hash. */
export function pinnedReads(pub: PublicClient, m: VoteManifest, memo: PinMemo) {
  const readAt = m.readAt;
  if (!readAt?.hash) return undefined;
  const head: ChainBlock = { block: readAt.block, timestamp: readAt.timestamp, hash: readAt.hash };
  let pin = memo.pins.get(readAt.hash);
  if (!pin) {
    pin = { snapshots: new Map(), checked: false };
    memo.pins.set(readAt.hash, pin);
    if (memo.pins.size > 4) memo.pins.delete(memo.pins.keys().next().value!);
  }
  const p = pin;
  const forget = <T>(x: Promise<T>, drop: () => void) => {
    x.catch(drop);
    return x;
  };

  /** The finalized block, no newer than the head. */
  const finalized = (): Promise<ChainBlock> =>
    p.finalized ??= forget(
      (async () => {
        const b = await pub.getBlock({ blockTag: "finalized" });
        if (Number(b.number) >= head.block) {
          memo.finalizedSeen = Math.max(memo.finalizedSeen, head.block);
          return head;
        }
        memo.finalizedSeen = Math.max(memo.finalizedSeen, Number(b.number));
        return { block: Number(b.number), timestamp: Number(b.timestamp), hash: b.hash! };
      })(),
      () => (p.finalized = undefined),
    );

  /** Every log of the round's contract from its deploy block to the head, in chain order. */
  const logs = (): Promise<RoundLog[]> =>
    p.logs ??= forget(
      (async () => {
        const prefix = memo.logPrefix;
        if (prefix && prefix.to >= head.block) {return prefix.logs.filter((l) =>
            l.block <= head.block
          );}
        // Only blocks already final when this read starts are kept for later pins: a
        // block finalized during the read may have been read from a fork just before.
        const finalAtStart = memo.finalizedSeen;
        finalized().catch(() => {}); // Alongside the logs, for the replay.
        const fetched: RoundLog[] = [];
        for (
          let from = (prefix?.to ?? m.deployBlock - 1) + 1;
          from <= head.block;
          from += LOG_CHUNK
        ) {
          const got = await pub.getLogs({
            address: m.contract,
            events: ROUND_EVENTS,
            fromBlock: BigInt(from),
            toBlock: BigInt(Math.min(head.block, from + LOG_CHUNK - 1)),
          });
          for (const l of got) {
            const t = (l as { blockTimestamp?: bigint | null }).blockTimestamp;
            fetched.push({
              eventName: l.eventName,
              args: l.args,
              block: Number(l.blockNumber),
              blockHash: l.blockHash!,
              logIndex: l.logIndex!,
              ...(t == null ? {} : { timestamp: Number(t) }),
            });
          }
        }
        const all = [...(prefix?.logs ?? []), ...fetched].sort((a, b) =>
          a.block - b.block || a.logIndex - b.logIndex
        );
        // Up to a finalized block, the logs never change: a later pin starts after it.
        const keep = Math.min(finalAtStart, head.block);
        if (keep > (memo.logPrefix?.to ?? -1)) {
          memo.logPrefix = { to: keep, logs: all.filter((l) => l.block <= keep) };
        }
        return all;
      })(),
      () => (p.logs = undefined),
    );

  /** What the contract committed to at the head and the head state, in one call by the
   * head's hash; with the finalized block's hash as the head sees it. */
  const snapshot = (tokenIds: bigint[]): Promise<Snapshot> => {
    const key = tokenIds.join();
    let s = p.snapshots.get(key);
    if (!s) {
      s = forget(
        (async () => {
          const f = await finalized();
          const depth = head.block - f.block;
          const contract = { address: m.contract, abi: SIGNED_BALLOTS_ABI } as const;
          const committedCalls: Call[] = [
            { ...contract, functionName: "transcript" },
            { ...contract, functionName: "recordCount" },
            ...tokenIds.map((id) => ({ ...contract, functionName: "ballotHashOf", args: [id] })),
          ];
          const stateCalls = stateContracts(m) as Call[];
          const hashCall: Call[] = depth > 0 && depth <= BLOCK_HASH_WINDOW
            ? [{
              address: MULTICALL3,
              abi: BLOCK_HASH_ABI,
              functionName: "getBlockHash",
              args: [BigInt(f.block)],
            }]
            : [];
          const r = await multicallAtHash(pub, head.hash!, [
            ...committedCalls,
            ...stateCalls,
            ...hashCall,
          ]);
          p.checked = true;
          const committed = r.slice(0, committedCalls.length).map((x) => {
            if (x.status !== "success") throw x.error;
            return x.result;
          });
          const last = r.at(-1)!;
          return {
            committed: {
              transcript: committed[0] as Hex,
              recordCount: BigInt(committed[1] as bigint),
              hashes: committed.slice(2) as Hex[],
            },
            state: r.slice(committedCalls.length, committedCalls.length + stateCalls.length),
            ...(hashCall.length && last.status === "success"
              ? { finalizedHash: last.result as Hex }
              : {}),
          };
        })(),
        () => p.snapshots.delete(key),
      );
      p.snapshots.set(key, s);
    }
    return s;
  };
  /** A snapshot this pin already took, whichever badges it was for. */
  const anySnapshot = () => p.snapshots.values().next().value as Promise<Snapshot> | undefined;

  return {
    head,
    finalized,
    logs,
    snapshot,
    anySnapshot,
    /** The head answered a call by its hash. */
    checked: () => p.checked,
    /** A block's hash and time known without a read: the head, or the finalized block
     * as the head's own history names it. */
    async known(block: number): Promise<ChainBlock | undefined> {
      if (block === head.block) return head;
      const f = p.finalized && await p.finalized.catch(() => undefined);
      if (!f || f.block !== block) return undefined;
      const s = anySnapshot();
      const hash = s && (await s.catch(() => undefined))?.finalizedHash;
      return hash ? { block, timestamp: f.timestamp, hash } : undefined;
    },
    /** Blocks in [from, to] with an event that changes a chain state. */
    async accountingBlocks(from: number, to: number): Promise<number[]> {
      const out = new Set<number>();
      for (const l of await logs()) {
        if (l.block >= from && l.block <= to && ACCOUNTING.has(l.eventName)) out.add(l.block);
      }
      return [...out].sort((a, b) => a - b);
    },
  };
}
export type PinnedReads = NonNullable<ReturnType<typeof pinnedReads>>;
