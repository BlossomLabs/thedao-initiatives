import { describe, expect, it } from "vitest";
import { effectiveRanks } from "../../vote/shared/ranks";
import { type ChainInputs, chainTally } from "./chain";
import { nextTiers, nextTiersAsync, STEP } from "./next-tier";

const K = STEP; // $1K in micro-USD

/** Inputs from raw ballots (one rank per initiative, 1 = Tier-S, 2 = Tier-A, ...). */
function inputs(
  costsK: number[],
  weightsK: number[],
  ballots: number[][],
  poolK = 100,
  done: number[] = [],
): ChainInputs {
  const m = costsK.length;
  return {
    m,
    costs: costsK.map((c) => BigInt(Math.round(c * 1000)) * 1_000_000n),
    voters: weightsK.map((_, i) => `v${i}`),
    weights: weightsK.map((w) => BigInt(Math.round(w * 1000)) * 1_000_000n),
    ranks: ballots.map((b) => effectiveRanks(b, m)),
    ballots,
    poolUsd: BigInt(poolK) * K,
    spent: 0n,
    done: new Set(done),
  };
}

/** Tier index of `c` with a phantom of `k` steps, as nextTiers builds it. */
function tierWith(inp: ChainInputs, c: number, k: bigint, first = 0): number | undefined {
  const ranks = Array.from({ length: inp.m }, (_, i) => (i === c ? 1 : inp.m + 2));
  const run = chainTally({
    ...inp,
    voters: [...inp.voters, "phantom"],
    weights: [...inp.weights, k * K],
    ranks: [...inp.ranks, ranks],
  }, first);
  const at = run.findIndex((s) => s.order.includes(c));
  return at < 0 ? undefined : first + at;
}

// One voter with $40K: initiative 1 ($40K) is funded in Tier-A. Initiative 0 ($70K) is
// out of their reach alone.
const knockOn = () => inputs([70, 40], [40], [[1, 2]]);

describe("the gap to the next tier", () => {
  it("funded in A: the gap is the least $1K step that funds it in Tier-S", () => {
    const inp = knockOn();
    const got = nextTiers(inp, 0).get(1)!;
    expect(got.tier).toBe("S");
    expect(got.gap).toBe(40n * K);
    expect(tierWith(inp, 1, 40n)).toBe(0);
    expect(tierWith(inp, 1, 39n)).not.toBe(0);
  });

  it("gaps round up to the next $1K", () => {
    // Initiative 1 needs $40K and has $39.7K behind it: $300 short.
    const inp = inputs([10, 40], [49.7], [[1, 2]]);
    const got = nextTiers(inp, 0).get(1)!;
    expect(got.tier).toBe("B");
    expect(got.gap).toBe(STEP);
  });

  it("not funded: the target is Tier-B", () => {
    const got = nextTiers(knockOn(), 0).get(0)!;
    expect(got.tier).toBe("B");
    expect(got.gap).toBe(30n * K);
  });

  it("funded in Tier-S: no entry", () => {
    const inp = inputs([10, 40], [49.7], [[1, 2]]);
    expect(nextTiers(inp, 0).has(0)).toBe(false);
  });

  it("a settled target tier gives no entry", () => {
    const inp = inputs([70, 40], [40], [[1, 2]], 100, [0]);
    expect(nextTiers(inp, 1).has(1)).toBe(false);
  });

  it("out of reach: null gap and no knock-on", () => {
    const inp = inputs([150, 40], [40], [[1, 2]]);
    expect(nextTiers(inp, 0).get(0)).toEqual({
      tier: "B",
      gap: null,
      comesIn: [],
      dropsOut: [],
      moves: [],
    });
  });

  it("the knock-on lists who comes in, drops out and moves", () => {
    // Funding initiative 0 spends $70K of the pool, so initiative 1 ($40K) no longer fits.
    const got = nextTiers(knockOn(), 0).get(0)!;
    expect(got.dropsOut).toEqual([[1, "A"]]);
    expect(got.comesIn).toEqual([]);
    expect(got.moves).toEqual([]);
  });

  it("the knock-on lists who comes in", () => {
    // The phantom funds initiative 0 in Tier-S; the voters' leftover money then funds
    // initiative 2 in Tier-A.
    const inp = inputs([10, 10, 10, 10], [10, 10, 10], [[3, 3, 3, 1], [2, 1, 3, 3], [3, 3, 3, 1]]);
    const got = nextTiers(inp, 0).get(0)!;
    expect(got.gap).toBe(10n * K);
    expect(got.comesIn).toEqual([[2, "A"]]);
    expect(got.dropsOut).toEqual([]);
    expect(got.moves).toEqual([]);
  });

  it("the knock-on lists who moves tier", () => {
    const inp = inputs([10, 10, 10, 10], [10, 10, 10], [[3, 1, 2, 3], [1, 3, 1, 3], [2, 1, 3, 3]]);
    const got = nextTiers(inp, 0).get(2)!;
    expect(got.tier).toBe("S");
    expect(got.moves).toEqual([[0, "S", "A"]]);
    expect(got.comesIn).toEqual([]);
    expect(got.dropsOut).toEqual([]);
  });

  it("no ballots: the gap is the need", () => {
    const inp = inputs([25.5], [], []);
    expect(nextTiers(inp, 0).get(0)!.gap).toBe(26n * K);
  });

  /** 40 initiatives, 200 voters, a $300K pool. */
  const large = () => {
    const m = 40, n = 200;
    const costsK = Array.from({ length: m }, (_, c) => 5 + ((c * 37) % 23));
    const weightsK = Array.from({ length: n }, (_, v) => 1 + ((v * 11) % 7));
    const ballots = Array.from(
      { length: n },
      (_, v) => Array.from({ length: m }, (_, c) => 1 + ((v * 7 + c * 13) % 3)),
    );
    return inputs(costsK, weightsK, ballots, 300);
  };

  it("runs the tally a bounded number of times", () => {
    const inp = large();
    let runs = 0;
    const got = nextTiers(inp, 0, (...a) => (runs++, chainTally(...a)));
    expect(got.size).toBeGreaterThan(0);
    const hiSteps = 300;
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThanOrEqual(inp.m * (Math.ceil(Math.log2(hiSteps)) + 2));
  });

  it("every gap found reaches its tier", () => {
    const inp = large();
    for (const [c, e] of nextTiers(inp, 0)) {
      if (e.gap === null) continue;
      const tier = ["S", "A", "B"].indexOf(e.tier);
      expect(tierWith(inp, c, e.gap / K)).toBeLessThanOrEqual(tier);
    }
  });

  it("a need larger than what's left of the pool is out of reach without a search", () => {
    const inp = inputs([150, 40], [40], [[1, 2]]);
    let backing0 = 0;
    const got = nextTiers(inp, 0, (x, first, upTo) => {
      if (x.voters.at(-1) === "phantom" && x.ranks.at(-1)![0] === 1) backing0++;
      return chainTally(x, first, upTo);
    });
    expect(got.get(0)!.gap).toBe(null);
    expect(backing0).toBe(0);
  });

  it("the async variant gives the same result", async () => {
    const inp = large();
    expect(await nextTiersAsync(inp, 0)).toEqual(nextTiers(inp, 0));
  });
});
