import { expect, it } from "vitest";
import { checkBallot, type RuleError } from "../../shared/vote/rules";
import { affiliationFlags, explainBelow, ruleMessage, ruleStatus } from "./vote-rules-copy";

const say = ruleMessage;

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
      "Your ballot requests $1,100,000. It must request at least $1,369,866 (1.5× the $913,244 pool). Add more initiatives; B-Tier is a good place for them.",
    );
});

it("size: when donations took every ask below 1.5× the pool, the minimum is every ask", () => {
  expect(say({ rule: "size", requested: 230_000_000n, needed: 280_000_000n, pool: 200_000_000n }))
    .toBe(
      "Your ballot requests $230. It must request at least $280 (every ask in the round, which is less than 1.5× the $200 pool). Add more initiatives; B-Tier is a good place for them.",
    );
});

it("independent: the rule, that affiliated projects count as one, and what to add", () => {
  expect(say({
    rule: "independent",
    tier: 0,
    count: 2,
    related: [{ group: 0, projects: [0, 1] }],
  })).toBe(
    "S-Tier needs at least 3 independent initiatives. Initiatives with the same affiliation count as one, so the marked ones count once. Add initiatives that share no affiliation with your other S-Tier picks.",
  );
  expect(say({ rule: "independent", tier: 1, count: 0, related: [] })).toBe(
    "A-Tier needs at least 3 independent initiatives.",
  );
});

it("group: the rule and the two ways out, no names or amounts (#144)", () => {
  const e: RuleError = {
    rule: "group",
    tier: 0,
    group: 0,
    groupUsd: 555_000_000_000n,
    tierUsd: 1_100_000_000_000n,
    projects: [0, 1, 2],
  };
  expect(say(e)).toBe(
    "Initiatives with the same affiliation can hold at most half of S-Tier's goals, and the marked ones hold more. Move some of them out of S-Tier, or add initiatives not affiliated with them.",
  );
  // Another affiliation over half the same tier says the same.
  expect(say({ ...e, group: 1, projects: [3, 4] })).toBe(say(e));
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
    text: "Needs at least 3 independent initiatives in S-Tier",
  });
  expect(ruleStatus([a]).text).toBe("Needs at least 3 independent initiatives in A-Tier");
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
  expect(
    explainBelow({ rule: "group", tier: 1, group: 0, groupUsd: 3n, tierUsd: 4n, projects: [0] }),
  ).toBe(true);
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

it("an empty A-Tier explains the B-Tier encoding restriction and settlement limit", () => {
  const e: RuleError = { rule: "empty_tier", tier: 1 };
  expect(say(e)).toContain("A-Tier needs a pick before a later tier can be used");
  expect(say(e)).toContain("already settled empty");
  expect(ruleStatus([e]).ok).toBe(false);
  expect(explainBelow(e)).toBe(true);
});

const colibri: RuleError = {
  rule: "group",
  tier: 0,
  group: 0,
  groupUsd: 555n,
  tierUsd: 1_100n,
  projects: [0, 1, 2],
};

it("affiliationFlags: the cards each rule blames, a card in two affiliations gets both", () => {
  const flags = affiliationFlags([
    colibri,
    { rule: "independent", tier: 0, count: 2, related: [{ group: 1, projects: [2, 3] }] },
    { rule: "size", requested: 1n, needed: 2n, pool: 2n },
  ], (g) => ["colibri", "Argot"][g]);
  expect([...flags.keys()].sort()).toEqual([0, 1, 2, 3]);
  expect(flags.get(0)).toEqual({
    tag: "colibri",
    reason: "Affiliated with colibri: over half of S-Tier",
  });
  expect(flags.get(2)).toEqual({
    tag: "colibri, Argot",
    reason:
      "Affiliated with colibri: over half of S-Tier; Affiliated with Argot: counts as one in S-Tier",
  });
  expect(flags.get(3)?.reason).toBe("Affiliated with Argot: counts as one in S-Tier");
});

it("group with one grant in the tier: the grant alone is over half, no affiliation named (#147)", () => {
  const alone: RuleError = {
    rule: "group",
    tier: 0,
    group: 6,
    groupUsd: 200n,
    tierUsd: 350n,
    projects: [24],
  };
  expect(say(alone)).toBe(
    "One grant can hold at most half of S-Tier's goals, and the marked one holds more. Add more initiatives to S-Tier, or move it to a lower tier.",
  );
  expect(ruleStatus([alone])).toEqual({ ok: false, text: "One grant holds over half of S-Tier" });
  expect(ruleStatus([colibri]).text).toBe("One affiliation holds over half of S-Tier");
  expect(explainBelow(alone)).toBe(true);
  const flags = affiliationFlags([alone, colibri], (g) => (g === 6 ? "SEAL" : "colibri"));
  expect(flags.get(24)).toEqual({ tag: "Over half", reason: "Over half of S-Tier on its own" });
  expect(flags.get(0)?.tag).toBe("colibri");
});
