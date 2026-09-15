import { assert, assertEquals, assertFalse } from "@std/assert";
import { ADMIN, harness, j, SAFE_ADDR } from "./app-helpers.ts";
import { transferLog } from "./helpers.ts";
import { loadConfig, TOKENS } from "../config.ts";
import { BALANCE_TTL_SECS, cronIntervalMinutes } from "../services/funding.ts";
import { syncSafe } from "../services/safe-api.ts";

const USDC = TOKENS.USDC[0];
const DONOR = "0x4444444444444444444444444444444444444444";
const TX = "0x" + "d1".repeat(32);
const safeKey = SAFE_ADDR.toLowerCase();

Deno.test("funding: raised comes from the Safe's balances, priced by the feeds, plus paid out", async () => {
  const h = await harness();
  const rfp = await h.db.rfps.insert({
    title: "Balance initiative",
    status: "approved",
    goalUsd: 3000,
    safeAddress: SAFE_ADDR,
  });
  h.script.tokenBalances["USDC:" + safeKey] = 2_500_000n; // 2.5 USDC
  h.script.ethBalances[safeKey] = 10n ** 18n; // 1 ETH at $2000
  await h.db.pledges.add(rfp.id, {
    company: "Acme",
    amountUsd: 500,
    url: "",
    note: "",
    logoCid: "",
    status: "pledged",
  });

  const page = await j(await h.req("/api/initiatives/" + rfp.slug)) as {
    summary: Record<string, number | boolean>;
    funded: boolean;
    pct: number;
    donations: unknown[];
  };
  assertEquals(page.summary, {
    pledged: 500,
    donated: 2002.5,
    total: 2502.5,
    live: true,
    ledger: 0,
    paidOut: 0,
  });
  assertEquals(page.donations.length, 0, "the ledger has no row yet, the number is live anyway");
  assertFalse(page.funded);

  // a milestone was paid: the balance dropped, the admin records the payout
  h.script.ethBalances[safeKey] = 0n;
  const admin = await h.mint(ADMIN, true);
  const r = await h.req(`/api/admin/initiatives/${rfp.id}`, {
    method: "PATCH",
    token: admin,
    json: { paidOutUsd: "2,000" },
  });
  assertEquals(r.status, 200);
  assertEquals(((await j(r)).initiative as { paidOutUsd: number }).paidOutUsd, 2000);
  h.clock.now += BALANCE_TTL_SECS + 1;
  const board = await j(await h.req("/api/board")) as {
    cards: {
      initiative: { slug: string };
      summary: { donated: number; total: number };
      funded: boolean;
    }[];
    totals: { raised: number };
  };
  const card = board.cards.find((c) => c.initiative.slug === rfp.slug)!;
  assertEquals(card.summary.donated, 2002.5);
  assertEquals(card.summary.total, 2502.5);
  assertEquals(board.totals.raised, 2502.5);
  // the goal is reached by the displayed total
  h.script.tokenBalances["USDC:" + safeKey] = 500_000_000n;
  h.clock.now += BALANCE_TTL_SECS + 1;
  assert(((await j(await h.req("/api/initiatives/" + rfp.slug))) as { funded: boolean }).funded);

  const bad = await h.req(`/api/admin/initiatives/${rfp.id}`, {
    method: "PATCH",
    token: admin,
    json: { paidOutUsd: "-5" },
  });
  assertEquals(bad.status, 400);
  h.close();
});

