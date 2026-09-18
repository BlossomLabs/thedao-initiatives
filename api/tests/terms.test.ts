import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  ADMIN,
  type Harness,
  harness,
  j,
  ORIGIN,
  PLAIN,
  SAFE_ADDR,
  testConnection,
} from "./app-helpers.ts";
import { syntheticContentFiles } from "./fixtures.ts";
import { transferLog } from "./helpers.ts";
import { CHAIN_ID, SESSION_REAUTH_SECS, TOKENS } from "../config.ts";
import { K } from "../db/keys.ts";
import { publishedDonationTerms } from "../services/donation-terms.ts";
import { retryDonationMatches } from "../services/donation-matching.ts";

const TX = "0x" + "aa".repeat(32);
const TX2 = "0x" + "bb".repeat(32);

async function setup() {
  const h = await harness();
  const rfp = await h.db.rfps.insert({
    title: "Community initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
    proposer: PLAIN,
  });
  const versions = await publishedDonationTerms();
  const version =
    [...versions].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0].id;
  const payload = {
    slug: rfp.slug,
    initiativeId: rfp.id,
    recipient: SAFE_ADDR,
    chainId: CHAIN_ID,
    agreed: true,
    version,
    method: "wallet",
    wallet: { address: PLAIN, token: TOKENS.USDC[0], amountRaw: "25000000" },
  };
  let cookie = "";
  const accept = async (patch: Record<string, unknown> = {}) => {
    const response = await h.req("/api/donate/accept", {
      method: "POST",
      headers: { cookie },
      json: { ...payload, ...patch },
    });
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    return response;
  };
  const confirm = (
    attemptId?: unknown,
    extra: Record<string, unknown> = {},
    cookieOverride = cookie,
  ) =>
    h.req("/api/donate/confirm", {
      method: "POST",
      headers: { cookie: cookieOverride },
      json: {
        slug: rfp.slug,
        initiativeId: rfp.id,
        txHash: TX,
        ...(attemptId ? { attemptId } : {}),
        ...extra,
      },
    });
  const paid = (
    logs = [transferLog(TOKENS.USDC[0], PLAIN, SAFE_ADDR, 25_000_000n)],
    block = "0x3e9",
  ) => {
    h.script.head = 1005;
    h.script.receipts[TX] = { status: "0x1", blockNumber: block, logs };
  };
  return { h, rfp, payload, accept, confirm, paid, cookie: () => cookie };
}

Deno.test("checkbox: records server time before transfer and correlates without authentication or signature", async () => {
  const { h, accept, confirm, paid } = await setup();
  try {
    const response = await accept();
    assertEquals(response.status, 200);
    assertStringIncludes(response.headers.get("set-cookie")!, "HttpOnly; SameSite=Lax");
    const { attemptId } = await j(response);
    const row = await h.db.terms.get(String(attemptId));
    assertEquals(row?.recordedAt, h.clock.now);
    assertEquals(row?.evidence, "browser-checkbox-v1");
    assertEquals(row?.donorAuthenticated, false);
    paid();
    assertEquals((await j(await confirm(attemptId))).status, "confirmed");
    const link = await h.db.terms.association(String(attemptId));
    assertEquals(link?.state, "matched");
    assertEquals(link?.evidence, "wallet-flow-correlated");
    assertEquals(link?.donorAuthenticated, false);
    h.clock.now += 10;
    await confirm(attemptId);
    assertEquals(await h.db.terms.get(String(attemptId)), row);
    assertEquals(await h.db.terms.association(String(attemptId)), link);
    assertEquals((await confirm(attemptId, { txHash: TX2 })).status, 409);
  } finally {
    h.close();
  }
});

Deno.test("checkbox: rejects unknown/future versions, client timestamps, unchecked consent and malformed intents", async () => {
  const { h, payload, accept } = await setup();
  try {
    const patches = [
      { version: "f".repeat(64) },
      { agreed: false },
      { recordedAt: 1 },
      { acceptedAt: "2026-09-01" },
      { chainId: 10 },
      { recipient: ADMIN },
      { method: "bogus" },
      { wallet: { ...payload.wallet, afterBlock: 0 } },
      { wallet: { ...payload.wallet, amountRaw: "1e6" } },
      { wallet: { ...payload.wallet, amountRaw: (2n ** 256n).toString() } },
      { wallet: { ...payload.wallet, address: "bad" } },
      { wallet: { ...payload.wallet, token: ADMIN } },
    ];
    for (const patch of patches) {
      assert([400, 409].includes((await accept(patch)).status), JSON.stringify(patch));
    }
    h.clock.now = Date.parse("2026-09-01T00:00:00Z") / 1000;
    assertEquals((await accept()).status, 400);
    assertEquals((await h.kv.list({ prefix: ["checkbox_acceptance"] }).next()).done, true);
  } finally {
    h.close();
  }
});

