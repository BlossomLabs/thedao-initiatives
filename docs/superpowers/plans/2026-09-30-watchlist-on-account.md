# Watchlist on the Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in users can keep their watchlist on their account (KV), are offered to move the browser's list there after sign-in, and open tabs stay in step.

**Architecture:** A per-address KV record behind four signed-in routes (`GET`, `import`, `PUT :id`, `DELETE :id`). On the client, `useWatchlist()` keeps its shape but reads either the browser list (`localStorage`) or the account list (a TanStack Query entry); account changes are broadcast on a `BroadcastChannel`. A lazy card under the wallet button makes the offer.

**Tech Stack:** Deno + Hono + Deno KV (API, `deno test`), React Router 7 + TanStack Query + Tailwind v4 + lucide-react (web, vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-09-30-watchlist-on-account-design.md`

**Branch / worktree:** `watchlist-account` in `/home/sem/Projects/thedao-p2`, stacked on `board-p2` (#58). Its own PR, based on `board-p2` until #58 merges.

## Global Constraints

- KV key `["watchlist", address.toLowerCase()]`, value `{ ids: string[], updatedAt: number }`; the record exists only once the account moved a list.
- At most 200 ids (`WATCHLIST_MAX = 200` in `shared/watchlist.ts`).
- Add and remove are explicit (`PUT` / `DELETE`), never a toggle on the server.
- Rate limit bucket `watchlist:<address>`, 60 writes per 60 s, shared by import, PUT and DELETE; 429 when over.
- The account list is never written to `localStorage`.
- Browser list key `thedao:watchlist` (unchanged); ask key `thedao:watchlist-ask` = a JSON object from lowercased address to `"always"`, `"never"` or `"later:<me.expiresAt>"`.
- "Don't ask again" records the answer it was ticked with: with Move → `"always"` (later sign-ins with bookmarks move without the card, showing only the success note); with Not now → `"never"`.
- BroadcastChannel name `thedao:watchlist`, message `{ address, ids }` (address lowercased).
- Copy, verbatim:
  - Title: `Keep your watchlist on your account?`
  - Body: `You have {n} initiatives on this browser's watchlist. Move them to your account to see them wherever you sign in.` (`1 initiative` when n = 1)
  - Buttons: `Move to my account`, `Not now`; checkbox: `Don't ask again`
  - Success: the card closes; no visible note; screen readers hear `Watchlist moved to your account.` (status element)
  - Failure: `Couldn't move your watchlist. Try again.`
  - Over the limit: `Your watchlist is over 200 initiatives. Remove some and try again.`
  - Add/remove failure: `Couldn't update your watchlist.`
- The board's first load must not grow: the card is a lazy chunk.
- Deno fmt: line width 100, indent 2. `deno task typecheck`, `deno lint`, `deno fmt --check` clean before each commit.

## Review Focus

1. Two tabs import at once, or import races a PUT: no id may be lost (versionstamp check + retry in the repo). Test: two concurrent `importIds` on the same address keep the union.
2. A browser list holding ids of initiatives archived since: import succeeds and drops them. Test in Task 1.
3. Signed in as A, another tab signs in as B: a broadcast for A must not change B's list. Test in Task 3 (message for another address is ignored).
4. Storage blocked (private mode, `localStorage` throws): the board, the hook and the card must still render; nothing can be on the browser list, so nothing is offered. Tests in Tasks 2 and 4 with a throwing `localStorage`.
5. Move clicked while offline: nothing is cleared from the browser. Test in Task 4 (import rejects → local list intact).

---

### Task 1: API: the account watchlist record and routes

**Files:**
- Create: `shared/watchlist.ts`
- Create: `api/db/watchlists.ts`
- Create: `api/routes/watchlist.ts`
- Create: `api/tests/watchlist.test.ts`
- Modify: `api/db/keys.ts` (add `watchlist` to `K`)
- Modify: `api/db/mod.ts` (register the repo)
- Modify: `api/app.ts:127-137` (mount `/api/watchlist`)
- Modify: `api/routes/auth.ts:85-95` (`hasWatchlist` on `/me`)
- Modify: `api/services/backup.ts:20-45` (`"watchlist"` in `BACKUP_PREFIXES`, alphabetical)

**Interfaces:**
- Produces: `WATCHLIST_MAX` (shared); `db.watchlists.get(address): Promise<string[] | null>`, `importIds(address, ids: string[], allowed: Set<string>): Promise<string[] | "full">`, `add(address, id): Promise<string[] | "full">`, `remove(address, id): Promise<string[]>`, `has(address): Promise<boolean>`; routes as in the spec, each returning `{ ids: string[] }`; `/api/auth/me` gains `hasWatchlist: boolean`.

- [ ] **Step 1: Write the failing tests**

`api/tests/watchlist.test.ts`:

```ts
/** The account watchlist: signed in only, own list only, import merges, add and remove are idempotent. */
import { assert, assertEquals } from "@std/assert";
import { harness, j, PLAIN } from "./app-helpers.ts";
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

Deno.test("watchlist: one account never reads or writes another's list", async () => {
  const { h, token, a } = await setup();
  await h.req(`/api/watchlist/${a}`, { method: "PUT", token });
  const other = await h.mint(OTHER);
  assertEquals((await h.req("/api/watchlist", { token: other })).status, 404);
  await h.req(`/api/watchlist/${a}`, { method: "DELETE", token: other });
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `deno test -A api/tests/watchlist.test.ts`
Expected: FAIL at import (`shared/watchlist.ts` not found).

- [ ] **Step 3: Shared limit and key**

`shared/watchlist.ts`:

```ts
/** The most initiatives one account's watchlist holds. */
export const WATCHLIST_MAX = 200;
```

In `api/db/keys.ts`, inside `K` after `nick`:

```ts
  /** One account's watchlist (db/watchlists.ts): { ids, updatedAt }. */
  watchlist: (addr: string) => ["watchlist", addr.toLowerCase()] as const,
```

- [ ] **Step 4: The repo**

`api/db/watchlists.ts`:

```ts
import { K } from "./keys.ts";
import { WATCHLIST_MAX } from "../../shared/watchlist.ts";

interface Watchlist {
  ids: string[];
  updatedAt: number;
}

/** One account's watchlist. Every write re-reads and checks the entry, so concurrent
 * writes (two tabs, an import racing an add) never lose an id. */
export function watchlistsRepo(kv: Deno.Kv, now: () => number) {
  const get = async (address: string): Promise<string[] | null> =>
    (await kv.get<Watchlist>(K.watchlist(address))).value?.ids ?? null;

  const has = async (address: string): Promise<boolean> => (await get(address)) !== null;

  /** Apply `change` to the current ids (null = no record yet) and write it back.
   * "full" = the result would pass WATCHLIST_MAX; nothing is written. */
  async function update(
    address: string,
    change: (ids: string[] | null) => string[],
  ): Promise<string[] | "full"> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const cur = await kv.get<Watchlist>(K.watchlist(address));
      const next = change(cur.value?.ids ?? null);
      if (next.length > WATCHLIST_MAX) return "full";
      const ok = (await kv.atomic().check(cur)
        .set(K.watchlist(address), { ids: next, updatedAt: now() }).commit()).ok;
      if (ok) return next;
    }
    throw new Error("watchlist: too much contention");
  }

  const merge = (cur: string[], add: string[]) => [...new Set([...cur, ...add])];

  return {
    get,
    has,
    /** Adds the allowed ids (creating the record), in the order first seen. */
    importIds: (address: string, ids: string[], allowed: Set<string>) =>
      update(address, (cur) => merge(cur ?? [], ids.filter((id) => allowed.has(id)))),
    add: (address: string, id: string) => update(address, (cur) => merge(cur ?? [], [id])),
    remove: async (address: string, id: string): Promise<string[]> => {
      const r = await update(address, (cur) => (cur ?? []).filter((x) => x !== id));
      return r === "full" ? [] : r; // removing never grows the list
    },
  };
}
```

In `api/db/mod.ts`: `import { watchlistsRepo } from "./watchlists.ts";` and in the returned object after `profiles`:

```ts
    watchlists: watchlistsRepo(kv, now),
