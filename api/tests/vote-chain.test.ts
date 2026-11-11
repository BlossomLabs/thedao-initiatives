import { assertEquals } from "@std/assert";
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
    },
    "http://unused",
    null,
    transport,
  );
  assertEquals((await chain.ownerOf(7n))?.toLowerCase(), "0x" + "11".repeat(20));
  assertEquals(calls, [BADGE]);
});
