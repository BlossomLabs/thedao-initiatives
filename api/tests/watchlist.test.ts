/** The account watchlist: signed in only, own list only, import merges, add and remove are idempotent. */
import { assert, assertEquals } from "@std/assert";
import { harness, j, ORIGIN, PLAIN } from "./app-helpers.ts";
import { BACKUP_PREFIXES } from "../services/backup.ts";
import { WATCHLIST_MAX } from "../../shared/watchlist.ts";

const OTHER = "0x2222222222222222222222222222222222222222";

async function setup(env: Record<string, string> = { RATE_LIMIT_MODE: "off" }) {
  const h = await harness({ env });
  const a = await h.db.initiatives.insert({ title: "Alpha initiative", status: "approved" });
  const b = await h.db.initiatives.insert({ title: "Beta initiative", status: "approved" });
  const gone = await h.db.initiatives.insert({ title: "Gone initiative", status: "archived" });
  const token = await h.mint(PLAIN);
  return { h, token, a: a.id, b: b.id, gone: gone.id };
}

Deno.test("watchlist: signed out is 401 on every route", async () => {
  const { h, a } = await setup();
  for (
    const [path, method] of [
      ["/api/watchlist", "GET"],
      ["/api/watchlist/import", "POST"],
      [`/api/watchlist/${a}`, "PUT"],
      [`/api/watchlist/${a}`, "DELETE"],
    ]
  ) {
    const res = await h.req(path, { method, json: method === "POST" ? { ids: [a] } : undefined });
    assertEquals(res.status, 401, `${method} ${path}`);
  }
  h.close();
});

Deno.test("watchlist: none until imported; import creates, merges, dedupes, drops non-approved", async () => {
  const { h, token, a, b, gone } = await setup();
  assertEquals((await h.req("/api/watchlist", { token })).status, 404);
  assertEquals((await j(await h.req("/api/auth/me", { token }))).hasWatchlist, false);

  const first = await h.req("/api/watchlist/import", {
    method: "POST",
    token,
    json: { ids: [a, a, gone, "nope"] },
  });
  assertEquals(first.status, 200);
  assertEquals((await j(first)).ids, [a]);

  const second = await j(
    await h.req("/api/watchlist/import", { method: "POST", token, json: { ids: [b, a] } }),
  );
  assertEquals(second.ids, [a, b]);
  assertEquals((await j(await h.req("/api/watchlist", { token }))).ids, [a, b]);
  assertEquals((await j(await h.req("/api/auth/me", { token }))).hasWatchlist, true);
  h.close();
});

Deno.test("watchlist: import rejects a bad body and a merge over the limit", async () => {
  const { h, token, a } = await setup();
  for (const json of [{}, { ids: "x" }, { ids: [1] }, { ids: [a], extra: 1 }]) {
    const res = await h.req("/api/watchlist/import", { method: "POST", token, json });
    assertEquals(res.status, 400, JSON.stringify(json));
  }
  // 201 approved ids: over the limit
  const ids: string[] = [];
  for (let i = 0; i <= WATCHLIST_MAX; i++) {
    ids.push((await h.db.initiatives.insert({ title: `Row ${i} title`, status: "approved" })).id);
  }
  const over = await h.req("/api/watchlist/import", { method: "POST", token, json: { ids } });
  assertEquals(over.status, 400);
  assertEquals((await h.req("/api/watchlist", { token })).status, 404);
  h.close();
});

Deno.test("watchlist: PUT and DELETE are idempotent; PUT of a non-approved id is 404", async () => {
  const { h, token, a, gone } = await setup();
  const put = () => h.req(`/api/watchlist/${a}`, { method: "PUT", token });
  await h.req("/api/watchlist/import", { method: "POST", token, json: { ids: [a] } });
  assertEquals((await j(await put())).ids, [a]);
  assertEquals((await j(await put())).ids, [a]);
  assertEquals((await h.req(`/api/watchlist/${gone}`, { method: "PUT", token })).status, 404);
  const del = () => h.req(`/api/watchlist/${a}`, { method: "DELETE", token });
  assertEquals((await j(await del())).ids, []);
  assertEquals((await j(await del())).ids, []);
  // an emptied list still exists: the account keeps using it
  assertEquals((await j(await h.req("/api/auth/me", { token }))).hasWatchlist, true);
  h.close();
});

Deno.test("watchlist: PUT and DELETE before any import are 404 and create nothing", async () => {
  const { h, token, a } = await setup();
  for (const method of ["PUT", "DELETE"]) {
    assertEquals((await h.req(`/api/watchlist/${a}`, { method, token })).status, 404, method);
  }
  assertEquals((await h.req("/api/watchlist", { token })).status, 404);
  assertEquals((await j(await h.req("/api/auth/me", { token }))).hasWatchlist, false);
  h.close();
});

Deno.test("watchlist: one account never reads or writes another's list", async () => {
  const { h, token, a } = await setup();
  await h.req("/api/watchlist/import", { method: "POST", token, json: { ids: [a] } });
  const other = await h.mint(OTHER);
  assertEquals((await h.req("/api/watchlist", { token: other })).status, 404);
  const del = await h.req(`/api/watchlist/${a}`, { method: "DELETE", token: other });
  assertEquals(del.status, 404);
  assertEquals((await j(await h.req("/api/auth/me", { token: other }))).hasWatchlist, false);
  assertEquals((await j(await h.req("/api/watchlist", { token }))).ids, [a]);
  h.close();
});

Deno.test("watchlist: concurrent imports keep every id", async () => {
  const { h, a, b } = await setup();
  const allowed = new Set([a, b]);
  await Promise.all([
    h.db.watchlists.importIds(PLAIN, [a], allowed),
    h.db.watchlists.importIds(PLAIN, [b], allowed),
  ]);
  assertEquals((await h.db.watchlists.get(PLAIN))?.sort(), [a, b].sort());
  h.close();
});

Deno.test("watchlist: writes are rate limited per account", async () => {
  const { h, token, a } = await setup({});
  let last = 200;
  for (let i = 0; i < 61; i++) {
    last = (await h.req(`/api/watchlist/${a}`, { method: "PUT", token })).status;
  }
  assertEquals(last, 429);
  h.close();
});

Deno.test("watchlist: the record is backed up", () => {
  assert((BACKUP_PREFIXES as readonly string[]).includes("watchlist"));
});

Deno.test("watchlist: the CORS preflight for PUT is allowed from the web origin", async () => {
  const { h, a } = await setup();
  const res = await h.req(`/api/watchlist/${a}`, {
    method: "OPTIONS",
    headers: { Origin: ORIGIN, "Access-Control-Request-Method": "PUT" },
  });
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert((res.headers.get("Access-Control-Allow-Methods") ?? "").split(",").includes("PUT"));
  h.close();
});

Deno.test("watchlist: PUT into a full list (200 ids) is 400", async () => {
  const { h, token, a } = await setup();
  const ids: string[] = [];
  for (let i = 0; i < WATCHLIST_MAX; i++) {
    ids.push((await h.db.initiatives.insert({ title: `Row ${i} title`, status: "approved" })).id);
  }
  const full = await h.req("/api/watchlist/import", { method: "POST", token, json: { ids } });
  assertEquals(full.status, 200);
  assertEquals(((await j(full)) as { ids: string[] }).ids.length, WATCHLIST_MAX);
  assertEquals((await h.req(`/api/watchlist/${a}`, { method: "PUT", token })).status, 400);
  h.close();
});
