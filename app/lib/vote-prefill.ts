import type { Tier } from "../../shared/vote/ballot";

const BY_STARS: Partial<Record<number, Tier>> = { 5: "S", 4: "A", 3: "B" };

/** A fresh ballot from the badge's own star ratings: 5★ Tier-S, 4★ Tier-A, 3★ Tier-B.
 * 1–2★ are skipped (`skipsFromRatings`); unrated and anything outside the round stay
 * unplaced. */
export function prefillFromRatings(
  mine: Record<string, number>,
  slugs: string[],
): Partial<Record<string, Tier>> {
  const out: Partial<Record<string, Tier>> = {};
  for (const slug of slugs) {
    const t = BY_STARS[mine[slug]];
    if (t) out[slug] = t;
  }
  return out;
}

/** What a fresh ballot skips: everything this badge rated 1★ or 2★, in round order. */
export function skipsFromRatings(mine: Record<string, number>, slugs: string[]): string[] {
  return slugs.filter((slug) => mine[slug] === 1 || mine[slug] === 2);
}

/** Whose ratings fill the ballot: in the real vote the voting badge is the review badge
 * itself; in a test round the badge is a Sepolia test badge, so the signed-in account's
 * own review badge (its lowest token id), or none. */
export function ratingsToken(
  kind: "test" | "real",
  badge: number,
  reviewTokenIds: string[] | undefined,
): string | null {
  if (kind === "real") return String(badge);
  if (!reviewTokenIds?.length) return null;
  return [...reviewTokenIds].sort((a, b) => Number(BigInt(a) - BigInt(b)))[0];
}
