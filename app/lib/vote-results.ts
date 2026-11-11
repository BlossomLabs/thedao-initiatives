import type { Card } from "~/lib/api-types";
import type { RoundTier } from "~/hooks/use-vote";
import { type Tier, TIERS } from "../../shared/vote/ballot";

/** Micro-USD (a decimal string) as dollars, to the cent. */
export const dollars = (micro: string) => Number(BigInt(micro) / 10_000n) / 100;

export type ResultRow = { card: Card; finalUsd: number; tier?: Tier };

/** What an initiative the vote didn't fund still needs: its ask minus what it raised. */
export const neededUsd = (card: Card): number =>
  Math.max(0, card.initiative.goalUsd - card.summary.total);

/** Funded = an award in a settled tier: tier order, then the order the tally funded them. */
export function splitResults(
  cards: Card[],
  tiers: RoundTier[],
): { funded: ResultRow[]; notFunded: ResultRow[] } {
  const bySlug = new Map(cards.map((c) => [c.initiative.slug, c]));
  const funded: ResultRow[] = [];
  const done = new Set<string>();
  for (const t of TIERS) {
    const rt = tiers.find((x) => x.tier === t);
    if (!rt || rt.status !== "settled") continue;
    for (const slug of rt.funded) {
      const card = bySlug.get(slug);
      const award = rt.awards[slug];
      if (!card || award === undefined || done.has(slug)) continue;
      done.add(slug);
      funded.push({ card, finalUsd: card.summary.total + dollars(award), tier: t });
    }
  }
  const notFunded = cards
    .filter((c) => !done.has(c.initiative.slug))
    .sort((a, b) => b.pct - a.pct || a.initiative.title.localeCompare(b.initiative.title))
    .map((card) => ({ card, finalUsd: card.summary.total }));
  return { funded, notFunded };
}
