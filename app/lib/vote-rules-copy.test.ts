import { expect, it } from "vitest";
import type { RuleError } from "../../shared/vote/rules";
import { explainBelow, ruleMessage, ruleStatus } from "./vote-rules-copy";

const titleOf = (i: number) => ["Seal Audits", "Seal Tooling", "Gamma", "Delta"][i];
const groupName = (g: number) => ["Seal"][g];
const say = (e: Parameters<typeof ruleMessage>[0]) => ruleMessage(e, titleOf, groupName);

it("size: what it requests, what it must, and where to add", () => {
  expect(
    say({
      rule: "size",
      requested: 1_100_000_000_000n,
      needed: 1_369_866_000_000n,
      pool: 913_244_000_000n,
    }),
  )
    .toBe(
      "Your ballot requests $1,100,000. It must request at least $1,369,866 (1.5× the $913,244 pool). Add more projects; Tier-B is a good place for them.",
    );
});

it("independent: names the affiliated projects that count as one", () => {
  expect(say({
    rule: "independent",
    tier: 0,
    count: 2,
    related: [{ group: 0, projects: [0, 1] }],
  })).toBe(
    "Tier-S needs at least 3 independent projects. Seal Audits and Seal Tooling are affiliated with Seal, so they count as one.",
  );
  expect(say({ rule: "independent", tier: 1, count: 0, related: [] })).toBe(
    "Tier-A needs at least 3 independent projects.",
  );
  expect(say({
    rule: "independent",
    tier: 0,
    count: 1,
    related: [{ group: 0, projects: [0, 1, 2] }],
  })).toContain("Seal Audits, Seal Tooling and Gamma are affiliated with Seal");
});

it("group: what the affiliation takes of the tier", () => {
  expect(
    say({
      rule: "group",
      tier: 0,
      group: 0,
      groupUsd: 310_000_000_000n,
      tierUsd: 500_000_000_000n,
    }),
  )
    .toBe(
      "Projects affiliated with Seal take $310,000 of Tier-S's $500,000. One affiliation can hold at most half.",
    );
});

it("tiers and shape", () => {
  expect(say({ rule: "tiers" })).toBe("Use at most three tiers.");
  expect(say({ rule: "shape" })).toBe("This ballot can't be read.");
});

it("the ballot box's line: the first rule to meet, size before tiers, else valid", () => {
  const size: RuleError = { rule: "size", requested: 1n, needed: 1_369_866_000_000n, pool: 2n };
  const s: RuleError = { rule: "independent", tier: 0, count: 1, related: [] };
  const a: RuleError = { rule: "independent", tier: 1, count: 2, related: [] };
  expect(ruleStatus([a, s, size])).toEqual({
    ok: false,
    text: "Needs at least $1,369,866 to be valid",
  });
  expect(ruleStatus([a, s])).toEqual({
    ok: false,
    text: "Needs at least 3 independent projects in Tier-S",
  });
  expect(ruleStatus([a]).text).toBe("Needs at least 3 independent projects in Tier-A");
  expect(ruleStatus([])).toEqual({ ok: true, text: "You can keep adding initiatives" });
});

it("only affiliation problems get the box under the tiers", () => {
  expect(explainBelow({ rule: "size", requested: 1n, needed: 2n, pool: 2n })).toBe(false);
  expect(explainBelow({ rule: "independent", tier: 0, count: 2, related: [] })).toBe(false);
  expect(
    explainBelow({
      rule: "independent",
      tier: 0,
      count: 2,
      related: [{ group: 0, projects: [0, 1] }],
    }),
  ).toBe(true);
  expect(explainBelow({ rule: "group", tier: 1, group: 0, groupUsd: 3n, tierUsd: 4n })).toBe(
    true,
  );
});
