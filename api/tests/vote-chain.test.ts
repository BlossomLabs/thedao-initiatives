import { assertEquals } from "@std/assert";
import { stampLogs } from "../services/vote-chain.ts";

const logs = [{ blockNumber: 10n }, { blockNumber: 10n }, { blockNumber: 12n }];

Deno.test("stampLogs: before the close, no block lookups (the head's time bounds every log)", async () => {
  let calls = 0;
  const out = await stampLogs(logs, 1_000, 2_000, () => {
    calls++;
    return Promise.resolve(0);
  });
  assertEquals(calls, 0);
  assertEquals(out, [1_000, 1_000, 1_000]);
});

Deno.test("stampLogs: after the close, one lookup per distinct block", async () => {
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
