import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { type Harness, harness, SAFE_ADDR } from "./app-helpers.ts";
import { fakeRpc, transferLog } from "./helpers.ts";
import { TOKENS } from "../config.ts";
import { SAFE_RECEIVED_TOPIC } from "../chain/verify.ts";
import { deployBlock, SAFE_V130_FLOOR_BLOCK, scanDonations } from "../services/donation-scan.ts";
import { refreshLedgers } from "../services/ledger.ts";

const USDC = TOKENS.USDC[0];
const DONOR = "0x4444444444444444444444444444444444444444";
const ROUTER = "0x7777777777777777777777777777777777777777";
const LATER_SAFE = "0x" + "5a".repeat(20);
const TX_USDC = "0x" + "b1".repeat(32);
const TX_ETH = "0x" + "b2".repeat(32);
const TX_LATER = "0x" + "b3".repeat(32);
const HEAD = 20_000_000;
const DEPLOYED = HEAD - 30_000;
const pad = (a: string) => "0x" + "0".repeat(24) + a.slice(2).toLowerCase();
const hex = (n: number) => "0x" + n.toString(16);

const safeReceived = (safe: string, sender: string, wei: bigint) => ({
  address: safe,
  topics: [SAFE_RECEIVED_TOPIC, pad(sender)],
  data: "0x" + wei.toString(16).padStart(64, "0"),
});

/** A deployed Safe at `safe`, with `tx` sending it 5 USDC at `block`. */
function usdcTo(h: Harness, safe: string, tx: string, block: number) {
  const log = transferLog(USDC, DONOR, safe, 5_000_000n);
  h.script.logs.push({ ...log, blockNumber: hex(block), transactionHash: tx });
  h.script.receipts[tx] = { status: "0x1", blockNumber: hex(block), logs: [log] };
  h.script.txs[tx] = { to: USDC, from: DONOR, value: "0x0" };
}

