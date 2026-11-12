import { describe, expect, it } from "vitest";
import { effectiveRanks } from "../../vote/shared/ranks";
import { type ChainInputs, chainTally } from "./chain";
import { stageBound } from "./stage";
import {
  finalWhatIfs,
  finalWhatIfsAsync,
  gapTo,
  leadIn,
  liveLeads,
  liveLeadsAsync,
  nextTiers,
  nextTiersAsync,
  STEP,
} from "./next-tier";

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

/** Whether `c` is funded in tier `first` with its cost and the pool both raised by `l` steps. */
/** Whether `c` is still funded in tier `first` (Tier-S or Tier-A) when its backers there
 * give `l` steps less, spread over them by weight (the remainder on the last backer). */
function fundedWithLead(inp: ChainInputs, first: number, c: number, l: bigint): boolean {
  const bound = Math.min(inp.m, stageBound(inp.ballots, first, 3, inp.m));
  const backers = inp.voters.map((_, i) => i).filter((i) => inp.ranks[i][c] <= bound);
  const total = backers.reduce((a, i) => a + inp.weights[i], 0n);
  const weights = [...inp.weights];
  let cum = 0n;
  for (const i of backers) {
    const next = cum + inp.weights[i];
    weights[i] -= (next * l * K) / total - (cum * l * K) / total;
    cum = next;
  }
  return chainTally({ ...inp, weights }, first, first + 1)[0].order.includes(c);
}

/** The inputs each tier settles from, chained as the replay does it. */
function settlements(inp: ChainInputs): { at: ChainInputs[]; finalTier: Map<number, number> } {
  const at: ChainInputs[] = [];
  const finalTier = new Map<number, number>();
  let cur = inp;
  for (let t = 0; t < 3; t++) {
    at.push(cur);
    const { order, shares } = chainTally(cur, t, t + 1)[0];
    const weights = [...cur.weights];
    let spent = cur.spent;
    for (const c of order) {
      finalTier.set(c, t);
      for (const [v, d] of shares.get(c)!) {
        weights[cur.voters.indexOf(v)] -= d;
        spent += d;
      }
    }
    cur = { ...cur, weights, spent, done: new Set([...cur.done, ...order]) };
  }
  return { at, finalTier };
}

describe("the gap to a chosen tier", () => {
  it("gapTo reaches a chosen tier and lists only that tier's changes", () => {
    // Initiative 2 reaching Tier-S moves initiative 0 from Tier-S to Tier-A.
    const inp = inputs([10, 10, 10, 10], [10, 10, 10], [[3, 1, 2, 3], [1, 3, 1, 3], [2, 1, 3, 3]]);
    const full = gapTo(inp, 0, 2, 0);
    expect(full).toEqual(nextTiers(inp, 0).get(2));
    const only = gapTo(inp, 0, 2, 0, { onlyTarget: true });
    expect(only.tier).toBe("S");
    expect(only.gap).toBe(full.gap);
    expect(tierWith(inp, 2, only.gap! / K)).toBe(0);
    expect(tierWith(inp, 2, only.gap! / K - 1n)).not.toBe(0);
    expect(only.dropsOut).toEqual([[0, "S"]]);
    expect(only.comesIn).toEqual([]);
    expect(only.moves).toEqual([]);
  });

  it("gapTo ignores changes outside the target tier", () => {
    // Funding initiative 0 in Tier-S pushes initiative 1 out of Tier-A, not Tier-S.
    const inp = knockOn();
    expect(gapTo(inp, 0, 0, 0).dropsOut).toEqual([[1, "A"]]);
    const only = gapTo(inp, 0, 0, 0, { onlyTarget: true });
    expect(only.gap).toBe(30n * K);
    expect(only.dropsOut).toEqual([]);
    expect(only.comesIn).toEqual([]);
  });

  it("gapTo with onlyTarget tallies no stage past the target", () => {
    const inp = knockOn();
    const upTos: (number | undefined)[] = [];
    const counting: typeof chainTally = (i, first, upTo) => {
      upTos.push(upTo);
      return chainTally(i, first, upTo);
    };
    const only = gapTo(inp, 0, 0, 0, { onlyTarget: true, tally: counting });
    expect(upTos.length).toBeGreaterThan(1);
    expect(upTos.every((u) => u === 1)).toBe(true);
    expect(only).toEqual(gapTo(inp, 0, 0, 0, { onlyTarget: true }));
    expect(only.gap).toBe(gapTo(inp, 0, 0, 0).gap);
  });

  it("gapTo lists who comes into the target tier", () => {
    // Initiatives 0 and 1 are in Tier-S, 2 in Tier-A, 3 not funded. With $3K more behind
    // initiative 2, Tier-S takes 0, 2 and 3: initiative 1 drops out and 3 comes in.
    const inp = inputs([5, 5, 5, 5], [5, 5, 5], [[1, 1, 1, 3], [1, 3, 3, 1], [3, 2, 3, 2]], 40);
    expect(tierWith(inp, 2, 0n)).toBe(1);
    const only = gapTo(inp, 0, 2, 0, { onlyTarget: true });
    expect(only.tier).toBe("S");
    expect(only.gap).toBe(3n * K);
    expect(tierWith(inp, 2, 3n)).toBe(0);
    expect(tierWith(inp, 2, 2n)).not.toBe(0);
    expect(only.comesIn).toEqual([[3, "S"]]);
    expect(only.dropsOut).toEqual([[1, "S"]]);
    expect(only.moves).toEqual([]);
  });
});

