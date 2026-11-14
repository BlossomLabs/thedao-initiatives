/** /vote/llms.txt: the round, its rules and every project, for an LLM drafting a ballot. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { voteLlms } from "../services/vote-llms.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import type { FeedInitiative } from "../services/feed.ts";
import { parseBallotText } from "../../shared/vote/ballot-text.ts";
import { harness } from "./app-helpers.ts";

const m: VoteManifest = {
  kind: "real",
  chainId: 1,
  contract: "0x1000000000000000000000000000000000000001",
  badge: "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C",
  deployBlock: 1,
  opensAt: 1_800_000_000,
  closesAt: 1_800_500_000,
  schedule: {
    opensAt: 1_800_000_000,
    firstTallyAt: [1_800_100_000, 1_800_200_000, 1_800_300_000],
    initialWindow: 7200,
    maxWindows: 4,
  },
  poolUsd: "1000000000000",
  slugs: ["seal-audits", "seal-tooling", "fuzzing", "wallets"],
  projects: [
    { askUsd: "300000000000", rfp: false, groups: [0] },
    { askUsd: "200000000000", rfp: false, groups: [0] },
    { askUsd: "250000000000", rfp: true, groups: [] },
    { askUsd: "400000000000", rfp: false, groups: [] },
  ],
  groups: ["Seal"],
  independentTiers: 1,
  ballotRules: true,
};
const entry = (slug: string, title: string, goalUsd: number, raisedUsd: number) =>
  ({
    slug,
    title,
    goalUsd,
    raisedUsd,
    type: slug === "fuzzing" ? "rfp" : "grant",
    markdownUrl: `https://x.test/initiative/${slug}.md`,
  }) as FeedInitiative;
const entries = [
  entry("seal-audits", "Seal audits", 300_000, 50_000),
  entry("seal-tooling", "Seal tooling", 200_000, 0),
  entry("fuzzing", "Community fuzzing", 250_000, 250_000),
  entry("wallets", "Wallet security", 400_000, 0),
];
const text = voteLlms(m, entries, "https://x.test");

Deno.test("vote llms: lists every round project with type, amounts and affiliations", () => {
  assertStringIncludes(
    text,
    "- seal-audits — Seal audits · Grant · requests $300,000 · still needs $250,000 · affiliations: Seal · [details](https://x.test/initiative/seal-audits.md)",
  );
  assertStringIncludes(
    text,
    "- fuzzing — Community fuzzing · RFP · requests $250,000 · still needs $0 · affiliations: none",
  );
});

Deno.test("vote llms: states the rules with the pool's 1.5× in dollars", () => {
  assertStringIncludes(text, "at least $1,500,000 in total (1.5× the $1,000,000 configured pool)");
  assertStringIncludes(text, "S-Tier needs at least 3 independent projects");
  assertStringIncludes(text, "Anything you leave unranked gets nothing from you");
  assertStringIncludes(text, 'not the smaller "still needs" amounts after donations or pledges');
  assertStringIncludes(text, "no pair shares any listed affiliation");
  assertStringIncludes(
    text,
    "a project with several affiliations counts its full requested amount",
  );
  assertStringIncludes(text, "Exactly half is allowed");
  assertStringIncludes(
    text,
    "A-Tier has no independence minimum or affiliation limit in this round",
  );
  assertStringIncludes(text, "S-Tier must not be empty");
});

Deno.test("vote llms: voting eligibility, first-ballot cutoff and revisions", () => {
  assertStringIncludes(text, "Each voting badge is one equal voting unit");
  assertStringIncludes(text, "Only its current owner can authorize its ballot");
  assertStringIncludes(text, "Send a first valid ballot before S-Tier actually settles");
  assertStringIncludes(text, "cannot add, remove or move projects in a settled tier");
  assertStringIncludes(text, "A refused revision leaves the previous accepted ballot counting");
  assertStringIncludes(text, "blocks strictly before its cutoff");
  assertStringIncludes(text, "[the current round state](https://x.test/api/vote/round)");
  assertStringIncludes(text, "1,000,000 = $1");
  assertStringIncludes(text, "ask the voter for the ballot that currently counts");
});

Deno.test("vote llms: the configured schedule and quiet-ending rules", () => {
  assertStringIncludes(text, "## Schedule and quiet ending");
  assertStringIncludes(text, "S-Tier starts settling 2027-01-16 11:46 UTC");
  assertStringIncludes(text, "A-Tier starts settling 2027-01-17 15:33 UTC");
  assertStringIncludes(text, "B-Tier starts settling 2027-01-18 19:20 UTC");
  assertStringIncludes(text, "latest possible settlement 2027-01-18 23:05 UTC");
  assertStringIncludes(text, "at most 4 settling windows. The first lasts 7200 seconds");
  assertStringIncludes(text, "funded set stayed unchanged throughout that window");
  assertStringIncludes(text, "even if the change later reverses");
  assertStringIncludes(text, "not changes to lower tiers or who pays");
  assertStringIncludes(text, "The final window settles the tier whatever happens");
  assertStringIncludes(text, "the round closes when B-Tier settles");
});

Deno.test("vote llms: A-Tier enforcement changes both the rules and the drafting checklist", () => {
  const both = voteLlms({ ...m, independentTiers: 3 }, entries, "https://x.test");
  assertStringIncludes(both, "A-Tier follows the same two independence and affiliation rules");
  assertStringIncludes(both, "S-Tier and A-Tier must not be empty");
  assertStringIncludes(both, "three pairwise-independent projects in each of S-Tier and A-Tier");
  assertStringIncludes(both, "B-Tier has no independence minimum or affiliation limit");
  assert(!both.includes("A-Tier has no independence minimum"));
});

Deno.test("vote llms: the minimum never rounds below the required micro-USD", () => {
  const precise = voteLlms({ ...m, poolUsd: "1000001" }, entries, "https://x.test");
  assertStringIncludes(precise, "at least $1.500002 in total (1.5× the $1.000001 configured pool)");
  assertStringIncludes(precise, "recompute this minimum from its poolUsd");
});

Deno.test("vote llms: a draft must use unique known slugs and pass validation", () => {
  assertStringIncludes(text, "Use only the exact project slugs below");
  assertStringIncludes(text, "list each project at most once");
  assertStringIncludes(text, "Syntax example only; it may not meet the ballot rules");
  assertStringIncludes(text, "Before returning it, check the total original requests");
  assertStringIncludes(text, "do not invent preferences or return an invalid ballot");
});

Deno.test("vote llms: the format example parses", async () => {
  const block = text.split("## Ballot format")[1].split("```")[1];
  assertEquals(await parseBallotText(block, m.slugs), {
    tiers: { "seal-audits": "S", "seal-tooling": "S", fuzzing: "A", wallets: "B" },
  });
  assertStringIncludes(
    text,
    "```yaml\nS-Tier:\n  - seal-audits\n  - seal-tooling\nA-Tier:\n  - fuzzing\nB-Tier:\n  - wallets\n```",
  );
  assert(!text.includes("pabutools"));
});

Deno.test("vote llms: 404 without a round", async () => {
  const h = await harness();
  h.deps.vote = undefined;
  const res = await h.req("/vote/llms.txt");
  assertEquals(res.status, 404);
  await res.body?.cancel();
  h.close();
});

Deno.test("vote llms: served as plain text, cached like the other feeds", async () => {
  const h = await harness();
  h.deps.vote = { chain: {} as never, manifest: m };
  const res = await h.req("/vote/llms.txt");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assertStringIncludes(res.headers.get("Cache-Control") ?? "", "max-age=300");
  const body = await res.text();
  assertStringIncludes(body, "- wallets — wallets · Grant · requests $400,000");
  assertStringIncludes(body, "## Voting and revisions");
  assertStringIncludes(body, "## Schedule and quiet ending");
  h.close();
});

Deno.test("vote llms: a round from before the ballot rules states none", () => {
  const old = voteLlms({ ...m, ballotRules: undefined }, entries, "https://x.test");
  assert(!old.includes("1.5×"));
  assert(!old.includes("needs at least 3 independent projects"));
  assert(!old.includes("three pairwise-independent projects"));
  assertStringIncludes(old, "This round has no ballot rules.");
});