```

- [ ] **Step 5: The routes**

`api/routes/watchlist.ts`:

```ts
import { type Context, Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonBody } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";

const WRITES_PER_MINUTE = 60;

/** The signed-in account's watchlist. Add and remove are explicit (PUT / DELETE). */
export function watchlistRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db } = deps;
  r.use("*", requireAuth);

  const me = (c: Context<Vars>) => c.var.user!.address;
  const limit = async (address: string) => {
    if (!(await db.rateLimit("watchlist:" + address.toLowerCase(), WRITES_PER_MINUTE, 60))) {
      throw new HttpError(429, "slow down");
    }
  };
  const approvedIds = async () => new Set((await db.initiatives.cards("approved")).map((x) => x.id));
  const full = () => new HttpError(400, "watchlist is full");

  r.get("/", async (c) => {
    const ids = await db.watchlists.get(me(c));
    if (!ids) throw new HttpError(404, "no watchlist");
    return c.json({ ids });
  });

  r.post("/import", async (c) => {
    const address = me(c);
    await limit(address);
    const body = await jsonBody(c, ["ids"]);
    const raw = body.ids;
    if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) {
      throw new HttpError(400, "ids must be a list of initiative ids");
    }
    const ids = await db.watchlists.importIds(address, raw as string[], await approvedIds());
    if (ids === "full") throw full();
    return c.json({ ids });
  });

  r.put("/:id", async (c) => {
    const address = me(c);
    await limit(address);
    const id = c.req.param("id");
    if (!(await approvedIds()).has(id)) throw new HttpError(404, "no such initiative");
    const ids = await db.watchlists.add(address, id);
    if (ids === "full") throw full();
    return c.json({ ids });
  });

  r.delete("/:id", async (c) => {
    const address = me(c);
    await limit(address);
    return c.json({ ids: await db.watchlists.remove(address, c.req.param("id")) });
  });

  return r;
}
```

In `api/app.ts`: `import { watchlistRoutes } from "./routes/watchlist.ts";` and after `app.route("/api/uploads", uploadRoutes(deps));`:

```ts
  app.route("/api/watchlist", watchlistRoutes(deps));
```

- [ ] **Step 6: `/me` and backups**

In `api/routes/auth.ts`, `/me`:

```ts
  r.get("/me", requireAuth, async (c) => {
    const u = c.var.user!;
    const [p, hasWatchlist] = await Promise.all([
      db.profiles.get(u.address),
      db.watchlists.has(u.address),
    ]);
    return c.json({
      address: u.address,
      isAdmin: u.isAdmin,
      expiresAt: u.expiresAt,
      nickname: p.nickname || null,
      pfp: p.pfp,
      pfpUrl: pfpUrl(config, p.pfp),
      hasWatchlist,
    });
  });
