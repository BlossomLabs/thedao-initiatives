/** Proposer edits to an approved initiative wait for an admin; the approved version stays live (#65). */
import { assert, assertEquals } from "@std/assert";
import {
  ADMIN,
  deploySafe,
  type Harness,
  harness,
  j,
  PLAIN,
  proposerToken,
} from "./app-helpers.ts";
import type { Revision } from "../db/types.ts";
import { REVISIONS_PER_HOUR_PER_ADDRESS } from "../config.ts";
import { K } from "../db/keys.ts";
import { minimalSubmission, revisionBody } from "./fixtures.ts";

const OTHER = "0x2222222222222222222222222222222222222222";
const GOOD = minimalSubmission(25000);
type Meta = { n: number; source: string; state: string; note?: string; reviewedBy?: string };
type Out = {
  initiative: { title: string; revision: number; categories: string[]; pendingRevision?: number };
  revision: Meta;
  pending?: boolean;
};
type Page = { initiative: Out["initiative"]; revisions: Meta[] };

/** Submit as PLAIN, approve, and return the slug, the id and the tokens involved. */
async function approved(h: Harness, approve = true) {
  const token = await proposerToken(h);
  const admin = await h.mint(ADMIN, true);
  const res = await h.req("/api/initiatives", { method: "POST", token, json: GOOD });
  assertEquals(res.status, 201);
  const { slug } = await j(res) as { slug: string };
  const id = (await h.db.initiatives.bySlug(slug))!.id;
  if (approve) {
    await deploySafe(h, admin, id);
    await h.req(`/api/admin/initiatives/${id}/status`, {
      method: "POST",
      token: admin,
      json: { action: "approve" },
    });
  }
  const edit = (who: string, json: unknown) =>
    h.req(`/api/initiatives/${slug}/revisions`, { method: "POST", token: who, json });
  const review = (n: number, action: "accept" | "reject", json: unknown = {}) =>
    h.req(`/api/admin/initiatives/${id}/revisions/${n}/${action}`, {
      method: "POST",
      token: admin,
      json,
    });
  const row = async () => (await h.db.initiatives.get(id))!;
  return { token, admin, slug, id, edit, review, row };
}
const retitled = (title: string) => ({ ...revisionBody(GOOD), title });

Deno.test("a proposer's edit to an approved initiative is held: the approved version stays live", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const { token, slug, id, edit, row } = await approved(h);
  const res = await edit(token, {
    ...retitled("A title nobody has approved"),
    categories: ["defi"],
  });
  assertEquals(res.status, 201);
  const out = await j(res) as unknown as Out;
  assertEquals(out.pending, true);
  assertEquals([out.revision.n, out.revision.state, out.revision.source], [
    2,
    "pending",
    "proposer",
  ]);
  // the row, the public page, the board card and the feed keep the approved version
  const live = await row();
  assertEquals([live.title, live.categories, live.revision, live.pendingRevision], [
    GOOD.title,
    GOOD.categories,
    1,
    2,
  ]);
  const held = (await h.db.revisions.get(id, 2))!;
  assertEquals([held.state, held.title, held.categories], [
    "pending",
    "A title nobody has approved",
    ["defi"],
  ]);
  const pub = await j(await h.req("/api/initiatives/" + slug)) as unknown as Page;
  assertEquals(pub.initiative.title, GOOD.title);
  assertEquals(pub.initiative.pendingRevision, undefined);
  assertEquals(pub.revisions.map((r) => r.n), [1]);
  const board = await j(await h.req("/api/board")) as {
    cards: { initiative: { title: string; categories: string[] } }[];
  };
  assertEquals(board.cards.map((c) => [c.initiative.title, c.initiative.categories]), [
    [GOOD.title, GOOD.categories],
  ]);
  // the same text again is nothing new
  assertEquals(
    (await edit(token, { ...retitled("A title nobody has approved"), categories: ["defi"] }))
      .status,
    400,
  );
  h.close();
});

