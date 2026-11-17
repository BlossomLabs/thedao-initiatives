import { assertEquals, assertRejects } from "@std/assert";
import { stampLogs } from "../services/vote-chain.ts";

const logs = [{ blockNumber: 10n }, { blockNumber: 10n }, { blockNumber: 12n }];

Deno.test("stampLogs: before S's first tally, no block lookups (the head's time bounds every log)", async () => {
  let calls = 0;
  const out = await stampLogs(logs, 1_000, 2_000, () => {
    calls++;
    return Promise.resolve(0);
  });
  assertEquals(calls, 0);
  assertEquals(out, [1_000, 1_000, 1_000]);
});

Deno.test("stampLogs: from S's first tally, one lookup per distinct block", async () => {
  const seen: bigint[] = [];
  const out = await stampLogs(logs, 3_000, 2_000, (b) => {
    seen.push(b);
    return Promise.resolve(Number(b) * 100);
  });
  assertEquals(seen.sort(), [10n, 12n]);
  assertEquals(out, [1_000, 1_000, 1_200]);
});

Deno.test("Sepolia RPC: SEPOLIA_RPC_URL, else the public node — never the mainnet Alchemy app", async () => {
  const { loadConfig } = await import("../config.ts");
  assertEquals(
    loadConfig({ ALCHEMY_API_KEY: "k" }).sepoliaRpcUrl,
    "https://ethereum-sepolia-rpc.publicnode.com",
  );
  assertEquals(
    loadConfig({ ALCHEMY_API_KEY: "k", SEPOLIA_RPC_URL: "https://s.example" }).sepoliaRpcUrl,
    "https://s.example",
  );
});

Deno.test("a real round reads ownerOf from the voting badge, not the ballots contract", async () => {
  const { createVoteChain } = await import("../services/vote-chain.ts");
  const { custom } = await import("viem");
  const BADGE = "0x3b49f45ec8796f64febb1ae0f5661791845ce35c";
  const BALLOTS = "0x1000000000000000000000000000000000000001";
  const calls: string[] = [];
  const transport = custom({
    request: ({ method, params }: { method: string; params: unknown[] }) => {
      if (method === "eth_chainId") return Promise.resolve("0x1");
      if (method === "eth_call") {
        calls.push((params[0] as { to: string }).to.toLowerCase());
        return Promise.resolve("0x" + "0".repeat(24) + "11".repeat(20));
      }
      return Promise.reject(new Error("unexpected " + method));
    },
  });
  const chain = createVoteChain(
    {
      kind: "real",
      chainId: 1,
      contract: BALLOTS,
      badge: BADGE,
      deployBlock: 1,
      opensAt: 0,
      closesAt: 1,
      schedule: { opensAt: 0, firstTallyAt: [1, 2, 3], initialWindow: 1, maxWindows: 1 },
      poolUsd: "1",
      slugs: ["a"],
      projects: [{ goalUsd: "1", rfp: false, groups: [] }],
      groups: [],
      independentTiers: 1,
    },
    "http://unused",
    null,
    transport,
  );
  assertEquals((await chain.ownerOf(7n))?.toLowerCase(), "0x" + "11".repeat(20));
  assertEquals(calls, [BADGE]);
});

Deno.test("ownerOf: an unminted badge is free; other reverts and RPC failures propagate", async () => {
  const { createVoteChain } = await import("../services/vote-chain.ts");
  const { custom, encodeErrorResult, parseAbi } = await import("viem");
  const m: import("../../shared/vote/manifest.ts").VoteManifest = {
    kind: "test",
    chainId: 11155111,
    contract: "0x1000000000000000000000000000000000000001",
    deployBlock: 1,
    opensAt: 0,
    closesAt: 1,
    schedule: { opensAt: 0, firstTallyAt: [1, 2, 3], initialWindow: 1, maxWindows: 1 },
    poolUsd: "1",
    slugs: ["a"],
    projects: [{ goalUsd: "1", rfp: false, groups: [] }],
    groups: [],
    independentTiers: 1,
  };
  const chainWith = (error: Error) =>
    createVoteChain(
      m,
      "http://unused",
      null,
      custom({
        request: ({ method }: { method: string }) => {
          if (method === "eth_chainId") return Promise.resolve("0xaa36a7");
          if (method === "eth_call") return Promise.reject(error);
          return Promise.reject(new Error("unexpected " + method));
        },
      }, { retryCount: 0 }),
    );
  const missing = encodeErrorResult({
    abi: parseAbi(["error ERC721NonexistentToken(uint256 tokenId)"]),
    errorName: "ERC721NonexistentToken",
    args: [1n],
  });
  const revert = (data: string) =>
    Object.assign(new Error("execution reverted"), { code: 3, data });
  assertEquals(await chainWith(revert(missing)).ownerOf(1n), null);
  await assertRejects(() => chainWith(revert("0xdeadbeef")).ownerOf(1n));
  await assertRejects(() => chainWith(revert("0x")).ownerOf(1n));
  // A provider message isn't proof that the contract says the badge is unminted.
  await assertRejects(() => chainWith(new Error("RPC failed: ERC721NonexistentToken")).ownerOf(1n));
});

