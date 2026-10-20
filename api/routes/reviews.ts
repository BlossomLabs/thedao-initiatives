import { type Context, Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAdmin } from "../middleware/auth.ts";
import { jsonBody, s } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";
import { COMMENT_BODY_MAX } from "../config.ts";
import { isStars, type RatingSummary, summarize } from "../../shared/ratings.ts";
import type { Review } from "../db/types.ts";

const WRITES_PER_MINUTE = 30;

/**
 * Admin star ratings, mounted under /api/admin: only admins read or write
 * them. Nothing here reaches the board, the comments or the feeds; each
 * admin's browser fetches them and merges them in.
 */
export function reviewRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db } = deps;
  r.use("*", requireAdmin);

  const me = (c: Context<Vars>) => c.var.user!.address;
  const initiativeOr404 = async (id: string) => {
    const initiative = await db.initiatives.get(id);
    if (!initiative || !["approved", "archived"].includes(initiative.status)) {
      throw new HttpError(404, "not found");
    }
    return initiative;
  };
  const reviewJson = (row: Review, current: boolean) => ({
    id: row.id,
    address: row.address,
    stars: row.stars,
    body: row.body,
    createdAt: row.createdAt,
    current,
  });

  /** Every initiative's summary, for the board: { [id]: RatingSummary }. */
  r.get("/ratings", async (c) => {
    const out: Record<string, RatingSummary> = {};
    for (const [id, list] of await db.reviews.ratings()) out[id] = summarize(list, me(c));
    return c.json({ ratings: out });
  });

  /** One initiative's reviews, oldest first, and its summary. */
  r.get("/initiatives/:id/reviews", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"));
    const [rows, ratings] = await Promise.all([
      db.reviews.forInitiative(initiative.id),
      db.reviews.ratingsFor(initiative.id),
    ]);
    const current = new Set(ratings.map((x) => x.reviewId));
    return c.json({
      reviews: rows.map((row) => reviewJson(row, current.has(row.id))),
      summary: summarize(ratings, me(c)),
    });
  });

  r.post("/initiatives/:id/reviews", async (c) => {
    const address = me(c);
    if (!(await db.rateLimit("review:" + address.toLowerCase(), WRITES_PER_MINUTE, 60))) {
      throw new HttpError(429, "slow down");
    }
    const initiative = await initiativeOr404(c.req.param("id"));
    if (initiative.status !== "approved") {
      throw new HttpError(400, "only initiatives on the board can be rated");
    }
    const body = await jsonBody(c, ["stars", "body"]);
    if (!isStars(body.stars)) throw new HttpError(400, "stars must be 1 to 5");
    const text = s(body.body, COMMENT_BODY_MAX + 1);
    if (text.length > COMMENT_BODY_MAX) {
      throw new HttpError(400, `the text must be at most ${COMMENT_BODY_MAX} characters`);
    }
    const row = await db.reviews.create({
      initiativeId: initiative.id,
      address,
      stars: body.stars,
      body: text,
    });
    return c.json({ review: reviewJson(row, true) }, 201);
  });

  /** Only the author deletes a review; their previous one then counts again. */
  r.delete("/initiatives/:id/reviews/:reviewId", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"));
    const ok = await db.reviews.remove(initiative.id, c.req.param("reviewId"), me(c));
    if (!ok) throw new HttpError(404, "no such review of yours");
    return c.json({ ok: true });
  });

  return r;
}