Deno.test("a held or rejected edit is for its proposer and the admins only", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const { token, admin, slug, edit, review } = await approved(h);
  await edit(token, retitled("An edit to be turned down"));
  const stranger = await h.mint(OTHER);
  const see = (n: number, who?: string) =>
    h.req(`/api/initiatives/${slug}/revisions/${n}`, { token: who });
  const each = async () => [
    (await see(2)).status,
    (await see(2, stranger)).status,
    (await see(2, token)).status,
    (await see(2, admin)).status,
  ];
  assertEquals(await each(), [404, 404, 200, 200]);
  // the proposer's and the admin's page say an edit is waiting; the public history never lists it
  for (const who of [token, admin]) {
    const page = await j(
      await h.req("/api/initiatives/" + slug, { token: who }),
    ) as unknown as Page;
    assertEquals(page.initiative.pendingRevision, 2);
    assertEquals(page.revisions.map((r) => r.n), [1]);
  }
  const waiting = async () =>
    (await j(await h.req("/api/admin/dashboard", { token: admin })) as unknown as {
      rows: { initiative: { pendingRevision: number | null } }[];
    }).rows.map((r) => r.initiative.pendingRevision);
  assertEquals(await waiting(), [2]);
  assertEquals((await review(2, "reject", { note: "Out of scope." })).status, 200);
  assertEquals(await waiting(), [null]);
  assertEquals(await each(), [404, 404, 200, 200]);
  const mine = await j(await see(2, token)) as { revision: Meta };
  assertEquals([mine.revision.state, mine.revision.note], ["rejected", "Out of scope."]);
  h.close();
});

Deno.test("accept makes the held edit live; reject leaves the live text alone; both clear the wait", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const { token, slug, id, edit, review, row } = await approved(h);
  await edit(token, { ...retitled("A title to be accepted"), categories: ["defi", "opsec"] });
  // only the edit that is waiting can be decided
  assertEquals((await review(1, "accept")).status, 409);
  assertEquals((await review(7, "reject")).status, 409);
  assertEquals(
    (await h.req(`/api/admin/initiatives/${id}/revisions/2/accept`, { method: "POST", token }))
      .status,
    403,
  );
  h.clock.now += 50;
  const ok = await review(2, "accept");
  assertEquals(ok.status, 200);
  const live = await row();
  assertEquals([live.title, live.categories, live.revision, live.pendingRevision ?? null], [
    "A title to be accepted",
    ["defi", "opsec"],
    2,
    null,
  ]);
  const accepted = (await h.db.revisions.get(id, 2))!;
  assertEquals([accepted.state, accepted.reviewedBy, accepted.reviewedAt], [
    "live",
    ADMIN,
    h.clock.now,
  ]);
  assertEquals(accepted.author, PLAIN);
  const pub = await j(await h.req("/api/initiatives/" + slug)) as unknown as Page;
  assertEquals([pub.initiative.title, pub.revisions.map((r) => r.n)], [
    "A title to be accepted",
    [1, 2],
  ]);
  assertEquals((await review(2, "accept")).status, 409); // decided already

  await edit(token, retitled("A title to be rejected"));
  assertEquals((await review(3, "reject", { note: "Not this one." })).status, 200);
  const after = await row();
  assertEquals([after.title, after.revision, after.pendingRevision ?? null], [
    "A title to be accepted",
    2,
    null,
  ]);
  const rejected = (await h.db.revisions.get(id, 3))!;
  assertEquals([rejected.state, rejected.note, rejected.reviewedBy], [
    "rejected",
    "Not this one.",
    ADMIN,
  ]);
  // the numbers stay dense: the next edit is 4, never a reused 3
  const next = await j(await edit(token, retitled("A third proposed title"))) as unknown as Out;
  assertEquals(next.revision.n, 4);
  h.close();
});

