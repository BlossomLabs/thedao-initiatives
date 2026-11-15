import { type Tier, TIERS } from "./ballot.ts";

/** The labels a voter can't touch once `settled` tiers have settled. The server compares
 * the voter's own groups of equal rank (their 1st, 2nd… group), not the labels: an
 * A-only ballot's first group is A. So everything up to the label holding their
 * `settled`-th group freezes; with fewer groups than that, adding any would change one. */
export function lockedLabels(
  counted: Partial<Record<string, Tier>>,
  settled: number,
): Set<Tier> {
  if (settled <= 0) return new Set();
  const groups = TIERS.filter((t) => Object.values(counted).includes(t));
  if (groups.length < settled) return new Set(TIERS);
  const last = TIERS.indexOf(groups[settled - 1]);
  return new Set(TIERS.slice(0, last + 1));
}
