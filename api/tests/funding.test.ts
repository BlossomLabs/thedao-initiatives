import { assert, assertEquals, assertFalse } from "@std/assert";
import { ADMIN, harness, j, SAFE_ADDR } from "./app-helpers.ts";
import { transferLog } from "./helpers.ts";
import { loadConfig, TOKENS } from "../config.ts";
import {
  BALANCE_LEASE_SECS,
  BALANCE_RETRY_SECS,
  BALANCE_TTL_SECS,
  createFunding,
} from "../services/funding.ts";
import { syncSafe } from "../services/safe-api.ts";

const USDC = TOKENS.USDC[0];
const DONOR = "0x4444444444444444444444444444444444444444";
const TX = "0x" + "d1".repeat(32);
const safeKey = SAFE_ADDR.toLowerCase();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => resolve = r);
  return { promise, resolve };
}

Deno.test("funding: settings and cold snapshots do not read balances; the ledger is the first fallback", async () => {
  const h = await harness();
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Cold cache",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    await h.req("/api/board/settings");
    assertEquals(h.script.calls.length, 0, "global UI settings never touch RPC");
    const first = await h.deps.funding.summary(initiative);
    assertEquals(first.donated, 0);
    assertFalse(first.live);
    assert(first.refreshDue);
    assertEquals(h.script.calls.length, 0);
    const board = await j(await h.req("/api/board"));
    const page = await j(await h.req("/api/initiatives/" + initiative.slug));
    assertEquals(board.refreshDue, true);
    assertEquals(page.refreshDue, true);
    assertEquals(
      h.script.calls.length,
      0,
      "even cold page reads defer token verification to the follow-up",
    );
  } finally {
    h.close();
  }
});

Deno.test("funding: old values return during a slow refresh, with one lease across instances", async () => {
  const h = await harness();
  const gate = deferred<void>();
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Shared cache",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.tokenBalances["USDC:" + safeKey] = 1_000_000n;
    await h.deps.funding.balances(SAFE_ADDR, true);
    const second = createFunding({ db: h.db, chain: h.deps.chain, now: () => h.clock.now });
    const warmCalls = h.script.calls.length;
    assertEquals((await second.balances(SAFE_ADDR, true))?.usd, 1);
    assertEquals(h.script.calls.length, warmCalls, "a new instance reuses KV");

    h.clock.now += BALANCE_TTL_SECS + 1;
    h.script.tokenBalances["USDC:" + safeKey] = 2_000_000n;
    const rpc = h.deps.chain.rpc;
    const started = deferred<void>();
    h.deps.chain.rpc = async (method, params) => {
      started.resolve();
      await gate.promise;
      return rpc(method, params);
    };
    const refreshing = h.deps.funding.balances(SAFE_ADDR, true);
    await started.promise;
    const stale = await second.summary(initiative);
    assertEquals(stale.donated, 1, "snapshot is available while RPC is blocked");
    assertFalse(stale.refreshDue, "another instance holds the refresh lease");
    assertEquals((await second.balances(SAFE_ADDR, true))?.usd, 1);
    assertEquals(h.script.calls.length, warmCalls, "the other instance must not start RPC");
    gate.resolve();
    assertEquals((await refreshing)?.usd, 2);
    assertEquals((await second.summary(initiative)).donated, 2);
    assertEquals(h.script.calls.length - warmCalls, 10);
  } finally {
    gate.resolve();
    h.close();
  }
});

Deno.test("funding: expired lease recovers and its late worker cannot overwrite the new snapshot", async () => {
  const h = await harness();
  const gate = deferred<void>();
  try {
    await h.deps.chain.state();
    const started = deferred<void>();
    const rpc = h.deps.chain.rpc;
    // Separate chain object simulates a worker frozen after reading the old balance.
    const frozenChain = {
      ...h.deps.chain,
      rpc: async (method: string, params: unknown[]) => {
        const result = await rpc(method, params);
        started.resolve();
        await gate.promise;
        return result;
      },
    };
    const frozen = createFunding({ db: h.db, chain: frozenChain, now: () => h.clock.now });
    h.script.tokenBalances["USDC:" + safeKey] = 1_000_000n;
    const oldWorker = frozen.balances(SAFE_ADDR, true);
    await started.promise;
    h.clock.now += BALANCE_LEASE_SECS + 1;
    h.script.tokenBalances["USDC:" + safeKey] = 2_000_000n;
    assertEquals((await h.deps.funding.balances(SAFE_ADDR, true))?.usd, 2);
    gate.resolve();
    await oldWorker;
    assertEquals((await h.deps.funding.balances(SAFE_ADDR))?.usd, 2);
  } finally {
    gate.resolve();
    h.close();
  }
});