Deno.test("checkbox: exchange fields are independently optional and private; hash is only visitor-reported", async () => {
  const { h, accept, confirm, paid, cookie } = await setup();
  try {
    for (const details of [{}, { name: "Donor" }, { amount: "12.50" }, { currency: "USDC" }]) {
      const response = await accept({ method: "exchange", wallet: undefined, details });
      assertEquals(response.status, 200);
      const id = String((await j(response)).attemptId);
      assertEquals((await h.db.terms.get(id))?.wallet, undefined);
      assertEquals((await h.req("/api/donate/attempt/" + id)).status, 403);
      assertEquals(
        (await h.req("/api/donate/attempt/" + id, { headers: { cookie: cookie() } })).status,
        200,
      );
      paid();
      await confirm(id);
      const link = await h.db.terms.association(id);
      assertEquals(link?.state, "matched");
      assertEquals(link?.evidence, "visitor-reported");
      assertEquals(link?.donorAuthenticated, false);
    }
    const publicBody = await j(await h.req("/api/donate/status/" + TX));
    assertEquals(publicBody.acceptance, undefined);
    assertEquals(publicBody.association, undefined);
  } finally {
    h.close();
  }
});

Deno.test("checkbox: other sessions cannot attach or read; a forged first claim cannot block another attempt", async () => {
  const { h, accept, confirm, paid, cookie } = await setup();
  try {
    const first = String((await j(await accept())).attemptId);
    const firstCookie = cookie();
    const session = await h.db.terms.createSession();
    assertEquals((await confirm(first, {}, "donation=" + session.token)).status, 404);
    assertEquals(
      (await h.req("/api/donate/attempt/" + first, {
        headers: { cookie: "donation=" + session.token },
      })).status,
      404,
    );
    const forged = { ...await h.db.terms.get(first), marker: "historical" };
    await h.kv.set(K.termsAcceptance(TX), forged);
    await h.kv.set(K.verifiedTermsAcceptance(1, TX, "historical", SAFE_ADDR), {
      verification: "donor-signature-v1",
    });
    await confirm(first, {}, firstCookie); // nonexistent hash, independent pending claim
    const second = String((await j(await accept())).attemptId);
    paid();
    await confirm(second);
    assertEquals((await h.db.terms.association(second))?.state, "matched");
    assertEquals((await h.db.terms.association(first))?.state, "pending");
    assertEquals((await h.kv.get(K.termsAcceptance(TX))).value, forged);
    assertEquals(
      (await h.kv.get(K.verifiedTermsAcceptance(1, TX, "historical", SAFE_ADDR))).value,
      { verification: "donor-signature-v1" },
    );
    assertEquals((await confirm(undefined, { terms: { version: "f".repeat(64) } })).status, 400);
  } finally {
    h.close();
  }
});

Deno.test("checkbox: pending/RPC failures queue matching and server retries survive browser closure and prior accounting", async () => {
  const { h, rfp, accept, confirm, paid } = await setup();
  try {
    const id = String((await j(await accept())).attemptId);
    paid();
    await confirm(); // accounting was already confirmed by an indexer or another visitor
    const verify = h.deps.chain.verifyDonation;
    h.deps.chain.verifyDonation = () => Promise.reject(new Error("RPC down"));
    assertEquals((await confirm(id)).status, 500);
    assertEquals((await h.db.terms.association(id))?.state, "pending");
    h.deps.chain.verifyDonation = verify;
    await retryDonationMatches(h.db, h.deps.chain, rfp.id);
    assertEquals((await h.db.terms.association(id))?.state, "matched");
    assertEquals((await h.db.terms.pending(rfp.id)).length, 0);
  } finally {
    h.close();
  }
});

Deno.test("checkbox: mismatched sender, amount, token, older transfers and ambiguous receipts remain unmatched", async () => {
  const scenarios = [
    [transferLog(TOKENS.USDC[0], ADMIN, SAFE_ADDR, 25_000_000n)],
    [transferLog(TOKENS.USDC[0], PLAIN, SAFE_ADDR, 26_000_000n)],
    [transferLog(TOKENS.USDT[0], PLAIN, SAFE_ADDR, 25_000_000n)],
    [
      transferLog(TOKENS.USDC[0], PLAIN, SAFE_ADDR, 10_000_000n),
      transferLog(TOKENS.USDC[0], ADMIN, SAFE_ADDR, 15_000_000n),
    ],
    [transferLog(TOKENS.USDC[0], PLAIN, SAFE_ADDR, 25_000_000n)],
  ];
  for (const [index, logs] of scenarios.entries()) {
    const { h, accept, confirm, paid } = await setup();
    try {
      const id = String((await j(await accept())).attemptId);
      paid(logs, index === 4 ? "0x10" : "0x3e9");
      await confirm(id);
      assertEquals((await h.db.terms.association(id))?.state, "unmatched");
    } finally {
      h.close();
    }
  }
});

