import { describe, expect, it } from "vitest";
import {
  addBlocker,
  addPlan,
  type BoardCard,
  looksJoint,
  titleAffiliation,
  titleAffiliationIn,
} from "./add-plan.ts";
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

describe("the affiliation a grant's title names (#147)", () => {
  it("a grant without affiliations gets a new one named after the team its title starts with", () => {
    const { calls, manifest: m } = addPlan(
      manifest({ groups: ["Seal"] }),
      [card({ title: "Remix: AI-Guided Smart Contract Security Checks" })],
    );
    expect(calls.map((c) => c.fn)).toEqual(["addGroup", "addInitiative"]);
    expect(m.groups).toEqual(["Seal", "Remix"]);
    expect(m.projects[1].groups).toEqual([1]);
    expect(calls[1].args[3]).toBe(0b10n);
  });
  it("an affiliation the round has already, held or not, is joined (ignoring case)", () => {
    const held = manifest({
      groups: ["SEAL"],
      projects: [{ goalUsd: "1000000", rfp: false, groups: [0] }],
    });
    const joined = addPlan(held, [card({ title: "seal: Incident Response" })]);
    expect(joined.calls.map((c) => c.fn)).toEqual(["addInitiative"]);
    expect(joined.manifest.groups).toEqual(["SEAL"]);
    expect(joined.manifest.projects[1].groups).toEqual([0]);
    // Left unused by an add that failed after it landed: the retry joins it.
    const left = addPlan(manifest({ groups: ["Remix"] }), [card({ title: "Remix: x" })]);
    expect(left.calls.map((c) => c.fn)).toEqual(["addInitiative"]);
    expect(titleAffiliationIn(held, { slug: "x", title: "Seal: y" })).toEqual({
      name: "SEAL",
      existing: true,
    });
    expect(titleAffiliationIn(held, { slug: "x", title: "Remix: y" })).toEqual({
      name: "Remix",
      existing: false,
    });
  });
  it("two grants of one team in one plan share it", () => {
    const { manifest: m } = addPlan(manifest(), [
      card({ slug: "p", title: "Acme: one" }),
      card({
        slug: "q",
        safeAddress: "0x3000000000000000000000000000000000000003",
        title: "Acme: two",
      }),
    ]);
    expect(m.groups).toEqual(["Acme"]);
    expect(m.projects.slice(1).map((p) => p.groups)).toEqual([[0], [0]]);
  });
  it("an RFP gets none, and an affiliated grant keeps its own", () => {
    const rfp = addPlan(manifest(), [card({ type: "rfp", title: "RFP: Fuzzing" })]);
    expect(rfp.calls.map((c) => c.fn)).toEqual(["addInitiative"]);
    const seal = addPlan(manifest({ groups: ["Seal"] }), [
      card({ title: "Remix: x", affiliations: ["SEAL"] }),
    ]);
    expect(seal.manifest.groups).toEqual(["Seal"]);
  });
  it("no colon: the whole title, else the slug; at most 32 bytes", () => {
    expect(titleAffiliation({ slug: "walnut", title: "Walnut" })).toBe("Walnut");
    expect(titleAffiliation({ slug: "walnut" })).toBe("walnut");
    expect(titleAffiliation({ slug: "x", title: "A".repeat(40) + ": x" })).toBe("A".repeat(32));
  });
  it("looksJoint: a team naming two or more", () => {
    for (const n of ["Kleros x Seer", "A & B", "A and B", "A, B", "A + B", "A/B"]) {
      expect(looksJoint(n)).toBe(true);
    }
    for (const n of ["Remix", "Kann Audits", "Revoke.cash", "Nexus", "OKcontract"]) {
      expect(looksJoint(n)).toBe(false);
    }
  });
});
