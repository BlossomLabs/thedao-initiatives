import { assert, assertEquals } from "@std/assert";
import { createPublicClient } from "viem";
import { mainnet } from "viem/chains";
import { voteTransport } from "../services/vote-chain.ts";
import { readRoundOnChain } from "../services/vote-round-read.ts";

Deno.test("outbound: viem vote and round-read transports explicitly refuse redirects", async () => {
  const original = globalThis.fetch;
  const modes: RequestRedirect[] = [];
  globalThis.fetch = (async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    modes.push(init?.redirect ?? req.redirect);
    const body = JSON.parse(await req.text());
    const answer = (item: { id: number; method: string }) => ({
      jsonrpc: "2.0",
      id: item.id,
      ...(item.method === "eth_blockNumber"
        ? { result: "0x1" }
        : { error: { code: -32601, message: "fixture" } }),
    });
    return Response.json(Array.isArray(body) ? body.map(answer) : answer(body));
  }) as typeof fetch;
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: voteTransport("https://rpc.example.test"),
    });
    assertEquals(await client.getBlockNumber(), 1n);
    try {
      await readRoundOnChain(
        "0x1111111111111111111111111111111111111111",
        "https://rpc.example.test",
      );
    } catch { /* RPC fixture intentionally has no contract. */ }
    assert(modes.length >= 2);
    assert(modes.every((mode) => mode === "error"));
  } finally {
    globalThis.fetch = original;
  }
});
