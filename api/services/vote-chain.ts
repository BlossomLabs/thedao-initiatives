import {
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbi,
  parseAbiItem,
  type PublicClient,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
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
          readonly { tokenId: bigint; nonce: bigint; r: Hex; vs: Hex; ballot: Hex }[],
        ];
      }
      | { fn: "drip"; to: Hex; value: bigint },
    nonce: number,
  ): Promise<Hex>;
  /** Every BallotRecorded and RegistrationRevoked since the deploy block, in chain order. */
  ballots(): Promise<BallotEvent[]>;
}

/** In chain order; `block` and `nonce` let the quiet ending group a block's receipts. */
export type BallotEvent =
  | { tokenId: string; ballot: Hex; timestamp: number; block?: number; nonce?: number }
  | { tokenId: string; revoked: true; timestamp: number; block?: number };

export interface VoteRound {
  chain: VoteChain;
  manifest: VoteManifest;
  /** Each initiative's need (goal − raised, micro-USD) in manifest order; the API
   * reads the board when absent. */
  needs?: () => Promise<bigint[]>;
}

const BALLOT_RECORDED = parseAbiItem(
  "event BallotRecorded(uint256 indexed tokenId, address indexed voter, uint64 nonce, bytes ballot)",
);
const REGISTRATION_REVOKED = parseAbiItem("event RegistrationRevoked(uint256 indexed tokenId)");
const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);
const OWNER_OF_ABI = parseAbi(["function ownerOf(uint256) view returns (address)"]);
const LOG_CHUNK = 50_000n;
/** _safeMint to a wallet is ~100k gas; the rest is room for a small receive hook. */
const MINT_GAS = 250_000n;

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
  const read = <T>(functionName: string, args: readonly unknown[]) =>
    pub.readContract({
      address: m.contract,
      abi: SIGNED_BALLOTS_ABI,
      functionName: functionName as never,
      args: args as never,
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
        // ERC721NonexistentToken: not minted yet.
        if (String(e).includes("ERC721NonexistentToken")) return null;
        throw e;
      }
    },
    balanceOf: (a) => read<bigint>("balanceOf", [a]),
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
        });
        return true;
      } catch {
        return false;
      }
    },
    nonceOf: async (n) => BigInt(await read<bigint>("nonceOf", [n])),
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
    async ballots() {
      const headBlock = await pub.getBlock();
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
                timestamp: t,
                block,
                nonce: Number(log.args.nonce),
              }
              : { tokenId, revoked: true, timestamp: t, block },
          );
        }
      }
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
