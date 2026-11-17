// A pinned round (manifest `readAt` with a hash) replayed against a JSON-RPC node: the
// same result as the unpinned reads, in a handful of calls, and a head that is no longer
// canonical is refused.
import { assertEquals, assertRejects } from "@std/assert";
import {
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  type Hex,
  multicall3Abi,
  parseAbi,
  toFunctionSelector,
  toHex,
} from "viem";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { replayRound, roundJson } from "../../shared/vote/replay-round.ts";
import { transcriptOf } from "../../shared/vote/transcript.ts";
import {
  createRoundSource,
  createStateSource,
  createVoteChain,
  stateSourceMemo,
} from "../services/vote-chain.ts";
import { BALLOT_RECORDED, POOL_USD_SET } from "../services/vote-pinned.ts";

const CONTRACT: Hex = "0x1000000000000000000000000000000000000001";
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const VOTER: Hex = "0x5000000000000000000000000000000000000005";
/** Block n has timestamp 12·n and hash n; the chain starts at BASE (viem knows Multicall3
 * on Sepolia only from its deploy block on). */
const SECS = 12;
const BASE = 2_000_000;
const B = (k: number) => BASE + k;
const T = (k: number) => B(k) * SECS;
/** Block n's hash; `salt` gives each test's chain its own hashes (block times are
 * remembered per hash for the whole isolate). */
const hashOf = (n: number, salt = 0) => toHex(BigInt(n) + (BigInt(salt) << 128n), { size: 32 });
const numberOf = (hash: Hex) => Number(BigInt(hash) & ((1n << 128n) - 1n));
const GET_BLOCK_HASH = toFunctionSelector("getBlockHash(uint256)");

