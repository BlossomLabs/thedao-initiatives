import { type Context, Hono, type Next } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonBody, s } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";
import { COMMENT_BODY_MAX } from "../config.ts";
import { isStars, type RatingSummary, summarize } from "../../shared/ratings.ts";
import type { Review } from "../db/types.ts";
import { K } from "../db/keys.ts";

import { ownsReviewToken, reviewTokenIds } from "../chain/reviewer.ts";

const WRITES_PER_MINUTE = 30;
/** How long GET /identity reuses a lookup: a holder's for 5 minutes, a non-holder's for 1. */
export const IDENTITY_HOLDER_TTL_SECS = 5 * 60;
export const IDENTITY_NONE_TTL_SECS = 60;
/** How long a lookup is kept to stand in while the NFT index is down. */
export const IDENTITY_KEEP_SECS = 24 * 3600;
interface CachedIdentity {
  ids: string[];
  at: number;
}

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
  // The identity only decides what the page offers, and every signed-in tab polls
  // it each minute: a lookup is reused for a few minutes across instances. A new
  // holder waits at most a minute; writes (requireHolder) always check fresh.
  // While the NFT index fails or times out (it did, 10 s at a time, #82), the last
  // lookup (up to a day old) answers instead of an error.
  const cachedTokenIds = async (address: string) => {
    const key = K.reviewIdentity(address);
    const hit = (await db.kv.get<CachedIdentity>(key, db.read)).value;
    const ttl = (ids: string[]) => ids.length ? IDENTITY_HOLDER_TTL_SECS : IDENTITY_NONE_TTL_SECS;
    if (hit && deps.now() - hit.at < ttl(hit.ids)) return hit.ids;
    let ids: string[];
    try {
      ids = await tokenIdsFor(address);
    } catch (e) {
      if (hit) return hit.ids;
      throw e;
    }
    await db.kv.set(key, { ids, at: deps.now() } satisfies CachedIdentity, {
      expireIn: IDENTITY_KEEP_SECS * 1000,
    });
    return ids;
  };
  r.get("/identity", requireAuth, async (c) => {
    const ids = await cachedTokenIds(c.var.user!.address);
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
    // Which initiatives are on the board comes from the status index: two lists,
    // not one read per rated initiative (that was ~2 s at 42 initiatives).
    const [ratings, approved, archived] = await Promise.all([
      db.reviews.ratings(),
      db.initiatives.cards("approved"),
      db.initiatives.cards("archived"),
    ]);
    const onBoard = new Set([...approved, ...archived].map((r) => r.id));
    const out: Record<string, RatingSummary> = {};
    for (const [id, list] of ratings) {
      if (onBoard.has(id)) out[id] = summarize(list, c.req.query("tokenId"));
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