```

In `api/services/backup.ts`, add `"watchlist",` to `BACKUP_PREFIXES` in alphabetical order.

- [ ] **Step 7: Run the tests to see them pass**

Run: `deno test -A api/tests/watchlist.test.ts`
Expected: 8 passed.

Run: `deno test -A api/`
Expected: all pass (the backup tests include the new prefix; `/me` tests that compare the whole body may need `hasWatchlist: false` added).

- [ ] **Step 8: Commit**

```bash
deno fmt api shared && deno lint && deno task typecheck
git add shared/watchlist.ts api/db/watchlists.ts api/db/keys.ts api/db/mod.ts api/routes/watchlist.ts api/app.ts api/routes/auth.ts api/services/backup.ts api/tests/watchlist.test.ts
git commit -m "Watchlist on the account (API): a per-address record, GET, import that merges approved ids, PUT and DELETE that add and remove one, 200 at most, rate limited; /me says hasWatchlist; backed up"
```

---

### Task 2: Client: browser list store and the tab channel

Moves the browser list out of the hook into a small store that every hook instance in the tab shares, and adds the BroadcastChannel wrapper. Behaviour for users does not change in this task.

**Files:**
- Create: `app/lib/watchlist-local.ts`
- Create: `app/lib/watchlist-local.test.ts`
- Create: `app/lib/watchlist-channel.ts`
- Create: `app/lib/watchlist-channel.test.ts`
- Modify: `app/hooks/use-watchlist.ts` (use the store)

**Interfaces:**
- Produces:
  - `LOCAL_KEY = "thedao:watchlist"`, `ASK_KEY = "thedao:watchlist-ask"`
  - `readLocal(): string[]`, `writeLocal(ids: string[]): void`, `clearLocal(): void`
  - `useLocalWatchlist(): string[]` (re-renders on writes in this tab and in others)
  - `type AskChoice = "always" | "never" | \`later:${number}\``
  - `readAsk(address: string): AskChoice | null`, `writeAsk(address: string, choice: AskChoice): void`, `useAsk(address: string): AskChoice | null` (addresses compared lowercased)
  - `announce(msg: { address: string; ids: string[] }): void`, `onAnnounce(fn: (msg) => void): () => void`

- [ ] **Step 1: Write the failing tests**

`app/lib/watchlist-local.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ASK_KEY,
  clearLocal,
  LOCAL_KEY,
  readAsk,
  readLocal,
  useAsk,
  useLocalWatchlist,
  writeAsk,
  writeLocal,
} from "./watchlist-local";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("reads, writes and clears the browser list; junk reads as empty", () => {
  expect(readLocal()).toEqual([]);
  writeLocal(["a", "b"]);
  expect(JSON.parse(localStorage.getItem(LOCAL_KEY)!)).toEqual(["a", "b"]);
  expect(readLocal()).toEqual(["a", "b"]);
  localStorage.setItem(LOCAL_KEY, '{"x":1}');
  expect(readLocal()).toEqual([]);
  localStorage.setItem(LOCAL_KEY, '["a", 2]');
  expect(readLocal()).toEqual(["a"]);
  clearLocal();
  expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
});

it("every hook in the tab sees a write at once, and a write from another tab", () => {
  const one = renderHook(() => useLocalWatchlist());
  const two = renderHook(() => useLocalWatchlist());
  act(() => writeLocal(["a"]));
  expect(one.result.current).toEqual(["a"]);
  expect(two.result.current).toEqual(["a"]);
  act(() => {
    localStorage.setItem(LOCAL_KEY, '["a","b"]');
    dispatchEvent(new StorageEvent("storage", { key: LOCAL_KEY }));
  });
  expect(one.result.current).toEqual(["a", "b"]);
});

it("the ask state is kept per account: always, never, or later for one sign-in", () => {
  const ask = renderHook(() => useAsk("0xabc"));
  expect(ask.result.current).toBeNull();
  act(() => writeAsk("0xABC", "later:123"));
  expect(readAsk("0xabc")).toBe("later:123");
  expect(ask.result.current).toBe("later:123");
  act(() => writeAsk("0xdef", "never"));
  expect(readAsk("0xabc")).toBe("later:123");
  act(() => writeAsk("0xabc", "always"));
  expect(JSON.parse(localStorage.getItem(ASK_KEY)!)).toEqual({ "0xabc": "always", "0xdef": "never" });
  localStorage.setItem(ASK_KEY, "not json");
  expect(readAsk("0xabc")).toBeNull();
});

it("storage off: reads are empty and writes do not throw", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readLocal()).toEqual([]);
  expect(readAsk("0xabc")).toBeNull();
  expect(() => writeLocal(["a"])).not.toThrow();
  expect(() => writeAsk("0xabc", "never")).not.toThrow();
  expect(() => clearLocal()).not.toThrow();
});
```

`app/lib/watchlist-channel.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { announce, onAnnounce } from "./watchlist-channel";

it("a message reaches listeners in other contexts, not the sender's own", async () => {
  if (typeof BroadcastChannel === "undefined") return; // the fallback is the focus refetch
  const other = new BroadcastChannel("thedao:watchlist");
  const got = new Promise((resolve) => (other.onmessage = (e) => resolve(e.data)));
  announce({ address: "0xabc", ids: ["a"] });
  expect(await got).toEqual({ address: "0xabc", ids: ["a"] });
  other.close();
});

it("onAnnounce delivers messages from other contexts and unsubscribes", async () => {
  if (typeof BroadcastChannel === "undefined") return;
  const fn = vi.fn();
  const off = onAnnounce(fn);
  const other = new BroadcastChannel("thedao:watchlist");
  other.postMessage({ address: "0xabc", ids: ["b"] });
  await vi.waitFor(() => expect(fn).toHaveBeenCalledWith({ address: "0xabc", ids: ["b"] }));
  off();
  other.close();
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno run -A npm:vitest run app/lib/watchlist-local.test.ts app/lib/watchlist-channel.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: The store**

`app/lib/watchlist-local.ts`:

```ts
import { useSyncExternalStore } from "react";

/** This browser's watchlist (initiative ids). */
export const LOCAL_KEY = "thedao:watchlist";
/** Per account (lowercased address): whether to offer moving it there. */
export const ASK_KEY = "thedao:watchlist-ask";

// storage events reach other tabs only; this one tells the hooks in this tab.
const SAME_TAB = "thedao:watchlist-local";

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage off: lasts for this page view */ }
  dispatchEvent(new CustomEvent(SAME_TAB, { detail: key }));
}

