import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { Verification } from "../chain/verify.ts";
import { TOKENS } from "../config.ts";
import { K } from "../db/keys.ts";
import { UNKNOWN_DONATION_MAX_AGE_SECS } from "../lib/donation-retry.ts";
import { PENDING_SCAN_LIMIT, PENDING_VERIFY_LIMIT, reverifyPending } from "../services/safe-api.ts";
import { harness, SAFE_ADDR } from "./app-helpers.ts";
import { DONOR, transferLog } from "./helpers.ts";

const hash = (i: number) => "0x" + i.toString(16).padStart(64, "0");
const unknown: Verification = {
  found: false,
  pending: false,
  ok: false,
  tokenSymbol: "",
  tokenAddress: "",
  amountRaw: "0",
  amount: 0,
  amountUsd: 0,
  donor: "",
  detail: "transaction not found on mainnet",
};
const seed = (h: Awaited<ReturnType<typeof harness>>) =>
  h.db.initiatives.insert({
    title: "Retry queue",
    status: "approved",
    safeAddress: SAFE_ADDR,
  });
const lookups = (h: Awaited<ReturnType<typeof harness>>) =>
  h.script.calls.filter((m) =>
    m === "eth_getTransactionReceipt" || m === "eth_getTransactionByHash"
  ).length;

Deno.test("public status polling respects retry backoff and reports retirement of unknown hashes", async () => {
  const h = await harness();
  try {
    const initiative = await seed(h);
    await h.db.donations.record(initiative.id, hash(1), unknown);
    const status = async () => {
      h.script.calls.length = 0;
      const response = await h.req(`/api/donate/status/${hash(1)}`);
      assertEquals(response.status, 200);
      return await response.json();
    };
    assertEquals((await status()).status, "pending");
    assertEquals(lookups(h), 2);
    h.clock.now += 6; // Past the route's five-second throttle, still inside the row's backoff.
    assertEquals((await status()).status, "pending");
    assertEquals(lookups(h), 0);
    h.clock.now += UNKNOWN_DONATION_MAX_AGE_SECS;
    const retired = await status();
    assertEquals(retired.status, "failed");
    assertStringIncludes(retired.detail, "window expired");
    assertEquals(lookups(h), 2);
    assertEquals((await status()).status, "failed");
    assertEquals(lookups(h), 0);
  } finally {
    h.close();
  }
});

Deno.test("board retries a bounded backlog, shares cooldown and eventually reaches every hash", async () => {
  const h = await harness({ fetch: () => Response.json({ next: null, results: [] }) });
  try {
    const initiative = await seed(h);
    const count = PENDING_VERIFY_LIMIT * 2 + 3;
    for (let i = 1; i <= count; i++) await h.db.donations.record(initiative.id, hash(i), unknown);
    const visited = new Set<string>();
    const verify = h.deps.chain.verifyDonation;
    h.deps.chain.verifyDonation = (tx, safe, opts) => {
      visited.add(tx);
      return verify(tx, safe, opts);
    };
    const refresh = async () => {
      h.script.calls.length = 0;
      const response = await h.req("/api/board?refresh=1");
      assertEquals(response.status, 200);
      await response.arrayBuffer();
      return lookups(h);
    };
    assertEquals(await refresh(), PENDING_VERIFY_LIMIT * 2);
    assertEquals(await refresh(), 0);
    for (let i = 0; i < 2; i++) {
      h.clock.now += h.deps.config.safeSyncTtlSecs + 1;
      assert(await refresh() <= PENDING_VERIFY_LIMIT * 2);
    }
    assertEquals(visited.size, count);
    // A newly inserted lower hash must be visited after the scan wraps.
    await h.db.donations.record(initiative.id, hash(0), unknown);
    h.clock.now += h.deps.config.safeSyncTtlSecs + 1;
    await refresh();
    assert(visited.has(hash(0)));
  } finally {
    h.close();
  }
});

Deno.test("pending retry scan bounds KV work and progresses past final rows", async () => {
  const h = await harness();
  try {
    const initiative = await seed(h);
    for (let i = 0; i < PENDING_SCAN_LIMIT; i++) {
      await h.db.donations.record(initiative.id, hash(i), { ...unknown, found: true });
    }
    await h.db.donations.record(initiative.id, hash(PENDING_SCAN_LIMIT), unknown);
    const first = await reverifyPending(h.deps, h.deps.chain.blockNumber, initiative);
    assertEquals(first, { checked: 0, scanned: PENDING_SCAN_LIMIT, more: true });
    const second = await reverifyPending(h.deps, h.deps.chain.blockNumber, initiative);
    assertEquals(second, { checked: 1, scanned: 1, more: false });
  } finally {
    h.close();
  }
});

