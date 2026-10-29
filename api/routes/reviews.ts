import { type Context, Hono, type Next } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonBody, s } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";
import { COMMENT_BODY_MAX } from "../config.ts";
import { isStars, type RatingSummary, summarize } from "../../shared/ratings.ts";
import type { Review } from "../db/types.ts";

import { ownsReviewToken, reviewTokenIds } from "../chain/reviewer.ts";

const WRITES_PER_MINUTE = 30;

/**
 * Public badge-backed reviews. Only authenticated current holders can write.
 * Optional tokenId personalizes the public summary using already-public ratings.
 */
type ReviewVars = Vars & { Variables: { reviewTokenIds: string[] } };

export function reviewRoutes(deps: Deps) {
  const r = new Hono<ReviewVars>();
  const { db } = deps;

  const tokenIdsFor = async (address: string) => {
    try {
      return await reviewTokenIds(deps.chain.rpc, address, deps.fetch);
    } catch {
      throw new HttpError(503, "Could not verify voting badge ownership. Please try again.");
    }
  };
  r.get("/identity", requireAuth, async (c) => {
    const ids = await tokenIdsFor(c.var.user!.address);
    return c.json({ tokenIds: ids, canReview: ids.length > 0 });
  });
  const requireHolder = async (c: Context<ReviewVars>, next: Next) => {
    const ids = await tokenIdsFor(c.var.user!.address);
    if (!ids.length) throw new HttpError(403, "Only Voting Badge Holders can review.");
    c.set("reviewTokenIds", ids);
    await next();
  };

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
    tokenId: row.tokenId,
    stars: row.stars,
    body: row.body,
    createdAt: row.createdAt,
    current,
  });

  /** Every initiative's summary, for the board: { [id]: RatingSummary }. */
  r.get("/ratings", async (c) => {
    const out: Record<string, RatingSummary> = {};
    for (const [id, list] of await db.reviews.ratings()) {
      const initiative = await db.initiatives.get(id);
      if (initiative && ["approved", "archived"].includes(initiative.status)) {
        out[id] = summarize(list, c.req.query("tokenId"));
      }
    }
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
      summary: summarize(ratings, c.req.query("tokenId")),
    });
  });

  r.post("/initiatives/:id/reviews", requireAuth, requireHolder, async (c) => {
    const address = c.var.user!.address;
    if (!(await db.rateLimit("review:" + address.toLowerCase(), WRITES_PER_MINUTE, 60))) {
      throw new HttpError(429, "slow down");
    }
    const initiative = await initiativeOr404(c.req.param("id"));
    if (initiative.status !== "approved") {
      throw new HttpError(400, "only initiatives on the board can be rated");
    }
    const body = await jsonBody(c, ["stars", "body", "tokenId"]);
    const tokenId = body.tokenId === undefined ? c.var.reviewTokenIds[0] : body.tokenId;
    if (typeof tokenId !== "string" || !c.var.reviewTokenIds.includes(tokenId)) {
      throw new HttpError(403, "You must own the voting badge used for this review.");
    }
    if (!isStars(body.stars)) throw new HttpError(400, "stars must be 1 to 5");
    const text = s(body.body, COMMENT_BODY_MAX + 1);
    if (text.length > COMMENT_BODY_MAX) {
      throw new HttpError(400, `the text must be at most ${COMMENT_BODY_MAX} characters`);
    }
    // Recheck immediately before saving; discovery alone never authorizes a write.
    try {
      if (!(await ownsReviewToken(deps.chain.rpc, address, tokenId))) {
        throw new HttpError(403, "You no longer own this voting badge.");
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(503, "Could not verify voting badge ownership. Please try again.");
    }
    const row = await db.reviews.create({
      initiativeId: initiative.id,
      tokenId,
      address,
      stars: body.stars,
      body: text,
    });
    return c.json({ review: reviewJson(row, true) }, 201);
  });

  /** Only the author deletes a review; their previous one then counts again. */
  r.delete("/initiatives/:id/reviews/:reviewId", requireAuth, requireHolder, async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"));
    const ok = await db.reviews.remove(
      initiative.id,
      c.req.param("reviewId"),
      c.var.user!.address,
      c.var.reviewTokenIds,
    );
    if (!ok) throw new HttpError(404, "no such review of yours");
    return c.json({ ok: true });
  });

  return r;
}
