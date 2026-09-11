import { assertEquals } from "@std/assert";
import { createEns, type EnsResolver } from "../services/ens.ts";

const ADDR = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";
const OTHER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

function resolver(over: Partial<EnsResolver>): EnsResolver {
  return {
    name: () => Promise.resolve(null),
    address: () => Promise.resolve(null),
    avatar: () => Promise.resolve(null),
    ...over,
  };
}

function ensdataFetch(calls: string[], data: Record<string, unknown> = {}) {
  return ((input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return Promise.resolve(Response.json(data));
  }) as typeof fetch;
}

Deno.test("ens: on-chain name + avatar, forward-verified, ensdata never asked", async () => {
  const calls: string[] = [];
  const ens = createEns(ensdataFetch(calls), () => 1000, {
    onchain: resolver({
      name: () => Promise.resolve("griff.eth"),
      address: () => Promise.resolve(ADDR.toLowerCase()),
      avatar: () => Promise.resolve("https://euc.li/griff.eth"),
    }),
  });
  assertEquals(await ens.reverse(ADDR), { name: "griff.eth", avatar: "https://euc.li/griff.eth" });
  assertEquals(await ens.forward("griff.eth"), ADDR);
  assertEquals(calls, []);
});

Deno.test("ens: a name whose forward record points elsewhere is not shown", async () => {
  const ens = createEns(ensdataFetch([]), () => 1000, {
    onchain: resolver({
      name: () => Promise.resolve("griff.eth"),
      address: () => Promise.resolve(OTHER),
    }),
  });
  assertEquals(await ens.reverse(ADDR), { name: "", avatar: "" });
});

Deno.test("ens: non-https avatars are dropped and a broken avatar record keeps the name", async () => {
  const ens = createEns(ensdataFetch([]), () => 1000, {
    onchain: resolver({
      name: () => Promise.resolve("griff.eth"),
      address: () => Promise.resolve(ADDR),
      avatar: () => Promise.resolve("ipfs://bafy-raw"),
    }),
  });
  assertEquals(await ens.reverse(ADDR), { name: "griff.eth", avatar: "" });
  const logs: string[] = [];
  const broken = createEns(ensdataFetch([]), () => 1000, {
    log: (m) => logs.push(m),
    onchain: resolver({
      name: () => Promise.resolve("griff.eth"),
      address: () => Promise.resolve(ADDR),
      avatar: () => Promise.reject(new Error("metadata 500")),
    }),
  });
  assertEquals(await broken.reverse(ADDR), { name: "griff.eth", avatar: "" });
  assertEquals(logs.length, 1);
});

Deno.test("ens: an authoritative on-chain 'no name' does not fall back to ensdata", async () => {
  const calls: string[] = [];
  const ens = createEns(ensdataFetch(calls, { ens: "stale.eth", address: ADDR }), () => 1000, {
    onchain: resolver({}),
  });
  assertEquals(await ens.reverse(ADDR), { name: "", avatar: "" });
  assertEquals(await ens.forward("stale.eth"), "");
  assertEquals(calls, []);
});

Deno.test("ens: when the chain cannot be asked, ensdata answers and the failure is logged", async () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const failing = resolver({
    name: () => Promise.reject(new Error("all RPC endpoints failed")),
    address: () => Promise.reject(new Error("all RPC endpoints failed")),
  });
  const ens = createEns(
    ensdataFetch(calls, {
      ens: "griff.eth",
      address: ADDR,
      avatar_url: "https://euc.li/griff.eth",
    }),
    () => 1000,
    { onchain: failing, log: (m) => logs.push(m) },
  );
  assertEquals(await ens.reverse(ADDR), { name: "griff.eth", avatar: "https://euc.li/griff.eth" });
  assertEquals(await ens.forward("griff.eth"), ADDR);
  assertEquals(calls, ["https://api.ensdata.net/" + ADDR, "https://api.ensdata.net/griff.eth"]);
  assertEquals(logs.length, 2);
});

Deno.test("ens: both sources down fails closed and is cached", async () => {
  const calls: string[] = [];
  const f = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(new Response("", { status: 503 }));
  }) as typeof fetch;
  const ens = createEns(f, () => 1000, {
    onchain: resolver({ address: () => Promise.reject(new Error("rpc down")) }),
  });
  assertEquals(await ens.forward("griff.eth"), "");
  assertEquals(await ens.forward("griff.eth"), "");
  assertEquals(calls.length, 1);
});
