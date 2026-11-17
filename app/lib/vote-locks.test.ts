import { describe, expect, it } from "vitest";
import { countedTiers, lockedLabels } from "./vote-locks";

describe("lockedLabels: what a settled tier freezes on this voter's ballot", () => {
  it("nothing before a tier settles", () => {
    expect(lockedLabels({ x: "S" }, 0)).toEqual(new Set());
  });
  it("an A-only ballot: its first group is A, so S and A freeze once S settles", () => {
    expect(lockedLabels({ x: "A" }, 1)).toEqual(new Set(["S", "A"]));
  });
  it("S and B: S freezes first; with two settled, B is the second group", () => {
    expect(lockedLabels({ x: "S", y: "B" }, 1)).toEqual(new Set(["S"]));
    expect(lockedLabels({ x: "S", y: "B" }, 2)).toEqual(new Set(["S", "A", "B"]));
  });
  it("fewer groups than settled tiers: adding anything would change one, so all freeze", () => {
    expect(lockedLabels({ x: "A" }, 2)).toEqual(new Set(["S", "A", "B"]));
  });
});

describe("countedTiers", () => {
  const slugs = ["alpha", "beta", "gamma"];
  it("corrects old local A-Tier labels to the S-Tier group actually counted", () => {
    expect(countedTiers("0xff01ff", { beta: "A" }, slugs)).toEqual({ beta: "S" });
  });
  it("else the chain's reading", () => {
    expect(countedTiers("0xff01ff", {}, slugs)).toEqual({ beta: "S" });
  });
});
