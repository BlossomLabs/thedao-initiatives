/** Proposer edits and the public revision history. */
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ADMIN, deploySafe, harness, j, PLAIN, proposerToken } from "./app-helpers.ts";
import type { Initiative, Revision } from "../db/types.ts";
import { minimalSubmission, revisionBody, syntheticContentFiles } from "./fixtures.ts";

const OTHER = "0x2222222222222222222222222222222222222222";
const GOOD = minimalSubmission(25000);
type Meta = { n: number; author: string; source: string; archived: boolean; createdAt: number };
type Page = { initiative: { title: string; revision: number }; revisions: Meta[] };

/** Submit as PLAIN and return the slug, the row and the tokens involved. */
async function submitted(h: Awaited<ReturnType<typeof harness>>, approve = true) {
  const token = await proposerToken(h);
  const admin = await h.mint(ADMIN, true);
  const res = await h.req("/api/initiatives", { method: "POST", token, json: GOOD });
  assertEquals(res.status, 201);
  const { slug } = await j(res) as { slug: string };
  const row = (await h.db.initiatives.bySlug(slug))!;
  if (approve) {
    await deploySafe(h, admin, row.id);
    await h.req(`/api/admin/initiatives/${row.id}/status`, {
      method: "POST",
      token: admin,
      json: { action: "approve" },
    });
  }
  return { token, admin, slug, id: row.id };
}

Deno.test("submit writes revision 1; the proposer's edit goes live as revision 2", async () => {
  const h = await harness();
  const { token, slug } = await submitted(h);
  const page = await j(await h.req("/api/initiatives/" + slug)) as unknown as Page;
  assertEquals(page.initiative.revision, 1);
  assertEquals(page.revisions.map((r) => [r.n, r.author, r.source, r.archived]), [
    [1, PLAIN, "submit", false],
  ]);

  const edit = {
    ...revisionBody(GOOD),
    title: "A better initiative title",
    sections: { ...GOOD.sections, why: "Second draft." },
  };
  assertEquals(
    (await h.req(`/api/initiatives/${slug}/revisions`, {
      method: "POST",
      json: edit,
    })).status,
    401,
  );
  const stranger = await h.req(`/api/initiatives/${slug}/revisions`, {
    method: "POST",
    token: await h.mint(OTHER),
    json: edit,
  });
  assertEquals(stranger.status, 403);
  assertStringIncludes(String((await j(stranger)).error), "proposer");

  h.clock.now += 100;
  const res = await h.req(`/api/initiatives/${slug}/revisions`, {
    method: "POST",
    token,
    json: edit,
  });
  assertEquals(res.status, 201);
  const out = await j(res) as { initiative: { title: string; revision: number }; revision: Meta };
  assertEquals(out.initiative.title, edit.title);
  assertEquals(out.initiative.revision, 2);
  assertEquals(out.revision.source, "proposer");
  assertEquals(out.revision.author, PLAIN);

  const after = await j(await h.req("/api/initiatives/" + slug)) as unknown as Page;
  assertEquals(after.initiative.title, edit.title);
  assertEquals(after.revisions.map((r) => r.n), [1, 2]);
  const v1 = await j(await h.req(`/api/initiatives/${slug}/revisions/1`));
  assertEquals((v1.revision as { title: string }).title, GOOD.title);
  assertEquals((v1.revision as { sections: { why: string } }).sections.why, GOOD.sections.why);
  assert((v1.revision as { structured: boolean }).structured);
  assertEquals((await h.req(`/api/initiatives/${slug}/revisions/9`)).status, 404);
  assertEquals((await h.req(`/api/initiatives/${slug}/revisions/x`)).status, 404);

  // unchanged text and invalid text are refused; the goal is not editable here
  const same = await h.req(`/api/initiatives/${slug}/revisions`, {
    method: "POST",
    token,
    json: edit,
  });
  assertEquals(same.status, 400);
  assertStringIncludes(String((await j(same)).error), "Nothing changed");
  assertEquals(
    (await h.req(`/api/initiatives/${slug}/revisions`, {
      method: "POST",
      token,
      json: { ...edit, title: "tiny" },
    }))
      .status,
    400,
  );
  assertEquals(
    (await h.req(`/api/initiatives/${slug}/revisions`, {
      method: "POST",
      token,
      json: { ...edit, summary: "short" },
    })).status,
    400,
  );
  assertEquals((await h.db.initiatives.bySlug(slug))!.goalUsd, 25000);

  // an archived initiative is closed for edits
  const row = (await h.db.initiatives.bySlug(slug))!;
  await h.db.initiatives.update(row.id, { status: "archived" });
  assertEquals(
    (await h.req(`/api/initiatives/${slug}/revisions`, {
      method: "POST",
      token,
      json: { ...edit, title: "Yet another title here" },
    })).status,
    403,
  );
  h.close();
});

