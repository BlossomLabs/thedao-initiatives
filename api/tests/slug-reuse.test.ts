import { assert, assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { createDb } from "../db/mod.ts";
import type { Initiative } from "../db/types.ts";
import { K } from "../db/keys.ts";
import { safeDeployCalldata } from "../chain/safe.ts";
import { SIGNERS } from "./helpers.ts";
import { ADMIN, deploySafe, harness, j, proposerToken, SAFE_ADDR } from "./app-helpers.ts";
import { minimalSubmission, revisionBody, syntheticContentFiles } from "./fixtures.ts";
import { syncContent } from "../services/content.ts";

const reclaim = { reclaimArchivedSlug: true };
const statuses = ["pending", "approved", "rejected", "archived"] as const;

/** Interleave a real competing write immediately before a transaction commits,
 * or fail the commit entirely. The wrapped operation still uses real KV checks. */
function interceptCommits(kv: Deno.Kv, before: () => Promise<boolean>): Deno.Kv {
  return new Proxy(kv, {
    get(target, key) {
      if (key === "atomic") {
        return () => {
          const op = target.atomic();
          const wrapped: Deno.AtomicOperation = new Proxy(op, {
            get(target, key) {
              if (key === "commit") {
                return async () => await before() ? target.commit() : { ok: false };
              }
              const value = Reflect.get(target, key);
              return typeof value === "function"
                ? (...args: unknown[]) => {
                  const result = value.apply(target, args);
                  return result === target ? wrapped : result;
                }
                : value;
            },
          });
          return wrapped;
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

Deno.test("slug transfer preserves legacy deployment, source identity, and all attached records", async () => {
  using kv = await Deno.openKv(":memory:");
  const db = createDb(kv);
  const old = await db.initiatives.insert({
    title: "My project",
    status: "archived",
    safeAddress: SAFE_ADDR,
    paidOutUsd: 42,
  });
  // Existing production rows predate the deployment key and source index.
  const legacy = { ...old };
  delete legacy.safeDeploymentKey;
  await kv.set(K.initiative(old.id), legacy);
  const attached = [K.pledge(old.id, "p"), K.donation(old.id, "tx"), K.comment(old.id, "c")];
  for (const key of attached) await kv.set(key, { rfpId: old.id, evidence: key[0] });
  const rev = await db.revisions.get(old.id, 1);
  const next = await db.initiatives.insert({ title: old.title }, undefined, undefined, reclaim);
  const archived = (await db.initiatives.get(old.id))!;
  assertEquals(next.slug, "my-project");
  assertEquals(archived.slug, `my-project-archived-${old.id.toLowerCase()}`);
  assertEquals(archived, {
    ...legacy,
    slug: archived.slug,
    archiveSlug: archived.slug,
    safeDeploymentKey: old.slug,
  });
  assertEquals((await db.initiatives.bySlug(next.slug))?.id, next.id);
  assertEquals((await db.initiatives.bySlug(archived.slug))?.id, old.id);
  assertEquals((await db.initiatives.bySourceSlug(old.slug))?.id, old.id);
  assertEquals((await db.initiatives.bySafe(SAFE_ADDR))?.id, old.id);
  assertEquals(await db.revisions.get(old.id, 1), rev);
  for (const key of attached) {
    assertEquals((await kv.get(key)).value, { rfpId: old.id, evidence: key[0] });
  }
  assertEquals(next.safeAddress, "");
  assertNotEquals(next.safeDeploymentKey, archived.safeDeploymentKey);
  assert(await db.initiatives.isReusedSlug(old.slug));
});

Deno.test("only an opted-in desired slug is reclaimable; archive URLs stay reserved", async () => {
  using kv = await Deno.openKv(":memory:");
  const db = createDb(kv);
  const old = await db.initiatives.insert({ title: "Project", status: "archived" });
  assertEquals((await db.initiatives.insert({ title: old.title })).slug, "project-2");
  await assertRejects(
    () => db.initiatives.insert({ title: old.title }, old.slug),
    Error,
    "already exists",
  );
  const archiveBase = `project-archived-${old.id.toLowerCase()}`;
  const occupied = await db.initiatives.insert({ title: "Occupied archive URL" }, archiveBase);
  const next = await db.initiatives.insert({ title: old.title }, undefined, undefined, reclaim);
  const archive = (await db.initiatives.get(old.id))!;
  assertEquals(archive.slug, `${archiveBase}-2`);
  assertEquals((await db.initiatives.bySlug(archiveBase))?.id, occupied.id);
  assertEquals(
    (await db.initiatives.insert({ title: archive.slug }, undefined, undefined, reclaim)).slug,
    `${archive.slug}-2`,
  );
  await db.initiatives.update(next.id, { status: "approved" });
  const suffix = (await db.initiatives.bySlug("project-2"))!;
  await db.initiatives.update(suffix.id, { status: "archived" });
  assertEquals(
    (await db.initiatives.insert({ title: old.title }, undefined, undefined, reclaim)).slug,
    "project-3",
  );
  assertEquals((await db.initiatives.get(suffix.id))?.slug, "project-2");
  await db.initiatives.update(next.id, { status: "rejected" });
  assertEquals(
    (await db.initiatives.insert({ title: old.title }, undefined, undefined, reclaim)).slug,
    "project-4",
  );
});

Deno.test("simultaneous claims have one clean URL; a competing unarchive cannot be overwritten", async () => {
  using kv = await Deno.openKv(":memory:");
  const db = createDb(kv);
  const old = await db.initiatives.insert({ title: "Concurrent project", status: "archived" });
  const rows = await Promise.all([
    db.initiatives.insert({ title: old.title }, undefined, undefined, reclaim),
    db.initiatives.insert({ title: old.title }, undefined, undefined, reclaim),
  ]);
  assertEquals(rows.map((r) => r.slug).sort(), ["concurrent-project", "concurrent-project-2"]);
  assertNotEquals(rows[0].id, rows[1].id);
  const racing = await db.initiatives.insert({ title: "Restoring project", status: "archived" });
  let once = true;
  const wrapped = createDb(interceptCommits(kv, async () => {
    if (once) {
      once = false;
      await db.initiatives.unarchive(racing.id);
    }
    return true;
  }));
  const loser = await wrapped.initiatives.insert(
    { title: racing.title },
    undefined,
    undefined,
    reclaim,
  );
  assertEquals(loser.slug, "restoring-project-2");
  assertEquals((await db.initiatives.get(racing.id))?.status, "approved");
  assertEquals((await db.initiatives.bySlug(racing.slug))?.id, racing.id);
  assertEquals(await db.initiatives.isReusedSlug(racing.slug), false);
});

Deno.test("failed transfer transactions leave no partial archive, source binding, or replacement", async () => {
  using kv = await Deno.openKv(":memory:");
  const db = createDb(kv);
  const old = await db.initiatives.insert({ title: "Failed project", status: "archived" });
  const failing = createDb(interceptCommits(kv, () => Promise.resolve(false)));
  await assertRejects(
    () => failing.initiatives.insert({ title: old.title }, undefined, undefined, reclaim),
    Error,
    "insertion conflict",
  );
  assertEquals(await db.initiatives.get(old.id), old);
  assertEquals((await db.initiatives.list([...statuses])).length, 1);
  assertEquals((await kv.get(K.initiativeBySourceSlug(old.slug))).value, null);
  assertEquals(await db.initiatives.isReusedSlug(old.slug), false);
  assertEquals(await db.initiatives.bySlug(`${old.slug}-archived-${old.id.toLowerCase()}`), null);
});

Deno.test("unarchive recalculates from title, skips occupied slugs, and preserves archive aliases", async () => {
  using kv = await Deno.openKv(":memory:");
  const db = createDb(kv);
  const old = await db.initiatives.insert({ title: "Restored project", status: "archived" });
  await db.initiatives.insert({ title: old.title }, undefined, undefined, reclaim);
  const archiveSlug = (await db.initiatives.get(old.id))!.slug;
  await db.initiatives.insert({ title: old.title, status: "archived" }); // -2 is occupied too
  const restored = await db.initiatives.unarchive(old.id);
  assertEquals(restored.slug, "restored-project-3");
  assertEquals(restored.status, "approved");
  assertEquals((await db.initiatives.bySlug(archiveSlug))?.id, old.id);
  assertEquals(restored.safeDeploymentKey, old.safeDeploymentKey);
  // Re-archive and claim the current URL: reuse the same permanent archive link.
  await db.initiatives.update(old.id, { status: "archived" });
  await db.initiatives.insert({ title: restored.slug }, undefined, undefined, reclaim);
  assertEquals((await db.initiatives.get(old.id))?.slug, archiveSlug);
  await db.initiatives.revise(old.id, { title: "A free new title", summary: "", details: "" }, {
    author: "",
    source: "admin",
  });
  assertEquals((await db.initiatives.unarchive(old.id)).slug, "a-free-new-title");
  assertEquals((await db.initiatives.bySlug(archiveSlug))?.id, old.id);
  assertEquals((await db.initiatives.bySourceSlug("restored-project"))?.id, old.id);
});

Deno.test("unarchive retries a competing claim and freezes legacy salt before releasing a URL", async () => {
  using kv = await Deno.openKv(":memory:");
  const db = createDb(kv);
  const old = await db.initiatives.insert({ title: "New title", status: "archived" }, "old-title");
  const legacy = { ...old };
  delete legacy.safeDeploymentKey;
  await kv.set(K.initiative(old.id), legacy);
  let once = true;
  const wrapped = createDb(interceptCommits(kv, async () => {
    if (once) {
      once = false;
      await db.initiatives.insert({ title: old.title });
    }
    return true;
  }));
  const restored = await wrapped.initiatives.unarchive(old.id);
  assertEquals(restored.slug, "new-title-2");
  assertEquals(restored.safeDeploymentKey, "old-title");
  assertEquals(await db.initiatives.bySlug("old-title"), null);
  assert(await db.initiatives.isReusedSlug("old-title"));
  assertEquals((await db.initiatives.bySourceSlug("old-title"))?.id, old.id);
});

Deno.test("content and backer resync keep the original ID across multiple replacements", async () => {
  const h = await harness();
  try {
    const original = syntheticContentFiles()[0];
    const file = {
      ...original,
      text: original.text.replace("goal: 600000", "backers:\n  Acme | $60\ngoal: 600000"),
    };
    assertEquals((await syncContent(h.db, [file])).created, 1);
    const old = (await h.db.initiatives.list(["approved"]))[0];
    await h.db.initiatives.update(old.id, { status: "archived" });
    const next = await h.db.initiatives.insert({ title: old.slug }, undefined, undefined, reclaim);
    await h.db.initiatives.update(next.id, { status: "archived" });
    const third = await h.db.initiatives.insert({ title: old.slug }, undefined, undefined, reclaim);
    const updated = file.text.replace("title:", "title: Updated ").replace(
      "Acme | $60",
      "Acme | $80",
    );
    const result = await syncContent(h.db, [{ ...file, text: updated }]);
    assertEquals(result.errors, []);
    assertEquals(result.updated, 1);
    assertEquals(result.backers, 1);
    assertEquals((await h.db.pledges.list(old.id))[0].amountUsd, 80);
    assertEquals((await h.db.initiatives.get(old.id))?.title.startsWith("Updated "), true);
    assertEquals((await h.db.initiatives.get(old.id))?.status, "archived");
    assertEquals(await h.db.initiatives.get(third.id), third);
    assertEquals((await h.db.initiatives.bySourceSlug(old.slug))?.id, old.id);
    assertEquals((await h.db.pledges.list(third.id)).length, 0);
    const imported = await h.db.initiatives.insert(
      { title: "Legacy imported", status: "archived" },
      "legacy-imported",
      { author: "", source: "import" },
      { createdAt: 1234 },
    );
    await h.db.initiatives.insert({ title: imported.title }, undefined, undefined, reclaim);
    assertEquals((await h.db.initiatives.bySourceSlug(imported.slug))?.id, imported.id);
    assertEquals(imported.safeDeploymentKey, "legacy-imported");
    assertEquals((await h.db.revisions.get(imported.id, 1))?.createdAt, 1234);
  } finally {
    h.close();
  }
});
Deno.test("submission reuses archived text and URL; approval and unarchive preserve both pages", async () => {
  const h = await harness();
  try {
    const token = await proposerToken(h);
    const admin = await h.mint(ADMIN, true);
    const body = minimalSubmission(1000);
    const submit = () => h.req("/api/initiatives", { method: "POST", token, json: body });
    const first = await submit();
    assertEquals(first.status, 201);
    const { slug } = await j(first) as { slug: string };
    const old = (await h.db.initiatives.bySlug(slug))!;
    assertEquals((await submit()).status, 400); // pending duplicate
    await h.db.initiatives.update(old.id, { status: "approved" });
    assertEquals((await submit()).status, 400); // approved duplicate
    await h.db.initiatives.update(old.id, { status: "archived" });
    const invalid = await h.req("/api/initiatives", {
      method: "POST",
      token,
      json: { ...body, summary: "Too short" },
    });
    assertEquals(invalid.status, 400);
    assertEquals((await h.db.initiatives.get(old.id))?.slug, slug);
    const replacement = await submit();
    assertEquals(replacement.status, 201);
    assertEquals((await j(replacement)).slug, slug);
    const next = (await h.db.initiatives.bySlug(slug))!;
    const archive = (await h.db.initiatives.get(old.id))!;
    assertNotEquals(next.id, old.id);
    assertEquals((await h.req(`/api/initiatives/${slug}`)).status, 404);
    assertEquals((await h.req(`/api/initiatives/${slug}`, { token })).status, 200);
    const archivedPage = await j(await h.req(`/api/initiatives/${archive.slug}`));
    assertEquals((archivedPage.initiative as Initiative).id, old.id);
    assert(!("safeDeploymentKey" in (archivedPage.initiative as object)));
    const status = (id: string, action: string) =>
      h.req(`/api/admin/initiatives/${id}/status`, {
        method: "POST",
        token: admin,
        json: { action },
      });
    await deploySafe(h, admin, next.id);
    assertEquals((await status(next.id, "approve")).status, 200);
    assertEquals((await h.req(`/api/initiatives/${slug}`)).status, 200);
    if (!(await h.db.initiatives.get(old.id))!.safeAddress) await deploySafe(h, admin, old.id);
    assertEquals((await status(old.id, "unarchive")).status, 200);
    assertEquals((await h.db.initiatives.get(old.id))?.slug, `${slug}-2`);
    assertEquals((await h.req(`/api/initiatives/${archive.slug}`)).status, 200);
    // Bulk restores go through the same allocator.
    await status(old.id, "archive");
    const bulk = await h.req("/api/admin/initiatives/bulk", {
      method: "POST",
      token: admin,
      json: { ids: [old.id], action: "unarchive" },
    });
    assertEquals(await j(bulk), { done: 1, failed: [] });
    assertEquals((await h.db.initiatives.get(old.id))?.slug, `${slug}-2`);
  } finally {
    h.close();
  }
});

Deno.test("reused URLs reject stale writes and admin slug actions; matching IDs and archive reads work", async () => {
  const h = await harness();
  try {
    const admin = await h.mint(ADMIN, true);
    const old = await h.db.initiatives.insert({ title: "Identity project", status: "archived" });
    const next = await h.db.initiatives.insert(
      { title: old.title, status: "approved" },
      undefined,
      undefined,
      reclaim,
    );
    const slug = next.slug;
    const writes = [
      { path: `/api/initiatives/${slug}`, method: "PATCH", json: { goal: "1000" } },
      {
        path: `/api/initiatives/${slug}/revisions`,
        method: "POST",
        json: {
          ...revisionBody(minimalSubmission(1000)),
          title: "Edited title",
          summary: "An updated summary that meets the forty character minimum.",
        },
      },
      {
        path: `/api/initiatives/${slug}/comments`,
        method: "POST",
        json: { type: "other", topic: "", body: "A comment", name: "Admin" },
      },
      {
        path: "/api/donate/confirm",
        method: "POST",
        json: { slug, txHash: "0x" + "12".repeat(32) },
      },
    ];
    for (const w of writes) {
      for (const identity of [{}, { initiativeId: old.id }]) {
        const res = await h.req(w.path, {
          method: w.method,
          token: admin,
          json: { ...w.json, ...identity },
        });
        assertEquals(res.status, 409, w.path);
      }
    }
    assertEquals(await h.db.initiatives.get(next.id), next);
    assertEquals((await h.db.comments.forInitiative(next.id)).length, 0);
    assertEquals((await h.db.donations.list(next.id)).length, 0);
    for (const w of writes.slice(0, 3)) {
      const res = await h.req(w.path, {
        method: w.method,
        token: admin,
        json: { ...w.json, initiativeId: next.id },
      });
      assert(res.status >= 200 && res.status < 300, `${w.path}: ${await res.text()}`);
    }
    // Matching donation identity passes the guard and reaches the missing-Safe check.
    assertEquals(
      (await h.req("/api/donate/confirm", {
        method: "POST",
        json: { ...writes[3].json, initiativeId: next.id },
      })).status,
      503,
    );
    const unsafeAdminActions = [
      { path: `/api/admin/initiatives/${slug}`, method: "PATCH", json: { sortRank: "1" } },
      {
        path: `/api/admin/initiatives/${slug}/status`,
        method: "POST",
        json: { action: "archive" },
      },
      { path: `/api/admin/initiatives/${slug}/safe-deploy-params`, method: "GET" },
    ];
    for (const w of unsafeAdminActions) {
      assertEquals((await h.req(w.path, { ...w, token: admin })).status, 409);
    }
    const params = async (id: string) =>
      await j(await h.req(`/api/admin/initiatives/${id}/safe-deploy-params`, { token: admin }));
    const oldParams = await params(old.id);
    assertEquals(oldParams.calldata, safeDeployCalldata(SIGNERS, old.safeDeploymentKey!));
    assertNotEquals(oldParams.calldata, (await params(next.id)).calldata);
    const archive = (await h.db.initiatives.get(old.id))!;
    assertEquals((await h.req(`/api/initiatives/${archive.slug}/revisions/1`)).status, 200);
    assertEquals((await h.req(`/api/initiatives/${archive.slug}/comments`)).status, 200);
    assertEquals((await h.req(`/initiative/${archive.slug}.md`)).status, 200);
  } finally {
    h.close();
  }
});
