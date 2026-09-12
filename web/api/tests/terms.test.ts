import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  ADMIN,
  harness,
  j,
  loadContentFiles,
  PLAIN,
  SAFE_ADDR,
  seedContentLogos,
} from "./app-helpers.ts";
import { syntheticContentFiles } from "./fixtures.ts";
import { transferLog } from "./helpers.ts";
import { K } from "../db/keys.ts";
import { termsVersionId } from "../db/terms.ts";
import { TOKENS } from "../config.ts";
import type { TermsAcceptance, TermsVersion } from "../db/types.ts";

const TEXT_V1 = ("# Donation Terms\n\n" + "These are the donation terms. ".repeat(12)).trim();
const TEXT_V2 = TEXT_V1 + "\n\n## 15. A new section\n\nSomething material changed.";

Deno.test("terms: every published version is kept, current follows, older ones never change", async () => {
  const h = await harness();
  try {
    assertEquals((await h.req("/api/terms")).status, 404);
    const admin = await h.mint(ADMIN, true);
    const plain = await h.mint(PLAIN);
    const publish = (json: unknown, token = admin) =>
      h.req("/api/admin/terms", { method: "POST", token, json });

    assertEquals(
      (await publish({ text: TEXT_V1, effectiveDate: "2026-09-06" }, plain)).status,
      403,
    );
    assertEquals((await publish({ text: "too short", effectiveDate: "2026-09-06" })).status, 400);
    assertEquals((await publish({ text: TEXT_V1, effectiveDate: "Sep 6" })).status, 400);

    const p1 = await j(await publish({ text: TEXT_V1, effectiveDate: "2026-09-06" })) as {
      outcome: string;
      version: { id: string; effectiveDate: string; material: boolean; publishedAt: number };
    };
    assertEquals(p1.outcome, "published");
    assertEquals(p1.version.id, termsVersionId(TEXT_V1, "2026-09-06"));
    assert(/^[0-9a-f]{64}$/.test(p1.version.id));
    assertEquals(p1.version.material, false);

    // the current version, with its text
    const cur = await j(await h.req("/api/terms")) as unknown as TermsVersion;
    assertEquals(cur.id, p1.version.id);
    assertEquals(cur.effectiveDate, "2026-09-06");
    assertEquals(cur.text, TEXT_V1);

    // same text + same date = same version, nothing rewritten
    h.clock.now += 100;
    const again = await j(
      await publish({ text: TEXT_V1, effectiveDate: "2026-09-06" }),
    ) as typeof p1;
    assertEquals(again.outcome, "existing");
    assertEquals(again.version.publishedAt, p1.version.publishedAt);

    // a new version becomes current; the old one is still there, unchanged
    const p2 = await j(
      await publish({ text: TEXT_V2, effectiveDate: "2026-10-01", material: true }),
    ) as typeof p1;
    assertEquals(p2.outcome, "published");
    assert(p2.version.id !== p1.version.id);
    assertEquals(p2.version.material, true);
    assertEquals(
      ((await j(await h.req("/api/terms"))) as unknown as TermsVersion).id,
      p2.version.id,
    );
    const list = await j(await h.req("/api/terms/versions")) as {
      current: string;
      versions: Record<string, unknown>[];
    };
    assertEquals(list.current, p2.version.id);
    assertEquals(list.versions.map((v) => v.effectiveDate), ["2026-10-01", "2026-09-06"]);
    assertEquals("text" in list.versions[0], false);
    const old = await j(
      await h.req("/api/terms/versions/" + p1.version.id),
    ) as unknown as TermsVersion;
    assertEquals(old.text, TEXT_V1);
    assertEquals(old.publishedAt, p1.version.publishedAt);
    const stored = (await h.kv.get<TermsVersion>(K.termsVersion(p1.version.id))).value!;
    assertEquals(stored.text, TEXT_V1);
    assertEquals((await h.req("/api/terms/versions/" + "f".repeat(64))).status, 404);
    assertEquals((await h.req("/api/terms/versions/../etc")).status, 404);
  } finally {
    h.close();
  }
});

