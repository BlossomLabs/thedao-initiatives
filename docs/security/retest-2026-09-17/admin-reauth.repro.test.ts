/** Audit reproduction: passes when the remaining step-up gap is present. */
import { assertEquals } from "@std/assert";
import { ADMIN, harness, j } from "../../../api/tests/app-helpers.ts";
import { syntheticContentFiles } from "../../../api/tests/fixtures.ts";
import { SESSION_REAUTH_SECS } from "../../../api/config.ts";

Deno.test("REPRO: stale administrator can create an approved initiative through content sync", async () => {
  const h = await harness();
  try {
    const token = await h.mint(ADMIN, true);
    h.clock.now += SESSION_REAUTH_SECS + 1;
    const guarded = await h.req("/api/admin/initiatives/missing/status", {
      method: "POST", token, json: { action: "approve" },
    });
    assertEquals(guarded.status, 403);
    assertEquals((await j(guarded)).reauthenticate, true);
    const file = syntheticContentFiles()[0];
    const synced = await h.req("/api/admin/sync-content", {
      method: "POST", token, json: { files: [file] },
    });
    assertEquals(synced.status, 200);
    assertEquals((await j(synced)).created, 1);
    const row = await h.db.rfps.bySlug("synthetic-rfp");
    assertEquals(row?.status, "approved");
    assertEquals((await h.req("/api/initiatives/synthetic-rfp")).status, 200);
  } finally {
    h.close();
  }
});
