/**
 * Agent-readable feeds, no JavaScript, wallet or login needed: /llms.txt,
 * /llms-full.txt, /api/initiatives.json and its schema. Open to
 * any origin (no credentials), cached FEED_TTL_SECS, with an ETag.
 */
import { type Context, Hono } from "hono";
import { encodeHex } from "@std/encoding/hex";
import type { Deps, Vars } from "../middleware/context.ts";
import { type BoardCache, readBoard } from "./board.ts";
import { buildFeed, type Feed, filterFeed, llmsFull, llmsIndex } from "../services/feed.ts";
import { FEED_JSON_SCHEMA } from "../services/feed-schema.ts";
import { gunzip, gzip } from "../lib/gzip.ts";

export const FEED_PATHS = [
  "/llms.txt",
  "/llms-full.txt",
  "/api/initiatives.json",
  "/api/initiatives.schema.json",
] as const;

/** How long a built feed serves: in an isolate's memory and as the KV copy every
 * isolate shares. Also the HTTP max-age: agents need no finer freshness. */
export const FEED_TTL_SECS = 300;

/**
 * One feed per origin (prod and preview hosts write their own URLs). A read is
 * served from this isolate's memory inside the window, else from the gzipped
 * copy in KV that another isolate stored (db/snapshots.ts), and only then
 * built from the board, which costs a KV read wave per card (#46, #47). Every
 * write request drops the memory here and the KV copy for everyone; another
 * isolate's memory can be up to FEED_TTL_SECS behind.
 */
export function createFeedCache(deps: Deps, board: BoardCache) {
  const { db, now, log } = deps;
  const saved = new Map<string, { feed: Feed; until: number }>();
  const inflight = new Map<string, Promise<Feed>>();
  const load = async (origin: string): Promise<Feed> => {
    const stored = await db.snapshots.get("feed", origin).catch((e) => {
      log(`feed snapshot read failed: ${String(e)}`);
      return null;
    });
    if (stored) {
      const feed = JSON.parse(new TextDecoder().decode(await gunzip(stored.bytes))) as Feed;
      saved.set(origin, { feed, until: stored.until });
      return feed;
    }
    const feed = await buildFeed(deps, origin, (await readBoard(deps, board)).cards);
    saved.set(origin, { feed, until: now() + FEED_TTL_SECS });
    try {
      const bytes = await gzip(new TextEncoder().encode(JSON.stringify(feed)));
      if (!await db.snapshots.set("feed", origin, bytes, FEED_TTL_SECS)) {
        log(`feed snapshot not stored: ${bytes.length} bytes gzipped is over the cap`);
      }
    } catch (e) {
      log(`feed snapshot write failed: ${String(e)}`);
    }
    return feed;
  };
  return {
    get(origin: string): Promise<Feed> {
      const s = saved.get(origin);
      if (s && now() < s.until) return Promise.resolve(s.feed);
      let p = inflight.get(origin);
      if (!p) {
        p = load(origin).finally(() => {
          if (inflight.get(origin) === p) inflight.delete(origin);
        });
        inflight.set(origin, p);
      }
      return p;
    },
    /** After a write: this isolate's copies and the shared KV copy. */
    async clear(): Promise<void> {
      saved.clear();
      inflight.clear();
      await db.snapshots.clear("feed").catch((e) =>
        log(`feed snapshot clear failed: ${String(e)}`)
      );
    },
    /** The origin to write into URLs: the request's own when it is a configured web
     * origin, the primary one otherwise (a spoofed Host never reaches a cached body). */
    origin(c: Context): string {
      const o = new URL(c.req.url).origin;
      return deps.config.webOrigins.includes(o) ? o : deps.config.webOrigins[0];
    },
  };
}
export type FeedCache = ReturnType<typeof createFeedCache>;

/** Weak: the same tag covers the gzip and identity encodings of the body. */
async function etagOf(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return `W/"${encodeHex(new Uint8Array(digest)).slice(0, 32)}"`;
}

/** If-None-Match as a list of tags, weak or strong; `*` matches anything. */
const matchesEtag = (header: string | undefined, etag: string): boolean =>
  (header ?? "").split(",").map((t) => t.trim().replace(/^W\//, "")).some((t) =>
    t === "*" || t === etag.replace(/^W\//, "")
  );

/** A public, cacheable body with an ETag; 304 when it matches. CORS comes from app.ts. */
export async function feedResponse(c: Context, body: string, type: string): Promise<Response> {
  const etag = await etagOf(body);
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Cache-Control": `public, max-age=${FEED_TTL_SECS}`,
    ETag: etag,
  };
  if (matchesEtag(c.req.header("If-None-Match"), etag)) return c.body(null, 304, headers);
  return c.body(body, 200, headers);
}

export function feedRoutes(feeds: FeedCache) {
  const r = new Hono<Vars>();
  r.get("/llms.txt", async (c) => {
    const o = feeds.origin(c);
    return feedResponse(c, llmsIndex(await feeds.get(o), o), "text/plain; charset=utf-8");
  });
  r.get("/llms-full.txt", async (c) => {
    const o = feeds.origin(c);
    return feedResponse(c, llmsFull(await feeds.get(o), o), "text/plain; charset=utf-8");
  });
  r.get("/api/initiatives.json", async (c) => {
    const feed = filterFeed(await feeds.get(feeds.origin(c)), {
      type: c.req.query("type"),
      cat: c.req.query("cat"),
      status: c.req.query("status"),
    });
    return feedResponse(c, JSON.stringify(feed), "application/json; charset=utf-8");
  });
  r.get(
    "/api/initiatives.schema.json",
    (c) => feedResponse(c, JSON.stringify(FEED_JSON_SCHEMA, null, 2), "application/schema+json"),
  );
  return r;
}
