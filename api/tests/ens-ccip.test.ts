import { assertEquals, assertGreater } from "@std/assert";
import { encodeAbiParameters, encodeErrorResult, encodeFunctionData, parseAbi } from "viem";
import { createApp } from "../app.ts";
import { createEns, onchainEns } from "../services/ens.ts";
import { harness, PLAIN, testConnection } from "./app-helpers.ts";

const offchainAbi = parseAbi([
  "error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)",
]);
const batchAbi = parseAbi([
  "function query((address sender, string[] urls, bytes data)[] queries) view returns (bool[] failures, bytes[] responses)",
]);
const resolver = "0x1111111111111111111111111111111111111111" as const;

Deno.test("ENS: direct and nested CCIP gateways never become server HTTP requests", async (t) => {
  const originalFetch = globalThis.fetch;
  const gateways: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    gateways.push(String(input));
    return Promise.resolve(Response.json({ data: "0x1234" }));
  }) as typeof fetch;
  try {
    for (const nested of [false, true]) {
      for (
        const target of [
          "http://127.0.0.1:8888/internal/{data}",
          "http://[::1]/internal/{data}",
          "http://169.254.169.254/metadata",
          "https://attacker.example/gateway",
        ]
      ) {
        await t.step(`${nested ? "local batch" : "direct"}: ${target}`, async () => {
          const h = await harness();
          let calls = 0;
          const fallbackCalls: string[] = [];
          const rpcFetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const req = JSON.parse(
              input instanceof Request ? await input.text() : String(init?.body),
            );
            calls++;
            const query = { sender: resolver, urls: [target], data: "0x1234" as const };
            const data = encodeErrorResult({
              abi: offchainAbi,
              errorName: "OffchainLookup",
              args: [
                req.params[0].to,
                nested ? ["x-batch-gateway:true"] : [target],
                nested
                  ? encodeFunctionData({ abi: batchAbi, functionName: "query", args: [[query]] })
                  : "0x1234",
                "0x12345678",
                "0x",
              ],
            });
            return Response.json({
              jsonrpc: "2.0",
              id: req.id,
              error: { code: 3, message: "execution reverted", data },
            });
          }) as typeof fetch;
          try {
            const ens = onchainEns(["https://rpc.example.test"], rpcFetch);
            h.deps.ens = createEns(
              ((input: string | URL | Request) => {
                fallbackCalls.push(String(input));
                return Promise.resolve(Response.json({}));
              }) as typeof fetch,
              h.deps.now,
              { onchain: ens },
            );
            const res = await createApp(h.deps).request(
              `http://api.test/api/ens-name/${PLAIN}`,
              undefined,
              testConnection(),
            );
            assertEquals(res.status, 200);
            assertEquals(await res.json(), { name: null, avatar: null });
            await ens.address("attacker.eth").catch(() => null);
            await ens.avatar("attacker.eth").catch(() => null);
            assertGreater(calls, 2, "all three locked viem actions must reach the mock RPC");
            assertEquals(gateways, [], "not even a public CCIP gateway may be fetched");
            assertEquals(fallbackCalls, [`https://api.ensdata.net/${PLAIN}`]);
          } finally {
            h.close();
          }
        });
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("ENS: disabling CCIP still resolves an ordinary on-chain address", async () => {
  // Universal Resolver resolveWithGateways returns (bytes result, address resolver).
  const record = encodeAbiParameters([{ type: "address" }], [PLAIN]);
  const result = encodeAbiParameters([{ type: "bytes" }, { type: "address" }], [record, resolver]);
  const rpcFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(input instanceof Request ? await input.text() : String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: req.id, result });
  }) as typeof fetch;
  assertEquals(
    await onchainEns(["https://rpc.example.test"], rpcFetch).address("ordinary.eth"),
    PLAIN,
  );
});