Deno.test("asks: every project's initiativeUsd ask, in manifest order, in one multicall", async () => {
  const { createVoteChain } = await import("../services/vote-chain.ts");
  const { custom, encodeFunctionResult, parseAbi } = await import("viem");
  const { SIGNED_BALLOTS_ABI } = await import("../../shared/vote/abi.ts");
  const usd = (a: bigint, b: bigint, c: bigint, d: bigint) =>
    encodeFunctionResult({
      abi: SIGNED_BALLOTS_ABI,
      functionName: "initiativeUsd",
      result: [a, b, c, d],
    });
  const multicall3 = parseAbi([
    "function aggregate3((address target, bool allowFailure, bytes callData)[]) returns ((bool success, bytes returnData)[])",
  ]);
  let calls = 0;
  const transport = custom({
    request: ({ method }: { method: string }) => {
      if (method === "eth_chainId") return Promise.resolve("0x1");
      if (method === "eth_call") {
        calls++;
        return Promise.resolve(encodeFunctionResult({
          abi: multicall3,
          functionName: "aggregate3",
          result: [
            { success: true, returnData: usd(5n, 6n, 11n, 100n) },
            { success: true, returnData: usd(0n, 0n, 0n, 250n) },
          ],
        }));
      }
      return Promise.reject(new Error("unexpected " + method));
    },
  });
  const chain = createVoteChain(
    {
      kind: "test",
      chainId: 1,
      contract: "0x1000000000000000000000000000000000000001",
      deployBlock: 1,
      opensAt: 0,
      closesAt: 1,
      schedule: { opensAt: 0, firstTallyAt: [1, 2, 3], initialWindow: 1, maxWindows: 1 },
      poolUsd: "1",
      slugs: ["a", "b"],
      projects: [{ goalUsd: "1", rfp: false, groups: [] }, {
        goalUsd: "1",
        rfp: false,
        groups: [],
      }],
      groups: [],
      independentTiers: 1,
    },
    "http://unused",
    null,
    transport,
  );
  assertEquals(await chain.asks(), [100n, 250n]);
  assertEquals(calls, 1);
});

Deno.test("canWithdraw: a contract with withdrawnMask can; one without (reverts, or no data) can't; a network failure throws", async () => {
  const { createVoteChain } = await import("../services/vote-chain.ts");
  const { custom, encodeFunctionResult } = await import("viem");
  const { SIGNED_BALLOTS_ABI } = await import("../../shared/vote/abi.ts");
  const m: import("../../shared/vote/manifest.ts").VoteManifest = {
    kind: "test",
    chainId: 11155111,
    contract: "0x1000000000000000000000000000000000000001",
    deployBlock: 1,
    opensAt: 0,
    closesAt: 1,
    schedule: { opensAt: 0, firstTallyAt: [1, 2, 3], initialWindow: 1, maxWindows: 1 },
    poolUsd: "1",
    slugs: ["a"],
    projects: [{ goalUsd: "1", rfp: false, groups: [] }],
    groups: [],
    independentTiers: 1,
  };
  const chainWith = (call: () => Promise<unknown>) =>
    createVoteChain(
      m,
      "http://unused",
      null,
      custom({
        request: ({ method }: { method: string }) => {
          if (method === "eth_chainId") return Promise.resolve("0xaa36a7");
          if (method === "eth_call") return call();
          return Promise.reject(new Error("unexpected " + method));
        },
      }),
    );
  const has = chainWith(() =>
    Promise.resolve(
      encodeFunctionResult({ abi: SIGNED_BALLOTS_ABI, functionName: "withdrawnMask", result: 0n }),
    )
  );
  assertEquals(await has.canWithdraw!(), true);
  const reverts = chainWith(() =>
    Promise.reject(Object.assign(new Error("execution reverted"), { code: 3, data: "0x" }))
  );
  assertEquals(await reverts.canWithdraw!(), false);
  assertEquals(await chainWith(() => Promise.resolve("0x")).canWithdraw!(), false);
  const down = chainWith(() => Promise.reject(new Error("fetch failed")));
  let threw = false;
  await down.canWithdraw!().catch(() => (threw = true));
  assertEquals(threw, true);
});

Deno.test("blockTime: one read per block hash, shared across reads; a failed read is not kept", async () => {
  const { blockTime } = await import("../services/vote-chain.ts");
  let reads = 0;
  const read = () => (reads++, Promise.resolve(1_234));
  const hash = `0x${"ab".repeat(32)}` as const;
  assertEquals(await blockTime(11155111, hash, read), 1_234);
  assertEquals(
    await blockTime(11155111, hash.toUpperCase().replace("0X", "0x") as never, read),
    1_234,
  );
  assertEquals(reads, 1, "the same block hash, read once");
  await blockTime(1, hash, read);
  assertEquals(reads, 2, "another chain's block is another entry");
  const bad = `0x${"cd".repeat(32)}` as const;
  await assertRejects(() => blockTime(11155111, bad, () => Promise.reject(new Error("rpc"))));
  assertEquals(await blockTime(11155111, bad, read), 1_234);
  assertEquals(reads, 3, "a failed read is asked again");
});
