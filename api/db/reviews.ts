import { collect, K } from "./keys.ts";
import type { Rating, Review } from "./types.ts";
import { newId } from "../lib/ids.ts";
import type { Stars } from "../../shared/ratings.ts";

/**
 * Admin reviews: stars with an optional note, only admins read them. Each
 * admin's latest review is their rating, kept under K.rating so the board
 * summary is one list. Every write checks that entry, so two reviews racing
 * never leave an older one counting.
 */
export function reviewsRepo(kv: Deno.Kv, now: () => number) {
  const forInitiative = async (initiativeId: string): Promise<Review[]> =>
    await collect(kv.list<Review>({ prefix: K.reviews(initiativeId) }));

  async function create(
    input: { initiativeId: string; address: string; stars: Stars; body: string },
  ): Promise<Review> {
    const review: Review = { ...input, id: newId(), createdAt: now() };
    const key = K.rating(input.initiativeId, input.address);
    for (let attempt = 0; attempt < 8; attempt++) {
      const cur = await kv.get<Rating>(key);
      const ok = (await kv.atomic().check(cur)
        .set(K.review(review.initiativeId, review.id), review)
        .set(key, { stars: review.stars, reviewId: review.id, at: review.createdAt }).commit()).ok;
      if (ok) return review;
    }
    throw new Error("reviews: too much contention");
  }

  /** Deletes one of `address`'s own reviews; their newest remaining one counts
   * again (or they have no rating). False when there is no such review of theirs. */
  async function remove(initiativeId: string, id: string, address: string): Promise<boolean> {
    const ratingKey = K.rating(initiativeId, address);
    for (let attempt = 0; attempt < 8; attempt++) {
      const entry = await kv.get<Review>(K.review(initiativeId, id));
      if (!entry.value || entry.value.address.toLowerCase() !== address.toLowerCase()) {
        return false;
      }
      const cur = await kv.get<Rating>(ratingKey);
      const op = kv.atomic().check(entry, cur).delete(K.review(initiativeId, id));
      if (cur.value?.reviewId === id) {
        // Ids are ULIDs: the last of the author's others is their newest.
        const prev = (await forInitiative(initiativeId))
          .filter((r) => r.id !== id && r.address.toLowerCase() === address.toLowerCase())
          .at(-1);
        if (prev) op.set(ratingKey, { stars: prev.stars, reviewId: prev.id, at: prev.createdAt });
        else op.delete(ratingKey);
      }
      if ((await op.commit()).ok) return true;
    }
    throw new Error("reviews: too much contention");
  }

  /** Every current rating, by initiative. */
  async function ratings(): Promise<Map<string, { address: string; stars: Stars }[]>> {
    const out = new Map<string, { address: string; stars: Stars }[]>();
    for await (const e of kv.list<Rating>({ prefix: K.ratings })) {
      const [, initiativeId, address] = e.key as [string, string, string];
      out.set(initiativeId, [...(out.get(initiativeId) ?? []), { address, stars: e.value.stars }]);
    }
    return out;
  }

  /** One initiative's current ratings. */
  const ratingsFor = async (initiativeId: string) =>
    (await Array.fromAsync(kv.list<Rating>({ prefix: K.ratingsFor(initiativeId) }))).map((e) => ({
      address: String(e.key[2]),
      stars: e.value.stars,
      reviewId: e.value.reviewId,
    }));

  return { forInitiative, create, remove, ratings, ratingsFor };
}
