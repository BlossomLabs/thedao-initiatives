/** /vote/llms.txt: what an LLM needs to draft a ballot for the deployed round, in the
 * same words as the ballot page (docs/superpowers/specs/2026-11-11-ballot-rules-design.md):
 * how the tally spends a share, the ballot rules, the pabutools format, every project
 * with its affiliations, and what to do. */
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import type { FeedInitiative } from "./feed.ts";

const dollars = (micro: bigint) =>
  `$${Number((micro + 500_000n) / 1_000_000n).toLocaleString("en-US")}`;
const usd = (n: number) => `$${Math.round(Math.max(0, n)).toLocaleString("en-US")}`;
const utc = (secs: number) =>
  `${new Date(secs * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function voteLlms(m: VoteManifest, entries: FeedInitiative[], origin: string): string {
  const rules = () => [
    `- The projects you rank must request at least ${dollars(needed)} in total (1.5× the ${
      dollars(pool)
    } pool).`,
    "- Tier-S needs at least 3 independent projects. Projects that share an affiliation count " +
    "as one. RFPs have no affiliations, so each RFP counts as independent.",
    "- In Tier-S, the projects of one affiliation can hold at most half of the tier's " +
    "requested total.",
    ...(tierA ? ["- Tier-A follows the same two rules."] : []),
    "- Tier-B has no such rules. A ballot that breaks a rule is invalid: it can't be sent.",
    "",
  ];
  const pool = BigInt(m.poolUsd);
  const needed = (3n * pool + 1n) / 2n;
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const tierA = (m.independentTiers & 2) !== 0;
  const example = [m.slugs.slice(0, 3).join("="), m.slugs[3], m.slugs.slice(4, 6).join("=")]
    .filter(Boolean).join(",");
  const projects = m.slugs.map((slug, i) => {
    const p = m.projects[i];
    const e = bySlug.get(slug);
    const affiliations = p.groups.map((g) => m.groups[g]).join(", ") || "none";
    return `- ${slug} — ${e?.title ?? slug} · ${p.rfp ? "RFP" : "Grant"} · requests ${
      dollars(BigInt(p.askUsd))
    } · still needs ${
      e ? usd(e.goalUsd - e.raisedUsd) : "unknown"
    } · affiliations: ${affiliations} · [details](${
      e?.markdownUrl ?? `${origin}/initiative/${slug}.md`
    })`;
  });
  return [
    `# TheDAO vote: build your ballot`,
    "",
    `> ${
      m.kind === "real" ? "TheDAO's vote" : "A test vote"
    } of the private voting badge holders on which initiatives TheDAO funds from a ${
      dollars(pool)
    } pool. Voting opens ${utc(m.opensAt)}; Tier-S starts settling ${
      utc(m.schedule.firstTallyAt[0])
    }.`,
    "",
    "## How the tally spends your share",
    "",
    "The pool is split equally between every badge that votes. Put what TheDAO must fund first: " +
    "Tier-S (must fund), then Tier-A (should fund), then Tier-B (nice to have). Initiatives in " +
    "the same tier are equal. Tier-S settles first, then Tier-A, then Tier-B; each funds what it " +
    "can from what is left of your share. Anything you leave unranked gets nothing from you; " +
    "your share of it returns to TheDAO. Put every project you'd be glad to see funded in " +
    "Tier-B: it only takes money once Tier-S and Tier-A are done.",
    "",
    "## Ballot rules",
    "",
    ...(m.ballotRules ? rules() : ["This round has no ballot rules.", ""]),
    "## Ballot format",
    "",
    "A pabutools (Pabulib) ordinal vote with the Blossom tie extension: project ids are the " +
    "slugs below; projects of equal rank are joined with `=`; tiers follow in order with `,`, " +
    "Tier-S first (an empty tier is `,,`). Anything not listed is unranked. The voter pastes " +
    "the line (or a whole .pb file) into the ballot page. Example (not advice):",
    "",
    "```",
    "VOTES",
    "voter_id;vote",
    `1;${example}`,
    "```",
    "",
    "## Projects",
    "",
    ...projects,
    "",
    "## What to do",
    "",
    "Ask the voter for their star ratings or their priorities: you can't see them. Then " +
    "write one vote line that passes the rules, and name the three Tier-S projects with no " +
    "shared affiliation that make it independent.",
    "",
  ].join("\n");
}
