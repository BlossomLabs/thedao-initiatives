/** /vote/llms.txt: what an LLM needs to draft a ballot for the deployed round, in the
 * same words as the ballot page (docs/superpowers/specs/2026-11-11-ballot-rules-design.md):
 * who can vote and revise, how tiers settle, how the tally spends a share, the ballot
 * rules, the ballot format, every project with its affiliations, and what to do. */
import { tierName, TIERS } from "../../shared/vote/ballot.ts";
import { formatBallotText } from "../../shared/vote/ballot-text.ts";
import { formatMicroUsd as dollars } from "../../shared/vote/format.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { windowEnds } from "../../shared/vote/quiet-ending.ts";
import { minimumAsk } from "../../shared/vote/rules.ts";
import type { FeedInitiative } from "./feed.ts";

const utc = (secs: number) =>
  `${new Date(secs * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function voteLlms(
  m: VoteManifest,
  entries: FeedInitiative[],
  origin: string,
  asks?: bigint[],
  /** Slugs an admin withdrew from the vote (at the replay's head). Null: it couldn't be
   * read, and the feed says so (none marked is then "unknown", not "none"). */
  withdrawn: ReadonlySet<string> | null = new Set(),
): string {
  const [sTier, aTier, bTier] = TIERS.map(tierName);
  const pool = BigInt(m.poolUsd);
  const needed = asks?.length === m.slugs.length &&
      m.slugs.every((_, i) => typeof asks[i] === "bigint") && withdrawn !== null
    ? minimumAsk({
      poolUsd: pool,
      asks,
      withdrawn: m.slugs.map((slug) => withdrawn.has(slug)),
    })
    : undefined;
  const tierA = (m.independentTiers & 2) !== 0;
  const enforced = tierA ? `${sTier} and ${aTier}` : sTier;
  const rules = () => [
    needed === undefined
      ? "- The current total-ask minimum is unknown because the current asks or withdrawal " +
        "status could not be read. Re-read this feed before checking the ballot's size."
      : `- The projects you rank must ask for at least ${dollars(needed)} in total (${
        2n * needed >= 3n * pool
          ? `1.5× the ${dollars(pool)} configured pool`
          : `every non-withdrawn project's current ask, which is less than 1.5× the ${
            dollars(pool)
          } configured pool`
      }).`,
    "- The minimum is the smaller of 1.5× the pool (rounded up to one micro-USD) and the " +
    "combined current asks of all non-withdrawn projects. When those asks total less than " +
    "1.5× the pool, rank every non-withdrawn project with a positive ask to meet the size rule. " +
    "The independence and affiliation rules still apply.",
    "- A project's ask is its goal less its donations and open pledges, " +
    "on-chain at the block that records your ballot, so it can change before then. If the " +
    "live pool or asks differ, recompute this capped minimum from poolUsd, asks and the " +
    "withdrawn projects in the current round state.",
    ...(m.pool && !m.pool.sold
      ? [
        `- The pool is ${m.pool.eth} ETH, sold for USD before ${sTier}'s first tally ` +
        `(${utc(m.schedule.firstTallyAt[0])}). Until then poolUsd is an estimate an admin ` +
        "sets, so the minimum above can move either way when it is sold: leave room.",
      ]
      : []),
    "- Where a project's ask is unknown, the ballot's size can't be checked here: say so to the " +
    "voter rather than estimating it.",
    "- The asks listed below are the chain's current ones: use them for the minimum and the " +
    "affiliation limits, and leave room for them to shrink. A project already fully funded " +
    "asks $0: it counts toward S-Tier independence but adds nothing to a total or a share.",
    `- ${sTier} needs at least 3 independent projects: choose three such that no pair shares ` +
    "any listed affiliation. RFPs have no affiliations, so each RFP counts as independent. " +
    "Additional related projects may be included if the affiliation limit below is kept.",
    `- In ${sTier}, the projects of one affiliation can hold at most half of the tier's ` +
    "asked total. Check each affiliation separately; a project with several affiliations " +
    "counts its full ask toward each. Exactly half is allowed.",
    ...(tierA
      ? [`- ${aTier} follows the same two independence and affiliation rules.`]
      : [`- ${aTier} has no independence minimum or affiliation limit in this round.`]),
    `- ${enforced} must not be empty. ${bTier} has no independence minimum or affiliation ` +
    "limit; the whole ballot must still meet the total-ask minimum.",
    "- A ballot that breaks a rule is invalid: it can't be sent. Adding projects or increasing " +
    "the pool later does not invalidate an earlier accepted ballot; a new revision must meet " +
    "the rules in force when it is recorded.",
    "",
  ];
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const example = formatBallotText(
    Object.fromEntries(m.slugs.slice(0, 4).map((s, i) => [s, TIERS[Math.max(0, i - 1)]])),
    m.slugs,
  );
  const projects = m.slugs.map((slug, i) => {
    const p = m.projects[i];
    const e = bySlug.get(slug);
    const affiliations = p.groups.map((g) => m.groups[g]).join(", ") || "none";
    return `- ${slug} — ${e?.title ?? slug} · ${p.rfp ? "RFP" : "Grant"} · goal ${
      dollars(BigInt(p.goalUsd))
    } · asks ${
      asks?.[i] === undefined ? "unknown" : dollars(asks[i])
    } · affiliations: ${affiliations}${
      withdrawn?.has(slug) ? " · withdrawn: true" : ""
    } · [details](${e?.markdownUrl ?? `${origin}/initiative/${slug}.md`})`;
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
    "poolInitialized, registrationClosesAt, closed, and each tier's status. While poolInitialized is false, " +
    "registrationClosesAt is null and no tier settles; voting still waits for opensAt. API dollar amounts are decimal " +
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
    `YAML with one key per tier, \`${sTier}\`, \`${aTier}\` and \`${bTier}\`, each a list of ` +
    "project slugs from the list below; an empty tier is `[]`. No voter id, no names, no " +
    "costs. Use only the exact project slugs below and list each project at most once. " +
    "A tier must contain a pick before any later tier can be used: B-Tier requires both S-Tier and A-Tier. " +
    "If an earlier tier settled empty on this ballot, later tiers cannot be added in this round. " +
    "Anything not listed is unranked. The voter pastes it into the ballot page. Syntax " +
    "example only; it may not meet the ballot rules or reflect the voter's priorities:",
    "",
    "```yaml",
    example,
    "```",
    "",
    "## Projects",
    "",
    ...(withdrawn === null
      ? [
        "Which projects an admin withdrew from the vote couldn't be read right now: none is " +
        "marked below, but some may be. Re-read this feed in a minute.",
        "",
      ]
      : withdrawn.size
      ? [
        "A project marked withdrawn: true was withdrawn by an admin: it is not a candidate and " +
        "asks $0 toward the total. Leave it unranked; if the ballot that counts has it in a " +
        "settled tier, keep it there as it is.",
        "",
      ]
      : []),
    ...projects,
    "",
    "## What to do",
    "",
    "Ask the voter for their star ratings or their priorities: you can't see them. Then " +
    "write the vote in the YAML format above, all three tiers, in a ```yaml code block.",
    ...(m.ballotRules
      ? [
        "Before returning it, check the total asks against the smaller of 1.5× the live pool " +
        "(rounded up to one micro-USD) and all non-withdrawn projects' current asks, " +
        `name three pairwise-independent projects in each of ${enforced}, and check every ` +
        "affiliation's share of each enforced tier's asks is at most 50%. If the voter's " +
        "choices cannot satisfy the rules, explain what is missing and ask which projects " +
        "they want to add; do not invent preferences or return an invalid ballot.",
      ]
      : []),
    "",
  ].join("\n");
}
