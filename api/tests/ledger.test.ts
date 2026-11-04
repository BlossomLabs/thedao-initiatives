import { assert, assertEquals, assertFalse } from "@std/assert";
import { harness, j, SAFE_ADDR } from "./app-helpers.ts";
import { transferLog } from "./helpers.ts";
import { loadConfig, TOKENS } from "../config.ts";
import { createDb } from "../db/mod.ts";
import {
  LEDGER_LEASE_SECS,
  LEDGER_MAX_BACKOFF_SECS,
  LEDGER_RETRY_SECS,
  ledgerStatus,
  refreshLedger,
  refreshLedgers,
  safeApiPausedUntil,
} from "../services/ledger.ts";
import { MAX_PAGES_PER_RUN } from "../services/safe-api.ts";

const DONOR = "0x" + "44".repeat(20);
const TX1 = "0x" + "d1".repeat(32);
const TX2 = "0x" + "d2".repeat(32);
const USDC = TOKENS.USDC[0];
const transfer = (tx: string) => ({
  type: "ERC20_TRANSFER",
  executionDate: "2026-09-01T00:00:00Z",
  blockNumber: 500,
  transactionHash: tx,
  to: SAFE_ADDR,
  from: DONOR,
  value: "1000000",
  tokenAddress: USDC,
  transferId: tx,
});
const receipt = (safe = SAFE_ADDR) => ({
  status: "0x1",
  blockNumber: "0x1f4",
  logs: [transferLog(USDC, DONOR, safe, 1_000_000n)],
});
const result = (txs: string[]) =>
  Response.json({ count: txs.length, next: null, results: txs.map(transfer) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => resolve = r);
  return { promise, resolve };
}
type Page = {
  donations: { txHash: string }[];
  summary: { ledger: number };
  ledger: NonNullable<Awaited<ReturnType<typeof ledgerStatus>>>;
};

Deno.test("ledger: snapshot first, refresh saves donations to KV, fresh visits do no upstream work", async () => {
  const h = await harness({ fetch: () => result([TX1]) });
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Viewed ledger",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX1] = receipt();
    const path = `/api/initiatives/${initiative.slug}`;
    const before = await j(await h.req(path)) as Page;
    assertEquals(before.donations, []);
    assert(before.ledger.refreshDue);
    assertEquals(h.fetchLog, []);
    assertEquals(h.script.calls, []);

    const after = await j(await h.req(path + "?refresh=1")) as Page;
    assertEquals(after.donations.map((d) => d.txHash), [TX1]);
    assertEquals(after.summary.ledger, 1);
    assertFalse(after.ledger.refreshDue);
    assertFalse(after.ledger.updating);
    assertEquals((await h.db.donations.get(initiative.id, TX1))!.status, "confirmed");
    assertEquals(h.fetchLog.length, 1);
    h.script.calls.length = 0;
    await h.req(path);
    await h.req(path + "?refresh=1");
    assertEquals(h.fetchLog.length, 1);
    assertEquals(h.script.calls, []);

    h.clock.now += h.deps.config.safeSyncTtlSecs + 1;
    const stale = await j(await h.req(path)) as Page;
    assertEquals(stale.donations.map((d) => d.txHash), [TX1]);
    assert(stale.ledger.refreshDue);
    assertEquals(h.fetchLog.length, 1, "time passing and snapshot reads do not start a sync");
    assertEquals(h.script.calls, []);
  } finally {
    h.close();
  }
});

