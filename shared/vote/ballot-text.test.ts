import { describe, expect, it } from "vitest";
import { formatBallotText, parseBallotText } from "./ballot-text";

const slugs = ["evm", "vyper", "fuzz", "forensiq", "dappfence", "wallets", "other"];
const BALLOT = `S-Tier:
  - evm
  - vyper
  - fuzz
A-Tier:
  - forensiq
B-Tier:
  - dappfence
  - wallets
`;

describe("YAML ballots", () => {
  it("reads one list per tier", async () => {
    expect(await parseBallotText(BALLOT, slugs)).toEqual({
      tiers: { evm: "S", vyper: "S", fuzz: "S", forensiq: "A", dappfence: "B", wallets: "B" },
    });
  });
  it("takes short keys, the flow form, one slug, an empty tier, comments and CRLF", async () => {
    const text = "S: [evm, vyper]  # must fund\r\nA-Tier: []\r\nb-tier: wallets\r\n";
    expect(await parseBallotText(text, slugs)).toEqual({
      tiers: { evm: "S", vyper: "S", wallets: "B" },
    });
  });
  it("refuses unknown projects and tiers, a project twice, and nothing", async () => {
    expect(await parseBallotText("S-Tier: [evm, nope]", slugs)).toEqual({
      error: "Unknown project: nope",
    });
    expect(await parseBallotText("S-Tier: [evm]\nB-Tier: [evm]", slugs)).toEqual({
      error: "evm is listed twice",
    });
    expect(await parseBallotText("S-Tier: [evm]\nC-Tier: [fuzz]", slugs)).toEqual({
      error: "Unknown tier: C-Tier. Use S-Tier, A-Tier or B-Tier.",
    });
    expect(await parseBallotText("   ", slugs)).toEqual({ error: "No vote found." });
    expect(await parseBallotText("S-Tier: []\nA-Tier:", slugs)).toEqual({
      error: "No vote found.",
    });
  });
  it("formats every tier, S-Tier first, and reads back the same", async () => {
    const tiers = { wallets: "B", evm: "S", vyper: "S" } as const;
    const text = formatBallotText(tiers, slugs);
    expect(text).toBe("S-Tier:\n  - evm\n  - vyper\nA-Tier: []\nB-Tier:\n  - wallets");
    expect(await parseBallotText(text, slugs)).toEqual({ tiers });
    expect(formatBallotText({}, slugs)).toBe("S-Tier: []\nA-Tier: []\nB-Tier: []");
  });
});

describe("what an LLM answers", () => {
  const want = { tiers: { evm: "S", vyper: "S", fuzz: "A" } };
  it("reads a fenced block inside prose", async () => {
    const text = "Here is your ballot:\n\n```yaml\nS-Tier:\n  - evm\n  - vyper\nA-Tier:\n" +
      "  - fuzz\n```\n\nLet me know if you want changes.";
    expect(await parseBallotText(text, slugs)).toEqual(want);
  });
  it("reads it copied off a rendered chat: no bullets, markdown headings, notes", async () => {
    const text = "Here is your ballot:\n\n**S-Tier**\n\nevm — formal EVM\n`vyper`\n\n" +
      "## A-Tier\n1. fuzz (RFP)\n\nLet me know if you want changes.";
    expect(await parseBallotText(text, slugs)).toEqual(want);
    expect(await parseBallotText("Sure!\nS-Tier: evm, vyper\nA-Tier: [fuzz]", slugs))
      .toEqual(want);
  });
});
