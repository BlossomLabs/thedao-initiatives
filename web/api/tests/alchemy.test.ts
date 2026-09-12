import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ADMIN, harness, j, SAFE_ADDR } from "./app-helpers.ts";
import { transferLog } from "./helpers.ts";
import { loadConfig, TOKENS } from "../config.ts";
import { recipientsOf, signBody } from "../services/alchemy.ts";

const USDC = TOKENS.USDC[0];
const DONOR = "0x4444444444444444444444444444444444444444";
const TX1 = "0x" + "b1".repeat(32);
const TX2 = "0x" + "b2".repeat(32);
const SIGNING_KEY = "whsec_test";
const OTHER_SAFE = "0x" + "55".repeat(20);

const safeRow = (tx: string, o: Partial<Record<string, unknown>> = {}) => ({
  type: "ERC20_TRANSFER",
  executionDate: "2026-09-01T00:00:00Z",
  blockNumber: 500,
  transactionHash: tx,
  to: SAFE_ADDR,
  from: DONOR,
  value: "1000000",
  tokenAddress: USDC,
  transferId: "e" + Math.random(),
  tokenInfo: { symbol: "USDC", decimals: 6 },
  ...o,
});

const activity = (o: Partial<Record<string, unknown>> = {}) => ({
  blockNum: "0x1f4",
  hash: TX1,
  fromAddress: DONOR.toLowerCase(),
  toAddress: SAFE_ADDR.toLowerCase(),
  value: 1,
  asset: "USDC",
  category: "erc20",
  rawContract: { rawValue: "0xf4240", address: USDC.toLowerCase(), decimals: 6 },
  ...o,
});

const payload = (acts: unknown[], network = "ETH_MAINNET") => ({
  webhookId: "wh_test",
  id: "whevt_" + Math.random(),
  createdAt: "2026-09-12T00:00:00Z",
  type: "ADDRESS_ACTIVITY",
  event: { network, activity: acts },
});

