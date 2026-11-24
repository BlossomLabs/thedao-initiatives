import { tierName, TIERS } from "../../shared/vote/ballot";
import type { RuleError } from "../../shared/vote/rules";
import { formatMicroUsd as dollars } from "../../shared/vote/format";
/** A broken ballot rule in plain words (docs/superpowers/specs/2026-11-11-ballot-rules-design.md).
 * The affiliation rules say the rule and what to do, no names or amounts: the cards they
 * blame are marked (#144, `affiliationFlags`). */
export function ruleMessage(e: RuleError): string {
  switch (e.rule) {
    case "size":
      // When every ask in the round adds up to less than 1.5× the pool, that sum is the minimum.
      return `Your ballot requests ${dollars(e.requested)}. It must request at least ${
        dollars(e.needed)
      } (${
        2n * e.needed >= 3n * e.pool
          ? `1.5× the ${dollars(e.pool)} pool`
          : `every ask in the round, which is less than 1.5× the ${dollars(e.pool)} pool`
      }). Add more projects; B-Tier is a good place for them.`;
    case "independent": {
      const tier = tierName(TIERS[e.tier]);
      const said = `${tier} needs at least 3 independent projects.`;
      if (!e.related.length) return said;
      return `${said} Projects with the same affiliation count as one, so the marked ones ` +
        `count once. Add projects that share no affiliation with your other ${tier} picks.`;
    }
    case "group": {
      const tier = tierName(TIERS[e.tier]);
      return `Projects with the same affiliation can hold at most half of ${tier}'s goals, ` +
        `and the marked ones hold more. Move some of them out of ${tier}, or add projects ` +
        `not affiliated with them.`;
    }
    case "empty_tier":
      return `${
        tierName(TIERS[e.tier])
      } needs a pick before a later tier can be used. If it already settled empty on this ballot, later tiers cannot be added in this round.`;
    case "tiers":
      return "Use at most three tiers.";
    case "shape":
      return "This ballot can't be read.";
  }
}

/** The ballot box's one line in place of the share: the first rule still to meet, or that
 * the ballot is valid. Size first (it is what most ballots miss), then each tier's
 * independence, then the rest. */
export function ruleStatus(errors: RuleError[]): { ok: boolean; text: string } {
  const order = (e: RuleError) =>
    e.rule === "size" ? 0 : e.rule === "independent" ? 1 + e.tier : e.rule === "group" ? 3 : 4;
  const e = [...errors].sort((a, b) => order(a) - order(b))[0];
  if (!e) return { ok: true, text: "You can add as many initiatives as you want" };
  switch (e.rule) {
    case "size":
      return { ok: false, text: `Needs at least ${dollars(e.needed)} to be valid` };
    case "independent":
      return {
        ok: false,
        text: `Needs at least 3 independent projects in ${tierName(TIERS[e.tier])}`,
      };
    case "group":
      return {
        ok: false,
        text: `One affiliation holds over half of ${tierName(TIERS[e.tier])}`,
      };
    case "empty_tier":
      return {
        ok: false,
        text: `Add a pick to ${tierName(TIERS[e.tier])} before using a later tier`,
      };
    case "tiers":
      return { ok: false, text: "Use at most three tiers" };
    case "shape":
      return { ok: false, text: "This ballot can't be read" };
  }
}

/** Whether a broken rule also gets the box under the tiers: only what the ballot box's
 * line can't explain, the affiliations (projects that count as one, or one affiliation
 * over half a tier). A short ballot or a tier with too few projects is said there alone. */
export function explainBelow(e: RuleError): boolean {
  return (e.rule === "independent" && e.related.length > 0) || e.rule === "group" ||
    e.rule === "tiers" || e.rule === "shape" || e.rule === "empty_tier";
}

/** What a card in a tier is marked with when an affiliation rule blames it: the
 * affiliation's name for its tag, and the reason for its hover and its phone row. */
export type AffiliationFlag = { tag: string; reason: string };

/** The cards the affiliation rules blame, by project index: an affiliation over half a
 * tier, or affiliated projects that count as one. A card blamed twice gets both. */
export function affiliationFlags(
  errors: RuleError[],
  groupName: (group: number) => string,
): Map<number, AffiliationFlag> {
  const found = new Map<number, { tags: string[]; reasons: string[] }>();
  const blame = (projects: number[], group: number, why: string) => {
    for (const p of projects) {
      const f = found.get(p) ?? { tags: [], reasons: [] };
      const name = groupName(group);
      if (!f.tags.includes(name)) f.tags.push(name);
      f.reasons.push(`Affiliated with ${name}: ${why}`);
      found.set(p, f);
    }
  };
  for (const e of errors) {
    if (e.rule === "group") {
      blame(e.projects, e.group, `over half of ${tierName(TIERS[e.tier])}`);
    } else if (e.rule === "independent") {
      for (const r of e.related) {
        blame(r.projects, r.group, `counts as one in ${tierName(TIERS[e.tier])}`);
      }
    }
  }
  return new Map(
    [...found].map(([p, f]) => [p, { tag: f.tags.join(", "), reason: f.reasons.join("; ") }]),
  );
}
