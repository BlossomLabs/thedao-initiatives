/** Admin star ratings: admins only, latest review counts, delete restores the previous one, nothing leaks. */
import { assert, assertEquals } from "@std/assert";
import { ADMIN, harness, PLAIN } from "./app-helpers.ts";
import { BACKUP_PREFIXES } from "../services/backup.ts";
import { averageWith, type RatingSummary, summaryWith } from "../../shared/ratings.ts";

interface ReviewJson {
  id: string;
  stars: number;
  body: string;
  current: boolean;
}
type Body = {
  review: ReviewJson;
  reviews: ReviewJson[];
  summary: RatingSummary;
  ratings: Record<string, RatingSummary>;
};
const j = (r: Response) => r.json() as Promise<Body>;

const OTHER_ADMIN = "0x2222222222222222222222222222222222222222";
const SECRET = "only-admins-read-this-note";

async function setup() {
  const h = await harness({
    env: { RATE_LIMIT_MODE: "off", ADMIN_ADDRESSES: `${ADMIN},${OTHER_ADMIN}` },
  });
  const a = await h.db.initiatives.insert({ title: "Alpha initiative", status: "approved" });
  const pending = await h.db.initiatives.insert({ title: "Pending initiative", status: "pending" });
  const archived = await h.db.initiatives.insert({ title: "Old initiative", status: "archived" });
  const admin = await h.mint(ADMIN, true);
  const other = await h.mint(OTHER_ADMIN, true);
  const plain = await h.mint(PLAIN);
  const post = (token: string, id: string, json: unknown) =>
    h.req(`/api/admin/initiatives/${id}/reviews`, { method: "POST", token, json });
  return { h, a, pending, archived, admin, other, plain, post };
}

Deno.test("reviews: signed out is 401 and a plain account is 403 on every route", async () => {
  const { h, a, plain } = await setup();
  const routes: [string, string][] = [
    ["/api/admin/ratings", "GET"],
    [`/api/admin/initiatives/${a.id}/reviews`, "GET"],
    [`/api/admin/initiatives/${a.id}/reviews`, "POST"],
    [`/api/admin/initiatives/${a.id}/reviews/x`, "DELETE"],
  ];
  for (const [path, method] of routes) {
    const json = method === "POST" ? { stars: 5 } : undefined;
    assertEquals((await h.req(path, { method, json })).status, 401, `${method} ${path}`);
    assertEquals(
      (await h.req(path, { method, json, token: plain })).status,
      403,
      `${method} ${path}`,
    );
  }
  assertEquals(await h.db.reviews.forInitiative(a.id), []);
  h.close();
});

Deno.test("reviews: each admin's latest review counts; average and distribution", async () => {
  const { h, a, admin, other, post } = await setup();
  assertEquals((await post(admin, a.id, { stars: 2, body: "first look" })).status, 201);
  h.clock.now += 10;
  const latest = await post(admin, a.id, { stars: 4 });
  assertEquals(latest.status, 201);
  assertEquals((await j(latest)).review.body, "");
  assertEquals((await post(other, a.id, { stars: 5, body: SECRET })).status, 201);

  const list = await j(await h.req(`/api/admin/initiatives/${a.id}/reviews`, { token: admin }));
  assertEquals(list.reviews.map((r) => r.stars), [2, 4, 5]);
  assertEquals(list.reviews.map((r) => r.current), [false, true, true]);
  assertEquals(list.summary, { avg: 4.5, count: 2, dist: [0, 0, 0, 1, 1], mine: 4 });

  const board = await j(await h.req("/api/admin/ratings", { token: other }));
  assertEquals(board.ratings, { [a.id]: { avg: 4.5, count: 2, dist: [0, 0, 0, 1, 1], mine: 5 } });
  h.close();
});

