import { assert, assertEquals, assertFalse } from "@std/assert";
import { harness, j, SAFE_ADDR } from "./app-helpers.ts";
import { transferLog } from "./helpers.ts";
import { TOKENS } from "../config.ts";
import { refreshDailyCache } from "../services/daily-cache.ts";

const SECOND_SAFE = "0x" + "55".repeat(20);
const DONOR = "0x" + "44".repeat(20);
const TX1 = "0x" + "e1".repeat(32);
const TX2 = "0x" + "e2".repeat(32);
const USDC = TOKENS.USDC[0];

const receipt = (safe: string) => ({
  status: "0x1",
  blockNumber: "0x1f4",
  logs: [transferLog(USDC, DONOR, safe, 1_000_000n)],
});

const transfers = (safe = SAFE_ADDR, tx = TX1) =>
  Response.json({
    count: 1,
    next: null,
    results: [{
      type: "ERC20_TRANSFER",
      executionDate: "2026-09-01T00:00:00Z",
      blockNumber: 500,
      transactionHash: tx,
      to: safe,
      from: DONOR,
      value: "1000000",
      tokenAddress: USDC,
      transferId: tx,
    }],
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => resolve = r);
  return { promise, resolve };
}

Deno.test("daily cache: only the exact production timeline may access KV or upstream services", async () => {
  const h = await harness();
  try {
    const guarded = {
      ...h.deps,
      db: {
        ...h.db,
        rfps: {
          ...h.db.initiatives,
          list: () => {
            throw new Error("non-production must not read KV");
          },
        },
      },
    };
    for (
      const timeline of [
        undefined,
        "",
        "git-branch/main",
        "git-branch/production",
        "preview/revision-id",
        "Production",
        "production ",
        "staging",
      ]
    ) {
      await refreshDailyCache(guarded, timeline);
    }
    assertEquals(h.fetchLog, []);
    assertEquals(h.script.calls, []);
  } finally {
    h.close();
  }
});

Deno.test("daily cache: production refreshes approved Safes, persists both caches, and skips fresh data", async () => {
  const h = await harness({
    fetch: (url) => url.includes(SECOND_SAFE) ? transfers(SECOND_SAFE, TX2) : transfers(),
  });
  try {
    const first = await h.db.initiatives.insert({
      title: "Daily first",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    const second = await h.db.initiatives.insert({
      title: "Daily second",
      status: "approved",
      safeAddress: SECOND_SAFE,
    });
    const bare = await h.db.initiatives.insert({ title: "No Safe", status: "approved" });
    const pending = await h.db.initiatives.insert({
      title: "Pending",
      status: "pending",
      safeAddress: "0x" + "66".repeat(20),
    });
    const archived = await h.db.initiatives.insert({
      title: "Archived",
      status: "archived",
      safeAddress: "0x" + "77".repeat(20),
    });
    h.script.receipts[TX1] = receipt(SAFE_ADDR);
    h.script.receipts[TX2] = receipt(SECOND_SAFE);
    h.script.tokenBalances[`USDC:${SAFE_ADDR.toLowerCase()}`] = 2_000_000n;
    h.script.tokenBalances[`USDC:${SECOND_SAFE}`] = 3_000_000n;

    await refreshDailyCache(h.deps, "production");
    assertEquals(h.fetchLog.length, 2);
    assertEquals(h.script.calls.filter((m) => m === "eth_blockNumber").length, 1);
    assertEquals((await h.deps.funding.balances(SAFE_ADDR))!.usd, 2);
    assertEquals((await h.deps.funding.balances(SECOND_SAFE))!.usd, 3);
    for (const [rfp, tx] of [[first, TX1], [second, TX2]] as const) {
      assertEquals((await h.db.donations.get(rfp.id, tx))!.status, "confirmed");
      assert((await h.db.meta.safeSync(rfp.id))!.ok);
      assertFalse((await h.deps.funding.summary(rfp)).refreshDue);
    }
    for (const rfp of [bare, pending, archived]) {
      assertEquals(await h.db.meta.safeSync(rfp.id), null);
      if (rfp.safeAddress) assertEquals(await h.deps.funding.balances(rfp.safeAddress), null);
    }

    h.script.calls.length = 0;
    await refreshDailyCache(h.deps, "production");
    const board = await j(await h.req("/api/board")) as {
      totals: { raised: number; donations: number };
    };
    assertEquals(board.totals.raised, 5);
    assertEquals(board.totals.donations, 2);
    assertEquals(h.fetchLog.length, 2, "fresh ledgers are reused");
    assertEquals(h.script.calls, [], "fresh balances and snapshots need no RPC");

    h.clock.now += 86400;
    h.script.tokenBalances[`USDC:${SAFE_ADDR.toLowerCase()}`] = 4_000_000n;
    await refreshDailyCache(h.deps, "production");
    assertEquals(h.fetchLog.length, 4);
    assertEquals((await h.deps.funding.balances(SAFE_ADDR))!.usd, 4);
    assertEquals(h.script.calls.filter((m) => m === "eth_blockNumber").length, 0);
    assertEquals(
      (await h.db.donations.list(first.id)).length,
      1,
      "known donations are not recredited",
    );
  } finally {
    h.close();
  }
});

Deno.test("daily cache: visitor refreshes share the scheduled job's ledger and balance leases", async () => {
  const gate = deferred<Response>();
  const started = deferred<void>();
  const h = await harness({
    fetch: () => {
      started.resolve();
      return gate.promise;
    },
  });
  let job: Promise<void> | undefined;
  try {
    const rfp = await h.db.initiatives.insert({
      title: "Shared daily refresh",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX1] = receipt(SAFE_ADDR);
    h.script.tokenBalances[`USDC:${SAFE_ADDR.toLowerCase()}`] = 1_000_000n;
    await h.deps.chain.state();
    h.script.calls.length = 0;

    job = refreshDailyCache(h.deps, "production");
    await started.promise;
    const page = await j(await h.req(`/api/initiatives/${rfp.slug}?refresh=1`)) as {
      ledger: { updating: boolean };
      donations: unknown[];
    };
    assert(page.ledger.updating);
    assertEquals(page.donations, []);
    assertEquals(h.fetchLog.length, 1);

    gate.resolve(transfers());
    await job;
    assertEquals((await h.db.donations.get(rfp.id, TX1))!.status, "confirmed");
    assertFalse((await h.db.meta.safeSync(rfp.id))!.updating);
    assertEquals((await h.deps.funding.balances(SAFE_ADDR))!.usd, 1);
    assertEquals(h.fetchLog.length, 1);
    assertEquals(h.script.calls.filter((m) => m === "eth_getBalance").length, 1);
    assertEquals(h.script.calls.filter((m) => m === "eth_call").length, Object.keys(TOKENS).length);
    assertEquals(h.script.calls.filter((m) => m === "eth_blockNumber").length, 1);
    assertEquals(h.script.calls.filter((m) => m === "eth_getTransactionReceipt").length, 1);
  } finally {
    gate.resolve(transfers());
    await job;
    h.close();
  }
});
