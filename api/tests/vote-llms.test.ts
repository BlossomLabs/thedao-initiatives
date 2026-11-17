/** /vote/llms.txt: the round, its rules and every project, for an LLM drafting a ballot. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { voteLlms } from "../services/vote-llms.ts";
import { feedRoutes, withdrawnNow } from "../routes/feeds.ts";
import { rulesRound, type VoteManifest } from "../../shared/vote/manifest.ts";
import { checkBallot } from "../../shared/vote/rules.ts";
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
    { goalUsd: "300000000000", rfp: false, groups: [0] },
    { goalUsd: "200000000000", rfp: false, groups: [0] },
    { goalUsd: "250000000000", rfp: true, groups: [] },
    { goalUsd: "400000000000", rfp: false, groups: [] },
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
    "- seal-audits — Seal audits · Grant · goal $300,000 · asks unknown · affiliations: Seal · [details](https://x.test/initiative/seal-audits.md)",
  );
  assertStringIncludes(
    text,
    "- fuzzing — Community fuzzing · RFP · goal $250,000 · asks unknown · affiliations: none",
  );
});

Deno.test("vote llms: states the rules with the pool's 1.5× in dollars", () => {
  const enough = voteLlms(
    { ...m, poolUsd: "500000000000" },
    entries,
    "https://x.test",
    m.projects.map((p) => BigInt(p.goalUsd)),
  );
  assertStringIncludes(enough, "at least $750,000 in total (1.5× the $500,000 configured pool)");
  assertStringIncludes(text, "S-Tier needs at least 3 independent projects");
  assertStringIncludes(text, "Anything you leave unranked gets nothing from you");
  assertStringIncludes(text, "no pair shares any listed affiliation");
  assertStringIncludes(
    text,
    "a project with several affiliations counts its full registered goal",
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
  const precise = voteLlms(
    { ...m, poolUsd: "1000001" },
    entries,
    "https://x.test",
    m.projects.map((p) => BigInt(p.goalUsd)),
  );
  assertStringIncludes(precise, "at least $1.500002 in total (1.5× the $1.000001 configured pool)");
  assertStringIncludes(precise, "recompute this capped minimum from poolUsd, asks");
});

Deno.test("vote llms: the 15-project minimum agrees with validation and is reachable", () => {
  const asks = Array.from(
    { length: 15 },
    (_, i) => BigInt(i === 14 ? 74_100 : 68_000) * 1_000_000n,
  );
  const rehearsal = {
    ...m,
    poolUsd: "724876000000",
    slugs: asks.map((_, i) => `project-${i}`),
    projects: asks.map((ask) => ({ goalUsd: String(ask), rfp: true, groups: [] })),
  };
  const guide = voteLlms(rehearsal, [], "https://x.test", asks);
  assertStringIncludes(guide, "must ask for at least $1,026,100 in total");
  assert(!guide.includes("at least $1,087,314"));
  assertStringIncludes(
    guide,
    "rank every non-withdrawn project with a positive ask to meet the size rule",
  );
  assertStringIncludes(guide, "Before returning it, check the total asks against the smaller of");
  const round = rulesRound(rehearsal, asks);
  const partial = new Uint8Array(15).fill(255);
  partial.set([1, 1, 1]);
  assertEquals(checkBallot(partial, round).errors, [{
    rule: "size",
    requested: 204_000_000_000n,
    needed: 1_026_100_000_000n,
    pool: 724_876_000_000n,
  }]);
  assert(checkBallot(new Uint8Array(15).fill(1), round).ok);
});

Deno.test("vote llms: donations and withdrawals reduce the minimum, fully funded asks add zero", () => {
  const asks = [250_000_000_000n, 200_000_000_000n, 0n, 400_000_000_000n];
  const guide = voteLlms(m, entries, "https://x.test", asks, new Set(["wallets"]));
  assertStringIncludes(guide, "must ask for at least $450,000 in total");
  assertStringIncludes(guide, "every non-withdrawn project's current ask");
  const covered = voteLlms(m, entries, "https://x.test", [0n, 0n, 0n, 0n]);
  assertStringIncludes(covered, "must ask for at least $0 in total");
});

Deno.test("vote llms: missing asks or withdrawal status never produce a guessed minimum", () => {
  const full = m.projects.map((p) => BigInt(p.goalUsd));
  const unknown = [
    voteLlms(m, entries, "https://x.test"),
    voteLlms(m, entries, "https://x.test", full.slice(0, 3)),
    voteLlms(m, entries, "https://x.test", full, null),
  ];
  for (const guide of unknown) {
    assertStringIncludes(guide, "The current total-ask minimum is unknown");
    assert(!guide.includes("must ask for at least $"));
  }
});

Deno.test("vote llms: the route serves the capped minimum from asks and the replay's withdrawals", async () => {
  const app = feedRoutes(
    {
      origin: () => "https://x.test",
      get: () => Promise.resolve({ initiatives: entries }),
    } as never,
    {
      vote: {
        manifest: m,
        chain: {
          asks: () => Promise.resolve([250_000_000_000n, 200_000_000_000n, 0n, 400_000_000_000n]),
        } as never,
      },
    },
    () =>
      Promise.resolve(
        { tiers: [{}, {}, { status: "waiting" }], live: { withdrawn: [3] } } as never,
      ),
  );
  const res = await app.request("https://x.test/vote/llms.txt");
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "must ask for at least $450,000 in total");
});

Deno.test("vote llms: a draft must use unique known slugs and pass validation", () => {
  assertStringIncludes(text, "Use only the exact project slugs below");
  assertStringIncludes(text, "list each project at most once");
  assertStringIncludes(text, "Syntax example only; it may not meet the ballot rules");
  assertStringIncludes(text, "Before returning it, check the total asks");
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
  assertStringIncludes(body, "- wallets — wallets · Grant · goal $400,000 · asks unknown");
  assertStringIncludes(body, "## Voting and revisions");
  assertStringIncludes(body, "## Schedule and quiet ending");
  h.close();
});

Deno.test("vote llms: the route passes the chain asks", async () => {
  const h = await harness();
  h.deps.vote = {
    chain: { asks: () => Promise.resolve([1n, 2n, 3n, 4_000_000n]) } as never,
    manifest: m,
  };
  const body = await (await h.req("/vote/llms.txt")).text();
  assertStringIncludes(body, "asks $4 · affiliations");
  h.close();
});

Deno.test("vote llms: a round from before the ballot rules states none", () => {
  const old = voteLlms({ ...m, ballotRules: undefined }, entries, "https://x.test");
  assert(!old.includes("1.5×"));
  assert(!old.includes("needs at least 3 independent projects"));
  assert(!old.includes("three pairwise-independent projects"));
  assertStringIncludes(old, "This round has no ballot rules.");
});

Deno.test("vote llms: size counts live asks while affiliation shares count registered goals", () => {
  assertStringIncludes(text, "The minimum is the smaller of 1.5× the pool");
  assertStringIncludes(
    text,
    "A project's ask is its goal less its donations and open pledges, on-chain at the block that records your ballot, so it can change before then",
  );
  assert(!text.includes("original requested amounts"));
  assertStringIncludes(text, "total registered goals");
  assertStringIncludes(text, "counts its full registered goal toward each");
  assertStringIncludes(text, "pledges do not change this share");
});

Deno.test("vote llms: each project lists its chain ask", () => {
  const asked = voteLlms(m, entries, "https://x.test", [
    250_000_000_000n,
    200_000_000_000n,
    0n,
    400_000_000_000n,
  ]);
  assertStringIncludes(asked, "· goal $300,000 · asks $250,000 ·");
  assertStringIncludes(asked, "· goal $250,000 · asks $0 ·");
  assertStringIncludes(text, "asks unknown");
  assertStringIncludes(
    text,
    "Where a project's ask is unknown, the ballot's size can't be checked here: say so to the voter rather than estimating it.",
  );
  assert(!text.includes("still needs"));
});

Deno.test("vote llms: a withdrawn initiative is marked withdrawn: true, the times stay ISO UTC", () => {
  const out = voteLlms(m, entries, "https://x.test", undefined, new Set(["fuzzing"]));
  assertStringIncludes(
    out,
    "- fuzzing — Community fuzzing · RFP · goal $250,000 · asks unknown · affiliations: none · withdrawn: true · [details]",
  );
  assert(
    !out.includes(
      "seal-audits — Seal audits · Grant · goal $300,000 · asks unknown · affiliations: Seal · withdrawn",
    ),
  );
  assertStringIncludes(out, "marked withdrawn: true");
  assertStringIncludes(out, "S-Tier starts settling 2027-01-16 11:46 UTC");
  // None withdrawn: no marks, and no word on them.
  assert(!text.includes("withdrawn: true"));
});

Deno.test("vote llms: withdrawn unknown says so, apart from none withdrawn", () => {
  const unknown = voteLlms(m, entries, "https://x.test", undefined, null);
  assertStringIncludes(unknown, "Which projects an admin withdrew from the vote couldn't be read");
  assert(!unknown.includes("withdrawn: true"));
  assert(!text.includes("couldn't be read"));
  const some = voteLlms(m, entries, "https://x.test", undefined, new Set(["wallets"]));
  assertStringIncludes(some, "it is not a candidate");
  assert(!some.includes("no candidate"));
});

Deno.test("vote llms: the route says withdrawn is unknown when the replay can't be read", async () => {
  const h = await harness();
  h.deps.vote = { chain: {} as never, manifest: m };
  const body = await (await h.req("/vote/llms.txt")).text();
  assertStringIncludes(body, "couldn't be read right now");
  h.close();
});

Deno.test("withdrawnNow: the replay's live list, null on a failure or past the wait", async () => {
  const round = { chain: {} as never, manifest: m };
  const st = (live: number[], last: unknown = { status: "waiting" }) =>
    Promise.resolve({ tiers: [{}, {}, last], live: { withdrawn: live } } as never);
  assertEquals([...(await withdrawnNow(round, () => st([2])))!], ["fuzzing"]);
  // Closed: B-Tier's settlement.
  assertEquals(
    [...(await withdrawnNow(round, () => st([], { status: "settled", withdrawn: [3] })))!],
    ["wallets"],
  );
  assertEquals(await withdrawnNow(round, () => Promise.reject(new Error("rpc"))), null);
  assertEquals(await withdrawnNow(round, () => new Promise(() => {}), 10), null);
  assertEquals(await withdrawnNow(round, undefined), null);
});
