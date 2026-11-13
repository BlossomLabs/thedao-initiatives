import { describe, expect, it } from "vitest";
import { formatBallotPb, parseBallotText } from "./pb";

const slugs = ["evm", "vyper", "fuzz", "forensiq", "dappfence", "wallets", "other"];
const FILE = `META
key;value
description;TheDAO vote ballot
vote_type;ordinal
blossom_ties;1
PROJECTS
project_id;cost;name
evm;250000;Formally verified EVM
VOTES
voter_id;vote
1;evm=vyper=fuzz,forensiq,dappfence=wallets
`;

describe("pabutools ballots (Blossom ties)", () => {
  it("reads the spec's example: ties with =, tiers in order with ,", () => {
    expect(parseBallotText(FILE, slugs)).toEqual({
      tiers: { evm: "S", vyper: "S", fuzz: "S", forensiq: "A", dappfence: "B", wallets: "B" },
    });
  });
  it("takes a bare vote line", () => {
    expect(parseBallotText("evm=vyper,fuzz", slugs)).toEqual({
      tiers: { evm: "S", vyper: "S", fuzz: "A" },
    });
  });
  it("ignores CRLF and spaces around = and ,", () => {
    expect(parseBallotText(FILE.replaceAll("\n", "\r\n"), slugs)).toEqual(
      parseBallotText(FILE, slugs),
    );
    expect(parseBallotText("  evm = vyper ,  fuzz \r\n", slugs)).toEqual({
      tiers: { evm: "S", vyper: "S", fuzz: "A" },
    });
  });
  it("refuses unknown projects, a project twice, more than three tiers, and nothing", () => {
    expect(parseBallotText("evm,nope", slugs)).toEqual({ error: "Unknown project: nope" });
    expect(parseBallotText("evm=fuzz,evm", slugs)).toEqual({ error: "evm is listed twice" });
    expect(parseBallotText("evm,vyper,fuzz,wallets", slugs)).toEqual({
      error: "Use at most three tiers.",
    });
    expect(parseBallotText("   ", slugs)).toEqual({ error: "No vote found." });
    expect(parseBallotText("META\nkey;value\nVOTES\nvoter_id;vote\n", slugs)).toEqual({
      error: "No vote found.",
    });
  });
  it("formats a ballot that reads back the same", () => {
    const tiers = { evm: "S", vyper: "S", fuzz: "S", wallets: "B" } as const;
    const text = formatBallotPb(tiers, {
      slugs,
      titles: (s) => s.toUpperCase(),
      askUsd: () => 1_500_000n,
    });
    expect(text).toContain("vote_type;ordinal\nblossom_ties;1");
    expect(text).toContain("evm;2;EVM"); // whole dollars, rounded
    // An empty A-Tier is an empty group: the ballot reads back exactly.
    expect(text).toContain("1;evm=vyper=fuzz,,wallets");
    expect(parseBallotText(text, slugs)).toEqual({ tiers });
  });
});

describe("what an LLM answers", () => {
  it("reads a voter-id row, a fenced reply, and a VOTES row without its header", () => {
    const want = { tiers: { evm: "S", vyper: "S", fuzz: "A" } };
    expect(parseBallotText("1;evm=vyper,fuzz", slugs)).toEqual(want);
    expect(parseBallotText("```\nevm=vyper,fuzz\n```", slugs)).toEqual(want);
    expect(parseBallotText("```text\nVOTES\nvoter_id;vote\n1;evm=vyper,fuzz\n```", slugs)).toEqual(
      want,
    );
    expect(parseBallotText("VOTES\n1;evm=vyper,fuzz", slugs)).toEqual(want);
  });
});