Deno.test("a second edit while one waits supersedes the first", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const { token, id, edit, review, row } = await approved(h);
  await edit(token, retitled("The first proposed title"));
  const second = await j(
    await edit(token, retitled("The second proposed title")),
  ) as unknown as Out;
  assertEquals(second.revision.n, 3);
  assertEquals((await h.db.revisions.get(id, 2))!.state, "superseded");
  assertEquals((await row()).pendingRevision, 3);
  assertEquals((await review(2, "accept")).status, 409);
  assertEquals((await review(3, "accept")).status, 200);
  assertEquals((await row()).title, "The second proposed title");
  h.close();
});

Deno.test("admin edits, and proposer edits to a pending initiative, still go live at once", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const fresh = await approved(h, false);
  const early = await j(
    await fresh.edit(fresh.token, retitled("Retitled before any approval")),
  ) as unknown as Out;
  assertEquals([early.pending ?? false, early.revision.state, early.initiative.title], [
    false,
    "live",
    "Retitled before any approval",
  ]);
  h.close();

  const g = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const { token, admin, id, edit, review, row } = await approved(g);
  await edit(token, retitled("The proposer's waiting title"));
  const team = await j(await edit(admin, retitled("The team's live title"))) as unknown as Out;
  assertEquals([team.pending ?? false, team.revision.n, team.initiative.title], [
    false,
    3,
    "The team's live title",
  ]);
  // the proposer's edit still waits, and accepted later it is the newest revision
  assertEquals((await row()).pendingRevision, 2);
  assertEquals((await review(2, "accept")).status, 200);
  const live = await row();
  assertEquals([live.title, live.revision, live.pendingRevision ?? null], [
    "The proposer's waiting title",
    4,
    null,
  ]);
  assertEquals((await g.db.revisions.get(id, 2))!.state, "superseded");
  const newest = (await g.db.revisions.get(id, 4))!;
  assertEquals([newest.state, newest.author, newest.source, newest.reviewedBy], [
    "live",
    PLAIN,
    "proposer",
    ADMIN,
  ]);
  g.close();
});

Deno.test("revisions written before states existed read as live", async () => {
  const h = await harness();
  const { slug, id } = await approved(h);
  const { state: _, ...old } = (await h.db.revisions.get(id, 1))! as Revision;
  await h.kv.set(K.revision(id, 1), old);
  const page = await j(await h.req("/api/initiatives/" + slug)) as unknown as Page;
  assertEquals(page.revisions.map((r) => [r.n, r.state]), [[1, "live"]]);
  assertEquals((await h.req(`/api/initiatives/${slug}/revisions/1`)).status, 200);
  h.close();
});

Deno.test("held edits count against the proposer's hourly cap", async () => {
  const h = await harness();
  const { token, edit } = await approved(h);
  for (let i = 0; i < REVISIONS_PER_HOUR_PER_ADDRESS; i++) {
    assertEquals((await edit(token, retitled(`A proposed title number ${i}`))).status, 201);
  }
  assertEquals((await edit(token, retitled("One proposed title too many"))).status, 429);
  h.close();
});

Deno.test("my initiatives: an edit in review, then the note when it was turned down", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const { token, edit, review } = await approved(h);
  type Mine = { initiatives: { editInReview: boolean; editRejected: { note: string } | null }[] };
  const mine = async () =>
    (await j(await h.req("/api/initiatives/mine", { token })) as unknown as Mine).initiatives[0];
  assertEquals([(await mine()).editInReview, (await mine()).editRejected], [false, null]);
  await edit(token, retitled("A title waiting for the team"));
  assertEquals([(await mine()).editInReview, (await mine()).editRejected], [true, null]);
  await review(2, "reject", { note: "Please keep the scope." });
  const after = await mine();
  assertEquals(after.editInReview, false);
  assert(after.editRejected);
  assertEquals(after.editRejected.note, "Please keep the scope.");
  h.close();
});

