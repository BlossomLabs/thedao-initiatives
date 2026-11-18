import { describe, expect, it } from "vitest";
import { addBlocker, addPlan, type BoardCard } from "./add-plan.ts";
import type { VoteManifest } from "./manifest.ts";
import { tierSpan } from "./round-from-chain.ts";

const SAFE = "0x1000000000000000000000000000000000000001";
const OTHER = "0x2000000000000000000000000000000000000002";
const schedule = {
  opensAt: 1_000,
  firstTallyAt: [100_000, 200_000, 300_000] as [number, number, number],
  initialWindow: 320,
  maxWindows: 4,
};
const tierMax = tierSpan(schedule);
const manifest = (over: Partial<VoteManifest> = {}): VoteManifest => ({
  kind: "real",
  chainId: 1,
  contract: "0x0000000000000000000000000000000000000abc",
  deployBlock: 1,
  opensAt: schedule.opensAt,
  closesAt: schedule.firstTallyAt[2] + tierMax,
  schedule,
  poolUsd: "0",
  slugs: ["old"],
  projects: [{ goalUsd: "1000000", rfp: false, groups: [] }],
  groups: [],
  accounts: [SAFE],
  independentTiers: 1,
  ...over,
});
const card = (over: Partial<BoardCard> = {}): BoardCard => ({
  slug: "new",
  goalUsd: 1000,
  safeAddress: OTHER,
  ...over,
});
const NOW = 5_000;

describe("addBlocker", () => {
  it("addBlocker: no Safe on the real round", () => {
    expect(addBlocker(manifest(), card({ safeAddress: "" }), NOW)).toEqual({ kind: "no-safe" });
    const test = manifest({ kind: "test", chainId: 11155111 });
    expect(addBlocker(test, card({ safeAddress: "" }), NOW)).toBeNull();
  });
  it("addBlocker: a Safe another initiative in the round uses", () => {
    const c = card({ safeAddress: SAFE.toUpperCase().replace("0X", "0x") });
    expect(addBlocker(manifest(), c, NOW)).toEqual({ kind: "safe-used" });
  });
  it("addBlocker: an RFP with affiliations", () => {
    const c = card({ type: "rfp", affiliations: ["Acme"] });
    expect(addBlocker(manifest(), c, NOW)).toEqual({ kind: "rfp-affiliations" });
  });
  it("addBlocker: inside S-Tier's quiet ending", () => {
    const t = schedule.firstTallyAt[0];
    expect(addBlocker(manifest(), card(), t + 1)).toEqual({
      kind: "closed",
      opensAt: t + tierMax,
    });
    expect(addBlocker(manifest(), card(), schedule.firstTallyAt[2] + tierMax + 1)).toEqual({
      kind: "closed",
      opensAt: null,
    });
  });
  it("addBlocker: already in the round", () => {
    expect(addBlocker(manifest(), card({ slug: "old" }), NOW)).toEqual({ kind: "already" });
  });
  it("addBlocker: nothing in the way", () => {
    expect(addBlocker(manifest(), card(), NOW)).toBeNull();
  });
});

describe("addPlan", () => {
  it("addPlan: a new affiliation adds its group before the initiative", () => {
    const { calls } = addPlan(manifest(), [card({ affiliations: ["Acme"] })]);
    expect(calls.map((c) => c.fn)).toEqual(["addGroup", "addInitiative"]);
  });
});
