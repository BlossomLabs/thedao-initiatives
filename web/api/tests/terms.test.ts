import { assertEquals, assertStringIncludes } from "@std/assert";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";
import { syntheticContentFiles } from "./fixtures.ts";
import { K } from "../db/keys.ts";

// The terms document lives in the site bundle (content/donation-terms.md via
// app/data/terms.ts); the API only keeps the acceptance log.
Deno.test("terms: no document in the API, acceptance log dedupes per address", async () => {
  const h = await harness();
  try {
    assertEquals((await h.req("/api/terms")).status, 404);

    for (const version of ["", "not a version", "x".repeat(41), "../etc"]) {
      const bad = await h.req("/api/terms/accept", { method: "POST", json: { version } });
      assertEquals(bad.status, 400, JSON.stringify(version));
    }
    const badAddr = await h.req("/api/terms/accept", {
      method: "POST",
      json: { version: "2026-09-06", address: "0x1234" },
    });
    assertEquals(badAddr.status, 400);

    // anonymous: always appended
    for (let i = 0; i < 2; i++) {
      assertEquals(
        (await h.req("/api/terms/accept", { method: "POST", json: { version: "2026-09-06" } }))
          .status,
        200,
      );
    }
    // per wallet: once per (address, version), case-insensitive
    for (const a of [PLAIN, PLAIN.toLowerCase()]) {
      const ok = await h.req("/api/terms/accept", {
        method: "POST",
        json: { version: "2026-09-06", address: a },
      });
      assertEquals(ok.status, 200);
    }
    let rows = 0;
    for await (const _ of h.kv.list({ prefix: ["terms_accept", "2026-09-06"] })) rows++;
    assertEquals(rows, 3);
    const byAddr = await h.kv.get(K.termsAcceptByAddr("2026-09-06", PLAIN));
    assertEquals((byAddr.value as { address: string }).address, PLAIN);

    // the log never leaves through a public route
    assertEquals((await h.req("/api/terms/acceptances")).status, 404);
  } finally {
    h.close();
  }
});

Deno.test("admin leads: only initiatives with funders, private, admin-only", async () => {
  const h = await harness();
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
