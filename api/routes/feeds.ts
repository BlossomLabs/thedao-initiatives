/**
 * Agent-readable feeds, no JavaScript, wallet or login needed: /llms.txt,
 * /llms-full.txt, /api/initiatives.json and its schema. Open to
 * any origin (no credentials), cached 5 minutes, with an ETag.
 */
import { type Context, Hono } from "hono";
import { encodeHex } from "@std/encoding/hex";
import type { Deps, Vars } from "../middleware/context.ts";
import { type BoardCache, readBoard } from "./board.ts";
import { buildFeed, type Feed, filterFeed, llmsFull, llmsIndex } from "../services/feed.ts";
import { FEED_JSON_SCHEMA } from "../services/feed-schema.ts";
import { createSnapshotCache, type SnapshotCache } from "../lib/snapshot-cache.ts";

export const FEED_PATHS = [
  "/llms.txt",
  "/llms-full.txt",
  "/api/initiatives.json",
  "/api/initiatives.schema.json",
] as const;

/** One feed per origin (prod and preview hosts write their own URLs). Cleared with the board. */
export function createFeedCache(deps: Deps, board: BoardCache) {
  const byOrigin = new Map<string, SnapshotCache<Feed>>();
  const cacheFor = (origin: string) => {
    let c = byOrigin.get(origin);
    if (!c) {
      // ponytail: a handful of hosts at most; drop the oldest past 8.
      if (byOrigin.size >= 8) byOrigin.delete(byOrigin.keys().next().value!);
      c = createSnapshotCache<Feed>(deps.now, deps.config.boardCacheSecs);
      byOrigin.set(origin, c);
    }
    return c;
  };
  const get = (origin: string): Promise<Feed> =>
    cacheFor(origin).get(async () => buildFeed(deps, origin, (await readBoard(deps, board)).cards));
  return {
    get,
    clear() {
      for (const c of byOrigin.values()) c.clear();
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
    "Cache-Control": "public, max-age=300",
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