Deno.test("ledger: concurrent visitors share a KV lease and see saved donations while updating", async () => {
  const gate = deferred<Response>();
  const started = deferred<void>();
  let slow = false;
  const h = await harness({
    fetch: () => {
      if (!slow) return result([TX1]);
      started.resolve();
      return gate.promise;
    },
  });
  let pending: Promise<Response> | undefined;
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Shared ledger",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX1] = receipt();
    h.script.receipts[TX2] = receipt();
    const path = `/api/initiatives/${initiative.slug}`;
    await h.req(path + "?refresh=1");
    slow = true;
    h.clock.now += h.deps.config.safeSyncTtlSecs + 1;
    pending = h.req(path + "?refresh=1");
    await started.promise;

    const stale = await j(await h.req(path)) as Page;
    assertEquals(stale.donations.map((d) => d.txHash), [TX1]);
    assert(stale.ledger.updating);
    assertFalse(stale.ledger.refreshDue, "another visitor owns the refresh");
    const other = { ...h.deps, db: createDb(h.kv, () => h.clock.now) };
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => refreshLedger(other, initiative)),
    );
    assert(concurrent.every((s) => s?.updating));
    await refreshLedger(other, initiative, true); // admin also respects the running lease
    assertEquals(h.fetchLog.length, 2, "only one upstream refresh for all visitors");

    gate.resolve(result([TX2, TX1]));
    const updated = await j(await pending) as Page;
    assertEquals(updated.donations.length, 2);
    assertEquals(updated.summary.ledger, 2);
    assertFalse(updated.ledger.updating);
    assertFalse(updated.ledger.refreshDue);
    const reader = await j(await h.req(path)) as Page;
    assertEquals(reader.donations.length, 2);
    assertFalse(reader.ledger.updating);
  } finally {
    gate.resolve(result([]));
    await pending;
    h.close();
  }
});

Deno.test("ledger: failures preserve saved rows and share a retry cooldown", async () => {
  let failed = false;
  const h = await harness({
    fetch: () => failed ? new Response("{}", { status: 429 }) : result([TX1]),
  });
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Retry ledger",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX1] = receipt();
    await refreshLedger(h.deps, initiative);
    h.clock.now += h.deps.config.safeSyncTtlSecs;
    failed = true;
    await refreshLedger(h.deps, initiative);
    const status = (await ledgerStatus(h.deps, initiative))!;
    assertFalse(status.ok);
    assertFalse(status.updating);
    assertFalse(status.refreshDue);
    assertEquals((await h.db.donations.list(initiative.id)).length, 1);
    await refreshLedger(h.deps, initiative);
    h.clock.now += LEDGER_RETRY_SECS - 1;
    await refreshLedger(h.deps, initiative);
    assertEquals(h.fetchLog.length, 2);
    failed = false;
    h.clock.now++;
    await refreshLedger(h.deps, initiative);
    assertEquals(h.fetchLog.length, 3);
    assert((await ledgerStatus(h.deps, initiative))!.ok);
  } finally {
    h.close();
  }
});

Deno.test("ledger: an expired lease recovers and its late worker cannot overwrite the new cursor", async () => {
  const gate = deferred<Response>();
  const started = deferred<void>();
  let calls = 0;
  const h = await harness({
    fetch: () => {
      if (++calls > 1) return result([TX2]);
      started.resolve();
      return gate.promise;
    },
  });
  let pending: ReturnType<typeof refreshLedger> | undefined;
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Recover ledger",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX2] = receipt();
    pending = refreshLedger(h.deps, initiative);
    await started.promise;
    h.clock.now += LEDGER_LEASE_SECS + 1;
    assert((await ledgerStatus(h.deps, initiative))!.refreshDue);
    const newer = await refreshLedger(h.deps, initiative);
    assertEquals(newer?.lastTxHash, TX2);
    gate.resolve(result([]));
    assertEquals(await pending, newer);
    assertEquals(await h.db.meta.safeSync(initiative.id), newer);
  } finally {
    gate.resolve(result([]));
    await pending;
    h.close();
  }
});

