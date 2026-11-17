import { expect, it } from "vitest";
import { checkBallot, type RuleError } from "../../shared/vote/rules";
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
      "Your ballot requests $1,100,000. It must request at least $1,369,866 (1.5× the $913,244 pool). Add more projects; B-Tier is a good place for them.",
    );
});

it("size: when donations took every ask below 1.5× the pool, the minimum is every ask", () => {
  expect(say({ rule: "size", requested: 230_000_000n, needed: 280_000_000n, pool: 200_000_000n }))
    .toBe(
      "Your ballot requests $230. It must request at least $280 (every ask in the round, which is less than 1.5× the $200 pool). Add more projects; B-Tier is a good place for them.",
    );
});

it("independent: names the affiliated projects that count as one", () => {
  expect(say({
    rule: "independent",
    tier: 0,
    count: 2,
    related: [{ group: 0, projects: [0, 1] }],
  })).toBe(
    "S-Tier needs at least 3 independent projects. Seal Audits and Seal Tooling are affiliated with Seal, so they count as one.",
  );
  expect(say({ rule: "independent", tier: 1, count: 0, related: [] })).toBe(
    "A-Tier needs at least 3 independent projects.",
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
      "Projects affiliated with Seal take $310,000 of S-Tier's $500,000. One affiliation can hold at most half.",
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
  // Required amounts stay exact, including fractions of a dollar.
  const status = (needed: bigint) =>
    ruleStatus([{ rule: "size", requested: 1n, needed, pool: 2n }]).text;
  expect(status(1_360_000_000_001n)).toBe("Needs at least $1,360,000.000001 to be valid");
  expect(status(1_360_000_000_000n)).toBe("Needs at least $1,360,000 to be valid");
  expect(status(13_421_000_000n)).toBe("Needs at least $13,421 to be valid");
  expect(status(999_500_000n)).toBe("Needs at least $999.5 to be valid");
  expect(status(999_000_000n)).toBe("Needs at least $999 to be valid");
  expect(ruleStatus([a, s])).toEqual({
    ok: false,
    text: "Needs at least 3 independent projects in S-Tier",
  });
  expect(ruleStatus([a]).text).toBe("Needs at least 3 independent projects in A-Tier");
  expect(ruleStatus([])).toEqual({ ok: true, text: "You can add as many initiatives as you want" });
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

it("the reachable $1,026,100 minimum is displayed exactly and accepts the full ballot", () => {
  const asks = Array.from(
    { length: 15 },
    (_, i) => BigInt(i === 14 ? 74_100 : 68_000) * 1_000_000n,
  );
  const round = {
    projects: asks.map((goalUsd) => ({ goalUsd, rfp: true, groups: [] })),
    asks,
    poolUsd: 724_876_000_000n,
    groupNames: [],
    independentTiers: 1,
  };
  const partial = new Uint8Array(15).fill(255);
  partial.set([1, 1, 1]);
  expect(ruleStatus(checkBallot(partial, round).errors)).toEqual({
    ok: false,
    text: "Needs at least $1,026,100 to be valid",
  });
  expect(ruleStatus(checkBallot(new Uint8Array(15).fill(1), round).errors).ok).toBe(true);
});

it("an empty A-Tier explains that B-Tier requires at least one A-Tier project", () => {
  const e: RuleError = { rule: "empty_tier", tier: 1 };
  expect(say(e)).toBe("A-Tier must have at least one project if B-Tier is not empty.");
  expect(ruleStatus([e])).toEqual({
    ok: false,
    text: "A-Tier must have at least one project if B-Tier is not empty",
  });
  expect(explainBelow(e)).toBe(true);
});
