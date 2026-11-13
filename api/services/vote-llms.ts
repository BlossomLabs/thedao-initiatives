/** /vote/llms.txt: what an LLM needs to draft a ballot for the deployed round, in the
 * same words as the ballot page (docs/superpowers/specs/2026-11-11-ballot-rules-design.md):
 * who can vote and revise, how tiers settle, how the tally spends a share, the ballot
 * rules, the pabutools format, every project with its affiliations, and what to do. */
import { tierName, TIERS } from "../../shared/vote/ballot.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { windowEnds } from "../../shared/vote/quiet-ending.ts";
import type { FeedInitiative } from "./feed.ts";

const dollars = (micro: bigint) => {
  const fraction = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `$${(micro / 1_000_000n).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
};
const usd = (n: number) => `$${Math.round(Math.max(0, n)).toLocaleString("en-US")}`;
const utc = (secs: number) =>
  `${new Date(secs * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function voteLlms(m: VoteManifest, entries: FeedInitiative[], origin: string): string {
  const [sTier, aTier, bTier] = TIERS.map(tierName);
  const pool = BigInt(m.poolUsd);
  const needed = (3n * pool + 1n) / 2n;
  const tierA = (m.independentTiers & 2) !== 0;
  const enforced = tierA ? `${sTier} and ${aTier}` : sTier;
  const rules = () => [
    `- The projects you rank must request at least ${dollars(needed)} in total (1.5× the ${
      dollars(pool)
    } configured pool). If the live pool differs, recompute this minimum from its poolUsd.`,
    "- Use the original requested amounts below for the minimum and affiliation limits, " +
    'not the smaller "still needs" amounts after donations or pledges.',
    `- ${sTier} needs at least 3 independent projects: choose three such that no pair shares ` +
    "any listed affiliation. RFPs have no affiliations, so each RFP counts as independent. " +
    "Additional related projects may be included if the affiliation limit below is kept.",
    `- In ${sTier}, the projects of one affiliation can hold at most half of the tier's ` +
    "requested total. Check each affiliation separately; a project with several affiliations " +
    "counts its full requested amount toward each. Exactly half is allowed.",
    ...(tierA
      ? [`- ${aTier} follows the same two independence and affiliation rules.`]
      : [`- ${aTier} has no independence minimum or affiliation limit in this round.`]),
    `- ${enforced} must not be empty. ${bTier} has no independence minimum or affiliation ` +
    "limit; the whole ballot must still meet the total-request minimum.",
    "- A ballot that breaks a rule is invalid: it can't be sent. Adding projects or increasing " +
    "the pool later does not invalidate an earlier accepted ballot; a new revision must meet " +
    "the rules in force when it is recorded.",
    "",
  ];
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
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
    } pool. Voting opens ${utc(m.opensAt)}; ${sTier} starts settling ${
      utc(m.schedule.firstTallyAt[0])
    }.`,
    "",
    "## Voting and revisions",
    "",
    "- Each voting badge is one equal voting unit. Only its current owner can authorize its " +
    "ballot; an owner with several badges can send a separate ballot for each.",
    `- Send a first valid ballot before ${sTier} actually settles. A badge that has not voted ` +
    "by then cannot join later, even if the later tiers are still open.",
    "- The latest accepted ballot for a badge replaces its earlier one. You can revise open " +
    "tiers, but cannot add, remove or move projects in a settled tier. A refused revision " +
    "leaves the previous accepted ballot counting.",
    "- Pasting a draft or signing it is not a counted vote: it must be recorded on-chain and " +
    "accepted. A settlement uses only blocks strictly before its cutoff; do not wait for the " +
    "last moment to send.",
    `- Before drafting, read [the current round state](${origin}/api/vote/round) for poolUsd, ` +
    "registrationClosesAt, closed, and each tier's status. API dollar amounts are decimal " +
    "strings in micro-USD (1,000,000 = $1). For a revision, ask the voter for the ballot that " +
    "currently counts and preserve its settled tiers. Re-read this feed if projects were added.",
    "",
    "## Schedule and quiet ending",
    "",
    ...TIERS.map((tier, i) =>
      `- ${tierName(tier)} starts settling ${utc(m.schedule.firstTallyAt[i])}; ` +
      `latest possible settlement ${utc(windowEnds(m.schedule, i).at(-1)!)}.`
    ),
    `- Each tier has at most ${m.schedule.maxWindows} settling windows. The first lasts ` +
    `${m.schedule.initialWindow} seconds; window k lasts floor(initialWindow / 2^(k - 1)) ` +
    "seconds, counting k from 1.",
    "- A tier settles at the end of a window if its funded set stayed unchanged throughout " +
    "that window. If it changes, even if the change later reverses, another shorter window " +
    "follows when this one ends, unless this was the final window. " +
    "Only the current tier's funded set matters, not changes to lower tiers or who pays. " +
    "The final window settles the tier whatever happens.",
    "- Settled awards and badge charges stay fixed. Live results for open tiers are " +
    `provisional; the round closes when ${bTier} settles, which can be earlier than its ` +
    "latest possible settlement above.",
    "",
    "## How the tally spends your share",
    "",
    "The pool is split equally between every badge that votes. Put what TheDAO must fund first: " +
    `${sTier} (must fund), then ${aTier} (should fund), then ${bTier} (nice to have). Initiatives in ` +
    `the same tier are equal. ${sTier} settles first, then ${aTier}, then ${bTier}; each funds what it ` +
    "can from what is left of your share. Anything you leave unranked gets nothing from you; " +
    "your share of it returns to TheDAO. Put every project you'd be glad to see funded in " +
    `${bTier}: it only takes money once ${sTier} and ${aTier} are done. Ranking a project does ` +
    `not guarantee funding; ${bTier} may fund nothing if the pool runs out.`,
    "",
    "## Ballot rules",
    "",
    ...(m.ballotRules ? rules() : ["This round has no ballot rules.", ""]),
    "## Ballot format",
    "",
    "A pabutools (Pabulib) ordinal vote with the Blossom tie extension: project ids are the " +
    "slugs below; projects of equal rank are joined with `=`; tiers follow in order with `,`, " +
    `${sTier} first (an empty middle tier is \`,,\`). Use at most three tiers, only the exact ` +
    "project slugs below, and list each project at most once. Anything not listed is unranked. " +
    "The voter pastes the line (or a whole .pb file) into the ballot page. Syntax example only; " +
    "it may not meet the ballot rules or reflect the voter's priorities:",
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
    "write the vote as one bare line (just the slugs, `=` and `,`, no voter id).",
    ...(m.ballotRules
      ? [
        "Before returning it, check the total original requests against 1.5× the live pool, " +
        `name three pairwise-independent projects in each of ${enforced}, and check every ` +
        "affiliation's share of each enforced tier's requests is at most 50%. If the voter's " +
        "choices cannot satisfy the rules, explain what is missing and ask which projects " +
        "they want to add; do not invent preferences or return an invalid ballot.",
      ]
      : []),
    "",
  ].join("\n");
}
