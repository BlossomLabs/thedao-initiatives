import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ADMIN, type Harness, harness, j, PLAIN, SAFE_ADDR } from "./app-helpers.ts";
import { syntheticContentFiles } from "./fixtures.ts";
import { transferLog } from "./helpers.ts";
import { TOKENS } from "../config.ts";
import { K } from "../db/keys.ts";
import { sha256Hex } from "../lib/ids.ts";
import type { TermsAcceptance } from "../db/terms.ts";

// The terms document lives in the site bundle (content/donation-terms/*.md via
// app/data/terms.ts); the API only keeps one acceptance record per donation,
// written by the donate confirm and never changed.
const VERSION = sha256Hex("2026-09-06\n# Donation Terms");

async function setup() {
  const h = await harness();
  const rfp = await h.db.rfps.insert({
    title: "Community initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
    proposer: "0x5555555555555555555555555555555555555555",
  });
  const at = (offsetSecs = -60) => new Date((h.clock.now + offsetSecs) * 1000).toISOString();
  const confirm = (body: Record<string, unknown>) =>
    h.req("/api/donate/confirm", { method: "POST", json: { slug: rfp.slug, ...body } });
  const record = async (tx: string) =>
    (await h.kv.get<TermsAcceptance>(K.termsAcceptance(tx))).value;
  const paid = (tx: string) => {
    h.script.receipts[tx] = {
      status: "0x1",
      blockNumber: "0x10",
      logs: [transferLog(TOKENS.USDC[0], PLAIN, SAFE_ADDR, 25_000_000n)],
    };
  };
  return { h, rfp, at, confirm, record, paid };
}

Deno.test("terms: the old accept endpoint is gone", async () => {
  const h = await harness();
  try {
    assertEquals((await h.req("/api/terms")).status, 404);
    const r = await h.req("/api/terms/accept", { method: "POST", json: { version: VERSION } });
    assertEquals(r.status, 404);
  } finally {
    h.close();
  }
});

Deno.test("donate/confirm: one acceptance record per tx, checksummed, first write wins", async () => {
  const { h, at, confirm, record, paid } = await setup();
  try {
    const tx = "0x" + "aa".repeat(32);
    paid(tx);
    const acceptedAt = at();
    const ok = await confirm({
      txHash: tx.toUpperCase().replace("0X", "0x"),
      terms: { version: VERSION, acceptedAt, address: PLAIN.toLowerCase() },
    });
    assertEquals(ok.status, 200);
    assertEquals((await j(ok)).status, "confirmed");
    assertEquals(await record(tx), {
      txHash: tx,
      version: VERSION,
      address: PLAIN,
      acceptedAt,
      recordedAt: h.clock.now,
    });

    // a second confirm for the same tx changes nothing, whatever it claims
    h.clock.now += 100;
    const again = await confirm({
      txHash: tx,
      terms: { version: "b".repeat(64), acceptedAt: at() },
    });
    assertEquals(again.status, 200);
    assertEquals((await record(tx))!.version, VERSION);
    assertEquals((await record(tx))!.recordedAt, h.clock.now - 100);
    assertEquals(
      await h.db.terms.record({ txHash: tx, version: VERSION, address: "", acceptedAt }),
      false,
    );

    // no terms block: no record; the donation still confirms
    const tx2 = "0x" + "bb".repeat(32);
    paid(tx2);
    assertEquals((await j(await confirm({ txHash: tx2 }))).status, "confirmed");
    assertEquals(await record(tx2), null);

    // no wallet connected at the time: address is ""
    const tx3 = "0x" + "cc".repeat(32);
    paid(tx3);
    await confirm({ txHash: tx3, terms: { version: VERSION, acceptedAt: at() } });
    assertEquals((await record(tx3))!.address, "");

    // the record never leaves through a public route
    assertEquals((await h.req("/api/terms/acceptances")).status, 404);
  } finally {
    h.close();
  }
});

