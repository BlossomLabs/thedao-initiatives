import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  multicall3Abi,
  parseAbi,
  parseAbiItem,
  type PublicClient,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TEST_USD_ABI } from "../../shared/vote/test-usd.ts";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
import { type AccountChange, accountPeriods } from "../../shared/vote/account-history.ts";
import type { StateCache, StateSource } from "../../shared/vote/chain-states.ts";
import type { ChainState, ValuationEvidence } from "../../shared/vote/quiet-ending.ts";
import type { BallotEvent, RoundSource, RulesHistory } from "../../shared/vote/replay-round.ts";
import { voteChain, type VoteManifest, voterNft } from "../../shared/vote/manifest.ts";

/** What the vote routes need from the chain. Injected so tests run without a chain. */
export interface VoteChain {
  ownerOf(n: bigint): Promise<Hex | null>;
  balanceOf(a: Hex): Promise<bigint>;
  /** The badge an account holds now (the latest one sent to it that it still owns). */
  badgeOf(a: Hex): Promise<bigint | null>;
  /** Every badge the account can vote with: the voting badges it holds in
   * the real round, its one round badge in a test round. */
  idsOf(a: Hex): Promise<number[]>;
  /** The relayer's address, or null when no relayer key is configured. */
  relayerAddress(): Hex | null;
  /** The account's code: "0x" for a plain EOA, 0xef0100… for an EIP-7702 delegation. */
  codeOf(a: Hex): Promise<Hex>;
  /** Would the relayer's mint(to, n) succeed (simulated)? */
  canMint(to: Hex, n: bigint): Promise<boolean>;
  nonceOf(n: bigint): Promise<bigint>;
  balance(a: Hex): Promise<bigint>;
  /** A relayed transaction's fate; "unknown" when the node has never seen it (dropped). */
  txStatus(hash: Hex): Promise<"pending" | "success" | "reverted" | "unknown">;
  /** Gas cost (wei) of one self-sent ballot at the current gas price. */
  estimateRecordFor(): Promise<bigint>;
  /** The relayer account's pending transaction count, as the RPC sees it. */
  relayerNonce(): Promise<number>;
  send(
    call:
      | { fn: "mint"; args: readonly [Hex, bigint] }
      | {
        fn: "record";
        args: readonly [
          readonly {
            tokenId: bigint;
            nonce: bigint;
            r: Hex;
            vs: Hex;
            ballot: Hex;
            proof: number[];
          }[],
        ];
      }
      | { fn: "drip"; to: Hex; value: bigint }
      /** A test round's TestUSD minted to `to` (six decimals). */
      | { fn: "testUsd"; token: Hex; to: Hex; amount: bigint }
      | {
        fn: "setPledgeBySig";
        args: readonly [Hex, bigint, bigint, bigint, Hex, bigint, bigint, Hex];
      },
    nonce: number,
  ): Promise<Hex>;
  /** The next nonce `signer` must sign a pledge with (setPledgeBySig; consecutive), at
   * `block` (default the head). */
  pledgeNonceOf(signer: Hex, block?: bigint): Promise<bigint>;
  /** The contract's record of a pledge id (`pledges(bytes32)`) at `block` (default the
   * head); `exists` false when never set. */
  pledgeOf(
    pledgeId: Hex,
    block?: bigint,
  ): Promise<{ initiativeId: bigint; currencyId: bigint; amount: bigint; exists: boolean }>;
  /** The head block's number: for reads that must agree with each other. */
  blockNumber(): Promise<bigint>;
  /** Every BallotRecorded and RegistrationRevoked since the deploy block, in chain order,
   * up to the pinned `block` (what `committed` must be read at). */
  ballots(): Promise<{ events: BallotEvent[]; block: bigint }>;
  /** What the contract committed to at `block`: its running transcript hash, its record
   * count, and each token's current ballot hash (zero when revoked), in one multicall. */
  committed(
    block: bigint,
    tokenIds: bigint[],
  ): Promise<{ transcript: Hex; recordCount: bigint; hashes: Hex[] }>;
  /** What the ballot rules judge by: when each project joined (`addedAt[id]`, its first
   * InitiativeConfigured) and every PoolUsdSet, stamped like ballots. */
  rulesHistory(): Promise<RulesHistory>;
  /** Each project's ask on-chain at the head block (`initiativeUsd`'s fourth value: goal
   * less donations and open pledges), micro-USD, in manifest order, in one multicall. */
  asks(): Promise<bigint[]>;
  /** Whether the round's contract can withdraw initiatives: it has `withdrawnMask` (the
   * first test round predates it, and a withdrawal batch would revert). Absent (a test
   * fake): it can. */
  canWithdraw?(): Promise<boolean>;
  corrections?(): Promise<
    { poolUsd: string; pendingPoolUsd: string | null; poolUpdateNonce: string }
  >;
}