Deno.test("pending initiative: visible and editable for its proposer and admins only", async () => {
  const h = await harness();
  const { token, admin, slug } = await submitted(h, false);
  assertEquals((await h.req("/api/initiatives/" + slug)).status, 404);
  assertEquals(
    (await h.req("/api/initiatives/" + slug, { token: await h.mint(OTHER) })).status,
    404,
  );
  assertEquals((await h.req("/api/initiatives/" + slug, { token })).status, 200);
  assertEquals((await h.req("/api/initiatives/" + slug, { token: admin })).status, 200);
  const res = await h.req(`/api/initiatives/${slug}/revisions`, {
    method: "POST",
    token,
    json: {
      ...revisionBody(GOOD),
      summary: GOOD.summary + " Now with an extra sentence for reviewers.",
    },
  });
  assertEquals(res.status, 201);
  assertEquals((await h.db.initiatives.bySlug(slug))!.status, "pending");
  h.close();
});

Deno.test("admin editor: text changes become admin revisions, other fields do not", async () => {
  const h = await harness();
  const { admin, slug, id } = await submitted(h);
  const patch = (json: Record<string, unknown>) =>
    h.req(`/api/admin/initiatives/${id}`, { method: "PATCH", token: admin, json });
  assertEquals((await patch({ goal: "30,000" })).status, 200);
  assertEquals((await h.db.revisions.list(id)).length, 1);
  assertEquals((await patch({ title: "Renamed by the team" })).status, 200);
  const revs = await h.db.revisions.list(id);
  assertEquals(revs.map((r) => [r.n, r.source, r.author]), [[1, "submit", PLAIN], [
    2,
    "admin",
    ADMIN,
  ]]);
  assertEquals(revs[1].summary, GOOD.summary); // untouched fields carry over
  assertEquals((await h.db.initiatives.get(id))!.goalUsd, 30000);
  assertEquals((await patch({ title: "short" })).status, 400);
  assertEquals((await patch({ title: "Renamed by the team" })).status, 200); // no-op, still fine
  assertEquals((await h.db.revisions.list(id)).length, 2);
  // an admin may also use the public edit endpoint; it is tagged as an admin
  // revision (the milestones must match the goal the admin just raised)
  const res = await h.req(`/api/initiatives/${slug}/revisions`, {
    method: "POST",
    token: admin,
    json: {
      ...revisionBody(GOOD),
      title: "Renamed again by the team",
      milestones: [{ ...GOOD.milestones[0], amount: 30000 }],
    },
  });
  assertEquals(res.status, 201);
  assertEquals((await j(res) as { revision: Meta }).revision.source, "admin");
  const view = await j(await h.req(`/api/admin/initiatives/${id}`, { token: admin }));
  assertEquals((view.revisions as Meta[]).length, 3);
  h.close();
});

