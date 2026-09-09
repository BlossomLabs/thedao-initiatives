import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { ADMIN, harness, j, loadContentFiles, PLAIN } from "./app-helpers.ts";
import { parseTermsFile } from "../services/content.ts";
import { K } from "../db/keys.ts";

const TERMS = "version: 2026-09-06\n\n# Donation Terms\n\n**Effective September 6, 2026.**\n";

Deno.test("terms file: version line is the gate version and leaves the body", () => {
  const t = parseTermsFile(TERMS);
  assertEquals(t.version, "2026-09-06");
  assert(t.body.startsWith("# Donation Terms"));
  let threw = false;
  try {
    parseTermsFile("# no version line\n");
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("terms: sync publishes, params carry the version, acceptance log dedupes per address", async () => {
  const h = await harness();
  try {
    assertEquals((await h.req("/api/terms")).status, 404);
    const admin = await h.mint(ADMIN, true);
    const files = [...(await loadContentFiles()), { name: "donation-terms.md", text: TERMS }];
    const res = await j(
      await h.req("/api/admin/sync-content", {
        method: "POST",
        token: admin,
        json: { files },
      }),
    );
    assertEquals(res.errors, []);

    const terms = await j(await h.req("/api/terms"));
    assertEquals(terms.version, "2026-09-06");
    assertStringIncludes(String(terms.body), "# Donation Terms");
    assertFalse(String(terms.body).includes("version:"));

    const params = await j(await h.req("/api/donate/params"));
    assertEquals(params.termsVersion, "2026-09-06");

    const bad = await h.req("/api/terms/accept", { method: "POST", json: { version: "old" } });
    assertEquals(bad.status, 400);
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
    const files = await loadContentFiles();
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