Deno.test("funding: 30-second board polls share one two-minute refresh across 19 Safes", async () => {
  const h = await harness();
  try {
    for (let i = 1; i <= 19; i++) {
      await h.db.initiatives.insert({
        title: `Safe ${i}`,
        status: "approved",
        safeAddress: "0x" + i.toString(16).padStart(40, "0"),
      });
    }
    await h.deps.chain.state();
    h.script.calls.length = 0;
    await h.req("/api/board?refresh=1");
    assertEquals(h.script.calls.length, 190);
    for (let i = 0; i < 3; i++) {
      h.clock.now += 30;
      await h.req("/api/board");
      await h.req("/api/board?refresh=1");
    }
    assertEquals(h.script.calls.length, 190, "even redundant refresh requests reuse the snapshot");
    h.clock.now += 30;
    await h.req("/api/board?refresh=1");
    assertEquals(h.script.calls.length, 380);
  } finally {
    h.close();
  }
});

Deno.test("funding: a newly confirmed donation invalidates only its Safe, repeated confirms do not", async () => {
  const h = await harness();
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Donation refresh",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    await h.deps.funding.balances(SAFE_ADDR, true);
    h.script.receipts[TX] = {
      status: "0x1",
      blockNumber: "0x1f4",
      logs: [transferLog(USDC, DONOR, SAFE_ADDR, 1_000_000n)],
    };
    h.script.tokenBalances["USDC:" + safeKey] = 1_000_000n;
    const confirm = () =>
      h.req("/api/donate/confirm", {
        method: "POST",
        json: { initiativeId: initiative.id, slug: initiative.slug, txHash: TX },
      });
    assertEquals((await confirm()).status, 200);
    assert((await h.deps.funding.summary(initiative)).refreshDue);
    assertEquals((await h.deps.funding.balances(SAFE_ADDR, true))?.usd, 1);
    assertEquals((await confirm()).status, 200);
    assertFalse((await h.deps.funding.summary(initiative)).refreshDue);
  } finally {
    h.close();
  }
});

Deno.test("funding: raised comes from the Safe's balances, priced by the feeds, plus paid out", async () => {
  const h = await harness();
  const initiative = await h.db.initiatives.insert({
    title: "Balance initiative",
    status: "approved",
    goalUsd: 3000,
    safeAddress: SAFE_ADDR,
  });
  h.script.tokenBalances["USDC:" + safeKey] = 2_500_000n; // 2.5 USDC
  h.script.ethBalances[safeKey] = 10n ** 18n; // 1 ETH at $2000
  await h.db.pledges.add(initiative.id, {
    company: "Acme",
    amountUsd: 500,
    url: "",
    note: "",
    logoCid: "",
    status: "pledged",
  });

  const page = await j(await h.req("/api/initiatives/" + initiative.slug + "?refresh=1")) as {
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
    refreshDue: false,
    ledger: 0,
    paidOut: 0,
  });
  assertEquals(page.donations.length, 0, "the ledger has no row yet, the number is live anyway");
  assertFalse(page.funded);

  // a milestone was paid: the balance dropped, the admin records the payout
  h.script.ethBalances[safeKey] = 0n;
  const admin = await h.mint(ADMIN, true);
  const r = await h.req(`/api/admin/initiatives/${initiative.id}`, {
    method: "PATCH",
    token: admin,
    json: { paidOutUsd: "2,000" },
  });
  assertEquals(r.status, 200);
  assertEquals(((await j(r)).initiative as { paidOutUsd: number }).paidOutUsd, 2000);
  h.clock.now += BALANCE_TTL_SECS + 1;
  const board = await j(await h.req("/api/board?refresh=1")) as {
    cards: {
      initiative: { slug: string };
      summary: { donated: number; total: number };
      funded: boolean;
    }[];
    totals: { raised: number };
  };
  const card = board.cards.find((c) => c.initiative.slug === initiative.slug)!;
  assertEquals(card.summary.donated, 2002.5);
  assertEquals(card.summary.total, 2502.5);
  assertEquals(board.totals.raised, 2502.5);
  // the goal is reached by the displayed total
  h.script.tokenBalances["USDC:" + safeKey] = 500_000_000n;
  h.clock.now += BALANCE_TTL_SECS + 1;
  assert(
    ((await j(await h.req("/api/initiatives/" + initiative.slug + "?refresh=1"))) as {
      funded: boolean;
    })
      .funded,
  );

  const bad = await h.req(`/api/admin/initiatives/${initiative.id}`, {
    method: "PATCH",
    token: admin,
    json: { paidOutUsd: "-5" },
  });
  assertEquals(bad.status, 400);
  h.close();
});