export type { BallotEvent, RulesHistory };

export interface VoteRound {
  chain: VoteChain;
  manifest: VoteManifest;
  /** Where the round's chain states are read (an archive node for past blocks). */
  source?: StateSource;
  /** Tests: the chain states the replay reads at `now`, in place of `source`. */
  states?: (now: number) => Promise<ChainState[]>;
  /** Tests: how long a request waits for the chain states (ms) before a 503. */
  statesWaitMs?: number;
}

const BALLOT_RECORDED = parseAbiItem(
  "event BallotRecorded(uint256 indexed tokenId, address indexed voter, uint64 nonce, bytes ballot)",
);
const REGISTRATION_REVOKED = parseAbiItem("event RegistrationRevoked(uint256 indexed tokenId)");
const INITIATIVE_CONFIGURED = parseAbiItem(
  "event InitiativeConfigured(uint256 indexed initiativeId, address indexed account, uint256 goalUsd, bool rfp, uint256 groups)",
);
const POOL_USD_SET = parseAbiItem("event PoolUsdSet(uint256 previousAmountUsd, uint256 amountUsd)");
const INITIATIVE_WITHDRAWN = parseAbiItem(
  "event InitiativeWithdrawn(uint256 indexed initiativeId, bool withdrawn)",
);
const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);
const OWNER_OF_ABI = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "error ERC721NonexistentToken(uint256 tokenId)",
]);
const LOG_CHUNK = 50_000n;
/** Leave room for a smart wallet's receive hook while bounding the relayer's gas. */
const MINT_GAS = 500_000n;