Deno.test("a row older than revisions: the held edit still snapshots the live text as revision 1", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const row = await h.db.initiatives.insert({
    title: "Imported long ago",
    summary: GOOD.summary,
    details: "Legacy text.",
    proposer: PLAIN,
    status: "approved",
    goalUsd: 25000,
  });
  await h.kv.set(K.initiative(row.id), { ...row, revision: 0 });
  await h.kv.delete(K.revision(row.id, 1));
  const res = await h.req(`/api/initiatives/${row.slug}/revisions`, {
    method: "POST",
    token,
    json: retitled("Imported long ago, retitled"),
  });
  assertEquals(res.status, 201);
  const after = (await h.db.initiatives.get(row.id))!;
  assertEquals([after.title, after.details, after.revision, after.pendingRevision], [
    "Imported long ago",
    "Legacy text.",
    1,
    2,
  ]);
  assertEquals((await h.db.revisions.get(row.id, 1))!.details, "Legacy text.");
  assertEquals((await h.db.revisions.get(row.id, 2))!.state, "pending");
  h.close();
});

Deno.test("whether an edit is held is decided on the row as written, not as the request read it", async () => {
  const h = await harness();
  const origin = { author: PLAIN, source: "proposer" as const };
  const text = { title: "Racing an approval", summary: "s", details: "d" };
  const row = await h.db.initiatives.insert({ ...text, proposer: PLAIN, status: "pending" });
  const whenApproved = (current: { status: string }) => current.status === "approved";
  // still pending when the write happens: live at once
  const early = await h.db.initiatives.revise(
    row.id,
    { ...text, details: "d2" },
    origin,
    whenApproved,
  );
  assertEquals([early.revision!.state, early.initiative.details], ["live", "d2"]);
  // approved between the request's read and its write: the edit is held
  await h.db.initiatives.update(row.id, { status: "approved" });
  const late = await h.db.initiatives.revise(
    row.id,
    { ...text, details: "d3" },
    origin,
    whenApproved,
  );
  assertEquals([late.revision!.state, late.initiative.details, late.initiative.pendingRevision], [
    "pending",
    "d2",
    3,
  ]);
  const tags = await h.db.initiatives.retag(row.id, ["defi"], origin, whenApproved);
  assertEquals([tags.revision!.state, tags.initiative.categories], ["pending", []]);
  h.close();
});

Deno.test("a change landing between the request's check and its write is seen by the write", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const { token, id, edit, row } = await approved(h, false);
  // Run `change` after the route has authorised the request, right before it writes.
  const racing = async (change: () => Promise<unknown>, json: unknown) => {
    const revise = h.db.initiatives.revise;
    h.db.initiatives.revise = async (...args) => {
      h.db.initiatives.revise = revise;
      await change();
      return await revise(...args);
    };
    try {
      return await edit(token, json);
    } finally {
      h.db.initiatives.revise = revise;
    }
  };
  // approved meanwhile: the edit is held, not published
  const held = await racing(
    () => h.db.initiatives.update(id, { status: "approved" }),
    retitled("Written while it was approved"),
  );
  assertEquals(held.status, 201);
  assertEquals((await j(held) as unknown as Out).pending, true);
  assertEquals([(await row()).title, (await row()).pendingRevision], [GOOD.title, 2]);
  // handed to another proposer meanwhile: the write is refused
  const lost = await racing(
    () => h.db.initiatives.update(id, { proposer: OTHER }),
    retitled("Written after losing the initiative"),
  );
  assertEquals(lost.status, 403);
  assertEquals([(await row()).title, (await row()).pendingRevision], [GOOD.title, 2]);
  assertEquals((await h.db.revisions.get(id, 2))!.state, "pending");
  assertEquals(await h.db.revisions.get(id, 3), null);
  h.close();
});

Deno.test("the page facts lock with the approval, even one that lands mid-request", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const { token, slug, id, row } = await approved(h, false);
  const update = h.db.initiatives.update;
  h.db.initiatives.update = async (...args) => {
    h.db.initiatives.update = update;
    await update(id, { status: "approved" });
    return await update(...args);
  };
  const res = await h.req(`/api/initiatives/${slug}`, {
    method: "PATCH",
    token,
    json: { goal: "99,000" },
  });
  h.db.initiatives.update = update;
  assertEquals(res.status, 403);
  assertEquals((await row()).goalUsd, 25000);
  h.close();
});