Deno.test("funding: one chain read per Safe per 15 s, stale cache on failure, ledger without a Safe", async () => {
  const h = await harness();
  const rfp = await h.db.rfps.insert({
    title: "Cached initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  h.script.tokenBalances["USDC:" + safeKey] = 1_000_000n;
  const reads = () => h.script.calls.filter((m) => m === "eth_getBalance").length;
  await h.req("/api/board");
  await h.req("/api/initiatives/" + rfp.slug);
  await h.req("/api/board");
  assertEquals(reads(), 1, "three page reads inside the TTL share one balance read");
  h.clock.now += BALANCE_TTL_SECS + 1;
  await h.req("/api/board");
  assertEquals(reads(), 2);

  // RPC outage: the last good number is kept rather than dropping to zero
  h.script.tokenBalances["USDC:" + safeKey] = 5_000_000n;
  h.script.brokenTokens.add("USDC");
  h.clock.now += BALANCE_TTL_SECS + 1;
  const stale = await j(await h.req("/api/initiatives/" + rfp.slug)) as {
    summary: { donated: number; live: boolean };
  };
  assertEquals(stale.summary.donated, 1);
  assert(stale.summary.live);
  h.script.brokenTokens.delete("USDC");

  // no Safe yet: the ledger total is all there is
  const bare = await h.db.rfps.insert({ title: "No Safe", status: "approved", goalUsd: 10 });
  const b = await j(await h.req("/api/initiatives/" + bare.slug)) as {
    summary: Record<string, unknown>;
  };
  assertEquals(b.summary, { pledged: 0, donated: 0, total: 0, live: false, ledger: 0, paidOut: 0 });
  h.close();
});

Deno.test("funding: the page says when the ledger was last checked and how often it runs", async () => {
  const h = await harness({
    fetch: (url) =>
      url.startsWith("https://api.safe.global/")
        ? Response.json({
          count: 1,
          next: null,
          results: [{
            type: "ERC20_TRANSFER",
            executionDate: "2026-09-01T00:00:00Z",
            blockNumber: 500,
            transactionHash: TX,
            to: SAFE_ADDR,
            from: DONOR,
            value: "1000000",
            tokenAddress: USDC,
            transferId: "e1",
            tokenInfo: { symbol: "USDC", decimals: 6 },
          }],
        })
        : new Response("", { status: 404 }),
  });
  const rfp = await h.db.rfps.insert({
    title: "Ledger status",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  type Page = {
    ledger: { checkedAt: number | null; ok: boolean; intervalMinutes: number | null };
    summary: { ledger: number };
  };
  const before = await j(await h.req("/api/initiatives/" + rfp.slug)) as Page;
  assertEquals(before.ledger, { checkedAt: null, ok: true, intervalMinutes: 10 });

  h.script.receipts[TX] = {
    status: "0x1",
    blockNumber: "0x1f4",
    logs: [transferLog(USDC, DONOR, SAFE_ADDR, 1_000_000n)],
  };
  await syncSafe(h.deps, rfp);
  const after = await j(await h.req("/api/initiatives/" + rfp.slug)) as Page;
  assertEquals(after.ledger, { checkedAt: h.clock.now, ok: true, intervalMinutes: 10 });
  assertEquals(after.summary.ledger, 1);

  // a Safe with no ledger status field for initiatives without a Safe
  const bare = await h.db.rfps.insert({ title: "No Safe", status: "approved", goalUsd: 10 });
  const b = await j(await h.req("/api/initiatives/" + bare.slug)) as { ledger: unknown };
  assertEquals(b.ledger, null);
  h.close();
});

Deno.test("funding: cron interval parsing", () => {
  assertEquals(cronIntervalMinutes("*/10 * * * *"), 10);
  assertEquals(cronIntervalMinutes("* * * * *"), 1);
  assertEquals(cronIntervalMinutes("0 * * * *"), 60);
  assertEquals(cronIntervalMinutes("0 */2 * * *"), 120);
  assertEquals(cronIntervalMinutes("5 4 * * *"), null);
  assertEquals(cronIntervalMinutes("*/10 * * * 1"), null);
});

Deno.test("config: ALCHEMY_API_KEY adds an Alchemy RPC ahead of the public endpoints, after RPC_URL", () => {
  const a = loadConfig({ ALCHEMY_API_KEY: "k1" });
  assertEquals(a.rpcEndpoints[0], "https://eth-mainnet.g.alchemy.com/v2/k1");
  const b = loadConfig({ ALCHEMY_API_KEY: "k1", RPC_URL: "https://rpc.example/x" });
  assertEquals(b.rpcEndpoints.slice(0, 2), [
    "https://rpc.example/x",
    "https://eth-mainnet.g.alchemy.com/v2/k1",
  ]);
});