function parse(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export const readLocal = (): string[] => parse(get(LOCAL_KEY));
export const writeLocal = (ids: string[]) => set(LOCAL_KEY, JSON.stringify(ids));
export const clearLocal = () => set(LOCAL_KEY, null);

/** "always": move on sign-in without asking; "never": do not ask; "later:<expiresAt>": not
 * during this sign-in. */
export type AskChoice = "always" | "never" | `later:${number}`;

function askMap(raw: string | null): Record<string, AskChoice> {
  try {
    const v = JSON.parse(raw ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export const readAsk = (address: string): AskChoice | null =>
  askMap(get(ASK_KEY))[address.toLowerCase()] ?? null;
export const writeAsk = (address: string, choice: AskChoice) =>
  set(ASK_KEY, JSON.stringify({ ...askMap(get(ASK_KEY)), [address.toLowerCase()]: choice }));

function subscribe(key: string) {
  return (notify: () => void) => {
    const onStorage = (e: StorageEvent) => e.key === key && notify();
    const onLocal = (e: Event) => (e as CustomEvent).detail === key && notify();
    addEventListener("storage", onStorage);
    addEventListener(SAME_TAB, onLocal);
    return () => {
      removeEventListener("storage", onStorage);
      removeEventListener(SAME_TAB, onLocal);
    };
  };
}

const subscribeLocal = subscribe(LOCAL_KEY);
const subscribeAsk = subscribe(ASK_KEY);

// useSyncExternalStore compares snapshots with Object.is: cache the parsed list per raw string.
let lastRaw: string | null | undefined;
let lastIds: string[] = [];
const localSnapshot = () => {
  const raw = get(LOCAL_KEY);
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastIds = parse(raw);
  }
  return lastIds;
};
const EMPTY: string[] = [];

/** The browser list, re-read on every write in this tab or another. */
export const useLocalWatchlist = (): string[] =>
  useSyncExternalStore(subscribeLocal, localSnapshot, () => EMPTY);

export const useAsk = (address: string): AskChoice | null =>
  useSyncExternalStore(subscribeAsk, () => readAsk(address), () => null);
```

- [ ] **Step 4: The channel**

`app/lib/watchlist-channel.ts`:

```ts
/** Tells this browser's other tabs the account watchlist changed. Missing
 * BroadcastChannel: a no-op (tabs still refetch on focus). */
export type WatchlistMessage = { address: string; ids: string[] };

const NAME = "thedao:watchlist";
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(NAME);

export function announce(msg: WatchlistMessage) {
  channel?.postMessage({ address: msg.address.toLowerCase(), ids: msg.ids });
}

export function onAnnounce(fn: (msg: WatchlistMessage) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  // A channel object never receives its own messages: listen on a separate one.
  const listener = new BroadcastChannel(NAME);
  listener.onmessage = (e: MessageEvent<WatchlistMessage>) => fn(e.data);
  return () => listener.close();
}
```

- [ ] **Step 5: The hook uses the store**

Replace the browser-list part of `app/hooks/use-watchlist.ts` (keep `isNew` as is):

```ts
import { useCallback } from "react";
import { useLocalWatchlist, writeLocal } from "~/lib/watchlist-local";

/** This browser's watchlist (initiative ids), in localStorage; other tabs stay in step. */
export function useWatchlist() {
  const ids = useLocalWatchlist();
  const toggle = useCallback((id: string) => {
    writeLocal(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }, [ids]);
  return { ids, has: (id: string) => ids.includes(id), toggle };
}
```

- [ ] **Step 6: Run the tests**

Run: `deno run -A npm:vitest run`
Expected: all pass (the board and card tests use the hook unchanged).

- [ ] **Step 7: Commit**

```bash
deno fmt app && deno lint && deno task typecheck
git add app/lib/watchlist-local.ts app/lib/watchlist-local.test.ts app/lib/watchlist-channel.ts app/lib/watchlist-channel.test.ts app/hooks/use-watchlist.ts
git commit -m "Watchlist (client): the browser list and the ask state as one store every hook in the tab shares, and a BroadcastChannel for the account list"
```

---

### Task 3: Client: the account list behind `useWatchlist()`

**Files:**
- Modify: `app/lib/api.ts:18-20` (allow `"PUT"`)
- Modify: `app/lib/api-types.ts:302-309` (`Me.hasWatchlist`)
- Modify: `app/lib/browser-privacy.ts:38-46` (`"watchlist"` is a private query root)
- Modify: `app/hooks/use-watchlist.ts`
- Create: `app/hooks/use-watchlist.test.tsx`
- Modify: `app/routes/board.tsx` (the failure note)
- Modify: `app/routes/board.test.tsx` (mock the session)

**Interfaces:**
- Consumes: Task 2's store and channel; Task 1's routes.
- Produces: `watchlistKey(address: string): readonly ["watchlist", string]`; `fetchAccountWatchlist(signal?): Promise<string[] | null>`; `useWatchlist(): { ids: string[]; has(id: string): boolean; toggle(id: string): void; source: "browser" | "account"; error: string | null }`.

- [ ] **Step 1: Write the failing tests**

`app/hooks/use-watchlist.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWatchlist, watchlistKey } from "./use-watchlist";
import { writeLocal } from "~/lib/watchlist-local";

const session = vi.hoisted(() => ({ value: { session: null, me: null } as Record<string, unknown> }));
vi.mock("~/context/session", () => ({ useSession: () => session.value }));
const api = vi.hoisted(() => vi.fn());
vi.mock("~/lib/api", async (o) => ({ ...(await o<object>()), api }));
const channel = vi.hoisted(() => ({ announce: vi.fn(), listeners: [] as ((m: unknown) => void)[] }));
vi.mock("~/lib/watchlist-channel", () => ({
  announce: channel.announce,
  onAnnounce: (fn: (m: unknown) => void) => {
    channel.listeners.push(fn);
    return () => {};
  },
}));

const A = "0xaaaa000000000000000000000000000000000000";
const signedIn = (hasWatchlist: boolean) => {
  session.value = {
    session: { address: A, isAdmin: false, expiresAt: 9 },
    me: { address: A, isAdmin: false, expiresAt: 9, hasWatchlist },
  };
};

let qc: QueryClient;
const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  session.value = { session: null, me: null };
  channel.listeners = [];
});
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

it("signed out, or signed in without an account list: the browser list", () => {
  writeLocal(["x"]);
  const out = renderHook(() => useWatchlist(), { wrapper: wrap });
  expect(out.result.current.source).toBe("browser");
  expect(out.result.current.ids).toEqual(["x"]);
  signedIn(false);
  const inNoList = renderHook(() => useWatchlist(), { wrapper: wrap });
  expect(inNoList.result.current.source).toBe("browser");
  expect(api).not.toHaveBeenCalled();
});

it("signed in with an account list: reads it, adds with PUT and removes with DELETE", async () => {
  signedIn(true);
  writeLocal(["local-only"]);
  api.mockResolvedValueOnce({ ids: ["a"] });
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  await waitFor(() => expect(result.current.ids).toEqual(["a"]));
  expect(result.current.source).toBe("account");

  api.mockResolvedValueOnce({ ids: ["a", "b"] });
  act(() => result.current.toggle("b"));
  expect(result.current.ids).toEqual(["a", "b"]); // at once
  expect(api).toHaveBeenLastCalledWith("/api/watchlist/b", { method: "PUT" });
  await waitFor(() => expect(channel.announce).toHaveBeenCalledWith({ address: A, ids: ["a", "b"] }));

  api.mockResolvedValueOnce({ ids: ["b"] });
  act(() => result.current.toggle("a"));
  expect(api).toHaveBeenLastCalledWith("/api/watchlist/a", { method: "DELETE" });
  await waitFor(() => expect(result.current.ids).toEqual(["b"]));
});

it("a failed add rolls back and says so", async () => {
  signedIn(true);
  api.mockResolvedValueOnce({ ids: [] });
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  await waitFor(() => expect(result.current.source).toBe("account"));
  api.mockRejectedValueOnce(new Error("offline"));
  act(() => result.current.toggle("b"));
  await waitFor(() => expect(result.current.ids).toEqual([]));
  expect(result.current.error).toBe("Couldn't update your watchlist.");
});

it("a broadcast for this account replaces the list; one for another account is ignored", async () => {
  signedIn(true);
  api.mockResolvedValueOnce({ ids: ["a"] });
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  await waitFor(() => expect(result.current.ids).toEqual(["a"]));
  act(() => channel.listeners.forEach((fn) => fn({ address: "0xbbbb", ids: ["z"] })));
  expect(result.current.ids).toEqual(["a"]);
  act(() => channel.listeners.forEach((fn) => fn({ address: A, ids: ["a", "c"] })));
  expect(result.current.ids).toEqual(["a", "c"]);
});

it("sign-out drops the account list from the cache", async () => {
  const { clearPrivateQueries } = await import("~/lib/browser-privacy");
  qc.setQueryData(watchlistKey(A), ["a"]);
  clearPrivateQueries(qc);
  expect(qc.getQueryData(watchlistKey(A))).toBeUndefined();
});

it("a list put in the cache (after a move) switches to the account list without /me", () => {
  signedIn(false);
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  act(() => qc.setQueryData(watchlistKey(A), ["m"]));
  expect(result.current.source).toBe("account");
  expect(result.current.ids).toEqual(["m"]);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno run -A npm:vitest run app/hooks/use-watchlist.test.tsx`
Expected: FAIL (`watchlistKey` not exported, no `source`).

- [ ] **Step 3: Types and plumbing**

`app/lib/api.ts`, `ApiOptions.method`:

```ts
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
```

`app/lib/api-types.ts`, `Me`:

```ts
  /** The account keeps a watchlist (the browser list can be moved to it). */
  hasWatchlist?: boolean;
```

`app/lib/browser-privacy.ts`, add `"watchlist",` to the `roots` set in `clearPrivateQueries` (sign-out drops the account list).

- [ ] **Step 4: The hook**

`app/hooks/use-watchlist.ts` (keep `isNew` at the bottom):

```ts
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "~/context/session";
import { api, ApiError } from "~/lib/api";
import { announce, onAnnounce } from "~/lib/watchlist-channel";
import { useLocalWatchlist, writeLocal } from "~/lib/watchlist-local";

export const watchlistKey = (address: string) => ["watchlist", address.toLowerCase()] as const;

/** The account's list; null when the account has none yet. */
export const fetchAccountWatchlist = (signal?: AbortSignal) =>
  api<{ ids: string[] }>("/api/watchlist", { signal, passive: true }).then(
    (r) => r.ids,
    (e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e)),
  );

/**
 * The watchlist the board shows: the account's once it has one (signed in),
 * else this browser's. Account changes show at once, roll back on failure and
 * reach this browser's other tabs.
 */
export function useWatchlist() {
  const { session, me } = useSession();
  const address = session?.address.toLowerCase() ?? "";
  const qc = useQueryClient();
  const local = useLocalWatchlist();
  const [error, setError] = useState<string | null>(null);
  const key = watchlistKey(address);
  const account = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchAccountWatchlist(signal),
    enabled: Boolean(address && me?.hasWatchlist),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!address) return;
    return onAnnounce((msg) => {
      if (msg.address === address) qc.setQueryData(watchlistKey(address), msg.ids);
    });
  }, [address, qc]);

  const onAccount = Boolean(address) && Array.isArray(account.data);
  const ids = onAccount ? account.data as string[] : local;

  const toggle = useCallback((id: string) => {
    setError(null);
    const on = ids.includes(id);
    if (!onAccount) {
      writeLocal(on ? ids.filter((x) => x !== id) : [...ids, id]);
      return;
    }
    const before = ids;
    qc.setQueryData(key, on ? ids.filter((x) => x !== id) : [...ids, id]);
    api<{ ids: string[] }>(`/api/watchlist/${encodeURIComponent(id)}`, {
      method: on ? "DELETE" : "PUT",
    }).then(
      (r) => {
        qc.setQueryData(key, r.ids);
        announce({ address, ids: r.ids });
      },
      () => {
        qc.setQueryData(key, before);
        setError("Couldn't update your watchlist.");
      },
    );
  }, [ids, onAccount, qc, address]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ids,
    has: (id: string) => ids.includes(id),
    toggle,
    source: onAccount ? "account" as const : "browser" as const,
    error,
  };
}
```

(`key` is derived from `address`, so `address` in the deps covers it; drop the eslint comment if `deno lint` does not run that rule.)

- [ ] **Step 5: Board: failure note and test mock**

In `app/routes/board.tsx`, right after the `<FilterBar ... />` block (inside `data && all.length > 0`):

```tsx
        <p className="m-0 mb-3 small text-dao-red empty:hidden" role="status" aria-live="polite">
          {watchlist.error}
        </p>
