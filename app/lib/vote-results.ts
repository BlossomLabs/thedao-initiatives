import type { Card } from "~/lib/api-types";
import type { RoundTier } from "~/hooks/use-vote";
import { type Tier, TIERS } from "../../shared/vote/ballot";

/** Micro-USD (a decimal string) as dollars, to the cent. */
export const dollars = (micro: string) => Number(BigInt(micro) / 10_000n) / 100;

/** The asks the round served (micro-USD, manifest order), when there is one per
 * initiative; otherwise none, as while they're being worked out. */
export const servedAsks = (
  round: { slugs: string[] },
  asks: string[] | undefined,
): string[] | undefined => asks?.length === round.slugs.length ? asks : undefined;

/** What an initiative asks the pool for, in dollars: its ask on-chain (goal less the
 * donations and open pledges, the contract's `initiativeUsd().askUsd`), as the round
 * serves it in manifest order. The ballot rules count it, and it moves with each donation.
 * Undefined while the asks are being worked out (the round came without them). */
export const askOf = (
  round: { slugs: string[] },
  asks: string[] | undefined,
  slug: string,
): number | undefined => {
  const i = round.slugs.indexOf(slug);
  const ask = i < 0 ? undefined : asks?.[i];
  return ask === undefined ? undefined : dollars(ask);
};

export type ResultRow = { card: Card; finalUsd: number; tier?: Tier };

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

/** Projects whose ask is $0: covered by donations, in no tier and funded by no one. `final`
 * were covered when a tier settled (settled tiers' `covered`); `now` are covered at the
 * latest tally only (the live view's), and could still change. */
export function coveredProjects(
  tiers: RoundTier[],
  liveCovered: string[] | undefined,
): { final: string[]; now: string[] } {
  const final = tiers.flatMap((t) => t.status === "settled" ? t.covered ?? [] : []);
  const done = new Set(final);
  return { final, now: (liveCovered ?? []).filter((s) => !done.has(s)) };
}