export function createVoteChain(
  m: VoteManifest,
  rpcUrl: string,
  relayerKey: Hex | null,
  transport: Transport = http(rpcUrl),
  /** The real round: the voting-badge ids an address holds (an explorer index, then
   * fresh ownerOf checks; api/chain/reviewer.ts). */
  votingBadgeIds?: (a: Hex) => Promise<string[]>,
): VoteChain {
  const chain = voteChain(m);
  const pub = createPublicClient({ chain, transport }) as PublicClient;
  const account = relayerKey ? privateKeyToAccount(relayerKey) : null;
  const wallet = account ? createWalletClient({ account, chain, transport }) : null;
  const read = <T>(functionName: string, args: readonly unknown[], blockNumber?: bigint) =>
    pub.readContract({
      address: m.contract,
      abi: SIGNED_BALLOTS_ABI,
      functionName: functionName as never,
      args: args as never,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    }) as Promise<T>;
  const blockTimes = new Map<bigint, number>();

  return {
    async ownerOf(n) {
      try {
        // The voters' NFT: the voting badge in the real round, the round's own badges in tests.
        return await pub.readContract({
          address: voterNft(m),
          abi: OWNER_OF_ABI,
          functionName: "ownerOf",
          args: [n],
        });
      } catch (e) {
        // Only the contract's decoded missing-token error means this id is free.
        const reverted = e instanceof BaseError
          ? e.walk((x) => x instanceof ContractFunctionRevertedError)
          : null;
        if (
          reverted instanceof ContractFunctionRevertedError &&
          reverted.data?.errorName === "ERC721NonexistentToken"
        ) return null;
        throw e;
      }
    },
    balanceOf: (a) => read<bigint>("balanceOf", [a]),
    async corrections() {
      const at = m.readAt ? BigInt(m.readAt.block) : await pub.getBlockNumber();
      const [pool, pending, nonce, has] = await Promise.all([
        read<bigint>("poolUsd", [], at),
        read<bigint>("pendingPoolUsd", [], at),
        read<bigint>("poolUpdateNonce", [], at),
        read<boolean>("hasPendingPool", [], at),
      ]);
      return {
        poolUsd: pool.toString(),
        pendingPoolUsd: has ? pending.toString() : null,
        poolUpdateNonce: nonce.toString(),
      };
    },
    async canWithdraw() {
      try {
        await read<bigint>("withdrawnMask", []);
        return true;
      } catch (e) {
        // The view reverts or returns nothing (no such function): a contract from before
        // withdrawals. A transport failure is no answer, so it propagates.
        const missing = e instanceof BaseError &&
          e.walk((x) =>
            x instanceof ContractFunctionRevertedError ||
            x instanceof ContractFunctionZeroDataError
          );
        if (missing) return false;
        throw e;
      }
    },
    codeOf: async (a) => (await pub.getCode({ address: a })) ?? "0x",
    async canMint(to, n) {
      if (!account) return false;
      try {
        await pub.simulateContract({
          address: m.contract,
          abi: SIGNED_BALLOTS_ABI,
          functionName: "mint",
          args: [to, n],
          account: account.address,
          gas: MINT_GAS,
        });
        return true;
      } catch {
        return false;
      }
    },
    nonceOf: async (n) => BigInt(await read<bigint>("nonceOf", [n])),
    pledgeNonceOf: async (a, block) => BigInt(await read<bigint>("pledgeNonceOf", [a], block)),
    async pledgeOf(id, block) {
      const [initiativeId, currencyId, amount, exists] = await read<
        readonly [bigint, bigint, bigint, boolean]
      >("pledges", [id], block);
      return { initiativeId, currencyId, amount, exists };
    },
    blockNumber: () => pub.getBlockNumber(),
    balance: (a) => pub.getBalance({ address: a }),
    async txStatus(hash) {
      const r = await pub.getTransactionReceipt({ hash }).catch(() => null);
      if (r) return r.status === "success" ? "success" : "reverted";
      const tx = await pub.getTransaction({ hash }).catch(() => null);
      return tx ? "pending" : "unknown";
    },
    async estimateRecordFor() {
      // A record() of an 81-byte ballot uses well under 150k gas.
      return 150_000n * (await pub.getGasPrice());
    },
    async relayerNonce() {
      if (!account) throw new Error("VOTE_RELAYER_KEY is not configured");
      return await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
    },
    async send(call, nonce) {
      if (!wallet || !account) throw new Error("VOTE_RELAYER_KEY is not configured");
      if (call.fn === "drip") {
        return await wallet.sendTransaction({ to: call.to, value: call.value, nonce });
      }
      if (call.fn === "testUsd") {
        return await wallet.writeContract({
          address: call.token,
          abi: TEST_USD_ABI,
          functionName: "mint",
          args: [call.to, call.amount],
          nonce,
        });
      }
      return await wallet.writeContract({
        address: m.contract,
        abi: SIGNED_BALLOTS_ABI,
        functionName: call.fn as never,
        args: call.args as never,
        nonce,
        // A mint calls an EIP-7702 wallet's code (onERC721Received): a fixed
        // limit keeps a gas-hungry delegate from draining the relayer.
        ...(call.fn === "mint" ? { gas: MINT_GAS } : {}),
      });
    },
    relayerAddress: () => account?.address ?? null,
    async idsOf(a) {
      if (m.kind === "real") {
        if (!votingBadgeIds) throw new Error("voting badge lookup is not configured");
        return (await votingBadgeIds(a)).map(Number);
      }
      const n = await this.badgeOf(a);
      return n === null ? [] : [Number(n)];
    },
    async badgeOf(a) {
      // No enumeration on the contract: the Transfer logs to the account, newest first,
      // and the first token it still owns.
      const head = await pub.getBlockNumber();
      const sent: bigint[] = [];
      for (let from = BigInt(m.deployBlock); from <= head; from += LOG_CHUNK) {
        const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head;
        const logs = await pub.getLogs({
          address: m.contract,
          event: TRANSFER,
          args: { to: a },
          fromBlock: from,
          toBlock: to,
        });
        for (const l of logs) sent.push(l.args.tokenId!);
      }
      for (const n of sent.reverse()) {
        if ((await this.ownerOf(n))?.toLowerCase() === a.toLowerCase()) return n;
      }
      return null;
    },
    async committed(block, tokenIds) {
      const contract = { address: m.contract, abi: SIGNED_BALLOTS_ABI } as const;
      const r = (await pub.multicall({
        blockNumber: block,
        allowFailure: false,
        contracts: [
          { ...contract, functionName: "transcript" },
          { ...contract, functionName: "recordCount" },
          ...tokenIds.map((id) => ({ ...contract, functionName: "ballotHashOf", args: [id] })),
        ] as never,
      })) as unknown as [Hex, bigint, ...Hex[]];
      return { transcript: r[0], recordCount: BigInt(r[1]), hashes: r.slice(2) as Hex[] };
    },
    async ballots() {
      const headBlock = await pub.getBlock(
        m.readAt ? { blockNumber: BigInt(m.readAt.block) } : undefined,
      );
      if (m.readAt?.hash && headBlock.hash !== m.readAt.hash) {
        throw new Error("vote head changed during replay");
      }
      const head = headBlock.number!;
      const headTime = Number(headBlock.timestamp);
      const out: BallotEvent[] = [];
      for (let from = BigInt(m.deployBlock); from <= head; from += LOG_CHUNK) {
        const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head;
        const range = { address: m.contract, fromBlock: from, toBlock: to } as const;
        const [votes, revokes] = await Promise.all([
          pub.getLogs({ ...range, event: BALLOT_RECORDED }),
          pub.getLogs({ ...range, event: REGISTRATION_REVOKED }),
        ]);
        const logs = [...votes, ...revokes].sort((a, b) =>
          a.blockNumber === b.blockNumber
            ? a.logIndex! - b.logIndex!
            : a.blockNumber! < b.blockNumber!
            ? -1
            : 1
        );
        const times = await stampLogs(
          logs,
          headTime,
          m.schedule.firstTallyAt[0],
          async (blockNumber) => {
            let t = blockTimes.get(blockNumber);
            if (t === undefined) {
              t = Number((await pub.getBlock({ blockNumber })).timestamp);
              blockTimes.set(blockNumber, t);
            }
            return t;
          },
        );
        for (const [i, log] of logs.entries()) {
          const t = times[i];
          const tokenId = log.args.tokenId!.toString();
          const block = Number(log.blockNumber);
          out.push(
            "ballot" in log.args && log.args.ballot
              ? {
                tokenId,
                ballot: log.args.ballot,
                voter: log.args.voter!,
                timestamp: t,
                block,
                logIndex: log.logIndex!,
                nonce: Number(log.args.nonce),
              }
              : { tokenId, revoked: true, timestamp: t, block },
          );
        }
      }
      return { events: out, block: head };
    },
    async asks() {
      const contract = { address: m.contract, abi: SIGNED_BALLOTS_ABI } as const;
      const r = (await pub.multicall({
        allowFailure: false,
        contracts: m.slugs.map((_, i) => ({
          ...contract,
          functionName: "initiativeUsd",
          args: [BigInt(i)],
        })),
      } as never)) as unknown as (readonly bigint[])[];
      return r.map((x) => BigInt(x[3]));
    },
    async rulesHistory() {
      // Positions, not times: the replay orders these against ballots exactly as the
      // contract saw them (a pool raise in a ballot's own block may come after it).
      const head = m.readAt ? BigInt(m.readAt.block) : await pub.getBlockNumber();
      const out: RulesHistory = { addedAt: [], pool: [] };
      for (let from = BigInt(m.deployBlock); from <= head; from += LOG_CHUNK) {
        const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head;
        const range = { address: m.contract, fromBlock: from, toBlock: to } as const;
        const [added, pools] = await Promise.all([
          pub.getLogs({ ...range, event: INITIATIVE_CONFIGURED }),
          pub.getLogs({ ...range, event: POOL_USD_SET }),
        ]);
        for (const log of added) {
          // Corrections re-emit it too: only the first event adds this ID.
          out.addedAt[Number(log.args.initiativeId)] ??= {
            block: Number(log.blockNumber),
            logIndex: log.logIndex!,
          };
        }
        for (const log of pools) {
          out.pool.push({
            block: Number(log.blockNumber),
            logIndex: log.logIndex!,
            poolUsd: log.args.amountUsd!,
          });
        }
      }
      out.pool.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
      return out;
    },
  };
}