```

In `app/routes/board.test.tsx`, with the other mocks:

```ts
vi.mock("~/context/session", () => ({ useSession: () => ({ session: null, me: null }) }));
```

- [ ] **Step 6: Run the tests**

Run: `deno run -A npm:vitest run`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
deno fmt app && deno lint && deno task typecheck
git add app/lib/api.ts app/lib/api-types.ts app/lib/browser-privacy.ts app/hooks/use-watchlist.ts app/hooks/use-watchlist.test.tsx app/routes/board.tsx app/routes/board.test.tsx
git commit -m "Watchlist (client): signed in with an account list, the board reads it and the bookmark adds with PUT and removes with DELETE, at once and rolled back on failure; other tabs follow the broadcast; sign-out drops it"
```

---

### Task 4: The offer card under the wallet button, and the automatic move

**Files:**
- Create: `app/hooks/use-watchlist-offer.ts`
- Create: `app/components/wallet/WatchlistOffer.tsx` (lazy chunk)
- Create: `app/components/wallet/WatchlistOfferSlot.tsx` (tiny, eager)
- Create: `app/components/wallet/WatchlistOffer.test.tsx`
- Modify: `app/components/layout/TopBar.tsx:84-96` (render the slot beside `ConnectButton`)

**Interfaces:**
- Consumes: Task 2 (`useLocalWatchlist`, `useAsk`, `writeAsk`, `readLocal`, `clearLocal`, `ASK_KEY`, `AskChoice`), Task 3 (`watchlistKey`), `announce`.
- Produces:
  - `useWatchlistOffer(): { mode: "none" | "ask" | "auto"; count: number; address: string; expiresAt: number }`
  - `moveToAccount(qc: QueryClient, address: string): Promise<string[]>` (imports `readLocal()`, puts the result in the cache, broadcasts it, clears the browser list; throws the `api` error on failure)
  - `WatchlistOffer` props `{ count: number; address: string; expiresAt: number; onDone: (moved: boolean) => void }`