Deno.test("donate/confirm: a bad terms block is refused and writes nothing", async () => {
  const { h, at, confirm, record, paid } = await setup();
  try {
    const tx = "0x" + "dd".repeat(32);
    paid(tx);
    const good = { version: VERSION, acceptedAt: at(), address: PLAIN };
    const bad: [string, unknown][] = [
      ["not an object", "x"],
      ["date version", { ...good, version: "2026-09-06" }],
      ["short version", { ...good, version: VERSION.slice(1) }],
      ["uppercase version", { ...good, version: VERSION.toUpperCase() }],
      ["missing acceptedAt", { version: VERSION }],
      ["prose acceptedAt", { ...good, acceptedAt: "yesterday" }],
      ["local acceptedAt", { ...good, acceptedAt: "2026-09-06T10:00:00+02:00" }],
      ["future acceptedAt", { ...good, acceptedAt: at(600) }],
      ["bad address", { ...good, address: "0x1234" }],
    ];
    for (const [what, terms] of bad) {
      const r = await confirm({ txHash: tx, terms });
      assertEquals(r.status, 400, what);
      assertEquals((await j(r)).error, "bad terms acceptance", what);
      assertEquals(await record(tx), null, what);
      assertEquals(await h.db.donations.byHash(tx), null, what);
    }
    // a malformed tx hash cannot key a record either
    const r = await confirm({ txHash: "0x12", terms: good });
    assertEquals(r.status, 400);
    assertEquals((await j(r)).error, "bad terms acceptance");
    // ...and a few minutes of clock skew is fine
    assertEquals(
      (await confirm({ txHash: tx, terms: { ...good, acceptedAt: at(200) } })).status,
      200,
    );
    assert(await record(tx));
  } finally {
    h.close();
  }
});

Deno.test("donate/confirm: the record is written before the chain is consulted", async () => {
  const { h, at, confirm, record } = await setup();
  try {
    // a tx the chain has never seen: pending donation, record present
    const tx = "0x" + "ee".repeat(32);
    const r = await confirm({ txHash: tx, terms: { version: VERSION, acceptedAt: at() } });
    assertEquals(r.status, 200);
    assertEquals((await j(r)).status, "pending");
    assert(await record(tx));
  } finally {
    h.close();
  }
  // the chain is down (no token is readable): 503, record still present
  const down = await setup();
  try {
    for (const sym of Object.keys(TOKENS)) down.h.script.brokenTokens.add(sym);
    const tx = "0x" + "ff".repeat(32);
    const r = await down.confirm({
      txHash: tx,
      terms: { version: VERSION, acceptedAt: down.at() },
    });
    assertEquals(r.status, 503);
    assert(await down.record(tx));
  } finally {
    down.h.close();
  }
});

Deno.test("admin leads: only initiatives with funders, private, admin-only", async () => {
  const h: Harness = await harness();
  try {
    const admin = await h.mint(ADMIN, true);
    const files = syntheticContentFiles();
    await h.req("/api/admin/sync-content", { method: "POST", token: admin, json: { files } });
    const all = await h.db.rfps.list(["approved"]);
    await h.db.rfps.update(all[0].id, {
      funders: "Acme | they ship it | know them well | yes | $50k",
      contact: "a@example.com",
    });
    assertEquals((await h.req("/api/admin/leads")).status, 401);
    assertEquals((await h.req("/api/admin/leads", { token: await h.mint(PLAIN) })).status, 403);
    const leads = await j(await h.req("/api/admin/leads", { token: admin }));
    const rows = leads.rows as { id: string; funders: string; contact: string }[];
    assertEquals(rows.length, 1);
    assertEquals(rows[0].id, all[0].id);
    assertStringIncludes(rows[0].funders, "Acme");
    assertEquals(rows[0].contact, "a@example.com");
  } finally {
    h.close();
  }
});
