/** Ballots as pabutools/Pabulib `.pb` text with the Blossom tie extension
 * (docs/superpowers/specs/2026-11-11-ballot-rules-design.md): `vote_type;ordinal`,
 * project ids are slugs, and in the `vote` cell projects of equal rank are joined with
 * `=` and groups follow in order with `,`: Tier-S first. An empty group (`,,`) is an
 * empty tier. Ordinary ordinal parsers don't read `=`: only this profile does. */
import type { Tier } from "./ballot.ts";

const TIER_ORDER: Tier[] = ["S", "A", "B"];

/** The vote line: from a full `.pb` (its single VOTES row's `vote` column) or bare. */
function voteLine(text: string): string | null {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.some((l) => /^(META|PROJECTS|VOTES)$/i.test(l))) return lines[0] ?? null;
  const at = lines.findIndex((l) => /^VOTES$/i.test(l));
  if (at < 0 || !lines[at + 1] || !lines[at + 2]) return null;
  const header = lines[at + 1].split(";").map((h) => h.trim().toLowerCase());
  const col = header.indexOf("vote");
  if (col < 0) return null;
  return lines[at + 2].split(";")[col]?.trim() || null;
}

export function parseBallotText(
  text: string,
  slugs: string[],
): { tiers: Partial<Record<string, Tier>> } | { error: string } {
  const line = voteLine(text);
  if (!line) return { error: "No vote found." };
  const groups = line.split(",").map((g) => g.split("=").map((x) => x.trim()).filter(Boolean));
  while (groups.length && groups[groups.length - 1].length === 0) groups.pop();
  if (!groups.length) return { error: "No vote found." };
  if (groups.length > 3) return { error: "Use at most three tiers." };
  const known = new Set(slugs);
  const tiers: Partial<Record<string, Tier>> = {};
  for (const [k, group] of groups.entries()) {
    for (const id of group) {
      if (!known.has(id)) return { error: `Unknown project: ${id}` };
      if (tiers[id]) return { error: `${id} is listed twice` };
      tiers[id] = TIER_ORDER[k];
    }
  }
  return { tiers };
}

/** This ballot as a one-vote `.pb`, every round project listed (cost in whole dollars). */
export function formatBallotPb(
  tiers: Partial<Record<string, Tier>>,
  round: { slugs: string[]; titles: (slug: string) => string; askUsd: (slug: string) => bigint },
): string {
  const groups = TIER_ORDER.map((t) => round.slugs.filter((s) => tiers[s] === t).join("="));
  while (groups.length && !groups[groups.length - 1]) groups.pop();
  const clean = (x: string) => x.replace(/[;\r\n]/g, " ");
  return [
    "META",
    "key;value",
    "description;TheDAO vote ballot",
    "vote_type;ordinal",
    "blossom_ties;1",
    "PROJECTS",
    "project_id;cost;name",
    ...round.slugs.map((s) =>
      `${s};${(round.askUsd(s) + 500_000n) / 1_000_000n};${clean(round.titles(s))}`
    ),
    "VOTES",
    "voter_id;vote",
    `1;${groups.join(",")}`,
    "",
  ].join("\n");
}