Deno.test("funding: shared snapshot, explicit refresh, failure cooldown, ledger without a Safe", async () => {
  const h = await harness();
  const initiative = await h.db.initiatives.insert({
    title: "Cached initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  h.script.tokenBalances["USDC:" + safeKey] = 1_000_000n;
  const reads = () => h.script.calls.filter((m) => m === "eth_getBalance").length;
  await h.req("/api/board");
  assertEquals(reads(), 0, "the initial page does not wait on balance RPC");
  await h.req("/api/board?refresh=1");
  await h.req("/api/initiatives/" + initiative.slug);
  await h.req("/api/board");
  assertEquals(reads(), 1, "page reads share the saved balance");
  h.clock.now += BALANCE_TTL_SECS + 1;
  await h.req("/api/board");
  assertEquals(reads(), 1, "a stale page still returns the saved balance without RPC");
  await h.req("/api/board?refresh=1");
  assertEquals(reads(), 2);

  // RPC outage: the last good number is kept rather than dropping to zero
  h.script.tokenBalances["USDC:" + safeKey] = 5_000_000n;
  h.script.brokenTokens.add("USDC");
  h.clock.now += BALANCE_TTL_SECS + 1;
  const stale = await j(await h.req("/api/initiatives/" + initiative.slug + "?refresh=1")) as {
    summary: { donated: number; live: boolean };
  };
  assertEquals(stale.summary.donated, 1);
  assert(stale.summary.live);
  const failedCalls = h.script.calls.length;
  await h.req("/api/board?refresh=1");
  await h.req("/api/board?refresh=1");
  assertEquals(
    h.script.calls.length,
    failedCalls,
    "failure cooldown is enforced even on explicit refresh",
  );
  h.script.brokenTokens.delete("USDC");
  h.clock.now += BALANCE_RETRY_SECS + 1;
  await h.req("/api/board?refresh=1");
  assertEquals((await h.deps.funding.balances(SAFE_ADDR))?.usd, 5);

  // no Safe yet: the ledger total is all there is
  const bare = await h.db.initiatives.insert({ title: "No Safe", status: "approved", goalUsd: 10 });
  const b = await j(await h.req("/api/initiatives/" + bare.slug)) as {
    summary: Record<string, unknown>;
  };
  assertEquals(b.summary, {
    pledged: 0,
    donated: 0,
    total: 0,
    live: false,
    refreshDue: false,
    ledger: 0,
    paidOut: 0,
  });
  h.close();
});

Deno.test("funding: the page says when the ledger was last checked and whether it needs refreshing", async () => {
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
  const initiative = await h.db.initiatives.insert({
    title: "Ledger status",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  type Page = {
    ledger: {
      checkedAt: number | null;
      ok: boolean;
      intervalMinutes: number | null;
      refreshDue: boolean;
      updating: boolean;
    };
    summary: { ledger: number };
  };
  const before = await j(await h.req("/api/initiatives/" + initiative.slug)) as Page;
  assertEquals(before.ledger, {
    checkedAt: null,
    ok: true,
    intervalMinutes: 10,
    refreshDue: true,
    updating: false,
  });

  h.script.receipts[TX] = {
    status: "0x1",
    blockNumber: "0x1f4",
    logs: [transferLog(USDC, DONOR, SAFE_ADDR, 1_000_000n)],
  };
  await syncSafe(h.deps, initiative);
  const after = await j(await h.req("/api/initiatives/" + initiative.slug)) as Page;
  assertEquals(after.ledger, {
    checkedAt: h.clock.now,
    ok: true,
    intervalMinutes: 10,
    refreshDue: false,
    updating: false,
  });
  assertEquals(after.summary.ledger, 1);

  // a Safe with no ledger status field for initiatives without a Safe
  const bare = await h.db.initiatives.insert({ title: "No Safe", status: "approved", goalUsd: 10 });
  const b = await j(await h.req("/api/initiatives/" + bare.slug)) as { ledger: unknown };
  assertEquals(b.ledger, null);
  h.close();
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
