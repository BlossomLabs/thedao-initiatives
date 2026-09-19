/**
 * The board is public and polled, so each isolate keeps the last built board
 * in memory for BOARD_CACHE_SECS (5 by default; 0 turns it off). A write
 * through the API or a `?refresh=1` read replaces it at once in that isolate;
 * other isolates catch up when their window ends.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { ADMIN, harness, j } from "./app-helpers.ts";
import { createSnapshotCache } from "../lib/snapshot-cache.ts";

Deno.test("snapshot cache: builds once inside the window, again after it", async () => {
  let now = 100;
  let builds = 0;
  const cache = createSnapshotCache<number>(() => now, 5);
  const build = () => Promise.resolve(++builds);
  assertEquals(await cache.get(build), 1);
  now = 104.9;
  assertEquals(await cache.get(build), 1);
  now = 105;
  assertEquals(await cache.get(build), 2);
});

Deno.test("snapshot cache: concurrent readers share one build", async () => {
  let builds = 0;
  const gate = Promise.withResolvers<void>();
  const cache = createSnapshotCache<number>(() => 100, 5);
  const build = async () => {
    const n = ++builds;
    await gate.promise;
    return n;
  };
  const both = Promise.all([cache.get(build), cache.get(build)]);
  gate.resolve();
  assertEquals(await both, [1, 1]);
});

Deno.test("snapshot cache: a build already running when the cache is cleared is not kept", async () => {
  const gate = Promise.withResolvers<void>();
  const cache = createSnapshotCache<string>(() => 100, 5);
  const slow = cache.get(async () => {
    await gate.promise;
    return "read before the write";
  });
  cache.clear();
  gate.resolve();
  assertEquals(await slow, "read before the write");
  assertEquals(
    await cache.get(() => Promise.resolve("read after the write")),
    "read after the write",
  );
});

Deno.test("snapshot cache: rebuild always builds, replaces the value and restarts the window", async () => {
  let now = 100;
  const cache = createSnapshotCache<string>(() => now, 5);
  await cache.get(() => Promise.resolve("old"));
  now = 104;
  assertEquals(await cache.rebuild(() => Promise.resolve("fresh")), "fresh");
  now = 108;
  assertEquals(await cache.get(() => Promise.resolve("rebuilt")), "fresh");
});

Deno.test("snapshot cache: a rebuild running when the cache is cleared is not kept", async () => {
  const gate = Promise.withResolvers<void>();
  const cache = createSnapshotCache<string>(() => 100, 5);
  const slow = cache.rebuild(async () => {
    await gate.promise;
    return "read before the write";
  });
  cache.clear();
  gate.resolve();
  assertEquals(await slow, "read before the write");
  assertEquals(
    await cache.get(() => Promise.resolve("read after the write")),
    "read after the write",
  );
});

Deno.test("snapshot cache: a failed build is not kept", async () => {
  const cache = createSnapshotCache<string>(() => 100, 5);
  await assertRejects(
    () => cache.get(() => Promise.reject(new Error("kv down"))),
    Error,
    "kv down",
  );
  assertEquals(await cache.get(() => Promise.resolve("ok")), "ok");
});

Deno.test("snapshot cache: zero seconds builds on every read", async () => {
  let builds = 0;
  const cache = createSnapshotCache<number>(() => 100, 0);
  const build = () => Promise.resolve(++builds);
  await cache.get(build);
  await cache.rebuild(() => Promise.resolve(99));
  assertEquals(await cache.get(build), 2);
});

type BoardJson = { cards: { initiative: { goalUsd: number }; backers: number }[] };
const board = async (h: Awaited<ReturnType<typeof harness>>, query = "") =>
  await j(await h.req("/api/board" + query)) as unknown as BoardJson;

async function seeded(env: Record<string, string> = {}) {
  const h = await harness({ env: { BOARD_CACHE_SECS: "5", ...env } });
  const r = await h.db.initiatives.insert({
    title: "Cached",
    summary: "s",
    status: "approved",
    goalUsd: 10,
  });
  return { h, id: r.id };
}

Deno.test("board cache: a repeat read inside the window is the saved board, then it is rebuilt", async () => {
  const { h, id } = await seeded();
  assertEquals((await board(h)).cards[0].initiative.goalUsd, 10);
  // Another isolate's write: this one only notices when its window ends.
  await h.db.initiatives.update(id, { goalUsd: 20 });
  h.clock.now += 4;
  assertEquals((await board(h)).cards[0].initiative.goalUsd, 10);
  h.clock.now += 1;
  assertEquals((await board(h)).cards[0].initiative.goalUsd, 20);
  h.close();
});

Deno.test("board cache: a write through the API drops the saved board", async () => {
  const { h, id } = await seeded();
  const admin = await h.mint(ADMIN, true);
  assertEquals((await board(h)).cards[0].backers, 0);
  const res = await h.req(`/api/admin/initiatives/${id}/pledges`, {
    method: "POST",
    token: admin,
    json: { company: "Acme", amount: 5 },
  });
  assertEquals(res.status, 201);
  assertEquals((await board(h)).cards[0].backers, 1);
  h.close();
});

Deno.test("board cache: ?refresh=1 rebuilds and replaces the saved board", async () => {
  const { h, id } = await seeded();
  await board(h);
  await h.db.initiatives.update(id, { goalUsd: 20 });
  assertEquals((await board(h, "?refresh=1")).cards[0].initiative.goalUsd, 20);
  assertEquals((await board(h)).cards[0].initiative.goalUsd, 20);
  h.close();
});

Deno.test("board cache: BOARD_CACHE_SECS=0 turns it off", async () => {
  const { h, id } = await seeded({ BOARD_CACHE_SECS: "0" });
  await board(h);
  await h.db.initiatives.update(id, { goalUsd: 20 });
  assertEquals((await board(h)).cards[0].initiative.goalUsd, 20);
  h.close();
});

Deno.test("board cache: on for 5 seconds unless configured", async () => {
  const { loadConfig } = await import("../config.ts");
  assertEquals(loadConfig({}).boardCacheSecs, 5);
  assertEquals(loadConfig({ BOARD_CACHE_SECS: "0" }).boardCacheSecs, 0);
  assertEquals(loadConfig({ BOARD_CACHE_SECS: "12" }).boardCacheSecs, 12);
  assertEquals(loadConfig({ BOARD_CACHE_SECS: "nonsense" }).boardCacheSecs, 5);
});