- [ ] **Step 1: Write the failing tests**

`app/components/wallet/WatchlistOffer.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WatchlistOfferSlot from "./WatchlistOfferSlot";
import { ASK_KEY, readLocal, writeAsk, writeLocal } from "~/lib/watchlist-local";
import { watchlistKey } from "~/hooks/use-watchlist";

const session = vi.hoisted(() => ({ value: { session: null, me: null } as Record<string, unknown> }));
vi.mock("~/context/session", () => ({ useSession: () => session.value }));
const api = vi.hoisted(() => vi.fn());
vi.mock("~/lib/api", async (o) => ({ ...(await o<object>()), api }));
vi.mock("~/lib/watchlist-channel", () => ({ announce: vi.fn(), onAnnounce: () => () => {} }));

const A = "0xaaaa000000000000000000000000000000000000";
const B = "0xbbbb000000000000000000000000000000000000";
const signIn = (address = A, expiresAt = 9) => {
  session.value = {
    session: { address, isAdmin: false, expiresAt },
    me: { address, isAdmin: false, expiresAt, hasWatchlist: false },
  };
};
let qc: QueryClient;
const mount = () =>
  render(
    <QueryClientProvider client={qc}>
      <WatchlistOfferSlot />
    </QueryClientProvider>,
  );
const title = () => screen.queryByText("Keep your watchlist on your account?");
const asked = () => JSON.parse(localStorage.getItem(ASK_KEY) ?? "{}");

beforeEach(() => {
  qc = new QueryClient();
  session.value = { session: null, me: null };
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("asks only when signed in with a non-empty browser list", async () => {
  writeLocal(["a", "b", "c"]);
  const { unmount } = mount();
  expect(title()).toBeNull();
  unmount();
  signIn();
  mount();
  expect(await screen.findByText("Keep your watchlist on your account?")).toBeInTheDocument();
  expect(screen.getByText(/You have 3 initiatives on this browser's watchlist\./)).toBeInTheDocument();
});

it("one initiative reads in the singular", async () => {
  writeLocal(["a"]);
  signIn();
  mount();
  expect(await screen.findByText(/You have 1 initiative on this browser's watchlist\./))
    .toBeInTheDocument();
});

it("Move imports, clears the browser list only after success, and says so", async () => {
  writeLocal(["a", "b"]);
  signIn();
  let resolve!: (v: unknown) => void;
  api.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Move to my account" }));
  expect(api).toHaveBeenCalledWith("/api/watchlist/import", { json: { ids: ["a", "b"] } });
  expect(readLocal()).toEqual(["a", "b"]); // not before the server says yes
  resolve({ ids: ["a", "b"] });
  expect(await screen.findByText("Watchlist moved to your account.")).toBeInTheDocument();
  expect(readLocal()).toEqual([]);
  expect(qc.getQueryData(watchlistKey(A))).toEqual(["a", "b"]);
  expect(asked()[A]).toBeUndefined(); // no box ticked: nothing remembered
});

it("a failed move keeps the browser list and offers to try again", async () => {
  writeLocal(["a"]);
  signIn();
  api.mockRejectedValueOnce(new Error("offline"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Move to my account" }));
  expect(await screen.findByText("Couldn't move your watchlist. Try again.")).toBeInTheDocument();
  expect(readLocal()).toEqual(["a"]);
});

it("Not now hides it until the next sign-in; with Don't ask again, never for this account", async () => {
  writeLocal(["a"]);
  signIn(A, 9);
  const { unmount } = mount();
  fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
  await waitFor(() => expect(title()).toBeNull());
  expect(asked()[A]).toBe("later:9");
  unmount();
  signIn(A, 10); // a new sign-in asks again
  mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Don't ask again" }));
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(title()).toBeNull());
  expect(asked()[A]).toBe("never");
});

it("Don't ask again with Move: the next sign-in with bookmarks moves them without asking", async () => {
  writeLocal(["a"]);
  signIn(A, 9);
  api.mockResolvedValueOnce({ ids: ["a"] });
  const { unmount } = mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Don't ask again" }));
  fireEvent.click(screen.getByRole("button", { name: "Move to my account" }));
  await screen.findByText("Watchlist moved to your account.");
  expect(asked()[A]).toBe("always");
  unmount();

  writeLocal(["b"]); // bookmarked while signed out
  signIn(A, 10);
  api.mockResolvedValueOnce({ ids: ["a", "b"] });
  mount();
  expect(await screen.findByText("Watchlist moved to your account.")).toBeInTheDocument();
  expect(title()).toBeNull();
  expect(api).toHaveBeenLastCalledWith("/api/watchlist/import", { json: { ids: ["b"] } });
  expect(readLocal()).toEqual([]);
});

it("an automatic move that fails shows nothing and keeps the bookmarks", async () => {
  writeLocal(["b"]);
  writeAsk(A, "always");
  signIn(A);
  api.mockRejectedValueOnce(new Error("offline"));
  mount();
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(title()).toBeNull();
  expect(screen.queryByText("Watchlist moved to your account.")).toBeNull();
  expect(readLocal()).toEqual(["b"]);
});

it("another account on the same browser is still asked", async () => {
  writeLocal(["a"]);
  writeAsk(A, "always");
  signIn(B);
  mount();
  expect(await screen.findByText("Keep your watchlist on your account?")).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

it("storage off: nothing can be on the browser list, so nothing is offered, and nothing throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  signIn();
  mount();
  expect(title()).toBeNull();
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno run -A npm:vitest run app/components/wallet/WatchlistOffer.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: The offer hook and the move**

`app/hooks/use-watchlist-offer.ts`:

```ts
import type { QueryClient } from "@tanstack/react-query";
import { useSession } from "~/context/session";
import { api } from "~/lib/api";
import { announce } from "~/lib/watchlist-channel";
import { clearLocal, readLocal, useAsk, useLocalWatchlist } from "~/lib/watchlist-local";
import { watchlistKey } from "~/hooks/use-watchlist";

