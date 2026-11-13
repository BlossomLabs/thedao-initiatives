import { tierName, TIERS } from "../../shared/vote/ballot";
import type { RuleError } from "../../shared/vote/rules";

/** Whole dollars from micro-USD: "$1,369,866". */
const dollars = (micro: bigint) =>
  `$${(Number((micro + 500_000n) / 1_000_000n)).toLocaleString("en-US")}`;
const and = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** A broken ballot rule in plain words (docs/superpowers/specs/2026-11-11-ballot-rules-design.md). */
export function ruleMessage(
  e: RuleError,
  titleOf: (project: number) => string,
  groupName: (group: number) => string,
): string {
  switch (e.rule) {
    case "size":
      return `Your ballot requests ${dollars(e.requested)}. It must request at least ${
        dollars(e.needed)
      } (1.5× the ${dollars(e.pool)} pool). Add more projects; B-Tier is a good place for them.`;
    case "independent":
      return [
        `${tierName(TIERS[e.tier])} needs at least 3 independent projects.`,
        ...e.related.map((r) =>
          `${and(r.projects.map(titleOf))} are affiliated with ${
            groupName(r.group)
          }, so they count as one.`
        ),
      ].join(" ");
    case "group":
      return `Projects affiliated with ${groupName(e.group)} take ${dollars(e.groupUsd)} of ${
        tierName(TIERS[e.tier])
      }'s ${dollars(e.tierUsd)}. One affiliation can hold at most half.`;
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
    e.rule === "tiers" || e.rule === "shape";
}
