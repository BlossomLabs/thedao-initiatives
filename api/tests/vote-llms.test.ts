/** /vote/llms.txt: the round, its rules and every project, for an LLM drafting a ballot. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { voteLlms } from "../services/vote-llms.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import type { FeedInitiative } from "../services/feed.ts";
import { parseBallotText } from "../../shared/vote/pb.ts";
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
  assertStringIncludes(text, "at least $1,500,000 in total (1.5× the $1,000,000 pool)");
  assertStringIncludes(text, "Tier-S needs at least 3 independent projects");
  assertStringIncludes(text, "Anything you leave unranked gets nothing from you");
  assert(!text.includes("Tier-A needs at least 3"));
});

Deno.test("vote llms: the format example parses", () => {
  const example = text.split("\n").find((l) => l.startsWith("1;"))!;
  const got = parseBallotText(example.slice(2), m.slugs);
  assert("tiers" in got, JSON.stringify(got));
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
  assertStringIncludes(await res.text(), "- wallets — wallets · Grant · requests $400,000");
  h.close();
});

Deno.test("vote llms: a round from before the ballot rules states none", () => {
  const old = voteLlms({ ...m, ballotRules: undefined }, entries, "https://x.test");
  assert(!old.includes("1.5×"));
  assertStringIncludes(old, "This round has no ballot rules.");
});