/**
 * What to do with this browser's watchlist for the signed-in account: nothing,
 * ask (the card), or move it without asking (the account answered "always").
 */
export function useWatchlistOffer() {
  const { session, me } = useSession();
  const local = useLocalWatchlist();
  const address = session?.address.toLowerCase() ?? "";
  const ask = useAsk(address);
  const expiresAt = me?.expiresAt ?? 0;
  const ready = Boolean(address && me) && local.length > 0;
  const mode = !ready || ask === "never" || ask === `later:${expiresAt}`
    ? "none" as const
    : ask === "always"
    ? "auto" as const
    : "ask" as const;
  return { mode, count: local.length, address, expiresAt };
}

/** Moves the browser list into the account: import, cache, tell the other tabs, clear. */
export async function moveToAccount(qc: QueryClient, address: string): Promise<string[]> {
  const r = await api<{ ids: string[] }>("/api/watchlist/import", { json: { ids: readLocal() } });
  qc.setQueryData(watchlistKey(address), r.ids);
  announce({ address, ids: r.ids });
  clearLocal();
  return r.ids;
}
```

- [ ] **Step 4: The card (lazy)**

`app/components/wallet/WatchlistOffer.tsx`:

```tsx
import { useId, useState } from "react";
import { X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "~/components/ui/Button";
import { ApiError } from "~/lib/api";
import { plural } from "~/lib/format";
import { writeAsk } from "~/lib/watchlist-local";
import { moveToAccount } from "~/hooks/use-watchlist-offer";

/** The offer to move this browser's watchlist to the account. Not modal: it never takes focus.
 * "Don't ask again" remembers the answer it is ticked with, for this account. */
export default function WatchlistOffer(
  { count, address, expiresAt, onDone }: {
    count: number;
    address: string;
    expiresAt: number;
    onDone: (moved: boolean) => void;
  },
) {
  const qc = useQueryClient();
  const ids = useId();
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const move = async () => {
    setBusy(true);
    setError("");
    try {
      await moveToAccount(qc, address);
      if (remember) writeAsk(address, "always");
      onDone(true);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 400
          ? "Your watchlist is over 200 initiatives. Remove some and try again."
          : "Couldn't move your watchlist. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const later = () => {
    writeAsk(address, remember ? "never" : `later:${expiresAt}`);
    onDone(false);
  };

  return (
    <section
      aria-labelledby={`${ids}-t`}
      aria-live="polite"
      className="card relative w-[320px] p-4 text-left shadow-menu max-[640px]:w-auto"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={later}
        className="absolute right-2 top-2 grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-white/60 hover:text-white"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <h2 id={`${ids}-t`} className="m-0 pr-8 font-inter-tight text-[15px] font-medium text-white">
        Keep your watchlist on your account?
      </h2>
      <p className="mb-3 mt-1.5 text-[13px] leading-[1.5] text-white/65">
        You have {plural(count, "initiative")} on this browser's watchlist. Move them to your
        account to see them wherever you sign in.
      </p>
      {error && <p className="mb-3 mt-0 text-[13px] text-dao-red">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" sm onClick={() => void move()} disabled={busy}>
          Move to my account
        </Button>
        <Button variant="ghost" sm onClick={later} disabled={busy}>Not now</Button>
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12.5px] text-white/60">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Don't ask again
      </label>
    </section>
  );
}
```

- [ ] **Step 5: The slot (eager, tiny) and the header**

`app/components/wallet/WatchlistOfferSlot.tsx`:

```tsx
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { moveToAccount, useWatchlistOffer } from "~/hooks/use-watchlist-offer";

const WatchlistOffer = lazy(() => import("./WatchlistOffer"));
const MOVED_MS = 4000;

/** Under the wallet button: the offer while it applies (or the move itself, when the
 * account said "always"), then "moved" for a moment. */
export default function WatchlistOfferSlot() {
  const offer = useWatchlistOffer();
  const qc = useQueryClient();
  const [moved, setMoved] = useState(false);
  // One automatic try per sign-in; a failure waits for the next one.
  const tried = useRef("");

  useEffect(() => {
    const signIn = `${offer.address}:${offer.expiresAt}`;
    if (offer.mode !== "auto" || tried.current === signIn) return;
    tried.current = signIn;
    moveToAccount(qc, offer.address).then(() => setMoved(true), () => {});
  }, [offer.mode, offer.address, offer.expiresAt, qc]);

  useEffect(() => {
    if (!moved) return;
    const t = setTimeout(() => setMoved(false), MOVED_MS);
    return () => clearTimeout(t);
  }, [moved]);

  if (offer.mode !== "ask" && !moved) return null;
  return (
    <div className="absolute right-0 top-full z-[70] mt-2 max-[640px]:fixed max-[640px]:inset-x-4 max-[640px]:top-[64px]">
      {moved
        ? (
          <p role="status" className="card m-0 w-[320px] p-4 text-[13px] text-white max-[640px]:w-auto">
            Watchlist moved to your account.
          </p>
        )
        : (
          <Suspense fallback={null}>
            <WatchlistOffer
              count={offer.count}
              address={offer.address}
              expiresAt={offer.expiresAt}
              onDone={(m) => m && setMoved(true)}
            />
          </Suspense>
        )}
    </div>
  );
}
```

In `app/components/layout/TopBar.tsx`: `import WatchlistOfferSlot from "~/components/wallet/WatchlistOfferSlot";`, and wrap the wallet button so the card anchors to it:

```tsx
          {staticShell ? <Fallback /> : (
            <div className="relative">
              <Suspense fallback={<Fallback />}>
                <ConnectButton />
              </Suspense>
              <WatchlistOfferSlot />
            </div>
          )}
```

- [ ] **Step 6: Run the tests**

Run: `deno run -A npm:vitest run`
Expected: all pass. If the TopBar tests fail because `useSession` is missing there, add to `app/components/layout/TopBar.test.tsx`:

```ts
vi.mock("~/components/wallet/WatchlistOfferSlot", () => ({ default: () => null }));
```

- [ ] **Step 7: Commit**

```bash
deno fmt app && deno lint && deno task typecheck
git add app/hooks/use-watchlist-offer.ts app/components/wallet/WatchlistOffer.tsx app/components/wallet/WatchlistOfferSlot.tsx app/components/wallet/WatchlistOffer.test.tsx app/components/layout/TopBar.tsx
git commit -m "Watchlist: after sign-in, a card under the wallet button offers to move this browser's watchlist to the account (Move to my account / Not now / Don't ask again, remembered per account: with Move, later bookmarks move on sign-in without asking); the card loads only when it applies"
```

---

### Task 5: Verify end to end and open the PR

**Files:** none new.

- [ ] **Step 1: Full checks**

Run: `deno task typecheck && deno lint && deno fmt --check app api shared && deno run -A npm:vitest run && deno test -A api/`
Expected: all clean, all pass.

- [ ] **Step 2: Bundle check**

Run: `deno task build` and compare the board route's gzipped JS with `board-p2`'s (`git stash`-free: build `board-p2` in a second worktree or note the sizes from `build/client/assets`). Expected: the board chunk grows by at most ~1 kB (the slot and the store); `WatchlistOffer-*.js` is its own chunk.

- [ ] **Step 3: Manual QA on the dev server**

Run: `KV_PATH=<scratch sqlite> deno task dev`, open `http://localhost:5173`.
1. Signed out, bookmark two initiatives. Sign in: the card appears under the wallet button reading "You have 2 initiatives…".
2. Open a second tab on the board. In the first, click Move to my account: "Watchlist moved to your account." shows for 4 s; in the second tab the card closes and the Watchlist pill shows 2 (focus it if needed).
3. Remove one bookmark in tab two: tab one updates.
4. Sign out: the Watchlist pill disappears (browser list is empty).
5. Bookmark one while signed out, sign in, tick Don't ask again, Move: sign out, bookmark another, sign in: it moves without the card, only the moved note shows. With another wallet on the same browser the card still asks.
6. At 390px the card spans the width under the header, no sideways scroll.

- [ ] **Step 4: Push and open the PR (after the user approves pushing)**

```bash
git push -u origin watchlist-account
gh pr create --base board-p2 --title "Watchlist on the account, offered after sign-in" --body-file <(printf '%s\n' "Stacked on #58. Spec: docs/superpowers/specs/2026-09-30-watchlist-on-account-design.md" "" "- API: GET / import / PUT :id / DELETE :id under /api/watchlist, 200 at most, rate limited; /me hasWatchlist; backed up." "- Client: the board reads the account list once it exists; add and remove at once with rollback; other tabs follow a BroadcastChannel; sign-out drops it." "- A card under the wallet button offers to move the browser list (Move to my account / Not now / Don't ask again).")
```