Deno.test("reviews: deleting the latest brings back the previous; only the author deletes", async () => {
  const { h, a, admin, other, post } = await setup();
  await post(admin, a.id, { stars: 2 });
  h.clock.now += 10;
  const second = (await j(await post(admin, a.id, { stars: 4 }))).review;
  const del = (token: string, id: string) =>
    h.req(`/api/admin/initiatives/${a.id}/reviews/${id}`, { method: "DELETE", token });

  assertEquals((await del(other, second.id)).status, 404);
  assertEquals((await del(admin, second.id)).status, 200);
  assertEquals((await del(admin, second.id)).status, 404);
  const after = await j(await h.req(`/api/admin/initiatives/${a.id}/reviews`, { token: admin }));
  assertEquals(after.summary.mine, 2);
  assertEquals(after.reviews.length, 1);
  assert(after.reviews[0].current);

  await del(admin, after.reviews[0].id);
  const empty = await j(await h.req("/api/admin/ratings", { token: admin }));
  assertEquals(empty.ratings, {});
  h.close();
});

Deno.test("reviews: bad stars, long text and non-board initiatives are rejected", async () => {
  const { h, a, pending, archived, admin, post } = await setup();
  for (const json of [{}, { stars: 0 }, { stars: 6 }, { stars: 3.5 }, { stars: "4" }]) {
    assertEquals((await post(admin, a.id, json)).status, 400, JSON.stringify(json));
  }
  assertEquals((await post(admin, a.id, { stars: 3, extra: 1 })).status, 400);
  assertEquals((await post(admin, a.id, { stars: 3, body: "x".repeat(2001) })).status, 400);
  assertEquals((await post(admin, pending.id, { stars: 3 })).status, 404);
  assertEquals((await post(admin, archived.id, { stars: 3 })).status, 400);
  assertEquals((await post(admin, "nope", { stars: 3 })).status, 404);
  // An archived initiative's reviews stay readable.
  assertEquals(
    (await h.req(`/api/admin/initiatives/${archived.id}/reviews`, { token: admin })).status,
    200,
  );
  assertEquals(await h.db.reviews.forInitiative(a.id), []);
  h.close();
});

Deno.test("reviews: nothing reaches the board, the comments or the feeds", async () => {
  const { h, a, admin, plain, post } = await setup();
  await post(admin, a.id, { stars: 5, body: SECRET });
  for (const token of [undefined, plain, admin]) {
    for (
      const path of [
        "/api/board",
        `/api/initiatives/${a.slug}`,
        `/api/initiatives/${a.slug}/comments`,
        "/llms.txt",
        "/llms-full.txt",
        "/api/initiatives.json",
        `/initiative/${a.slug}.md`,
      ]
    ) {
      const res = await h.req(path, { token });
      assertEquals(res.status, 200, path);
      const text = await res.text();
      assert(!text.includes(SECRET), `${path} leaks the note`);
      assert(!text.includes('"stars"'), `${path} leaks the stars`);
    }
  }
  h.close();
});

Deno.test("reviews: the backup carries reviews and ratings", () => {
  assert((BACKUP_PREFIXES as readonly string[]).includes("review"));
  assert((BACKUP_PREFIXES as readonly string[]).includes("rating"));
});

Deno.test("ratings: the average as it will be with the viewer's pick", () => {
  // 4 and 5, the viewer's is the 4.
  const s: RatingSummary = { avg: 4.5, count: 2, dist: [0, 0, 0, 1, 1], mine: 4 };
  assertEquals(averageWith(s, null), 4.5);
  assertEquals(averageWith(s, 2), 3.5); // replaces theirs
  // Not rated yet: one more.
  assertEquals(averageWith({ ...s, mine: null }, 3), 4);
  assertEquals(averageWith({ avg: 0, count: 0, dist: [0, 0, 0, 0, 0], mine: null }, 5), 5);
});

Deno.test("ratings: the whole summary with the viewer's pick, their old one out of the bars", () => {
  const s: RatingSummary = { avg: 4.5, count: 2, dist: [0, 0, 0, 1, 1], mine: 4 };
  assertEquals(summaryWith(s, null), s);
  assertEquals(summaryWith(s, 2), { avg: 3.5, count: 2, dist: [0, 1, 0, 0, 1], mine: 2 });
  assertEquals(summaryWith({ ...s, mine: null }, 3), {
    avg: 4,
    count: 3,
    dist: [0, 0, 1, 1, 1],
    mine: 3,
  });
});