Deno.test("retry deadline resumes at the first unchecked row and applies per-row backoff", async () => {
  const h = await harness();
  const realNow = Date.now;
  try {
    const initiative = await seed(h);
    for (let i = 1; i <= 3; i++) await h.db.donations.record(initiative.id, hash(i), unknown);
    let ms = realNow();
    Date.now = () => ms;
    const visited: string[] = [];
    h.deps.chain.verifyDonation = (tx) => {
      visited.push(tx);
      ms += 101;
      return Promise.resolve(unknown);
    };
    assertEquals(await reverifyPending(h.deps, h.deps.chain.blockNumber, initiative, 0), {
      checked: 0,
      scanned: 0,
      more: false,
    });
    await reverifyPending(h.deps, h.deps.chain.blockNumber, initiative, 100);
    assertEquals(visited, [hash(1)]);
    await reverifyPending(h.deps, h.deps.chain.blockNumber, initiative, 100);
    assertEquals(visited, [hash(1), hash(2)]);
    await reverifyPending(h.deps, h.deps.chain.blockNumber, initiative, 100);
    await reverifyPending(h.deps, h.deps.chain.blockNumber, initiative, 100);
    assertEquals(visited, [hash(1), hash(2), hash(3)]);
    const row = (await h.db.donations.get(initiative.id, hash(1)))!;
    assertEquals(row.retryAttempts, 1);
    assertEquals(row.retryAfter, h.clock.now + 60);
    h.clock.now += 61;
    await reverifyPending(h.deps, h.deps.chain.blockNumber, initiative, 100);
    assertEquals(visited.at(-1), hash(1));
    assertEquals((await h.db.donations.get(initiative.id, hash(1)))!.retryAfter, h.clock.now + 120);
  } finally {
    Date.now = realNow;
    h.close();
  }
});

Deno.test("unknown hashes retire while observed, delayed and temporarily unreachable transactions can recover", async () => {
  const h = await harness();
  try {
    const initiative = await seed(h);
    for (let i = 1; i <= 4; i++) await h.db.donations.record(initiative.id, hash(i), unknown);
    await h.db.donations.record(initiative.id, hash(2), {
      ...unknown,
      found: true,
      pending: true,
      detail: "transaction pending, not yet mined",
    });
    // Exercise a legacy pending row without the new bookkeeping fields.
    const legacy = (await h.db.donations.get(initiative.id, hash(1)))!;
    delete legacy.seenOnChain;
    delete legacy.retryAttempts;
    delete legacy.retryAfter;
    await h.kv.set(K.donation(initiative.id, hash(1)), legacy);
    h.clock.now += UNKNOWN_DONATION_MAX_AGE_SECS + 1;
    h.script.receipts[hash(3)] = {
      status: "0x1",
      blockNumber: "0x1f4",
      logs: [transferLog(TOKENS.USDC[0], DONOR, SAFE_ADDR, 25_000_000n)],
    };
    const verify = h.deps.chain.verifyDonation;
    h.deps.chain.verifyDonation = (tx, safe, opts) =>
      tx === hash(4)
        ? Promise.reject(new Error("temporary transport failure"))
        : verify(tx, safe, opts);
    await reverifyPending(h.deps, h.deps.chain.blockNumber, initiative);
    const rows = await h.db.donations.list(initiative.id, false);
    const status = (i: number) => rows.find((r) => r.txHash === hash(i))!.status;
    assertEquals([1, 2, 3, 4].map(status), ["failed", "pending", "confirmed", "pending"]);
    assertStringIncludes(rows.find((r) => r.txHash === hash(1))!.detail, "window expired");
    // Resubmitting a still-missing hash cannot reset its age.
    assertEquals((await h.db.donations.record(initiative.id, hash(1), unknown))[1], "failed");
    // Even a retired hash can be confirmed if it eventually appears on-chain.
    h.script.receipts[hash(1)] = h.script.receipts[hash(3)];
    const recovered = await verify(hash(1), SAFE_ADDR);
    assertEquals((await h.db.donations.record(initiative.id, hash(1), recovered))[1], "confirmed");
    assertEquals((await h.db.donations.get(initiative.id, hash(4)))!.retryAfter, h.clock.now + 60);
  } finally {
    h.close();
  }
});
