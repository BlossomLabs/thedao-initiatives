/** NFT-backed ratings: current ownership authorizes writes, token identity survives transfers. */
import { assert, assertEquals } from "@std/assert";
import { ADMIN, harness, PLAIN } from "./app-helpers.ts";
import { REVIEW_BADGE_CONTRACT } from "../config.ts";
import { BACKUP_PREFIXES } from "../services/backup.ts";
import { averageWith, type RatingSummary } from "../../shared/ratings.ts";

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
  const owners = new Map([["1", ADMIN.toLowerCase()], ["2", OTHER_ADMIN.toLowerCase()]]);
  const fetcher = h.deps.fetch;
  h.deps.fetch = (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "eth.blockscout.com") {
      const address = url.pathname.split("/")[4];
      return Promise.resolve(Response.json({
        items: [...owners].filter(([, owner]) => owner === address).map(([id]) => ({
          id,
          token: { address_hash: REVIEW_BADGE_CONTRACT },
        })),
        next_page_params: null,
      }));
    }
    return fetcher(input, init);
  };
  const rpc = h.deps.chain.rpc;
  h.deps.chain.rpc = async (method, params) => {
    if (method === "eth_call") {
      const call = params[0] as { to: string; data: string };
      if (call.to === REVIEW_BADGE_CONTRACT.toLowerCase()) {
        assert(call.data.startsWith("0x6352211e"));
        const id = BigInt("0x" + call.data.slice(10)).toString();
        return "0x" + (owners.get(id)?.slice(2) ?? "0").padStart(64, "0");
      }
    }
    return rpc(method, params);
  };
  const a = await h.db.initiatives.insert({ title: "Alpha initiative", status: "approved" });
  const pending = await h.db.initiatives.insert({ title: "Pending initiative", status: "pending" });
  const archived = await h.db.initiatives.insert({ title: "Old initiative", status: "archived" });
  const admin = await h.mint(ADMIN, true);
  const other = await h.mint(OTHER_ADMIN, true);
  const plain = await h.mint(PLAIN);
  const post = (token: string, id: string, json: unknown) =>
    h.req(`/api/reviews/initiatives/${id}/reviews`, { method: "POST", token, json });
  return { h, a, pending, archived, admin, other, plain, post, owners };
}

Deno.test("reviews: public reads are open; signed-out writes are 401 and non-holder writes are 403", async () => {
  const { h, a, plain } = await setup();
  const routes: [string, string][] = [
    ["/api/reviews/ratings", "GET"],
    [`/api/reviews/initiatives/${a.id}/reviews`, "GET"],
    [`/api/reviews/initiatives/${a.id}/reviews`, "POST"],
    [`/api/reviews/initiatives/${a.id}/reviews/x`, "DELETE"],
  ];
  for (const [path, method] of routes) {
    const json = method === "POST" ? { stars: 5 } : undefined;
    assertEquals(
      (await h.req(path, { method, json })).status,
      method === "GET" ? 200 : 401,
      `${method} ${path}`,
    );
    assertEquals(
      (await h.req(path, { method, json, token: plain })).status,
      method === "GET" ? 200 : 403,
      `${method} ${path}`,
    );
  }
  assertEquals(await h.db.reviews.forInitiative(a.id), []);
  h.close();
});

Deno.test("reviews: each NFT's latest review counts; average and distribution", async () => {
  const { h, a, admin, other, post } = await setup();
  assertEquals((await post(admin, a.id, { stars: 2, body: "first look" })).status, 201);
  h.clock.now += 10;
  const latest = await post(admin, a.id, { stars: 4 });
  assertEquals(latest.status, 201);
  assertEquals((await j(latest)).review.body, "");
  assertEquals((await post(other, a.id, { stars: 5, body: SECRET })).status, 201);

  const list = await j(
    await h.req(`/api/reviews/initiatives/${a.id}/reviews?tokenId=1`, { token: admin }),
  );
  assertEquals(list.reviews.map((r) => r.stars), [2, 4, 5]);
  assertEquals(list.reviews.map((r) => r.current), [false, true, true]);
  assertEquals(list.summary, { avg: 4.5, count: 2, dist: [0, 0, 0, 1, 1], mine: 4 });

  const board = await j(await h.req("/api/reviews/ratings?tokenId=2", { token: other }));
  assertEquals(board.ratings, { [a.id]: { avg: 4.5, count: 2, dist: [0, 0, 0, 1, 1], mine: 5 } });
  h.close();
});