/** Poll until `cond` holds or ~2s pass (the queue delivers asynchronously). */
async function until(cond: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

Deno.test("alchemy: recipientsOf groups tx hashes per recipient, mainnet only, transfer categories only", () => {
  const p = payload([
    activity(),
    activity({ hash: TX2, category: "internal", asset: "ETH", rawContract: {} }),
    activity({ hash: TX2, category: "erc721", toAddress: OTHER_SAFE }),
    activity({ hash: TX1, toAddress: OTHER_SAFE, category: "external" }),
  ]);
  const m = recipientsOf(p);
  assertEquals([...m.keys()].sort(), [OTHER_SAFE, SAFE_ADDR.toLowerCase()].sort());
  assertEquals([...m.get(SAFE_ADDR.toLowerCase())!].sort(), [TX1, TX2]);
  assertEquals([...m.get(OTHER_SAFE)!], [TX1]);
  assertEquals(recipientsOf(payload([activity()], "MATIC_MAINNET")).size, 0);
  assertEquals(recipientsOf({ type: "MINED_TRANSACTION" }).size, 0);
  assertEquals(recipientsOf(null).size, 0);
});

Deno.test("alchemy hook: 404 without a signing key, 401 on a bad signature", async () => {
  const off = await harness();
  const r0 = await off.req("/api/hooks/alchemy", { method: "POST", json: payload([activity()]) });
  assertEquals(r0.status, 404);
  off.close();

  const h = await harness({ env: { ALCHEMY_WEBHOOK_SIGNING_KEY: SIGNING_KEY } });
  const body = JSON.stringify(payload([activity()]));
  const r1 = await h.req("/api/hooks/alchemy", { method: "POST", body });
  assertEquals(r1.status, 401);
  const r2 = await h.req("/api/hooks/alchemy", {
    method: "POST",
    body,
    headers: { "x-alchemy-signature": await signBody("wrong-key", body) },
  });
  assertEquals(r2.status, 401);
  const r3 = await h.req("/api/hooks/alchemy", {
    method: "POST",
    body: "not json",
    headers: { "x-alchemy-signature": await signBody(SIGNING_KEY, "not json") },
  });
  assertEquals(r3.status, 400);
  h.close();
});

Deno.test("alchemy hook: passes the site lock, queues a sync for the matching Safe, credits the donation", async () => {
  let pageBody: unknown[] = [];
  const h = await harness({
    env: {
      ALCHEMY_WEBHOOK_SIGNING_KEY: SIGNING_KEY,
      SITE_USERNAME: "preview",
      SITE_PASSWORD: "secret",
    },
    fetch: (url) =>
      url.startsWith("https://api.safe.global/")
        ? Response.json({ count: pageBody.length, next: null, results: pageBody })
        : new Response("", { status: 404 }),
  });
  h.deps.syncQueue!.listen();
  const rfp = await h.db.rfps.insert({
    title: "Hooked initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  pageBody = [safeRow(TX1)];
  h.script.receipts[TX1] = {
    status: "0x1",
    blockNumber: "0x1f4",
    logs: [transferLog(USDC, DONOR, SAFE_ADDR, 1_000_000n)],
  };

  // An address we do not know: accepted, nothing queued, no Safe API call.
  const stray = JSON.stringify(payload([activity({ toAddress: OTHER_SAFE })]));
  const r0 = await h.req("/api/hooks/alchemy", {
    method: "POST",
    body: stray,
    headers: { "x-alchemy-signature": await signBody(SIGNING_KEY, stray) },
  });
  assertEquals(r0.status, 200);
  assertEquals((await j(r0)).queued, 0);

  const body = JSON.stringify(payload([activity()]));
  const r1 = await h.req("/api/hooks/alchemy", {
    method: "POST",
    body,
    headers: { "x-alchemy-signature": await signBody(SIGNING_KEY, body) },
  });
  assertEquals(r1.status, 200);
  assertEquals((await j(r1)).queued, 1);

  assert(
    await until(async () => (await h.db.donations.get(rfp.id, TX1))?.status === "confirmed"),
    "the queued sync should credit the donation",
  );
  const d = (await h.db.donations.get(rfp.id, TX1))!;
  assertEquals(d.amountUsd, 1);
  assertEquals(
    h.fetchLog.filter((f) => f.url.startsWith("https://api.safe.global/")).length,
    1,
  );
  h.close();
});

Deno.test("alchemy hook: retries once when the indexer has not caught up yet", async () => {
  let pageBody: unknown[] = [];
  const h = await harness({
    env: { ALCHEMY_WEBHOOK_SIGNING_KEY: SIGNING_KEY },
    fetch: (url) => {
      if (!url.startsWith("https://api.safe.global/")) return new Response("", { status: 404 });
      const res = Response.json({ count: pageBody.length, next: null, results: pageBody });
      pageBody = [safeRow(TX1)]; // the indexer catches up after the first request
      return res;
    },
  });
  h.deps.syncQueue!.listen();
  const rfp = await h.db.rfps.insert({
    title: "Lagging initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  h.script.receipts[TX1] = {
    status: "0x1",
    blockNumber: "0x1f4",
    logs: [transferLog(USDC, DONOR, SAFE_ADDR, 1_000_000n)],
  };
  const body = JSON.stringify(payload([activity()]));
  const r = await h.req("/api/hooks/alchemy", {
    method: "POST",
    body,
    headers: { "x-alchemy-signature": await signBody(SIGNING_KEY, body) },
  });
  assertEquals(r.status, 200);
  assert(
    await until(async () => (await h.db.donations.get(rfp.id, TX1))?.status === "confirmed"),
    "the retry should credit the donation",
  );
  assertEquals(
    h.fetchLog.filter((f) => f.url.startsWith("https://api.safe.global/")).length,
    2,
  );
  h.close();
});

Deno.test("safe-confirm registers the Safe with the Alchemy webhook when configured", async () => {
  const patches: Record<string, unknown>[] = [];
  const h = await harness({
    env: { ALCHEMY_AUTH_TOKEN: "auth-tok", ALCHEMY_WEBHOOK_ID: "wh_123" },
    fetch: (url, init) => {
      if (url === "https://dashboard.alchemy.com/api/update-webhook-addresses") {
        patches.push(JSON.parse(String(init?.body)));
        return Response.json({});
      }
      return new Response("", { status: 404 });
    },
  });
  const rfp = await h.db.rfps.insert({ title: "Fresh Safe", status: "approved", goalUsd: 1000 });
  const admin = await h.mint(ADMIN, true);
  const r = await h.req(`/api/admin/initiatives/${rfp.id}/safe-confirm`, {
    method: "POST",
    token: admin,
    json: { address: SAFE_ADDR },
  });
  assertEquals(r.status, 200);
  const out = await j(r);
  assertEquals(out.alchemy, "registered");
  assertEquals(patches.length, 1, "the Notify API should have been called once");
  const call = h.fetchLog.find((f) => f.url.includes("update-webhook-addresses"))!;
  assertEquals(call.init?.method, "PATCH");
  assertEquals(new Headers(call.init?.headers).get("x-alchemy-token"), "auth-tok");
  assertEquals(patches[0].webhook_id, "wh_123");
  assertEquals(patches[0].addresses_to_add, [SAFE_ADDR]);
  assertEquals(patches[0].addresses_to_remove, []);
  h.close();

  // Not configured: the confirm still succeeds and says so.
  const plain = await harness();
  const rfp2 = await plain.db.rfps.insert({ title: "No hook", status: "approved", goalUsd: 1 });
  const tok = await plain.mint(ADMIN, true);
  const r2 = await plain.req(`/api/admin/initiatives/${rfp2.id}/safe-confirm`, {
    method: "POST",
    token: tok,
    json: { address: SAFE_ADDR },
  });
  assertEquals(r2.status, 200);
  assertEquals((await j(r2)).alchemy, "skipped");
  assertEquals(plain.fetchLog.length, 0);
  plain.close();
});

Deno.test("config: ALCHEMY_API_KEY adds an Alchemy RPC ahead of the public endpoints, after RPC_URL", () => {
  const a = loadConfig({ ALCHEMY_API_KEY: "k1" });
  assertEquals(a.rpcEndpoints[0], "https://eth-mainnet.g.alchemy.com/v2/k1");
  assertStringIncludes(a.rpcEndpoints[1], "https://");
  const b = loadConfig({ ALCHEMY_API_KEY: "k1", RPC_URL: "https://rpc.example/x" });
  assertEquals(b.rpcEndpoints.slice(0, 2), [
    "https://rpc.example/x",
    "https://eth-mainnet.g.alchemy.com/v2/k1",
  ]);
  assertEquals(loadConfig({}).alchemyWebhookSigningKey, "");
});
