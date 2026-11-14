/** The admin dashboard's endpoints (#89): the to-do list first, the full table on demand. */
import { assert, assertEquals } from "@std/assert";
import { ADMIN, deploySafe, harness, j, PLAIN, proposerToken } from "./app-helpers.ts";
import { minimalSubmission, revisionBody } from "./fixtures.ts";

type Row = { id: string; slug: string; title: string; pendingRevision: number | null };
type Todo = {
  submissions: Row[];
  edits: Row[];
  held: { id: string; initiative: { slug: string } | null }[];
  unanswered: unknown[];
  reported: unknown[];
  index: { id: string; status: string }[];
  counts: { total: number; approved: number; approvedThisWeek: number };
};

Deno.test("todo: submissions oldest first, waiting edits, held comments; no chain or Safe calls", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const admin = await h.mint(ADMIN, true);
    const token = await proposerToken(h);
    // A different goal changes the section text, so each one is a new submission.
    const submit = async (title: string, goal: number) => {
      const res = await h.req("/api/initiatives", {
        method: "POST",
        token,
        json: { ...minimalSubmission(goal), title },
      });
      assertEquals(res.status, 201, await res.clone().text());
      const { slug } = await j(res) as { slug: string };
      h.clock.now += 60;
      return (await h.db.initiatives.bySlug(slug))!;
    };
    const first = await submit("First submission waiting", 1000);
    const second = await submit("Second submission waiting", 2000);
    const live = await submit("Approved with an edit", 3000);
    await deploySafe(h, admin, live.id);
    await h.req(`/api/admin/initiatives/${live.id}/status`, {
      method: "POST",
      token: admin,
      json: { action: "approve" },
    });
    const edited = await h.req(`/api/initiatives/${live.slug}/revisions`, {
      method: "POST",
      token,
      json: { ...revisionBody(minimalSubmission(3000)), title: "A retitle to review" },
    });
    assertEquals(edited.status, 201);
    await h.db.comments.create(
      {
        rfpId: live.id,
        parentId: null,
        type: "question",
        body: "Held for review",
        address: PLAIN,
        displayName: "Anon",
        email: "",
        status: "held",
        aiSummary: "",
        roles: [],
      } as unknown as Parameters<typeof h.db.comments.create>[0],
    );

    const calls = h.script.calls.length;
    const fetches = h.fetchLog.length;
    const res = await h.req("/api/admin/todo", { token: admin });
    assertEquals(res.status, 200, await res.clone().text());
    const todo = await j(res) as unknown as Todo;
    assertEquals(todo.submissions.map((x) => x.id), [first.id, second.id]);
    assertEquals(todo.edits.map((x) => [x.id, x.pendingRevision]), [[live.id, 2]]);
    assertEquals(todo.held.map((x) => x.initiative?.slug), [live.slug]);
    assertEquals(todo.counts, { total: 3, approved: 1, approvedThisWeek: 1 });
    assertEquals(todo.index.length, 3);
    // The first paint is KV only: nothing on the chain, nothing from the Safe API.
    assertEquals(h.script.calls.length, calls);
    assertEquals(h.fetchLog.length, fetches);

    const list = await j(await h.req("/api/admin/initiatives", { token: admin })) as {
      rows: { initiative: { id: string; status: string }; summary: { total: number } }[];
    };
    assertEquals(list.rows.map((r) => r.initiative.status), ["pending", "pending", "approved"]);
    assertEquals(list.rows.every((r) => r.summary.total === 0), true);
    // The table reads snapshots only, never a refresh.
    assertEquals(h.script.calls.length, calls);
    assertEquals(h.fetchLog.length, fetches);

    const status = await j(await h.req("/api/admin/status", { token: admin })) as {
      signers: { ok: boolean };
    };
    assert(status.signers.ok);
    assertEquals(h.script.calls.length, calls);
  } finally {
    h.close();
  }
});

Deno.test("todo: admins only", async () => {
  const h = await harness();
  try {
    assertEquals((await h.req("/api/admin/todo")).status, 401);
    const plain = await h.mint(PLAIN);
    for (
      const path of [
        "/api/admin/todo",
        "/api/admin/status",
        "/api/admin/initiatives",
        "/api/admin/held",
      ]
    ) {
      assertEquals((await h.req(path, { token: plain })).status, 403, path);
    }
  } finally {
    h.close();
  }
});
