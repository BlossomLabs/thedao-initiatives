import { describe, expect, it } from "vitest";
import { effectiveRanks } from "../../vote/shared/ranks";
import fixtures from "./fixtures/stage-tally.json";
import { stageBound, stageTally, tierOf } from "./stage";

type Fixture = {
  costs: string[];
  weights: string[];
  budget: string;
  ballots: number[][];
  stages: { order: number[]; bound: number; shares: Record<string, Record<string, string>> }[];
};

describe("stage tally: the Python quiet ending's _ear, chained stage by stage", () => {
  (fixtures as Fixture[]).forEach((f, k) => {
    it(`fixture ${k}`, () => {
      const m = f.costs.length;
      const costs = f.costs.map(BigInt);
      const weights = f.weights.map(BigInt);
      const ranks = f.ballots.map((b) => effectiveRanks(b, m));
      const done = new Set<number>();
      let spent = 0n;
      f.stages.forEach((want, stage) => {
        const bound = stageBound(f.ballots, stage, 3, m);
        expect(bound).toBe(want.bound);
        const candidates = [...Array(m).keys()].filter((c) => !done.has(c));
        const got = stageTally(costs, weights, ranks, BigInt(f.budget), spent, candidates, bound);
        expect(got.order).toEqual(want.order);
        for (const c of got.order) {
          const shares = Object.fromEntries(
            [...got.shares.get(c)!].map(([i, d]) => [String(i), d.toString()]),
          );
          expect(shares).toEqual(want.shares[String(c)]);
          done.add(c);
          spent += [...got.shares.get(c)!.values()].reduce((a, b) => a + b, 0n);
        }
      });
    });
  });
});

describe("tierOf", () => {
  it("counts distinct ranks; withheld comes after every tier", () => {
    expect(tierOf([1, 1, 3, 255], 0)).toBe(0);
    expect(tierOf([1, 1, 3, 255], 2)).toBe(1);
    expect(tierOf([1, 1, 3, 255], 3)).toBeGreaterThan(2);
    expect(tierOf(null, 0)).toBe(1); // as the Python: no ballot, no tiers
  });
});
