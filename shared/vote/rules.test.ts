import { describe, expect, it } from "vitest";
import {
  checkBallot,
  checkProof,
  emptyTierErrors,
  findProof,
  type RulesRound,
  tiersOf,
} from "./rules";
import fixtures from "./fixtures/ballot-rules.json";

/** Six projects: 0 and 1 related to Seal, 5 an RFP. Pool 200. S-Tier enforced. */
const round = (over: Partial<RulesRound> = {}): RulesRound => ({
  projects: [100n, 100n, 100n, 100n, 50n, 50n].map((goalUsd, i) => ({
    goalUsd,
    rfp: i === 5,
    groups: i < 2 ? [0] : [],
  })),
  asks: [100n, 100n, 100n, 100n, 50n, 50n],
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
  it("a valid ballot: three unrelated in S-Tier, 1.5× the pool requested", () => {
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
      // Seal also holds 200 of S-Tier's 300.
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

  describe("when donations take every ask below 1.5× the pool", () => {
    // Pool 200 wants 300, but the asks add up to 280; project 3 is covered.
    const low = { asks: [40n, 40n, 100n, 0n, 50n, 50n] }; // 280 < 300

    it("placing every project passes", () => {
      expect(checkBallot(ballot({ S: [0, 2, 5], B: [1, 3, 4] }), round(low)).ok).toBe(true);
    });

    it("leaving one that still asks out is too small, needing every ask", () => {
      expect(checkBallot(ballot({ S: [0, 2, 5], B: [1] }), round(low)).errors).toEqual([
        { rule: "size", requested: 230n, needed: 280n, pool: 200n },
      ]);
    });

    it("a short ballot leaves out the projects past its end", () => {
      // Project 3 is covered, 4 and 5 past the end still ask.
      const short = Uint8Array.from([1, 4, 1, 1]);
      expect(checkBallot(short, round(low)).errors).toEqual([
        { rule: "size", requested: 180n, needed: 280n, pool: 200n },
      ]);
      expect(checkBallot(short, round({ asks: [40n, 40n, 100n, 0n, 0n, 0n] })).ok).toBe(true);
    });

    it("projects with a $0 ask may be left out", () => {
      // Project 3 is covered; the rest are placed.
      expect(checkBallot(ballot({ S: [0, 2, 5], B: [1, 4] }), round(low)).ok).toBe(true);
    });
  });

  it("saturates at 2^256 − 1 like the contract: a near-max pool needs every ask", () => {
    const max = (1n << 256n) - 1n;
    const big = round({ poolUsd: max, asks: [1n << 254n, 0n, 1n << 254n, 1n << 254n, 0n, 0n] });
    expect(checkBallot(ballot({ S: [0, 2, 3] }), big).ok).toBe(true);
    const unplaced = round({
      poolUsd: max,
      asks: [1n << 254n, 1n << 255n, 1n << 254n, 1n << 254n, 1n << 255n, 1n << 255n],
    });
    expect(checkBallot(ballot({ S: [0, 2, 3] }), unplaced).errors).toEqual([
      { rule: "size", requested: 3n << 254n, needed: max, pool: max },
    ]);
  });

  it("more than three tiers is invalid", () => {
    // Four rank groups: 1, 2, 3, 4.
    expect(checkBallot(Uint8Array.from([1, 2, 3, 4, 255, 255]), round()).errors)
      .toContainEqual({ rule: "tiers" });
  });

  it("A-Tier is checked only when enforced, and must then exist", () => {
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
    expect(checkProof(b, round(), [2, 3, 4])).toBe(false); // 4 is in B-Tier
    expect(checkProof(b, round(), [2, 3])).toBe(false);
  });

  it("findProof names the unrelated triples whatever the pool, or null", () => {
    expect(findProof(ballot({ S: [0, 2, 3] }), round({ poolUsd: 10_000n }))).toEqual([0, 2, 3]);
    expect(findProof(ballot({ S: [0, 1, 2] }), round())).toBeNull();
    expect(findProof(ballot({ S: [0, 2, 3], A: [1, 4, 5] }), round({ independentTiers: 3 })))
      .toEqual([0, 2, 3, 1, 4, 5]);
  });

  it("size counts asks, not goals", () => {
    const funded = round({
      projects: round().projects.map((p) => ({ ...p, goalUsd: 100n })),
      asks: [10n, 10n, 10n, 10n, 10n, 10n],
      poolUsd: 20n,
    });
    const b = ballot({ S: [0, 2, 3, 4] });
    expect(checkBallot(b, funded).ok).toBe(true);
    expect(checkBallot(b, { ...funded, poolUsd: 30n }).errors).toEqual([
      { rule: "size", requested: 40n, needed: 45n, pool: 30n },
    ]);
  });

  it("the group rule keeps counting goals when unrelated projects receive support", () => {
    // Seal's goals are exactly half, even when its live asks become most of S-Tier's.
    const r = round({ asks: [90n, 90n, 10n, 10n, 10n, 10n], poolUsd: 100n });
    expect(checkBallot(ballot({ S: [0, 1, 2, 3] }), r).ok).toBe(true);
    const even = round({ asks: [10n, 10n, 90n, 90n, 10n, 10n], poolUsd: 100n });
    expect(checkBallot(ballot({ S: [0, 1, 2, 3] }), even).ok).toBe(true);
  });

  it("funding an affiliation does not let its goals exceed half of S-Tier", () => {
    const r = round({ asks: [0n, 0n, 100n, 100n, 50n, 50n], poolUsd: 0n });
    expect(checkBallot(ballot({ S: [0, 1, 2, 5] }), r).errors).toEqual([
      { rule: "group", tier: 0, group: 0, groupUsd: 200n, tierUsd: 350n },
    ]);
  });

  it("a $0 ask counts toward independence", () => {
    const zero = round({ asks: [0n, 0n, 0n, 0n, 0n, 0n], poolUsd: 0n });
    expect(checkBallot(ballot({ S: [0, 2, 3] }), zero)).toEqual({
      ok: true,
      errors: [],
      proof: [0, 2, 3],
    });
  });

  const only = (...ids: number[]) => [0, 1, 2, 3, 4, 5].map((i) => ids.includes(i));

  it("withdrawn asks nothing", () => {
    const b = ballot({ S: [0, 2, 3] });
    expect(checkBallot(b, round()).ok).toBe(true);
    expect(checkBallot(b, round({ withdrawn: only(3) })).errors).toEqual([
      { rule: "size", requested: 200n, needed: 300n, pool: 200n },
    ]);
  });

  it("withdrawn asks nothing in the total", () => {
    const b = ballot({ S: [0, 2, 3], B: [1] });
    expect(checkBallot(b, round({ poolUsd: 300n })).errors).toEqual([
      { rule: "size", requested: 400n, needed: 450n, pool: 300n },
    ]);
    expect(checkBallot(b, round({ poolUsd: 300n, withdrawn: only(4, 5) })).ok).toBe(true);
  });

  it("withdrawn left out is fine", () => {
    const asks = [50n, 0n, 30n, 20n, 40n, 0n];
    const b = ballot({ S: [0, 2, 3] });
    expect(checkBallot(b, round({ poolUsd: 100n, asks })).errors).toEqual([
      { rule: "size", requested: 100n, needed: 140n, pool: 100n },
    ]);
    expect(checkBallot(b, round({ poolUsd: 100n, asks, withdrawn: only(4) })).ok).toBe(true);
  });

  it("withdrawn still independent", () => {
    const r = round({ poolUsd: 0n, withdrawn: only(0) });
    expect(checkBallot(ballot({ S: [0, 2, 3] }), r)).toEqual({
      ok: true,
      errors: [],
      proof: [0, 2, 3],
    });
    expect(findProof(ballot({ S: [0, 2, 3] }), r)).toEqual([0, 2, 3]);
    expect(checkProof(ballot({ S: [0, 2, 3] }), r, [0, 2, 3])).toBe(true);
  });

  it("withdrawn keeps its real ask in the group rule", () => {
    // Seal holds 200 of 400: exactly half. Were 2 and 3 worth 0 it would hold all of it.
    const r = round({ poolUsd: 0n, withdrawn: only(2, 3) });
    expect(checkBallot(ballot({ S: [0, 1, 2, 3] }), r)).toEqual({
      ok: true,
      errors: [],
      proof: [0, 2, 3],
    });
  });

  it("tiersOf groups by competition rank", () => {
    expect(tiersOf(Uint8Array.from([1, 1, 3, 255, 3, 1]))).toEqual([[0, 1, 5], [2, 4]]);
  });
});

describe("parity with the Python reference", () => {
  it("matches the Python reference on every fixture", () => {
    for (const c of fixtures) {
      const r = checkBallot(Uint8Array.from(c.ballot), {
        projects: c.projects.map((p) => ({ ...p, goalUsd: BigInt(p.goalUsd) })),
        asks: c.asks.map(BigInt),
        groupNames: c.groupNames,
        poolUsd: BigInt(c.poolUsd),
        independentTiers: c.independentTiers,
        withdrawn: "withdrawn" in c ? (c as { withdrawn: boolean[] }).withdrawn : undefined,
      });
      expect({ name: c.name, ok: r.ok, rules: r.errors.map((e) => e.rule), proof: r.proof })
        .toEqual({ name: c.name, ok: c.ok, rules: c.rules, proof: c.proof });
    }
  });
});

describe("empty tiers by label", () => {
  it("an enforced tier the voter left empty is an independence error (the chain can't see it)", () => {
    expect(emptyTierErrors({ a: "A", b: "A", c: "A" }, 1)).toEqual([
      { rule: "independent", tier: 0, count: 0, related: [] },
    ]);
    expect(emptyTierErrors({ a: "S", b: "B" }, 3)).toEqual([
      { rule: "independent", tier: 1, count: 0, related: [] },
    ]);
    expect(emptyTierErrors({ a: "S", b: "A" }, 3)).toEqual([]);
    expect(emptyTierErrors({ a: "S" }, 1)).toEqual([]);
  });
});

it("an optional empty A-Tier is still required before B-Tier can be represented", () => {
  expect(emptyTierErrors({ a: "S", b: "B" }, 1)).toEqual([{ rule: "empty_tier", tier: 1 }]);
  expect(emptyTierErrors({ b: "B" }, 0)).toEqual([{ rule: "empty_tier", tier: 0 }, {
    rule: "empty_tier",
    tier: 1,
  }]);
});