Deno.test("ledger: page refresh retries only that initiative's pending donations", async () => {
  const h = await harness({ fetch: () => result([]) });
  try {
    const first = await h.db.initiatives.insert({
      title: "Visited",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    const otherSafe = "0x" + "55".repeat(20);
    const second = await h.db.initiatives.insert({
      title: "Not visited",
      status: "approved",
      safeAddress: otherSafe,
    });
    h.script.head = 501;
    for (const [initiative, tx] of [[first, TX1], [second, TX2]] as const) {
      h.script.receipts[tx] = receipt(initiative.safeAddress);
      await h.db.donations.record(
        initiative.id,
        tx,
        await h.deps.chain.verifyDonation(tx, initiative.safeAddress),
      );
    }
    h.script.head = 502;
    h.script.calls.length = 0;
    await refreshLedger(h.deps, first);
    assertEquals(h.script.calls, ["eth_getTransactionReceipt", "eth_blockNumber"]);
    assertEquals((await h.db.donations.get(first.id, TX1))!.status, "confirmed");
    assertEquals((await h.db.donations.get(second.id, TX2))!.status, "pending");
    assertEquals(await h.db.meta.safeSync(second.id), null);
  } finally {
    h.close();
  }
});

Deno.test("ledger: board refreshes visible Safes and reuses the result on initiative pages", async () => {
  const h = await harness({ fetch: () => result([]) });
  try {
    const first = await h.db.initiatives.insert({
      title: "On the board",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    const second = await h.db.initiatives.insert({
      title: "Also visible",
      status: "approved",
      safeAddress: "0x" + "55".repeat(20),
    });
    const hidden = await h.db.initiatives.insert({
      title: "Private",
      status: "pending",
      safeAddress: "0x" + "66".repeat(20),
    });
    await h.db.initiatives.insert({ title: "No Safe", status: "approved" });
    await h.req("/api/board");
    assertEquals(h.fetchLog.length, 0);
    await h.req("/api/board?refresh=1");
    assertEquals(h.fetchLog.length, 2);
    assert((await h.db.meta.safeSync(first.id))!.ok);
    assert((await h.db.meta.safeSync(second.id))!.ok);
    assertEquals(await h.db.meta.safeSync(hidden.id), null);
    assertEquals(h.script.calls.filter((m) => m === "eth_blockNumber").length, 0);
    h.script.calls.length = 0;
    await h.req("/api/board?refresh=1");
    await h.req(`/api/initiatives/${first.slug}?refresh=1`);
    assertEquals(h.fetchLog.length, 2);
    assertEquals(h.script.calls, []);
  } finally {
    h.close();
  }
});

Deno.test("ledger: cache lifetime replaces the old schedule configuration", () => {
  assertEquals(loadConfig({}).safeSyncTtlSecs, 600);
  assertEquals(loadConfig({ SAFE_SYNC_TTL_SECS: "120" }).safeSyncTtlSecs, 120);
  assertEquals(loadConfig({ SAFE_SYNC_TTL_SECS: "5" }).safeSyncTtlSecs, 60);
  for (const value of ["bad", "Infinity", "0", "-10"]) {
    assertEquals(loadConfig({ SAFE_SYNC_TTL_SECS: value }).safeSyncTtlSecs, 600);
  }
});

Deno.test("ledger: an incomplete backfill resumes after the short cooldown while viewed", async () => {
  const h = await harness({
    fetch: (url) => {
      const next = new URL(url);
      const page = Number(next.searchParams.get("page") ?? 0);
      next.searchParams.set("page", String(page + 1));
      return Response.json({
        count: MAX_PAGES_PER_RUN + 1,
        next: page < MAX_PAGES_PER_RUN ? next.toString() : null,
        results: [{ ...transfer(TX1), tokenAddress: "0x" + "99".repeat(20) }],
      });
    },
  });
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Long history",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    const first = await refreshLedger(h.deps, initiative);
    assertFalse(first!.backfilled);
    assert(first!.resumeUrl.includes(`page=${MAX_PAGES_PER_RUN}`));
    assertEquals(first!.refreshAfter, h.clock.now + LEDGER_RETRY_SECS);
    assertEquals(h.fetchLog.length, MAX_PAGES_PER_RUN);
    h.clock.now += LEDGER_RETRY_SECS - 1;
    await refreshLedger(h.deps, initiative);
    assertEquals(h.fetchLog.length, MAX_PAGES_PER_RUN);
    h.clock.now++;
    const complete = await refreshLedger(h.deps, initiative);
    assert(complete!.backfilled);
    assertEquals(complete!.resumeUrl, "");
    assertEquals(complete!.refreshAfter, h.clock.now + h.deps.config.safeSyncTtlSecs);
    assertEquals(h.fetchLog.length, MAX_PAGES_PER_RUN + 1);
    assertEquals(h.script.calls, []);
  } finally {
    h.close();
  }
});

Deno.test("ledger: failures in a row double the cooldown up to 30 minutes, a success resets it", async () => {
  let status = 500;
  const h = await harness({
    fetch: () => status === 200 ? result([]) : new Response("{}", { status }),
  });
  try {
    const initiative = await h.db.initiatives.insert({
      title: "Failing ledger",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const state = (await refreshLedger(h.deps, initiative))!;
      assertFalse(state.ok);
      waits.push(state.refreshAfter! - h.clock.now);
      h.clock.now = state.refreshAfter!;
    }
    assertEquals(waits, [60, 120, 240, 480, 960, LEDGER_MAX_BACKOFF_SECS, LEDGER_MAX_BACKOFF_SECS]);
    status = 200;
    const ok = (await refreshLedger(h.deps, initiative))!;
    assert(ok.ok);
    assertEquals(ok.failures, 0);
    status = 500;
    h.clock.now = ok.refreshAfter!;
    const again = (await refreshLedger(h.deps, initiative))!;
    assertEquals(again.refreshAfter! - h.clock.now, LEDGER_RETRY_SECS);
  } finally {
    h.close();
  }
});

Deno.test("ledger: a 429 pauses every Safe and quiets their refresh flags, doubling while it repeats", async () => {
  let limited = true;
  const h = await harness({
    fetch: () => limited ? new Response("{}", { status: 429 }) : result([]),
  });
  try {
    const rows = [];
    for (let i = 1; i <= 5; i++) {
      rows.push(
        await h.db.initiatives.insert({
          title: `Paused ${i}`,
          status: "approved",
          safeAddress: "0x" + i.toString(16).padStart(40, "0"),
        }),
      );
    }
    await refreshLedgers(h.deps, rows);
    const tried = h.fetchLog.length;
    assert(tried >= 1 && tried <= 3, "the first 429 stops the batch");
    const until = await safeApiPausedUntil(h.deps);
    assertEquals(until, h.clock.now + LEDGER_RETRY_SECS);
    // Untried Safes are overdue, but nothing is due while the API is paused.
    for (const r of rows) {
      assertFalse((await ledgerStatus(h.deps, r, until))!.refreshDue);
    }
    assert((await ledgerStatus(h.deps, rows[4]))!.refreshDue, "due again once the pause ends");
    await refreshLedgers(h.deps, rows);
    await refreshLedger(h.deps, rows[4]);
    assertEquals(h.fetchLog.length, tried, "no Safe API call during the pause");

    h.clock.now = until;
    await refreshLedgers(h.deps, rows);
    assertEquals(await safeApiPausedUntil(h.deps), h.clock.now + 2 * LEDGER_RETRY_SECS);

    limited = false;
    h.clock.now = await safeApiPausedUntil(h.deps);
    await refreshLedgers(h.deps, rows);
    assertEquals(await safeApiPausedUntil(h.deps), 0, "a success after the pause clears it");
    for (const r of rows) assertFalse((await ledgerStatus(h.deps, r))!.refreshDue);
  } finally {
    h.close();
  }
});

Deno.test("ledger: 429s from parallel lanes count as one pause", async () => {
  // Three syncs already past the pause check; their 429s land one after another.
  const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
  let calls = 0;
  const allIn = deferred<void>();
  const h = await harness({
    fetch: async () => {
      const gate = gates[calls++];
      if (calls === 3) allIn.resolve();
      await gate.promise;
      return new Response("{}", { status: 429 });
    },
  });
  try {
    const rows = [];
    for (let i = 1; i <= 3; i++) {
      rows.push(
        await h.db.initiatives.insert({
          title: `Lane ${i}`,
          status: "approved",
          safeAddress: "0x" + i.toString(16).padStart(40, "0"),
        }),
      );
    }
    const runs = rows.map((r) => refreshLedger(h.deps, r));
    await allIn.promise;
    for (let i = 0; i < 3; i++) {
      gates[i].resolve();
      await runs[i];
    }
    assertEquals(await safeApiPausedUntil(h.deps), h.clock.now + LEDGER_RETRY_SECS);
  } finally {
    for (const g of gates) g.resolve();
    h.close();
  }
});