/** Exact times matter from S's first tally on (windows, registration, the close).
 * Before it, the head block's time bounds every log, so no per-block lookups (a cold
 * results page would otherwise make one RPC per ballot block). From it, one lookup per
 * distinct block (cached in the isolate). */
export async function stampLogs(
  logs: { blockNumber: bigint | null }[],
  headTime: number,
  exactFrom: number,
  timeOf: (block: bigint) => Promise<number>,
): Promise<number[]> {
  if (headTime < exactFrom) return logs.map(() => headTime);
  const blocks = [...new Set(logs.map((l) => l.blockNumber!))];
  const times = new Map(
    await Promise.all(blocks.map(async (b) => [b, await timeOf(b)] as const)),
  );
  return logs.map((l) => times.get(l.blockNumber!)!);
}

const PLEDGE_SET = parseAbiItem(
  "event PledgeSet(bytes32 indexed pledgeId, uint256 indexed initiativeId, uint256 indexed currencyId, uint256 amount)",
);
const ERC20_TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const MULTICALL3: Hex = "0xcA11bde05977b3631167028862bE2a173976CA11";
const NATIVE = /^0x0{40}$/i;
/** Native balance multicalls in flight at once (one per block). */
const BALANCE_READS = 8;
/** Most blocks whose native scan is kept in memory (the oldest go first). */
const NATIVE_MEMO = 20_000;

