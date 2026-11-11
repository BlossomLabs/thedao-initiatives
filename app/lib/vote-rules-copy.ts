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
      } (1.5× the ${dollars(e.pool)} pool). Add more projects; Tier-B is a good place for them.`;
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