/** One approved Safe, deployed 30k blocks ago, with 3 USDC and 1 ETH routed through a contract. */
async function setup(env: Record<string, string> = {}) {
  // Logs mode is the default: no DONATION_DISCOVERY set.
  const h = await harness({
    env,
    fetch: (url) =>
      url.startsWith("https://api.safe.global/")
        ? Response.json({ count: 0, next: null, results: [] })
        : new Response("", { status: 404 }),
  });
  h.script.head = HEAD;
  h.script.code[SAFE_ADDR.toLowerCase()] = "0x6080";
  h.script.deployedAt[SAFE_ADDR.toLowerCase()] = DEPLOYED;
  const initiative = await h.db.initiatives.insert({
    title: "Scanned initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  const usdc = transferLog(USDC, DONOR, SAFE_ADDR, 3_000_000n);
  const eth = safeReceived(SAFE_ADDR, ROUTER, 10n ** 18n);
  // The USDC arrives the block the Safe was deployed: a backfill must not start after it.
  h.script.logs.push(
    { ...usdc, blockNumber: hex(DEPLOYED), transactionHash: TX_USDC },
    { ...eth, blockNumber: hex(HEAD - 500), transactionHash: TX_ETH },
  );
  h.script.receipts[TX_USDC] = { status: "0x1", blockNumber: hex(DEPLOYED), logs: [usdc] };
  h.script.txs[TX_USDC] = { to: USDC, from: DONOR, value: "0x0" };
  h.script.receipts[TX_ETH] = { status: "0x1", blockNumber: hex(HEAD - 500), logs: [eth] };
  h.script.txs[TX_ETH] = { to: ROUTER, from: DONOR, value: hex(10 ** 9) };
  return { h, initiative };
}

const safeApiCalls = (h: Harness) =>
  h.fetchLog.filter((f) => f.url.startsWith("https://api.safe.global/")).length;

Deno.test("donation scan: deployBlock binary-searches eth_getCode, null without archive reads", async () => {
  const at = 18_123_457;
  const rpc = fakeRpc({
    eth_getCode: ([, tag]) => Number(tag) >= at ? "0x6080" : "0x",
  });
  assertEquals(await deployBlock(rpc, SAFE_ADDR, HEAD), at);
  const old = fakeRpc({ eth_getCode: () => "0x6080" });
  assertEquals(await deployBlock(old, SAFE_ADDR, HEAD), SAFE_V130_FLOOR_BLOCK);
  const none = fakeRpc({ eth_getCode: () => "0x" });
  assertEquals(await deployBlock(none, SAFE_ADDR, HEAD), null);
  const pruned = fakeRpc({
    eth_getCode: ([, tag]) => {
      if (Number(tag) < HEAD) throw new Error("missing trie node");
      return "0x6080";
    },
  });
  assertEquals(await deployBlock(pruned, SAFE_ADDR, HEAD), null);
});

Deno.test("donation scan: the first run reads each Safe's history from its deploy block, no Safe API", async () => {
  const { h, initiative } = await setup();
  try {
    const { state, touched } = await scanDonations(h.deps);
    assert(state?.ok, state?.error);
    assertEquals(state.cursor, HEAD - 2, "stops at the confirmed head (3 confirmations)");
    assertEquals(state.behind, 0);
    assertEquals(state.known, [SAFE_ADDR.toLowerCase()]);
    assertEquals(touched, [initiative.id]);
    const usdc = (await h.db.donations.get(initiative.id, TX_USDC))!;
    assertEquals([usdc.status, usdc.amountUsd, usdc.source], ["confirmed", 3, "tx"]);
    const eth = (await h.db.donations.get(initiative.id, TX_ETH))!;
    assertEquals([eth.status, eth.amountUsd, eth.source], ["confirmed", 2000, "tx"]);
    assertStringIncludes(eth.detail, "internal transfer");
    assertEquals(eth.donor.toLowerCase(), ROUTER);
    assertEquals(safeApiCalls(h), 0);

    // A run right after is skipped; a forced one finds nothing new and re-verifies nothing.
    assertEquals((await scanDonations(h.deps)).skipped, "fresh");
    h.script.calls.length = 0;
    h.script.head += 10;
    const again = await scanDonations(h.deps, { force: true });
    assertEquals(again.state?.cursor, HEAD + 8);
    assertFalse(h.script.calls.includes("eth_getTransactionReceipt"));
    assertFalse(h.script.calls.includes("eth_getCode"), "known Safes are not probed again");
  } finally {
    h.close();
  }
});

Deno.test("donation scan: a first run cut short waits for every Safe before it scans", async () => {
  const { h, initiative } = await setup();
  try {
    const cut = await scanDonations(h.deps, { budgetMs: -1 });
    assertEquals([cut.state?.cursor, cut.state?.known], [0, []]);
    assertStringIncludes(cut.state!.error, "not probed yet");
    assertFalse(h.script.calls.includes("eth_getLogs"));
    const { state } = await scanDonations(h.deps);
    assert(state?.ok, state?.error);
    assertEquals(state.backfills, {});
    assertEquals(state.firstStart, undefined);
    assertEquals((await h.db.donations.list(initiative.id)).length, 2);
  } finally {
    h.close();
  }
});

Deno.test("donation scan: a Safe approved later is backfilled on its own up to the cursor", async () => {
  const { h } = await setup();
  try {
    await scanDonations(h.deps);
    const later = await h.db.initiatives.insert({
      title: "Approved later",
      status: "approved",
      goalUsd: 1000,
      safeAddress: LATER_SAFE,
    });
    h.script.code[LATER_SAFE] = "0x6080";
    h.script.deployedAt[LATER_SAFE] = HEAD - 9_000;
    usdcTo(h, LATER_SAFE, TX_LATER, HEAD - 8_000); // long before the shared cursor
    h.script.head += 5;
    const { state } = await scanDonations(h.deps, { force: true });
    assert(state?.ok, state?.error);
    assertEquals(state.backfills, {});
    assertEquals((await h.db.donations.get(later.id, TX_LATER))?.status, "confirmed");
  } finally {
    h.close();
  }
});

Deno.test("donation scan: without archive reads, history starts a day before the initiative", async () => {
  const { h, initiative } = await setup();
  try {
    h.script.noArchive = true;
    const { state } = await scanDonations(h.deps);
    assert(state?.ok, state?.error);
    // createdAt is "now" in the harness: the start is about a day back, after the deploy block.
    assertEquals(await h.db.donations.get(initiative.id, TX_USDC), null);
    assert(await h.db.donations.get(initiative.id, TX_ETH));
  } finally {
    h.close();
  }
});

Deno.test("donation scan: narrows the range a provider refuses, and fails without moving the cursor", async () => {
  const { h, initiative } = await setup();
  try {
    h.script.maxLogSpan = 100; // a keyless free-plan limit
    const ok = await scanDonations(h.deps, { budgetMs: 60_000 });
    assert(ok.state?.ok, ok.state?.error);
    assertEquals((await h.db.donations.list(initiative.id)).length, 2);

    h.script.maxLogSpan = 10; // below the smallest range we try
    h.script.head += 500;
    const failed = await scanDonations(h.deps, { force: true });
    assertFalse(failed.state?.ok);
    assertEquals(failed.state?.cursor, ok.state!.cursor);
    assertEquals(failed.state?.behind, 500);
  } finally {
    h.close();
  }
});

Deno.test("donation scan: logs mode ledgers skip the Safe API unless an admin forces a sync", async () => {
  const { h, initiative } = await setup();
  try {
    await refreshLedgers(h.deps, [initiative]);
    assertEquals(safeApiCalls(h), 0);
    assertEquals((await h.db.donations.get(initiative.id, TX_USDC))?.status, "confirmed");
    assert((await h.db.meta.safeSync(initiative.id))?.ok);

    await refreshLedgers(h.deps, [initiative], true);
    assertEquals(safeApiCalls(h), 1, "a forced sync backfills from the Safe API");
  } finally {
    h.close();
  }
});

Deno.test("donation scan: DONATION_DISCOVERY=safe-api leaves the scanner off", async () => {
  const { h, initiative } = await setup({ DONATION_DISCOVERY: "safe-api" });
  try {
    await refreshLedgers(h.deps, [initiative]);
    assertEquals(safeApiCalls(h), 1);
    assertFalse(h.script.calls.includes("eth_getLogs"));
  } finally {
    h.close();
  }
});

Deno.test("donation scan: a Safe paying itself, in ETH or tokens, is not a donation", async () => {
  const { h, initiative } = await setup();
  try {
    const SELF_ETH = "0x" + "c1".repeat(32);
    const SELF_USDC = "0x" + "c2".repeat(32);
    const eth = safeReceived(SAFE_ADDR, SAFE_ADDR, 10n ** 18n);
    const usdc = transferLog(USDC, SAFE_ADDR, SAFE_ADDR, 9_000_000n);
    for (const [tx, log] of [[SELF_ETH, eth], [SELF_USDC, usdc]] as const) {
      h.script.logs.push({ ...log, blockNumber: hex(HEAD - 100), transactionHash: tx });
      h.script.receipts[tx] = { status: "0x1", blockNumber: hex(HEAD - 100), logs: [log] };
      h.script.txs[tx] = { to: SAFE_ADDR, from: DONOR, value: "0x0" };
    }
    await scanDonations(h.deps);
    for (const tx of [SELF_ETH, SELF_USDC]) {
      assertFalse((await h.db.donations.get(initiative.id, tx))?.status === "confirmed", tx);
    }
    assertEquals((await h.db.donations.get(initiative.id, TX_ETH))?.status, "confirmed");
  } finally {
    h.close();
  }
});

Deno.test("donation scan: a run out of time mid-range keeps the cursor before it", async () => {
  const { h, initiative } = await setup();
  try {
    const first = await scanDonations(h.deps);
    const NEW1 = "0x" + "d1".repeat(32);
    const NEW2 = "0x" + "d2".repeat(32);
    usdcTo(h, SAFE_ADDR, NEW1, HEAD + 10);
    usdcTo(h, SAFE_ADDR, NEW2, HEAD + 20);
    h.script.head += 100;
    const verify = h.deps.chain.verifyDonation;
    h.deps.chain.verifyDonation = async (...args) => {
      await new Promise((r) => setTimeout(r, 40));
      return await verify(...args);
    };
    const cut = await scanDonations(h.deps, { force: true, budgetMs: 20 });
    assertEquals(cut.state?.cursor, first.state?.cursor, "the unfinished range is not passed");
    assertEquals(cut.state?.behind, 100);
    h.deps.chain.verifyDonation = verify;
    const done = await scanDonations(h.deps, { force: true });
    assertEquals(done.state?.cursor, HEAD + 98);
    for (const tx of [NEW1, NEW2]) {
      assertEquals((await h.db.donations.get(initiative.id, tx))?.status, "confirmed");
    }
  } finally {
    h.close();
  }
});