describe("the Tier-S lead", () => {
  it("a lead is the backing it could lose and stay in Tier-S", () => {
    // Initiative 0 ($10K) has $49.7K behind it.
    const inp = inputs([10, 40], [49.7], [[1, 2]]);
    const lead = leadIn(inp, 0, 0)!;
    expect(lead).toBe(39n * K);
    expect(fundedWithLead(inp, 0, 0, lead / K)).toBe(true);
    expect(fundedWithLead(inp, 0, 0, lead / K + 1n)).toBe(false);
  });

  it("a lead is measured by its backers giving less, not by a higher cost", () => {
    // The reviewer's case: A and B back 0 and its rival 1, E backs 0 only, F backs 1 only.
    // Raising 0's cost leaves its support, and so its place ahead of 1, as it was.
    const inp: ChainInputs = {
      m: 2,
      costs: [50n * K, 50n * K],
      voters: ["A", "B", "E", "F"],
      weights: [25n * K, 25n * K, 40n * K, 20n * K],
      ranks: [[1, 1], [1, 1], [1, 4], [4, 1]],
      ballots: [[1, 1], [1, 1], [1, 0], [0, 1]],
      poolUsd: 1000n * K,
      spent: 0n,
      done: new Set(),
    };
    expect(chainTally(inp, 0, 1)[0].order).toEqual([0]);
    const lead = leadIn(inp, 0, 0)!;
    expect(lead % K).toBe(0n);
    expect(fundedWithLead(inp, 0, 0, lead / K)).toBe(true);
    expect(fundedWithLead(inp, 0, 0, lead / K + 1n)).toBe(false);
  });

  it("backers it shares with a rival lower the lead", () => {
    // 0 ($30K): A ($40K) and B ($20K). Rival 1 ($25K): A and F ($10K). The pool ($40K)
    // fits one. Each $3K A and B give less costs 0 $3K of support but 1 only $2K, so at
    // $30K the two tie and the cheaper rival goes first: the lead is $29K, not the $30K
    // a rival with backers of its own would leave. F leaves 0 unplaced, which ranks it
    // past Tier-S: F is no backer of 0 there, and giving F part of the loss would make
    // the lead $35K.
    const inp = inputs([30, 25], [40, 20, 10], [[1, 1], [1, 0], [0, 1]], 40);
    expect(chainTally(inp, 0, 1)[0].order).toEqual([0]);
    expect(leadIn(inp, 0, 0)).toBe(29n * K);
    expect(fundedWithLead(inp, 0, 0, 29n)).toBe(true);
    expect(fundedWithLead(inp, 0, 0, 30n)).toBe(false);
    const own = inputs([30, 25], [40, 20, 28], [[1, 0], [1, 0], [0, 1]], 40);
    expect(leadIn(own, 0, 0)).toBe(30n * K);
  });

  it("a lead under $1K is no lead", () => {
    const inp = inputs([10], [10.5], [[1]]);
    expect(leadIn(inp, 0, 0)).toBe(0n);
  });

  it("leadIn is null when not funded in Tier-S", () => {
    const inp = knockOn();
    expect(leadIn(inp, 0, 0)).toBe(null);
    expect(leadIn(inp, 0, 1)).toBe(null);
  });

  it("live leads: only while Tier-S is open, only for Tier-S initiatives", async () => {
    const inp = inputs([10, 40], [49.7], [[1, 2]]);
    expect(liveLeads(inp, 0)).toEqual(new Map([[0, 39n * K]]));
    expect(liveLeads(inp, 1).size).toBe(0);
    expect(await liveLeadsAsync(inp, 0)).toEqual(liveLeads(inp, 0));
  });
});

