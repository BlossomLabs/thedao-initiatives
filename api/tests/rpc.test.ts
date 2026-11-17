import { assertEquals, assertRejects } from "@std/assert";
import { createRpc, RpcError } from "../chain/rpc.ts";

Deno.test("RPC failures omit endpoint credentials, provider payloads and fetch exceptions", async () => {
  const secret = "SENTINEL_RPC_SECRET";
  const endpoint = `https://user:${secret}@rpc.invalid/v2/${secret}?key=${secret}`;
  for (
    const [respond, expected] of [
      [() => new Response(secret, { status: 503 }), "HTTP 503"],
      [
        () => Response.json({ error: { code: -32000, message: secret, data: endpoint } }),
        "JSON-RPC error -32000",
      ],
      [() => Response.json({ error: { code: secret, message: secret } }), "JSON-RPC error"],
      [() => {
        throw new Error(endpoint);
      }, "request failed"],
      [() => new Response(secret), "request failed"],
    ] as const
  ) {
    const rpc = createRpc({
      endpoints: [endpoint],
      fetch: (() => Promise.resolve(respond())) as typeof fetch,
    });
    const error = await assertRejects(() => rpc("eth_call", []), RpcError);
    assertEquals(error.message, `all RPC endpoints failed: endpoint 1: ${expected}`);
  }
});

Deno.test("RPC failover still reuses the last successful endpoint", async () => {
  const calls: string[] = [];
  const rpc = createRpc({
    endpoints: ["https://first.invalid", "https://second.invalid"],
    fetch: ((input, init) => {
      assertEquals(init?.redirect, "error");
      calls.push(String(input));
      return Promise.resolve(
        String(input).includes("first")
          ? new Response("", { status: 503 })
          : Response.json({ result: "0x123" }),
      );
    }) as typeof fetch,
  });
  assertEquals(await rpc("eth_blockNumber", []), "0x123");
  assertEquals(await rpc("eth_blockNumber", []), "0x123");
  assertEquals(calls, [
    "https://first.invalid",
    "https://second.invalid",
    "https://second.invalid",
  ]);
});