const manifest: VoteManifest = {
  kind: "test",
  chainId: 11155111,
  contract: CONTRACT,
  deployBlock: B(1),
  opensAt: 0,
  closesAt: 99_999,
  // S's first tally at block 500: ballots after it are stamped with their block's time.
  schedule: {
    opensAt: 0,
    firstTallyAt: [T(500), T(5_000), T(6_000)],
    initialWindow: 600,
    maxWindows: 2,
  },
  poolUsd: "300",
  slugs: ["a", "b", "c"],
  projects: ["a", "b", "c"].map(() => ({ goalUsd: "1", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
  ballotRules: true,
};

type Ballot = { tokenId: bigint; nonce: bigint; ballot: Hex; block: number };

function node(
  o: { head: number; finalized: number; ballots: Ballot[]; stamped?: boolean; salt?: number },
) {
  const hash = (n: number) => hashOf(n, o.salt);
  const calls: { method: string; tag?: unknown; from?: number }[] = [];
  const block = (n: number) => ({
    number: toHex(n),
    timestamp: toHex(n * SECS),
    hash: hash(n),
    parentHash: hash(Math.max(0, n - 1)),
    transactions: [],
  });
  const ballotsAt = (at: number) => o.ballots.filter((b) => b.block <= at);
  const logs = () =>
    [
      ...o.ballots.map((b) => ({
        block: b.block,
        topics: encodeEventTopics({
          abi: [BALLOT_RECORDED],
          eventName: "BallotRecorded",
          args: { tokenId: b.tokenId, voter: VOTER },
        }),
        data: encodeAbiParameters([{ type: "uint64" }, { type: "bytes" }], [b.nonce, b.ballot]),
      })),
      {
        block: B(50),
        topics: encodeEventTopics({ abi: [POOL_USD_SET], eventName: "PoolUsdSet" }),
        data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [0n, 300n]),
      },
    ].sort((a, b) => a.block - b.block);
  const result = (functionName: string, r: unknown, abi: unknown = SIGNED_BALLOTS_ABI) => ({
    success: true,
    returnData: encodeFunctionResult({ abi, functionName, result: r } as never) as Hex,
  });
  const transport = custom({
    request: ({ method, params }: { method: string; params: unknown[] }) => {
      if (method === "eth_chainId") return Promise.resolve(toHex(11155111));
      if (method === "eth_blockNumber") return Promise.resolve(toHex(o.head));
      if (method === "eth_getBlockByNumber") {
        const tag = params[0] as string;
        calls.push({ method, tag });
        const n = tag === "latest" ? o.head : tag === "finalized" ? o.finalized : Number(tag);
        return Promise.resolve(block(n));
      }
      if (method === "eth_getLogs") {
        const f = params[0] as { fromBlock: Hex; toBlock: Hex; topics: (Hex | Hex[] | null)[] };
        const [from, to] = [Number(f.fromBlock), Number(f.toBlock)];
        calls.push({ method, from });
        const want = [f.topics[0]].flat().map((t) => t?.toLowerCase());
        return Promise.resolve(
          logs().filter((l) => l.block >= from && l.block <= to && want.includes(l.topics[0]))
            .map((l, i) => ({
              address: CONTRACT,
              topics: l.topics,
              data: l.data,
              blockNumber: toHex(l.block),
              blockHash: hash(l.block),
              ...(o.stamped ? { blockTimestamp: toHex(l.block * SECS) } : {}),
              logIndex: toHex(i),
              transactionHash: hash(l.block),
              transactionIndex: "0x0",
              removed: false,
            })),
        );
      }
      if (method === "eth_call") {
        const tag = params[1] as string | { blockHash: Hex; requireCanonical: boolean };
        calls.push({ method, tag });
        let at: number;
        if (typeof tag === "object") {
          at = numberOf(tag.blockHash);
          // A hash this chain doesn't have (or not canonically): refused.
          if (!tag.requireCanonical || hash(at) !== tag.blockHash || at > o.head) {
            return Promise.reject(new Error("header for hash not found"));
          }
        } else at = tag === "latest" ? o.head : Number(tag);
        const { data } = params[0] as { data: Hex };
        const [subs] = decodeFunctionData({ abi: multicall3Abi, data }).args as unknown as [
          { target: Hex; callData: Hex }[],
        ];
        const proof = transcriptOf(
          ballotsAt(at).map((b) => ({
            tokenId: b.tokenId.toString(),
            voter: VOTER,
            nonce: b.nonce,
            ballot: b.ballot,
          })),
        );
        const results = subs.map((s) => {
          if (s.target.toLowerCase() === MULTICALL3) {
            if (s.callData === toFunctionSelector("getCurrentBlockTimestamp()")) {
              return result("getCurrentBlockTimestamp", BigInt(at * SECS), multicall3Abi);
            }
            if (!s.callData.startsWith(GET_BLOCK_HASH)) throw new Error("unexpected call");
            const n = Number(BigInt(`0x${s.callData.slice(10)}`));
            return result(
              "getBlockHash",
              n < at && at - n <= 256 ? hash(n) : `0x${"0".repeat(64)}`,
              parseAbi(["function getBlockHash(uint256) view returns (bytes32)"]),
            );
          }
          const { functionName, args } = decodeFunctionData({
            abi: SIGNED_BALLOTS_ABI,
            data: s.callData,
          });
          switch (functionName) {
            case "transcript":
              return result(functionName, proof.transcript);
            case "recordCount":
              return result(functionName, BigInt(proof.count));
            case "ballotHashOf":
              return result(functionName, proof.lastHash.get(String(args![0])));
            case "initiativeCount":
              return result(functionName, 3n);
            case "poolUsd":
              return result(functionName, 300n);
            case "withdrawnMask":
              return result(functionName, 0n);
            case "initiativeUsd":
              return result(functionName, [0n, 0n, 0n, 100n]);
            case "valuationDiagnostics":
              return result(functionName, 0n);
          }
          throw new Error("unexpected " + functionName);
        });
        return Promise.resolve(
          encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results }),
        );
      }
      return Promise.reject(new Error("unexpected " + method));
    },
  }, { retryCount: 0 });
  return { transport, calls };
}

const BALLOTS: Ballot[] = [
  { tokenId: 1n, nonce: 1n, ballot: "0x01ffff", block: B(100) },
  { tokenId: 2n, nonce: 1n, ballot: "0xff01ff", block: B(200) },
  // After S's first tally (block 500), in its window: stamped with its block's own time.
  { tokenId: 3n, nonce: 1n, ballot: "0xffff01", block: B(520) },
  { tokenId: 1n, nonce: 2n, ballot: "0x01ff01", block: B(530) },
];
const pin = (head: number, salt = 0): VoteManifest => ({
  ...manifest,
  readAt: { block: head, timestamp: head * SECS, hash: hashOf(head, salt) },
});
const replay = (m: VoteManifest, transport: ReturnType<typeof node>["transport"], head: number) =>
  replayRound(m, createRoundSource(m, "http://unused", transport), { now: head * SECS + 5 });

const count = (calls: ReturnType<typeof node>["calls"], method: string, tag?: unknown) =>
  calls.filter((c) => c.method === method && (tag === undefined || c.tag === tag)).length;
const byHash = (calls: ReturnType<typeof node>["calls"]) =>
  calls.filter((c) => c.method === "eth_call" && typeof c.tag === "object").length;