describe("the final what-ifs", () => {
  // Initiative 0 is funded in Tier-S, 3 in Tier-A, 1 in Tier-B; 2 is not funded.
  const round = () =>
    settlements(inputs([5, 5, 5, 5], [5, 5, 5], [[1, 3, 3, 2], [1, 2, 2, 3], [1, 1, 2, 1]], 40));

  it("finalWhatIfs judges each figure at the settlement above", () => {
    const { at, finalTier } = round();
    expect(finalTier).toEqual(new Map([[0, 0], [3, 1], [1, 2]]));
    const got = finalWhatIfs(at, finalTier, 4);
    expect([...got.lead.keys()]).toEqual([0]);
    expect(got.lead.get(0)).toBe(leadIn(at[0], 0, 0));
    expect(got.next.has(0)).toBe(false);
    expect(got.next.get(3)).toEqual(gapTo(at[0], 0, 3, 0, { onlyTarget: true }));
    expect(got.next.get(3)!.tier).toBe("S");
    expect(got.next.get(1)).toEqual(gapTo(at[1], 1, 1, 1, { onlyTarget: true }));
    expect(got.next.get(1)!.tier).toBe("A");
    expect(got.next.get(2)).toEqual(gapTo(at[2], 2, 2, 2, { onlyTarget: true }));
    expect(got.next.get(2)!.tier).toBe("B");
    for (const c of [1, 2, 3]) expect(got.next.get(c)!.gap).not.toBe(null);
  });

  it("no ballots at a settlement: no figures", () => {
    const { at, finalTier } = round();
    const empty = { ...at[1], voters: [], weights: [], ranks: [], ballots: [] };
    const got = finalWhatIfs([at[0], empty, null], finalTier, 4);
    expect(got.next.has(3)).toBe(true);
    expect(got.lead.has(0)).toBe(true);
    expect(got.next.has(1)).toBe(false);
    expect(got.next.has(2)).toBe(false);
    expect(finalWhatIfs([null, null, null], finalTier, 4)).toEqual({
      next: new Map(),
      lead: new Map(),
    });
  });

  it("already in the target tier at its settlement: no figure", () => {
    // A stored snapshot put initiative 0 in Tier-A, yet Tier-S's inputs fund it in Tier-S.
    const { at, finalTier } = round();
    expect(chainTally(at[0], 0, 1)[0].order).toContain(0);
    const forced = new Map([...finalTier, [0, 1]]);
    const got = finalWhatIfs(at, forced, 4);
    expect(got.next.has(0)).toBe(false);
    expect(got.lead.has(0)).toBe(false);
    expect(got.next.has(3)).toBe(true);
  });

  it("the async variant gives the same result", async () => {
    const { at, finalTier } = round();
    expect(await finalWhatIfsAsync(at, finalTier, 4)).toEqual(finalWhatIfs(at, finalTier, 4));
  });
});
