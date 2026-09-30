/** AI board search: advisory and client-side only; the stored order never changes. */
import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { requireClientIp } from "../middleware/ip.ts";
import { jsonBody, s } from "../lib/body.ts";
import { AI_QUERY_MAX_CHARS, aiFilterCategories, aiFilterRanked, aiTopK } from "../services/ai.ts";

const CACHE_TTL = 600;
const CACHE_MAX = 500;

export function aiRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db } = deps;
  const cache = new Map<string, [string[], number]>();

  r.post("/ai-search", async (c) => {
    if (!deps.ai.enabled) throw new HttpError(503, "search is not configured");
    const body = await jsonBody(c, ["query"]);
    const query = s(body.query, AI_QUERY_MAX_CHARS);
    if (query.length < 3) throw new HttpError(400, "describe what you want to fund");
    const initiatives = await db.initiatives.cards("approved");
    if (!initiatives.length) return c.json({ matches: [] });
    const items = initiatives.map((x) => ({
      id: x.id,
      title: x.title.slice(0, 120),
      summary: x.summary.slice(0, 300),
    }));
    const known = new Set(initiatives.map((x) => x.id));
    const k = aiTopK(initiatives.length);
    const key = query.toLowerCase() + "|" + [...known].sort().join(",");
    const hit = cache.get(key);
    if (hit && deps.now() - hit[1] < CACHE_TTL) return c.json({ matches: hit[0] });
    if (!(await db.rateLimit("ai:" + requireClientIp(c), 6, 60))) {
      throw new HttpError(429, "too many searches, wait a minute");
    }
    if (!(await db.rateLimit("ai:global", 30, 60))) {
      throw new HttpError(429, "search is busy, try again shortly");
    }
    if (!(await db.meta.aiBudgetOk())) {
      throw new HttpError(429, "search is resting until tomorrow");
    }
    let ranked: unknown;
    try {
      ranked = await deps.ai.rank(query, items);
    } catch (e) {
      deps.log(`ai-search failed: ${String(e)}`);
      throw new HttpError(502, "search is unavailable right now");
    }
    const matches = aiFilterRanked(ranked, known, k);
    cache.delete(key);
    cache.set(key, [matches, deps.now()]);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return c.json({ matches });
  });

  /** Category pre-fill for the submit form: advisory, the submitter confirms or changes it.
   * A failure is an error the form shows as "no suggestion"; the question stays required. */
  r.post("/ai-categories", async (c) => {
    if (!deps.ai.enabled) throw new HttpError(503, "suggestions are not configured");
    const body = await jsonBody(c, ["title", "summary"]);
    const title = s(body.title, 200);
    const summary = s(body.summary, 1000);
    if (title.length < 8 || summary.length < 20) {
      throw new HttpError(400, "add a title and summary first");
    }
    if (!(await db.rateLimit("ai-cat:" + requireClientIp(c), 10, 60))) {
      throw new HttpError(429, "too many suggestions, wait a minute");
    }
    if (!(await db.rateLimit("ai:global", 30, 60))) {
      throw new HttpError(429, "suggestions are busy, try again shortly");
    }
    if (!(await db.meta.aiBudgetOk())) {
      throw new HttpError(429, "suggestions are resting until tomorrow");
    }
    let raw: unknown;
    try {
      raw = await deps.ai.suggestCategories(title, summary);
    } catch (e) {
      deps.log(`ai-categories failed: ${String(e)}`);
      throw new HttpError(502, "suggestions are unavailable right now");
    }
    const categories = aiFilterCategories(raw);
    if (!categories.length) throw new HttpError(502, "no suggestion this time");
    return c.json({ categories });
  });

  return r;
}