Deno.test("pinned: the same round as the unpinned reads, in far fewer calls", async () => {
  const plain = node({ head: B(1000), finalized: B(930), ballots: BALLOTS, salt: 1 });
  const expected = roundJson(await replay(manifest, plain.transport, B(1000)), manifest.slugs);
  const chain = node({
    head: B(1001),
    finalized: B(930),
    ballots: BALLOTS,
    stamped: true,
    salt: 1,
  });
  const got = roundJson(await replay(pin(B(1000), 1), chain.transport, B(1000)), manifest.slugs);
  assertEquals(got, expected);
  assertEquals(Object.keys(got.accepted), ["1", "2", "3"]);
  const { calls } = chain;
  assertEquals(count(calls, "eth_getLogs"), 1, "one read for every event of the contract");
  assertEquals(count(calls, "eth_getBlockByNumber", "latest"), 0);
  assertEquals(count(calls, "eth_getBlockByNumber", "finalized"), 1);
  // The head's commitments and state, then one state per tally point and ballot block in
  // S's window: every one by its block's hash.
  assertEquals(count(calls, "eth_call"), byHash(calls));
  assertEquals(byHash(calls), 6);
  assertEquals(
    calls.length * 2 < plain.calls.length,
    true,
    `${calls.length} calls pinned, ${plain.calls.length} unpinned`,
  );
});

Deno.test("pinned: ballot times come with the logs; without them, each block is read once per isolate", async () => {
  const stamped = node({
    head: B(1001),
    finalized: B(930),
    ballots: BALLOTS,
    stamped: true,
    salt: 3,
  });
  await replay(pin(B(1000), 3), stamped.transport, B(1000));
  const plain = node({ head: B(1001), finalized: B(930), ballots: BALLOTS, salt: 4 });
  await replay(pin(B(1000), 4), plain.transport, B(1000));
  // B(520) and B(530): ballots in S's window. Each is read once as its state's block;
  // without the logs' times, every ballot block once more for its time.
  const reads = (calls: typeof plain.calls) =>
    [B(100), B(520), B(530)].map((n) => count(calls, "eth_getBlockByNumber", toHex(n)));
  assertEquals(reads(stamped.calls), [0, 1, 1]);
  // From S's first tally on every ballot's block is stamped, B(100)'s too.
  assertEquals(reads(plain.calls), [1, 2, 2]);
  // The next block's pin from a new source (nothing shared but the isolate): the block
  // times are remembered, only each state's own block is read.
  plain.calls.length = 0;
  await replay(pin(B(1001), 4), plain.transport, B(1001));
  assertEquals(reads(plain.calls), [0, 1, 1]);
});

Deno.test("pinned: a head that is no longer canonical is refused", async () => {
  const chain = node({ head: B(1000), finalized: B(930), ballots: BALLOTS, salt: 5 });
  // Block B(999) under a hash the chain doesn't have.
  await assertRejects(() => replay(pin(B(999), 6), chain.transport, B(999)), Error);
});

Deno.test("pinned: the next pin reads the logs after the finalized block, and searches nothing again", async () => {
  const { transport, calls } = node({
    head: B(1002),
    finalized: B(930),
    ballots: BALLOTS,
    salt: 7,
  });
  const memo = stateSourceMemo();
  const source = (m: VoteManifest) => {
    const chain = createVoteChain(m, "http://unused", null, transport, undefined, memo);
    return {
      ...createStateSource(m, "http://unused", transport, memo),
      ballots: () => chain.ballots(),
      committed: (b: bigint, t: bigint[]) => chain.committed(b, t),
      rulesHistory: () => chain.rulesHistory(),
    };
  };
  const m = pin(B(1000), 7);
  const first = await replayRound(m, source(m), { now: T(1000) + 5 });
  // The first pin learns which block is final; the logs up to it are kept from the
  // next read on (one started after it was final).
  const between = pin(B(1001), 7);
  await replayRound(between, source(between), { now: T(1001) + 5 });
  calls.length = 0;
  const next = pin(B(1002), 7);
  const second = await replayRound(next, source(next), { now: T(1002) + 5 });
  assertEquals(
    roundJson(second, manifest.slugs).accepted,
    roundJson(first, manifest.slugs).accepted,
  );
  assertEquals(calls.filter((c) => c.method === "eth_getLogs").map((c) => c.from), [B(931)]);
  // The finalized block, then the head read once more at the end: no search, and the
  // final blocks' reads are remembered.
  assertEquals(calls.filter((c) => c.method === "eth_getBlockByNumber").map((c) => c.tag), [
    "finalized",
    toHex(B(1002)),
  ]);
  // The head, and the five final states (no KV cache in this test).
  assertEquals(byHash(calls), 6);
});
