import { assert, assertEquals, assertFalse } from "@std/assert";
import { harness, j, SAFE_ADDR } from "./app-helpers.ts";
import { transferLog } from "./helpers.ts";
import { loadConfig, TOKENS } from "../config.ts";
import { createDb } from "../db/mod.ts";
import {
  LEDGER_LEASE_SECS,
  LEDGER_RETRY_SECS,
  ledgerStatus,
  refreshLedger,
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
    const rfp = await h.db.rfps.insert({
      title: "Viewed ledger",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX1] = receipt();
    const path = `/api/initiatives/${rfp.slug}`;
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
    assertEquals((await h.db.donations.get(rfp.id, TX1))!.status, "confirmed");
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
    const rfp = await h.db.rfps.insert({
      title: "Shared ledger",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX1] = receipt();
    h.script.receipts[TX2] = receipt();
    const path = `/api/initiatives/${rfp.slug}`;
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
      Array.from({ length: 8 }, () => refreshLedger(other, rfp)),
    );
    assert(concurrent.every((s) => s?.updating));
    await refreshLedger(other, rfp, true); // admin also respects the running lease
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
    const rfp = await h.db.rfps.insert({
      title: "Retry ledger",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX1] = receipt();
    await refreshLedger(h.deps, rfp);
    h.clock.now += h.deps.config.safeSyncTtlSecs;
    failed = true;
    await refreshLedger(h.deps, rfp);
    const status = (await ledgerStatus(h.deps, rfp))!;
    assertFalse(status.ok);
    assertFalse(status.updating);
    assertFalse(status.refreshDue);
    assertEquals((await h.db.donations.list(rfp.id)).length, 1);
    await refreshLedger(h.deps, rfp);
    h.clock.now += LEDGER_RETRY_SECS - 1;
    await refreshLedger(h.deps, rfp);
    assertEquals(h.fetchLog.length, 2);
    failed = false;
    h.clock.now++;
    await refreshLedger(h.deps, rfp);
    assertEquals(h.fetchLog.length, 3);
    assert((await ledgerStatus(h.deps, rfp))!.ok);
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
    const rfp = await h.db.rfps.insert({
      title: "Recover ledger",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    h.script.receipts[TX2] = receipt();
    pending = refreshLedger(h.deps, rfp);
    await started.promise;
    h.clock.now += LEDGER_LEASE_SECS + 1;
    assert((await ledgerStatus(h.deps, rfp))!.refreshDue);
    const newer = await refreshLedger(h.deps, rfp);
    assertEquals(newer?.lastTxHash, TX2);
    gate.resolve(result([]));
    assertEquals(await pending, newer);
    assertEquals(await h.db.meta.safeSync(rfp.id), newer);
  } finally {
    gate.resolve(result([]));
    await pending;
    h.close();
  }
});

Deno.test("ledger: page refresh retries only that initiative's pending donations", async () => {
  const h = await harness({ fetch: () => result([]) });
  try {
    const first = await h.db.rfps.insert({
      title: "Visited",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    const otherSafe = "0x" + "55".repeat(20);
    const second = await h.db.rfps.insert({
      title: "Not visited",
      status: "approved",
      safeAddress: otherSafe,
    });
    h.script.head = 501;
    for (const [rfp, tx] of [[first, TX1], [second, TX2]] as const) {
      h.script.receipts[tx] = receipt(rfp.safeAddress);
      await h.db.donations.record(
        rfp.id,
        tx,
        await h.deps.chain.verifyDonation(tx, rfp.safeAddress),
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
    const first = await h.db.rfps.insert({
      title: "On the board",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    const second = await h.db.rfps.insert({
      title: "Also visible",
      status: "approved",
      safeAddress: "0x" + "55".repeat(20),
    });
    const hidden = await h.db.rfps.insert({
      title: "Private",
      status: "pending",
      safeAddress: "0x" + "66".repeat(20),
    });
    await h.db.rfps.insert({ title: "No Safe", status: "approved" });
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
    const rfp = await h.db.rfps.insert({
      title: "Long history",
      status: "approved",
      safeAddress: SAFE_ADDR,
    });
    const first = await refreshLedger(h.deps, rfp);
    assertFalse(first!.backfilled);
    assert(first!.resumeUrl.includes(`page=${MAX_PAGES_PER_RUN}`));
    assertEquals(first!.refreshAfter, h.clock.now + LEDGER_RETRY_SECS);
    assertEquals(h.fetchLog.length, MAX_PAGES_PER_RUN);
    h.clock.now += LEDGER_RETRY_SECS - 1;
    await refreshLedger(h.deps, rfp);
    assertEquals(h.fetchLog.length, MAX_PAGES_PER_RUN);
    h.clock.now++;
    const complete = await refreshLedger(h.deps, rfp);
    assert(complete!.backfilled);
    assertEquals(complete!.resumeUrl, "");
    assertEquals(complete!.refreshAfter, h.clock.now + h.deps.config.safeSyncTtlSecs);
    assertEquals(h.fetchLog.length, MAX_PAGES_PER_RUN + 1);
    assertEquals(h.script.calls, []);
  } finally {
    h.close();
  }
});