Deno.test("reviews: deleting the latest brings back the previous; only the author deletes", async () => {
  const { h, a, admin, other, post } = await setup();
  await post(admin, a.id, { stars: 2 });
  h.clock.now += 10;
  const second = (await j(await post(admin, a.id, { stars: 4 }))).review;
  const del = (token: string, id: string) =>
    h.req(`/api/reviews/initiatives/${a.id}/reviews/${id}`, { method: "DELETE", token });

  assertEquals((await del(other, second.id)).status, 404);
  assertEquals((await del(admin, second.id)).status, 200);
  assertEquals((await del(admin, second.id)).status, 404);
  const after = await j(
    await h.req(`/api/reviews/initiatives/${a.id}/reviews?tokenId=1`, { token: admin }),
  );
  assertEquals(after.summary.mine, 2);
  assertEquals(after.reviews.length, 1);
  assert(after.reviews[0].current);

  await del(admin, after.reviews[0].id);
  const empty = await j(await h.req("/api/reviews/ratings", { token: admin }));
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
    (await h.req(`/api/reviews/initiatives/${archived.id}/reviews`, { token: admin })).status,
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
  assert((BACKUP_PREFIXES as readonly string[]).includes("nft_review_v1"));
  assert((BACKUP_PREFIXES as readonly string[]).includes("nft_rating_v1"));
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

Deno.test("reviews: a non-admin holder can review; admins without the NFT cannot", async () => {
  const { h, a, admin, plain, owners, post } = await setup();
  owners.set("1", PLAIN.toLowerCase());
  assertEquals((await post(admin, a.id, { stars: 5 })).status, 403);
  const saved = await post(plain, a.id, { stars: 3 });
  assertEquals(saved.status, 201);
  const body = await saved.json();
  assertEquals(body.review.tokenId, "1");
  assertEquals(body.review.address, PLAIN);
  assertEquals((await post(plain, a.id, { stars: 5, tokenId: "2" })).status, 403);
  h.close();
});

Deno.test("reviews: transferring an NFT replaces its rating instead of adding a reviewer", async () => {
  const { h, a, admin, plain, other, owners, post } = await setup();
  const old = (await j(await post(admin, a.id, { stars: 5 }))).review;
  owners.set("1", PLAIN.toLowerCase());
  assertEquals((await post(plain, a.id, { stars: 1 })).status, 201);
  assertEquals((await post(admin, a.id, { stars: 5 })).status, 403);
  const result = await j(
    await h.req(`/api/reviews/initiatives/${a.id}/reviews?tokenId=1`, { token: plain }),
  );
  assertEquals(result.summary, { avg: 1, count: 1, dist: [1, 0, 0, 0, 0], mine: 1 });
  assertEquals(result.reviews.map((r) => r.current), [false, true]);
  // The former owner still cannot delete the old review after acquiring a different NFT.
  owners.set("3", ADMIN.toLowerCase());
  assertEquals(
    (await h.req(`/api/reviews/initiatives/${a.id}/reviews/${old.id}`, {
      token: admin,
      method: "DELETE",
    })).status,
    404,
  );
  const board = await j(await h.req("/api/reviews/ratings?tokenId=2", { token: other }));
  assertEquals(board.ratings[a.id].count, 1);
  h.close();
});

Deno.test("reviews: legacy admin keys are excluded from lists and averages", async () => {
  const { h, a, admin } = await setup();
  await h.kv.set(["review", a.id, "old"], {
    id: "old",
    initiativeId: a.id,
    address: ADMIN,
    stars: 5,
    body: SECRET,
    createdAt: 1,
  });
  await h.kv.set(["rating", a.id, ADMIN.toLowerCase()], { stars: 5, reviewId: "old", at: 1 });
  assertEquals(await h.db.reviews.forInitiative(a.id), []);
  const board = await j(await h.req("/api/reviews/ratings", { token: admin }));
  assertEquals(board.ratings, {});
  assertEquals(
    (await h.req(`/api/admin/initiatives/${a.id}/reviews`, { token: admin })).status,
    404,
  );
  h.close();
});

Deno.test("reviews: ownership lookup failure refuses writes and stores nothing", async () => {
  const { h, a, admin, post } = await setup();
  h.deps.chain.rpc = () => Promise.reject(new Error("RPC unavailable"));
  assertEquals((await post(admin, a.id, { stars: 5 })).status, 503);
  assertEquals(await h.db.reviews.forInitiative(a.id), []);
  h.close();
});

Deno.test("reviews: concurrent writes for the same NFT leave one current rating", async () => {
  const { h, a, admin, post } = await setup();
  const results = await Promise.all([
    post(admin, a.id, { stars: 1 }),
    post(admin, a.id, { stars: 5 }),
  ]);
  assertEquals(results.map((r) => r.status), [201, 201]);
  const list = await j(
    await h.req(`/api/reviews/initiatives/${a.id}/reviews?tokenId=1`, { token: admin }),
  );
  assertEquals(list.summary.count, 1);
  assertEquals(list.reviews.filter((r) => r.current).length, 1);
  h.close();
});

Deno.test("reviews: public reads include badge reviews without relying on NFT services", async () => {
  const { h, a, pending, archived, admin, plain, post } = await setup();
  await post(admin, a.id, { stars: 4, body: "Public badge review" });
  await h.db.reviews.create({
    initiativeId: pending.id,
    tokenId: "1",
    address: ADMIN,
    stars: 5,
    body: "Hidden pending review",
  });
  h.deps.chain.rpc = () => Promise.reject(new Error("chain unavailable"));
  h.deps.fetch = () => Promise.reject(new Error("index unavailable"));
  for (const token of [undefined, plain, admin]) {
    const response = await h.req(`/api/reviews/initiatives/${a.id}/reviews`, { token });
    assertEquals(response.status, 200);
    const body = await j(response);
    assertEquals(body.reviews[0].body, "Public badge review");
    assertEquals(body.summary.mine, null);
    assertEquals(body.summary.count, 1);
    const ratings = await j(await h.req("/api/reviews/ratings", { token }));
    assertEquals(ratings.ratings[a.id].mine, null);
    assertEquals(ratings.ratings[pending.id], undefined);
    assertEquals(
      (await h.req(`/api/reviews/initiatives/${pending.id}/reviews`, { token })).status,
      404,
    );
    assertEquals(
      (await h.req(`/api/reviews/initiatives/${archived.id}/reviews`, { token })).status,
      200,
    );
  }
  h.close();
});
