import { assertEquals } from "@std/assert";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";
import { syntheticContentFiles } from "./fixtures.ts";
import { SESSION_REAUTH_SECS } from "../config.ts";
Deno.test("sensitive admin changes reject stale authentication before any side effect", async () => {
  const h = await harness();
  try {
    const stale = await h.mint(ADMIN, true);
    h.clock.now += SESSION_REAUTH_SECS;
    for (
      const [path, method, json] of [
        ["/admins", "POST", { address: PLAIN }],
        [`/admins/${PLAIN}`, "DELETE", {}],
        ["/initiatives/missing/status", "POST", { action: "approve" }],
        ["/initiatives/bulk", "POST", { ids: ["missing"], action: "approve" }],
        ["/initiatives/missing/safe-confirm", "POST", {}],
        // Content sync publishes approved initiatives, so it steps up like approval does.
        ["/sync-content", "POST", { files: [syntheticContentFiles()[0]] }],
        ["/maintenance/enter", "POST", {}],
        ["/maintenance/exit", "POST", {}],
        ["/restore", "POST", { backup: {} }],
      ] as const
    ) {
      const res = await h.req(`/api/admin${path}`, { method, token: stale, json });
      assertEquals(res.status, 403, path);
      assertEquals((await j(res)).reauthenticate, true);
    }
    assertEquals(await h.deps.admins.isAdmin(PLAIN), false);
    assertEquals(await h.db.initiatives.bySlug("synthetic-rfp"), null);
    const initiative = await h.db.initiatives.insert({
      title: "Recent authorization check",
      status: "approved",
    });
    for (const json of [{ paidOutUsd: 100 }, { proposer: PLAIN }]) {
      const res = await h.req(`/api/admin/initiatives/${initiative.id}`, {
        method: "PATCH",
        token: stale,
        json,
      });
      assertEquals(res.status, 403);
      assertEquals((await j(res)).reauthenticate, true);
      assertEquals(await h.db.initiatives.get(initiative.id), initiative);
    }
    // Read-only access remains available; fresh admin authentication can perform the change.
    assertEquals((await h.req("/api/admin/admins", { token: stale })).status, 200);
    // The backup carries every private field, so downloading it steps up too.
    const backup = await h.req("/api/admin/backup", { token: stale });
    assertEquals(backup.status, 403);
    assertEquals((await j(backup)).reauthenticate, true);
    const fresh = await h.mint(ADMIN, true);
    assertEquals(
      (await h.req("/api/admin/admins", { method: "POST", token: fresh, json: { address: PLAIN } }))
        .status,
      200,
    );
    assertEquals(await h.deps.admins.isAdmin(PLAIN), true);
    const synced = await h.req("/api/admin/sync-content", {
      method: "POST",
      token: fresh,
      json: { files: [syntheticContentFiles()[0]] },
    });
    assertEquals(synced.status, 200);
    assertEquals((await j(synced)).created, 1);
    assertEquals((await h.db.initiatives.bySlug("synthetic-rfp"))?.status, "approved");
    const ordinary = await h.mint("0x3333333333333333333333333333333333333333");
    const denied = await h.req("/api/admin/admins", {
      method: "POST",
      token: ordinary,
      json: { address: PLAIN },
    });
    assertEquals(denied.status, 403);
    assertEquals((await j(denied)).reauthenticate, undefined);
  } finally {
    h.close();
  }
});
