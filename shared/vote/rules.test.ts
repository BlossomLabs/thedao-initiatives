import { describe, expect, it } from "vitest";
import { checkBallot, checkProof, type RulesRound, tiersOf } from "./rules";

/** Six projects: 0 and 1 related to Seal, 5 an RFP. Pool 200. Tier-S enforced. */
const round = (over: Partial<RulesRound> = {}): RulesRound => ({
  projects: [100n, 100n, 100n, 100n, 50n, 50n].map((askUsd, i) => ({
    askUsd,
    rfp: i === 5,
    groups: i < 2 ? [0] : [],
  })),
  groupNames: ["Seal"],
  poolUsd: 200n,
  independentTiers: 1,
  ...over,
});
/** A ballot of `len` bytes from tiers of project indexes (competition ranks). */
function ballot(tiers: { S?: number[]; A?: number[]; B?: number[] }, len = 6): Uint8Array {
  const out = new Uint8Array(len).fill(255);
  let rank = 1;
  for (const group of [tiers.S ?? [], tiers.A ?? [], tiers.B ?? []]) {
    for (const i of group) out[i] = rank;
    rank += group.length;
  }
  return out;
}

describe("ballot rules", () => {
  it("a valid ballot: three unrelated in Tier-S, 1.5× the pool requested", () => {
    expect(checkBallot(ballot({ S: [0, 2, 3] }), round())).toEqual({
      ok: true,
      errors: [],
      proof: [0, 2, 3],
    });
  });

  it("related projects count as one", () => {
    const r = checkBallot(ballot({ S: [0, 1, 2], B: [3, 4] }), round());
    expect(r.ok).toBe(false);
    expect(r.proof).toEqual([]);
    expect(r.errors).toEqual([
      { rule: "independent", tier: 0, count: 2, related: [{ group: 0, projects: [0, 1] }] },
      // Seal also holds 200 of Tier-S's 300.
      { rule: "group", tier: 0, group: 0, groupUsd: 200n, tierUsd: 300n },
    ]);
  });

  it("an RFP is independent of everything", () => {
    expect(checkBallot(ballot({ S: [0, 2, 5], B: [3] }), round()).ok).toBe(true);
  });

  it("a group may hold exactly half, not more", () => {
    const half = checkBallot(ballot({ S: [0, 1, 2, 3] }), round());
    expect(half).toEqual({ ok: true, errors: [], proof: [0, 2, 3] });
    expect(checkBallot(ballot({ S: [0, 1, 2, 5] }), round()).errors).toEqual([
      { rule: "group", tier: 0, group: 0, groupUsd: 200n, tierUsd: 350n },
    ]);
  });

  it("minimum size is 1.5× the pool, exactly allowed", () => {
    expect(checkBallot(ballot({ S: [0, 2, 3] }), round()).ok).toBe(true);
    expect(checkBallot(ballot({ S: [0, 2, 3] }), round({ poolUsd: 201n })).errors).toEqual([
      { rule: "size", requested: 300n, needed: 302n, pool: 201n },
    ]);
  });

  it("more than three tiers is invalid", () => {
    // Four rank groups: 1, 2, 3, 4.
    expect(checkBallot(Uint8Array.from([1, 2, 3, 4, 255, 255]), round()).errors)
      .toContainEqual({ rule: "tiers" });
  });

  it("Tier-A is checked only when enforced, and must then exist", () => {
    const b = ballot({ S: [0, 2, 3] });
    expect(checkBallot(b, round({ independentTiers: 1 })).ok).toBe(true);
    expect(checkBallot(b, round({ independentTiers: 3 })).errors).toEqual([
      { rule: "independent", tier: 1, count: 0, related: [] },
    ]);
  });

  it("a shorter ballot reads missing projects as unplaced", () => {
    const short = Uint8Array.from([1, 4, 1, 1]); // S = 0, 2, 3; A = 1
    const padded = Uint8Array.from([1, 4, 1, 1, 255, 255]);
    expect(checkBallot(short, round())).toEqual(checkBallot(padded, round()));
    expect(checkBallot(short, round()).ok).toBe(true);
  });

  it("a ballot longer than the projects, or with a rank gap, can't be read", () => {
    expect(checkBallot(Uint8Array.from([1, 1, 1, 255, 255, 255, 255]), round()).errors)
      .toEqual([{ rule: "shape" }]);
    expect(checkBallot(Uint8Array.from([1, 4, 1, 255, 255, 255]), round()).errors)
      .toEqual([{ rule: "shape" }]);
  });

  it("checkProof accepts any valid triple and rejects related or misplaced ones", () => {
    const b = ballot({ S: [0, 1, 2, 3], B: [4] });
    expect(checkProof(b, round(), [1, 2, 3])).toBe(true);
    expect(checkProof(b, round(), [0, 1, 2])).toBe(false); // 0 and 1 share Seal
    expect(checkProof(b, round(), [2, 3, 4])).toBe(false); // 4 is in Tier-B
    expect(checkProof(b, round(), [2, 3])).toBe(false);
  });

  it("tiersOf groups by competition rank", () => {
    expect(tiersOf(Uint8Array.from([1, 1, 3, 255, 3, 1]))).toEqual([[0, 1, 5], [2, 4]]);
  });
});
