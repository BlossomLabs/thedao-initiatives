/** Admin star ratings: private reviews only admins see (api/routes/reviews.ts). */

export const STARS = [1, 2, 3, 4, 5] as const;
export type Stars = typeof STARS[number];

export const isStars = (v: unknown): v is Stars =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;

/** One initiative's ratings: each admin's latest review counts once. */
export interface RatingSummary {
  /** Mean of the current ratings, 0 while there are none. */
  avg: number;
  count: number;
  /** How many admins gave 1..5 stars (index 0 = 1 star). */
  dist: [number, number, number, number, number];
  /** The viewer's current rating, null if they have none. */
  mine: Stars | null;
}

export const EMPTY_SUMMARY: RatingSummary = { avg: 0, count: 0, dist: [0, 0, 0, 0, 0], mine: null };

/** The summary of each admin's current rating (`mine` from the viewer's). */
export function summarize(
  ratings: { address: string; stars: Stars }[],
  viewer?: string,
): RatingSummary {
  const dist: RatingSummary["dist"] = [0, 0, 0, 0, 0];
  let sum = 0;
  let mine: Stars | null = null;
  for (const r of ratings) {
    dist[r.stars - 1]++;
    sum += r.stars;
    if (viewer && r.address.toLowerCase() === viewer.toLowerCase()) mine = r.stars;
  }
  const count = ratings.length;
  return { avg: count ? Math.round((sum / count) * 10) / 10 : 0, count, dist, mine };
}

/** The average once the viewer's rating is `stars` (replacing theirs, or one
 * more), rounded like summarize's; null leaves it as it is. */
export function averageWith(summary: RatingSummary, stars: Stars | null): number {
  if (stars === null) return summary.avg;
  const sum = summary.dist.reduce((acc, n, i) => acc + n * (i + 1), 0) - (summary.mine ?? 0) +
    stars;
  const count = summary.count + (summary.mine ? 0 : 1);
  return Math.round((sum / count) * 10) / 10;
}
