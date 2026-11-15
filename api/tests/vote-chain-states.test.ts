import { assertEquals, assertRejects } from "@std/assert";
import {
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  type Hex,
  multicall3Abi,
  parseAbiItem,
  toHex,
} from "viem";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
import { chainStates } from "../../shared/vote/chain-states.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { createStateSource, kvStateCache } from "../services/vote-chain.ts";

const CONTRACT = "0x1000000000000000000000000000000000000001";
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const ZERO: Hex = "0x0000000000000000000000000000000000000000";
const TOKEN: Hex = "0x2000000000000000000000000000000000000002";
const ACCOUNTS: Hex[] = [
  "0x3000000000000000000000000000000000000003",
  "0x4000000000000000000000000000000000000004",
];
/** Block n has timestamp 12·n. */
const SECS = 12;

const manifest = (currencies: { asset: Hex }[] = []): VoteManifest => ({
  kind: "test",
  chainId: 1,
  contract: CONTRACT,
  deployBlock: 1,
  opensAt: 0,
  closesAt: 99_999,
  schedule: { opensAt: 0, firstTallyAt: [1200, 5000, 6000], initialWindow: 600, maxWindows: 2 },
  poolUsd: "1",
  slugs: ["a", "b"],
  projects: [0, 1].map(() => ({ goalUsd: "1", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
  ...(currencies.length
    ? {
      currencies: [{ asset: ZERO }, ...currencies].map((c) => ({
        symbol: "X",
        asset: c.asset,
        usdFeed: ZERO,
      })),
      accounts: ACCOUNTS,
    }
    : {}),
});

type Log = { address: Hex; topics: Hex[]; data: Hex; block: number };
/** A JSON-RPC node over blocks 0..head. `pruned`: no state before head − 10. */
function node(o: {
  head: number;
  pruned?: boolean;
  count?: number;
  ethOf?: (block: number, account: Hex) => bigint;
  logs?: Log[];
}) {
  const calls: { method: string; block?: string }[] = [];
  const block = (n: number) => ({
    number: toHex(n),
    timestamp: toHex(n * SECS),
    hash: toHex(n, { size: 32 }),
    parentHash: toHex(Math.max(0, n - 1), { size: 32 }),
    transactions: [],
  });
  const ok = (abi: typeof SIGNED_BALLOTS_ABI, functionName: string, result: unknown) => ({
    success: true,
    returnData: encodeFunctionResult({ abi, functionName, result } as never) as Hex,
  });
  const transport = custom({
    request: ({ method, params }: { method: string; params: unknown[] }) => {
      if (method === "eth_chainId") return Promise.resolve("0x1");
      if (method === "eth_blockNumber") return Promise.resolve(toHex(o.head));
      if (method === "eth_getBlockByNumber") {
        const tag = params[0] as string;
        return Promise.resolve(block(tag === "latest" ? o.head : Number(tag)));
      }
      if (method === "eth_call") {
        const tag = params[1] as string;
        calls.push({ method, block: tag });
        const at = tag === "latest" ? o.head : Number(tag);
        if (o.pruned && at < o.head - 10) {
          return Promise.reject(new Error("missing trie node (state is not available)"));
        }
        const { to, data } = params[0] as { to: string; data: Hex };
        if (to.toLowerCase() !== MULTICALL3) throw new Error("not a multicall");
        const [subs] = decodeFunctionData({ abi: multicall3Abi, data }).args as unknown as [
          { target: Hex; callData: Hex }[],
        ];
        const results = subs.map((s): { success: boolean; returnData: Hex } => {
          if (s.target.toLowerCase() === MULTICALL3) {
            const { args } = decodeFunctionData({ abi: multicall3Abi, data: s.callData });
            return {
              success: true,
              returnData: encodeFunctionResult({
                abi: multicall3Abi,
                functionName: "getEthBalance",
                result: o.ethOf!(at, args![0] as Hex),
              }),
            };
          }
          const { functionName, args } = decodeFunctionData({
            abi: SIGNED_BALLOTS_ABI,
            data: s.callData,
          });
          const count = o.count ?? 2;
          if (functionName === "initiativeCount") {
            return ok(SIGNED_BALLOTS_ABI, functionName, BigInt(count));
          }
          if (functionName === "poolUsd") return ok(SIGNED_BALLOTS_ABI, functionName, 500n);
          if (functionName === "initiativeUsd") {
            const i = Number(args![0]);
            if (i >= count) return { success: false, returnData: "0x" as Hex };
            return ok(SIGNED_BALLOTS_ABI, functionName, [0n, 0n, 0n, BigInt(100 * (i + 1) + at)]);
          }
          throw new Error("unexpected " + functionName);
        });
        return Promise.resolve(
          encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results }),
        );
      }
      if (method === "eth_getLogs") {
        calls.push({ method });
        const f = params[0] as {
          address: Hex | Hex[];
          topics: (Hex | Hex[] | null)[];
          fromBlock: Hex;
          toBlock: Hex;
        };
        const addrs = [f.address].flat().map((a) => a.toLowerCase());
        const match = (want: Hex | Hex[] | null | undefined, got: Hex | undefined) =>
          want == null || [want].flat().map((x) => x.toLowerCase()).includes(got!.toLowerCase());
        const out = (o.logs ?? []).filter((l) =>
          addrs.includes(l.address.toLowerCase()) &&
          l.block >= Number(f.fromBlock) && l.block <= Number(f.toBlock) &&
          f.topics.every((t, i) => match(t, l.topics[i]))
        );
        return Promise.resolve(out.map((l, i) => ({
          address: l.address,
          topics: l.topics,
          data: l.data,
          blockNumber: toHex(l.block),
          blockHash: toHex(l.block, { size: 32 }),
          logIndex: toHex(i),
          transactionHash: toHex(l.block, { size: 32 }),
          transactionIndex: "0x0",
          removed: false,
        })));
      }
      return Promise.reject(new Error("unexpected " + method));
    },
  }, { retryCount: 0 });
  return { transport, calls };
}

Deno.test("a pruned RPC error on a past block propagates", async () => {
  const { transport } = node({ head: 1000, pruned: true });
  const src = createStateSource(manifest(), "http://unused", transport);
  // The head's state is there; a past block's is not, and nothing stands in for it.
  assertEquals((await src.stateAt(1000)).asks.length, 2);
  await assertRejects(() => src.stateAt(100), Error, "missing trie node");
  await assertRejects(
    () =>
      chainStates(manifest(), src, { now: 1000 * SECS, receiptBlocks: [], finalAfterSecs: 1800 }),
    Error,
    "missing trie node",
  );
});

Deno.test("stateAt: one multicall at that block; asks only for projects the contract has", async () => {
  const { transport, calls } = node({ head: 1000, count: 1 });
  const src = createStateSource(manifest(), "http://unused", transport);
  const s = await src.stateAt(400);
  assertEquals(s, { timestamp: 400 * SECS, asks: [500n], poolUsd: 500n });
  assertEquals(calls, [{ method: "eth_call", block: toHex(400) }]);
});

Deno.test("stateAt: a contract with more projects than the manifest is an error", async () => {
  const { transport } = node({ head: 1000, count: 3 });
  const src = createStateSource(manifest(), "http://unused", transport);
  await assertRejects(() => src.stateAt(400), Error, "the contract has 3 projects");
});

Deno.test("blockBefore: the last block strictly before a time", async () => {
  const { transport } = node({ head: 1000 });
  const src = createStateSource(manifest(), "http://unused", transport);
  assertEquals(await src.blockBefore(1200), { block: 99, timestamp: 1188 });
  assertEquals(await src.blockBefore(1201), { block: 100, timestamp: 1200 });
  assertEquals(await src.blockBefore(1), { block: 0, timestamp: 0 });
  // Past the head: the head.
  assertEquals(await src.blockBefore(99_999), { block: 1000, timestamp: 12_000 });
  await assertRejects(() => src.blockBefore(0), Error, "no block before");
});

Deno.test("native balances: a block where an account's ETH balance changed, one multicall per block", async () => {
  const { transport, calls } = node({
    head: 1000,
    ethOf: (b, a) => (a === ACCOUNTS[1] && b >= 105 ? 2n : 1n) + (b >= 108 ? 5n : 0n),
  });
  const src = createStateSource(manifest([{ asset: ZERO }]), "http://unused", transport);
  assertEquals(await src.balanceChangeBlocks(100, 110), [105, 108]);
  // Blocks 99..110: 99 is the one each change is compared with.
  assertEquals(calls.filter((c) => c.method === "eth_call").length, 12);
});

Deno.test("native balances: a second scan reads only new blocks and the last few again", async () => {
  // A change at 950, and one at 995 that a reorg moves to 996 before the second scan.
  let moved = false;
  const at = { head: 1000 };
  const { transport, calls } = node({
    get head() {
      return at.head;
    },
    ethOf: (b) => (b >= 950 ? 2n : 1n) + (b >= (moved ? 996 : 995) ? 5n : 0n),
  });
  const src = createStateSource(manifest([{ asset: ZERO }]), "http://unused", transport);
  const ethCalls = () => calls.filter((c) => c.method === "eth_call").length;
  assertEquals(await src.balanceChangeBlocks(900, 1000), [950, 995]);
  assertEquals(ethCalls(), 102); // 899..1000
  moved = true;
  at.head = 1005;
  assertEquals(await src.balanceChangeBlocks(900, 1005), [950, 996]);
  // Blocks to 988 were 12 deep at the first scan: kept. 989..1005 again, against 988.
  assertEquals(ethCalls() - 102, 18);
  // Nothing new: only the shallow tail again.
  const before = ethCalls();
  assertEquals(await src.balanceChangeBlocks(900, 1005), [950, 996]);
  assertEquals(ethCalls() - before, 13); // 994..1005, against 993
});

Deno.test("ERC-20 balances: a Transfer to or from an account; others are not seen", async () => {
  const transfer = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  );
  const log = (from: Hex, to: Hex, block: number, address: Hex = TOKEN): Log => ({
    address,
    topics: encodeEventTopics({ abi: [transfer], args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [1n]),
    block,
  });
  const other = "0x5000000000000000000000000000000000000005";
  const { transport, calls } = node({
    head: 1000,
    logs: [
      log(other, ACCOUNTS[0], 103),
      log(ACCOUNTS[1], other, 107),
      log(other, other, 104),
      log(other, ACCOUNTS[0], 105, "0x6000000000000000000000000000000000000006"),
      log(other, ACCOUNTS[0], 200),
    ],
  });
  const src = createStateSource(manifest([{ asset: TOKEN }]), "http://unused", transport);
  assertEquals(await src.balanceChangeBlocks(100, 110), [103, 107]);
  // No native currency: no balances read block by block.
  assertEquals(calls.filter((c) => c.method === "eth_call").length, 0);
});

Deno.test("accountingEventBlocks: blocks with a PledgeSet or PoolUsdSet from the round's contract", async () => {
  const pool = parseAbiItem("event PoolUsdSet(uint256 previousAmountUsd, uint256 amountUsd)");
  const pledge = parseAbiItem(
    "event PledgeSet(bytes32 indexed pledgeId, uint256 indexed initiativeId, uint256 indexed currencyId, uint256 amount)",
  );
  const poolLog = (block: number, address: Hex = CONTRACT): Log => ({
    address,
    topics: encodeEventTopics({ abi: [pool] }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1n, 2n]),
    block,
  });
  const pledgeLog = (block: number): Log => ({
    address: CONTRACT,
    topics: encodeEventTopics({
      abi: [pledge],
      args: { pledgeId: toHex(1, { size: 32 }), initiativeId: 0n, currencyId: 1n },
    }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [9n]),
    block,
  });
  const { transport } = node({
    head: 1000,
    logs: [poolLog(102), pledgeLog(106), pledgeLog(106), poolLog(104, TOKEN), poolLog(300)],
  });
  const src = createStateSource(manifest(), "http://unused", transport);
  assertEquals(await src.accountingEventBlocks(100, 110), [102, 106]);
});

Deno.test("the KV cache keeps chain reads under the round's prefix", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const cache = kvStateCache(kv, manifest());
    assertEquals(await cache.get("state:1"), undefined);
    await cache.set("state:1", { timestamp: 12, asks: ["5"], poolUsd: "7" });
    assertEquals(await cache.get("state:1"), { timestamp: 12, asks: ["5"], poolUsd: "7" });
    const keys = [];
    for await (const e of kv.list({ prefix: ["vote", CONTRACT.toLowerCase(), "chain"] })) {
      keys.push(e.key);
    }
    assertEquals(keys, [["vote", CONTRACT.toLowerCase(), "chain", "state:1"]]);
  } finally {
    kv.close();
  }
});