/** The round's chain states read from an RPC (an archive node, for past blocks):
 * shared/vote/chain-states.ts turns them into the replay's states. Every read names its
 * block; a node that can't serve it fails the read. */
export type StateSourceMemo = {
  nativeScans: Map<string, Map<number, boolean>>;
  histories: Map<number, Promise<AccountChange[]>>;
  anchors: Map<string, { block: number; hash: Hex }>;
};
export const stateSourceMemo = (): StateSourceMemo => ({
  nativeScans: new Map(),
  histories: new Map(),
  anchors: new Map(),
});

export function createStateSource(
  m: VoteManifest,
  rpcUrl: string,
  transport: Transport = http(rpcUrl),
  memo = stateSourceMemo(),
): StateSource {
  const pub = createPublicClient({ chain: voteChain(m), transport }) as PublicClient;
  const contract = { address: m.contract, abi: SIGNED_BALLOTS_ABI } as const;
  /** Native balance scans through a canonical finalized anchor are reused. Newer
   * blocks are scanned again; the KV cache shares finalized scans across instances. */
  const { nativeScans, histories } = memo;
  const blockAt = async (n: number) => {
    const b = await pub.getBlock({ blockNumber: BigInt(n) });
    return { block: n, timestamp: Number(b.timestamp), hash: b.hash! };
  };
  const head = async () => {
    const b = await pub.getBlock(m.readAt ? { blockNumber: BigInt(m.readAt.block) } : undefined);
    if (m.readAt?.hash && b.hash !== m.readAt.hash) {
      throw new Error("vote head changed during replay");
    }
    return { block: Number(b.number), timestamp: Number(b.timestamp), hash: b.hash! };
  };
  /** Blocks in [from, to] holding a log `get` returns (read in chunks), ascending, once each. */
  const logBlocks = async (
    from: number,
    to: number,
    get: (fromBlock: bigint, toBlock: bigint) => Promise<{ blockNumber: bigint | null }[]>,
  ) => {
    const out = new Set<number>();
    for (let a = BigInt(from); a <= BigInt(to); a += LOG_CHUNK) {
      const b = a + LOG_CHUNK - 1n < BigInt(to) ? a + LOG_CHUNK - 1n : BigInt(to);
      for (const l of await get(a, b)) out.add(Number(l.blockNumber));
    }
    return [...out].sort((x, y) => x - y);
  };

  const scanBalances = async (from: number, to: number, accounts: Hex[]): Promise<number[]> => {
    const currencies = (m.currencies ?? []).slice(1).filter((c) => !c.disabled);
    if (!currencies.length) return [];
    if (!accounts.length) return [];
    const key = accounts.join().toLowerCase();
    let nativeSeen = nativeScans.get(key);
    if (!nativeSeen) nativeScans.set(key, nativeSeen = new Map());
    const tokens = currencies.map((c) => c.asset).filter((a) => !NATIVE.test(a));
    const out = new Set<number>();
    if (tokens.length) {
      for (const side of ["from", "to"] as const) {
        const blocks = await logBlocks(from, to, (fromBlock, toBlock) =>
          pub.getLogs({
            address: tokens,
            event: ERC20_TRANSFER,
            args: { [side]: accounts },
            fromBlock,
            toBlock,
          }));
        for (const b of blocks) out.add(b);
      }
    }
    if (currencies.some((c) => NATIVE.test(c.asset))) {
      const final = await pub.getBlock({ blockTag: "finalized" });
      const finalNumber = Number(final.number);
      // A memo belongs to this finalized prefix; discard it if that anchor was replaced.
      const anchorKey = `anchor:${key}`;
      const anchor = memo.anchors.get(anchorKey);
      if (anchor && (await blockAt(anchor.block)).hash !== anchor.hash) nativeSeen.clear();
      memo.anchors.set(anchorKey, { block: finalNumber, hash: final.hash! });
      // No log for an internal transfer: each block's balances against the block before.
      const ethAt = (block: number) =>
        pub.multicall({
          blockNumber: BigInt(block),
          batchSize: 0,
          multicallAddress: MULTICALL3,
          allowFailure: false,
          contracts: accounts.map((a) => ({
            address: MULTICALL3,
            abi: multicall3Abi,
            functionName: "getEthBalance",
            args: [a],
          })),
        }) as Promise<bigint[]>;
      // Previously finalized blocks are known; scan the unfinalized tail again.
      let start = from;
      for (; start <= to && nativeSeen.has(start); start++) {
        if (nativeSeen.get(start)) out.add(start);
      }
      let before = start <= to ? await ethAt(start - 1) : [];
      for (let a = start; a <= to; a += BALANCE_READS) {
        const batch = Array.from(
          { length: Math.min(BALANCE_READS, to - a + 1) },
          (_, i) => a + i,
        );
        const reads = await Promise.all(batch.map(ethAt));
        for (const [i, now] of reads.entries()) {
          const changed = now.some((x, j) => x !== before[j]);
          if (changed) out.add(batch[i]);
          if (batch[i] <= finalNumber) nativeSeen.set(batch[i], changed);
          before = now;
        }
      }
      for (const b of nativeSeen.keys()) {
        if (nativeSeen.size <= NATIVE_MEMO) break;
        nativeSeen.delete(b);
      }
    }
    return [...out].sort((x, y) => x - y);
  };
  const accountHistory = (to: number): Promise<AccountChange[]> => {
    let p = histories.get(to);
    if (!p) {
      p = (async () => {
        const out: AccountChange[] = [];
        for (let from = m.deployBlock; from <= to; from += Number(LOG_CHUNK)) {
          const logs = await pub.getLogs({
            address: m.contract,
            event: INITIATIVE_CONFIGURED,
            fromBlock: BigInt(from),
            toBlock: BigInt(Math.min(to, from + Number(LOG_CHUNK) - 1)),
          });
          for (const log of logs) {
            out.push({
              block: Number(log.blockNumber),
              logIndex: log.logIndex!,
              id: Number(log.args.initiativeId!),
              account: log.args.account!,
            });
          }
        }
        return out;
      })();
      if (histories.size >= 4) histories.delete(histories.keys().next().value!);
      histories.set(to, p);
      p.catch(() => histories.delete(to));
    }
    return p;
  };

  return {
    head,
    blockAt,
    async finalized() {
      const b = await pub.getBlock({ blockTag: "finalized" });
      const tip = await head();
      return Number(b.number) > tip.block ? tip : {
        block: Number(b.number),
        timestamp: Number(b.timestamp),
        hash: b.hash!,
      };
    },
    async blockBefore(time) {
      const top = await head();
      if (top.timestamp < time) return top;
      // Invariant: lo's time < time <= hi's time. Interpolation steps alternate with
      // halving, so uneven block times still finish in about 2·log2(head) reads.
      let lo = await blockAt(0);
      if (lo.timestamp >= time) throw new Error(`no block before ${time}`);
      let hi = top;
      for (let step = 0; hi.block - lo.block > 1; step++) {
        const guess = step % 2 ? Math.floor((lo.block + hi.block) / 2) : lo.block + Math.floor(
          ((time - lo.timestamp) * (hi.block - lo.block)) / (hi.timestamp - lo.timestamp),
        );
        const mid = await blockAt(Math.min(hi.block - 1, Math.max(lo.block + 1, guess)));
        if (mid.timestamp < time) lo = mid;
        else hi = mid;
      }
      return lo;
    },
    async stateAt(block) {
      // One eth_call at the block: the count, the pool and an ask for every manifest
      // project (one the contract doesn't have yet reverts, and is left out).
      const [b, r] = await Promise.all([
        blockAt(block),
        pub.multicall({
          blockNumber: BigInt(block),
          batchSize: 0,
          multicallAddress: MULTICALL3,
          allowFailure: true,
          contracts: [
            { ...contract, functionName: "initiativeCount" },
            { ...contract, functionName: "poolUsd" },
            { ...contract, functionName: "withdrawnMask" },
            ...m.slugs.map((_, i) => ({
              ...contract,
              functionName: "initiativeUsd",
              args: [BigInt(i)],
            })),
            ...m.slugs.map((_, i) => ({
              ...contract,
              functionName: "valuationDiagnostics",
              args: [BigInt(i)],
            })),
          ],
        } as never) as Promise<{ status: string; result?: unknown; error?: Error }[]>,
      ]);
      // allowFailure turns a failed eth_call into failed results: the read failed.
      for (const x of r.slice(0, 2)) if (x.status !== "success") throw x.error;
      const count = Number(r[0].result as bigint);
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
      return {
        timestamp: b.timestamp,
        asks,
        poolUsd: BigInt(r[1].result as bigint),
        withdrawn,
        valuation,
      };
    },
    accountingEventBlocks: (from, to) =>
      logBlocks(from, to, (fromBlock, toBlock) =>
        pub.getLogs({
          address: m.contract,
          events: [PLEDGE_SET, POOL_USD_SET, INITIATIVE_WITHDRAWN, INITIATIVE_CONFIGURED],
          fromBlock,
          toBlock,
        })),
    async balanceChangeBlocks(from, to) {
      if (m.configRevision === undefined) {
        if (m.currencies && m.currencies.length > 1 && m.accounts?.length !== m.slugs.length) {
          throw new Error("vote manifest: currencies need one account per project");
        }
        return await scanBalances(from, to, m.accounts ?? []);
      }
      const history = await accountHistory(m.readAt?.block ?? to);
      const periods = accountPeriods(history, from, to);
      const blocks = new Set<number>();
      for (const p of periods) {
        for (const b of await scanBalances(p.from, p.to, p.accounts)) blocks.add(b);
      }
      return [...blocks].sort((a, b) => a - b);
    },
  };
}

/** Everything a replay reads (shared/vote/replay-round.ts), from an RPC URL alone: the
 * ballot reads of a VoteChain without a relayer, and the chain states. For the site's
 * own source and for scripts/vote-replay.ts. */
export function createRoundSource(
  m: VoteManifest,
  rpcUrl: string,
  transport: Transport = http(rpcUrl),
): RoundSource {
  const chain = createVoteChain(m, rpcUrl, null, transport);
  return {
    ...createStateSource(m, rpcUrl, transport),
    ballots: () => chain.ballots(),
    committed: (block, tokenIds) => chain.committed(block, tokenIds),
    rulesHistory: () => chain.rulesHistory(),
  };
}

/** Chain reads that are final, kept in KV under the round's prefix. */
export function kvStateCache(kv: Deno.Kv, m: VoteManifest): StateCache {
  const prefix = ["vote", m.chainId, m.contract.toLowerCase(), "chain"];
  return {
    get: async (key) => (await kv.get([...prefix, key])).value ?? undefined,
    set: async (key, value) => {
      await kv.set([...prefix, key], value);
    },
  };
}