Deno.test("checkbox: missing, reverted, shallow and wrong-recipient transfers never match", async () => {
  for (const mode of ["missing", "reverted", "shallow", "recipient"]) {
    const { h, accept, confirm, paid } = await setup();
    try {
      const id = String((await j(await accept())).attemptId);
      if (mode === "reverted") {
        h.script.receipts[TX] = { status: "0x0", blockNumber: "0x3e9", logs: [] };
      }
      if (mode === "shallow") {
        paid();
        h.script.head = 1000;
      }
      if (mode === "recipient") paid([transferLog(TOKENS.USDC[0], PLAIN, ADMIN, 25_000_000n)]);
      await confirm(id);
      assertEquals(
        (await h.db.terms.association(id))?.state,
        ["missing", "shallow"].includes(mode) ? "pending" : "unmatched",
      );
    } finally {
      h.close();
    }
  }
});

Deno.test("checkbox: forged origins, form posts, stale scopes and expired sessions are rejected", async () => {
  const { h, rfp, payload, accept, confirm, cookie } = await setup();
  try {
    for (const origin of [undefined, "null", "https://attacker.test"]) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (origin) headers.origin = origin;
      const res = await h.app.request("http://api.test/api/donate/accept", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      }, testConnection());
      assertEquals(res.status, 403);
    }
    const form = await h.app.request("http://api.test/api/donate/accept", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "text/plain" },
      body: JSON.stringify(payload),
    }, testConnection());
    assertEquals(form.status, 415);
    const id = String((await j(await accept())).attemptId);
    const forged = await h.app.request("http://api.test/api/donate/confirm", {
      method: "POST",
      headers: { cookie: cookie(), "content-type": "application/json" },
      body: JSON.stringify({ slug: rfp.slug, txHash: TX, attemptId: id }),
    }, testConnection());
    assertEquals(forged.status, 403);
    await h.db.rfps.update(rfp.id, { safeAddress: ADMIN });
    assertEquals((await confirm(id)).status, 409);
    await h.db.rfps.update(rfp.id, { safeAddress: SAFE_ADDR });
    h.clock.now += 7 * 86400 + 1;
    assertEquals((await confirm(id)).status, 403);
  } finally {
    h.close();
  }
});

Deno.test("checkbox: direct confirmations credit transfers without inventing acceptance", async () => {
  const { h, confirm, paid } = await setup();
  try {
    paid();
    assertEquals((await j(await confirm())).status, "confirmed");
    assertEquals((await h.kv.list({ prefix: ["checkbox_acceptance"] }).next()).done, true);
  } finally {
    h.close();
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
    // Private contacts need a recent signature, not just a live cookie.
    h.clock.now += SESSION_REAUTH_SECS;
    const stale = await h.req("/api/admin/leads", { token: admin });
    assertEquals(stale.status, 403);
    assertEquals((await j(stale)).reauthenticate, true);
  } finally {
    h.close();
  }
});

Deno.test("checkbox: secure cookie is separate from login and oversized requests are refused", async () => {
  const { h, payload } = await setup();
  try {
    const res = await h.app.request("https://api.test/api/donate/accept", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, testConnection());
    assertEquals(res.status, 200);
    assertStringIncludes(res.headers.get("set-cookie")!, "__Host-donation=");
    assertStringIncludes(res.headers.get("set-cookie")!, "; Secure");
    assertEquals((await j(res)).token, undefined);
    const oversized = await h.req("/api/donate/accept", {
      method: "POST",
      json: { ...payload, padding: "a".repeat(9000) },
    });
    assertEquals(oversized.status, 413);
  } finally {
    h.close();
  }
});

Deno.test("checkbox: native ETH matches and expired pending associations stop retrying", async () => {
  const { h, rfp, accept, confirm, paid } = await setup();
  try {
    const raw = "10000000000000000";
    const id = String(
      (await j(await accept({ wallet: { address: PLAIN, token: "native", amountRaw: raw } })))
        .attemptId,
    );
    paid([]);
    h.script.txs[TX] = { from: PLAIN, to: SAFE_ADDR, value: "0x" + BigInt(raw).toString(16) };
    await confirm(id);
    assertEquals((await h.db.terms.association(id))?.state, "matched");
    const pending = String((await j(await accept())).attemptId);
    await confirm(pending, { txHash: TX2 });
    h.clock.now += 7 * 86400 + 1;
    await retryDonationMatches(h.db, h.deps.chain, rfp.id);
    assertEquals((await h.db.terms.association(pending))?.state, "expired");
    assert(await h.db.terms.get(pending));
  } finally {
    h.close();
  }
});