Deno.test("terms: one immutable acceptance record per acceptance, the tx hash attached once", async () => {
  const h = await harness();
  try {
    for (const version of ["", "not a version", "x".repeat(65), "../etc"]) {
      const bad = await h.req("/api/terms/accept", { method: "POST", json: { version } });
      assertEquals(bad.status, 400, JSON.stringify(version));
    }
    const badAddr = await h.req("/api/terms/accept", {
      method: "POST",
      json: { version: "2026-09-06", address: "0x1234" },
    });
    assertEquals(badAddr.status, 400);

    // anonymous, then with a wallet: every acceptance is its own record
    const ids: string[] = [];
    for (
      const json of [
        { version: "2026-09-06" },
        { version: "2026-09-06", address: PLAIN },
        { version: "2026-09-06", address: PLAIN.toLowerCase() },
      ]
    ) {
      const res = await j(await h.req("/api/terms/accept", { method: "POST", json })) as {
        ok: boolean;
        acceptanceId: string;
      };
      assert(res.ok);
      assert(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(res.acceptanceId), res.acceptanceId);
      ids.push(res.acceptanceId);
    }
    assertEquals(new Set(ids).size, 3);
    const rec = (await h.kv.get<TermsAcceptance>(K.termsAcceptance(ids[1]))).value!;
    assertEquals(rec.version, "2026-09-06");
    assertEquals(rec.address, PLAIN);
    assertEquals(rec.acceptedAt, new Date(h.clock.now * 1000).toISOString());
    assertEquals(rec.txHash, null);
    // the per-address index keeps the first acceptance of that wallet
    const byAddr = (await h.kv.get<TermsAcceptance>(K.termsAcceptByAddr("2026-09-06", PLAIN)))
      .value!;
    assertEquals(byAddr.id, ids[1]);
    let rows = 0;
    for await (const _ of h.kv.list({ prefix: ["terms_accept", "2026-09-06"] })) rows++;
    assertEquals(rows, 3);

    // a donation confirm attaches the tx hash to the record, once
    const admin = await h.mint(ADMIN, true);
    await seedContentLogos(h);
    await h.req("/api/admin/sync-content", {
      method: "POST",
      token: admin,
      json: { files: await loadContentFiles() },
    });
    const first = (await h.db.rfps.list(["approved"]))[0];
    await h.db.rfps.update(first.id, { safeAddress: SAFE_ADDR });
    const tx = "0x" + "cd".repeat(32);
    h.script.receipts[tx] = {
      status: "0x1",
      blockNumber: "0x100",
      logs: [transferLog(TOKENS.USDC[0], PLAIN, SAFE_ADDR, 100_000_000n)],
    };
    assertEquals(
      (await h.req("/api/donate/confirm", {
        method: "POST",
        json: { slug: first.slug, txHash: tx, acceptanceId: "not-a-ulid" },
      })).status,
      400,
    );
    h.clock.now += 60;
    const conf = await j(
      await h.req("/api/donate/confirm", {
        method: "POST",
        json: { slug: first.slug, txHash: tx, acceptanceId: ids[1] },
      }),
    );
    assertEquals(conf.status, "confirmed");
    const linked = (await h.kv.get<TermsAcceptance>(K.termsAcceptance(ids[1]))).value!;
    assertEquals(linked.txHash, tx);
    assertEquals(linked.acceptedAt, rec.acceptedAt);
    assertEquals(linked.address, PLAIN);
    const donation = (await h.db.donations.get(first.id, tx))!;
    assertEquals(donation.acceptanceId, ids[1]);
    assertEquals(donation.termsVersion, "2026-09-06");

    // a second confirm (status poll, another tx) never rewrites the record
    const tx2 = "0x" + "ef".repeat(32);
    h.script.receipts[tx2] = {
      status: "0x1",
      blockNumber: "0x101",
      logs: [transferLog(TOKENS.USDC[0], PLAIN, SAFE_ADDR, 5_000_000n)],
    };
    await h.req("/api/donate/confirm", {
      method: "POST",
      json: { slug: first.slug, txHash: tx2, acceptanceId: ids[1] },
    });
    const still = (await h.kv.get<TermsAcceptance>(K.termsAcceptance(ids[1]))).value!;
    assertEquals(still.txHash, tx);
    assertEquals(await h.db.terms.linkTx(ids[1], tx2), "already");
    assertEquals(await h.db.terms.linkTx("01ARZ3NDEKTSV4RRFFQ69G5FAV", tx2), "missing");

    // the log never leaves through a public route
    assertEquals((await h.req("/api/terms/acceptances")).status, 404);
    assertEquals((await h.req("/api/terms/versions/" + ids[1])).status, 404);
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