Deno.test("content sync: an unchanged file adds no revision, a changed one does", async () => {
  const h = await harness();
  const admin = await h.mint(ADMIN, true);
  const files = syntheticContentFiles();
  const sync = (f = files) =>
    h.req("/api/admin/sync-content", { method: "POST", token: admin, json: { files: f } });
  await sync();
  await sync();
  const rows = await h.db.initiatives.list(["approved", "pending"]);
  for (const r of rows) {
    const revs = await h.db.revisions.list(r.id);
    assertEquals(revs.map((v) => [v.n, v.source, v.author]), [[1, "content", ""]]);
  }
  const changed = files.map((f, i) =>
    i === 0
      ? { ...f, text: f.text.replace("Because it closes a gap.", "Because it really does.") }
      : f
  );
  await sync(changed);
  const total = (await Promise.all(rows.map((r) => h.db.revisions.list(r.id)))).flat().length;
  assertEquals(total, rows.length + 1);
  h.close();
});

Deno.test("archive: hides a superseded revision publicly, never the current one, reversible", async () => {
  const h = await harness();
  const { token, admin, slug, id } = await submitted(h);
  await h.req(`/api/initiatives/${slug}/revisions`, {
    method: "POST",
    token,
    json: { ...revisionBody(GOOD), title: "A second title for this one" },
  });
  const act = (n: number | string, action: string) =>
    h.req(`/api/admin/initiatives/${id}/revisions/${n}`, {
      method: "POST",
      token: admin,
      json: { action },
    });
  assertEquals((await act(2, "archive")).status, 400);
  assertEquals((await act(7, "archive")).status, 404);
  assertEquals((await act(1, "nuke")).status, 400);
  assertEquals((await act(1, "archive")).status, 200);

  const pub = await j(await h.req("/api/initiatives/" + slug)) as unknown as Page;
  assertEquals(pub.revisions.map((r) => r.n), [2]);
  assertEquals((await h.req(`/api/initiatives/${slug}/revisions/1`)).status, 404);
  const asAdmin = await j(
    await h.req("/api/initiatives/" + slug, { token: admin }),
  ) as unknown as Page;
  assertEquals(asAdmin.revisions.map((r) => [r.n, r.archived]), [[1, true], [2, false]]);
  assertEquals((await h.req(`/api/initiatives/${slug}/revisions/1`, { token: admin })).status, 200);
  // the current text is untouched by archiving history
  assertEquals(pub.initiative.title, "A second title for this one");

  assertEquals((await act(1, "unarchive")).status, 200);
  const back = await j(await h.req("/api/initiatives/" + slug)) as unknown as Page;
  assertEquals(back.revisions.map((r) => r.n), [1, 2]);
  // only admins
  assertEquals(
    (await h.req(`/api/admin/initiatives/${id}/revisions/1`, {
      method: "POST",
      token,
      json: { action: "archive" },
    })).status,
    403,
  );
  h.close();
});

Deno.test("legacy rows: the first edit snapshots the old text as revision 1", async () => {
  const h = await harness();
  const row = await h.db.initiatives.insert({ title: "Imported long ago", status: "approved" });
  // Pretend it predates revisions: no history, no revision counter.
  await h.kv.delete(["revision", row.id, 1]);
  const { revision: _r, ...bare } = row;
  await h.kv.set(["rfp", row.id], { ...bare, createdAt: 1_700_000_000 } as Initiative);
  const page = await j(await h.req("/api/initiatives/" + row.slug)) as unknown as Page;
  assertEquals(page.initiative.revision, 0);
  assertEquals(page.revisions, []);

  const { revision } = await h.db.initiatives.revise(row.id, {
    title: "Imported long ago, now edited",
    summary: "",
    details: "",
  }, { author: ADMIN, source: "admin" });
  assertEquals(revision!.n, 2);
  const revs = await h.db.revisions.list(row.id);
  assertEquals(revs.map((v: Revision) => [v.n, v.source, v.title, v.createdAt]), [
    [1, "import", "Imported long ago", 1_700_000_000],
    [2, "admin", "Imported long ago, now edited", h.clock.now],
  ]);
  assertEquals((await h.db.initiatives.get(row.id))!.revision, 2);

  // text fields never go through update()
  await assertRejects(
    () => h.db.initiatives.update(row.id, { title: "x" }),
    Error,
    "field not allowed",
  );
  assert((await h.db.initiatives.get(row.id))!.title.endsWith("edited"));
  h.close();
});
