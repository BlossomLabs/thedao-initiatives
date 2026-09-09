import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { ADMIN, harness, j, SAFE_ADDR } from "./app-helpers.ts";
import { transferLog } from "./helpers.ts";
import { TOKENS } from "../config.ts";
import { syncAll, syncSafe } from "../services/safe-api.ts";

const USDC = TOKENS.USDC[0];
const DONOR = "0x4444444444444444444444444444444444444444";
const TX1 = "0x" + "a1".repeat(32);
const TX2 = "0x" + "a2".repeat(32);
const TX_ETH = "0x" + "a3".repeat(32);

const row = (o: Partial<Record<string, unknown>>) => ({
  type: "ERC20_TRANSFER",
  executionDate: "2026-09-01T00:00:00Z",
  blockNumber: 500,
  transactionHash: TX1,
  to: SAFE_ADDR,
  from: DONOR,
  value: "1000000",
  tokenAddress: USDC,
  transferId: "e" + Math.random(),
  tokenInfo: { symbol: "USDC", decimals: 6 },
  ...o,
});

Deno.test("safe sync: groups rows per tx, verifies over RPC, sends bearer, incremental stop, ETH fallback, 429", async () => {
  let pageBody: unknown[] = [];
  let status = 200;
  const h = await harness({
    env: { SAFE_API_KEY: "safe-key" },
    fetch: (url) => {
      if (!url.startsWith("https://api.safe.global/")) {
        return new Response("", { status: 404 });
      }
      if (status !== 200) {
        return new Response("{}", { status, headers: { "x-ratelimit-remaining": "0" } });
      }
      return Response.json({ count: pageBody.length, next: null, results: pageBody }, {
        headers: { "x-ratelimit-remaining": "4990" },
      });
    },
  });
  const rfp = await h.db.rfps.insert({
    title: "Synced initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  // TX1: two USDC rows in one tx (batched) + TX2: one ETH internal transfer the RPC path can't see
  pageBody = [
    row({
      transactionHash: TX_ETH,
      type: "ETHER_TRANSFER",
      tokenAddress: null,
      value: (10n ** 18n).toString(),
      blockNumber: 600,
    }),
    row({ transactionHash: TX1, value: "1000000" }),
    row({ transactionHash: TX1, value: "2000000" }),
    row({
      transactionHash: TX2,
      tokenAddress: "0x" + "99".repeat(20),
      tokenInfo: { symbol: "SCAM" },
    }), // not accepted
  ];
  h.script.receipts[TX1] = {
    status: "0x1",
    blockNumber: "0x1f4",
    logs: [
      transferLog(USDC, DONOR, SAFE_ADDR, 1_000_000n),
      transferLog(USDC, DONOR, SAFE_ADDR, 2_000_000n),
    ],
  };
  // ETH via a contract: tx.to is the contract, not the Safe
  h.script.receipts[TX_ETH] = { status: "0x1", blockNumber: "0x258", logs: [] };
  h.script.txs[TX_ETH] = { to: "0x" + "77".repeat(20), from: DONOR, value: "0x0" };

  const before = h.fetchLog.length;
  await h.req("/api/board");
  await h.req("/api/initiatives/" + rfp.slug);
  assertEquals(h.fetchLog.length, before, "page reads must never call the Safe API");

  const state = await syncSafe(h.deps, rfp);
  assert(state.ok, state.error);
  const safeCalls = h.fetchLog.filter((f) =>
    f.url.startsWith("https://api.safe.global/")
  );
  assertEquals(safeCalls.length, 1);
  assertEquals(
    new Headers(safeCalls[0].init?.headers).get("authorization"),
    "Bearer safe-key",
  );
  assertStringIncludes(
    safeCalls[0].url,
    `/safes/${SAFE_ADDR}/incoming-transfers/?limit=20`,
  );
  const d1 = (await h.db.donations.get(rfp.id, TX1))!;
  assertEquals(d1.status, "confirmed");
  assertEquals(d1.amountUsd, 3); // both rows summed via the RPC verification
  assertEquals(d1.source, "tx");
  const de = (await h.db.donations.get(rfp.id, TX_ETH))!;
  assertEquals(de.status, "confirmed");
  assertEquals(de.source, "safe-api");
  assertEquals(de.amountUsd, 2000);
  assertEquals(await h.db.donations.get(rfp.id, TX2), null);
  assertEquals(
    (await h.db.meta.get("safe_api_quota") as { remaining: number }).remaining,
    4990,
  );

  // second sync: nothing new -> exactly one request, stops on the known hash
  await syncSafe(h.deps, rfp);
  assertEquals(
    h.fetchLog.filter((f) => f.url.startsWith("https://api.safe.global/")).length,
    2,
  );
  assertEquals((await h.db.donations.list(rfp.id)).length, 2);

  // quota exhausted: cycle aborts, state records the error, nothing written
  status = 429;
  const n = await syncAll(h.deps);
  assertEquals(n, 0);
  const st = (await h.db.meta.safeSync(rfp.id))!;
  assertFalse(st.ok);
  assertStringIncludes(st.error, "429");

  // admin button is rate limited to one per minute per Safe and reports state
  status = 200;
  const admin = await h.mint(ADMIN, true);
  const r1 = await h.req(`/api/admin/initiatives/${rfp.id}/sync-donations`, {
    method: "POST",
    token: admin,
  });
  assertEquals(r1.status, 200);
  assert(((await j(r1)).safeSync as { ok: boolean }).ok);
  assertEquals(
    (await h.req(`/api/admin/initiatives/${rfp.id}/sync-donations`, {
      method: "POST",
      token: admin,
    })).status,
    429,
  );
  const dash = await j(await h.req("/api/admin/dashboard", { token: admin })) as {
    safeApi: { configured: boolean; quota: { remaining: number } };
  };
  assert(dash.safeApi.configured);
  assertEquals(dash.safeApi.quota.remaining, 4990);
  h.close();
});

Deno.test("safe sync: shallow transfers wait for confirmations, pending rows get re-verified", async () => {
  let pageBody: unknown[] = [];
  const h = await harness({
    fetch: (url) =>
      url.startsWith("https://api.safe.global/")
        ? Response.json({ count: 1, next: null, results: pageBody })
        : new Response("", { status: 404 }),
  });
  const rfp = await h.db.rfps.insert({
    title: "Shallow initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  h.script.head = 1000;
  pageBody = [row({ transactionHash: TX1, blockNumber: 999 })]; // only 2 deep
  h.script.receipts[TX1] = {
    status: "0x1",
    blockNumber: "0x3e7",
    logs: [transferLog(USDC, DONOR, SAFE_ADDR, 1_000_000n)],
  };
  await syncSafe(h.deps, rfp);
  assertEquals(await h.db.donations.get(rfp.id, TX1), null);
  h.script.head = 1002;
  await syncAll(h.deps);
  assertEquals((await h.db.donations.get(rfp.id, TX1))!.status, "confirmed");
  // price feed outage -> pending, then the cron's reverify confirms it
  pageBody = [
    row({
      transactionHash: TX2,
      blockNumber: 999,
      tokenAddress: TOKENS.EURC[0],
      tokenInfo: { symbol: "EURC" },
    }),
    row({ transactionHash: TX1, blockNumber: 999 }),
  ];
  h.script.receipts[TX2] = {
    status: "0x1",
    blockNumber: "0x3e7",
    logs: [transferLog(TOKENS.EURC[0], DONOR, SAFE_ADDR, 5_000_000n)],
  };
  h.script.brokenFeeds.add("EURC");
  await syncSafe(h.deps, rfp);
  assertEquals((await h.db.donations.get(rfp.id, TX2))!.status, "pending");
  assertEquals((await h.db.fundingSummary(rfp.id)).donated, 1);
  h.script.brokenFeeds.delete("EURC");
  await syncAll(h.deps);
  const d2 = (await h.db.donations.get(rfp.id, TX2))!;
  assertEquals(d2.status, "confirmed");
  assertEquals(d2.amountUsd, 5.72); // 5 EURC * 1.143
  assertEquals((await h.db.fundingSummary(rfp.id)).donated, 6.72);
  h.close();
});

Deno.test("safe sync: a time budget cuts a backfill short, progress persists, the next run completes", async () => {
  const pages: Record<string, unknown[]> = {};
  let requests = 0;
  const h = await harness({
    fetch: (url) => {
      if (!url.startsWith("https://api.safe.global/")) {
        return new Response("", { status: 404 });
      }
      requests++;
      const key = url.includes("offset=20") ? "p2" : "p1";
      return Response.json({
        count: 40,
        next: key === "p1" ? url + "&offset=20" : null,
        results: pages[key],
      });
    },
  });
  const rfp = await h.db.rfps.insert({
    title: "Big initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  const txs = Array.from(
    { length: 40 },
    (_, i) => "0x" + i.toString(16).padStart(2, "0").repeat(32),
  );
  pages.p1 = txs.slice(0, 20).map((t) => row({ transactionHash: t, blockNumber: 500 }));
  pages.p2 = txs.slice(20).map((t) => row({ transactionHash: t, blockNumber: 400 }));
  for (const t of txs) {
    h.script.receipts[t] = {
      status: "0x1",
      blockNumber: "0x1f4",
      logs: [transferLog(USDC, DONOR, SAFE_ADDR, 1_000_000n)],
    };
  }
  // budget 0 ms: the first page is fetched, then the very first credit trips the budget
  const s1 = await syncSafe(h.deps, rfp, 0);
  assert(s1.ok);
  assertFalse(s1.backfilled);
  assertEquals(s1.lastTxHash, "");
  assertStringIncludes(s1.resumeUrl, "incoming-transfers");
  assertEquals(requests, 1);
  // resumes on the unfinished page, walks to the end of history
  const s2 = await syncSafe(h.deps, rfp);
  assert(s2.backfilled);
  assertEquals(s2.resumeUrl, "");
  assertEquals(s2.lastTxHash, ""); // a resumed walk never sets the cursor
  assertEquals(requests, 3);
  assertEquals((await h.db.donations.list(rfp.id)).length, 40);
  // next run starts at the top: page of known hashes -> done, cursor set
  const s3 = await syncSafe(h.deps, rfp);
  assertEquals(requests, 4);
  assertEquals(s3.lastTxHash, txs[0]);
  await syncSafe(h.deps, rfp);
  assertEquals(requests, 5); // incremental: one request, stops on the cursor
  h.close();
});
