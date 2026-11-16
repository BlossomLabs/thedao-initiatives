import { describe, expect, it } from "vitest";
import { effectiveRanks } from "../../vote/shared/ranks";
import { type ChainInputs, chainTally } from "./chain";
import { FINE, STEP, type Tally, withGift as gift } from "./next-tier";
import { maxWinningAsk } from "./entry";
import {
  jumps,
  jumpsAsync,
  rivalAmounts,
  THREAT_STEP,
  threatOf,
  threatOfAsync,
  threats,
  threatsAsync,
} from "./threat";
import round from "./fixtures/test-round-2026-11-15.json";

const K = STEP; // $1K in micro-USD

/** Inputs from raw ballots (one rank per initiative, 1 = S-Tier, 2 = A-Tier, ...). */
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
    withdrawn: new Set(),
  };
}

/** A small seeded generator (mulberry32), so the made-up rounds are the same every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A made-up round: `m` initiatives, `n` voters, each placing a few in S-Tier, A-Tier and
 * B-Tier (competition ranks), the rest unplaced. */
function seeded(seed: number, m: number, n = 10): ChainInputs {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const costs = Array.from({ length: m }, () => int(5, 60));
  const weights = Array.from({ length: n }, () => int(3, 15));
  const ballots = Array.from({ length: n }, () => {
    const order = [...Array(m).keys()];
    for (let i = m - 1; i > 0; i--) {
      const j = int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const placed = order.slice(0, int(1, m));
    const tierOf = new Map(placed.map((c) => [c, int(0, 2)]));
    return Array.from({ length: m }, (_, c) => {
      const t = tierOf.get(c);
      if (t === undefined) return 0;
      return 1 + [...tierOf.values()].filter((u) => u < t).length;
    });
  });
  return inputs(costs, weights, ballots, int(40, 150));
}

/** Candidate → tier index, the whole chain from `first`. */
function full(inp: ChainInputs, first: number): Map<number, number> {
  const out = new Map<number, number>();
  chainTally(inp, first).forEach((s, k) => s.order.forEach((c) => out.set(c, first + k)));
  return out;
}

/** Every $step from one step to the last below each other initiative's cost, full tallies. */
function brute(inp: ChainInputs, first: number, step: bigint): Map<number, bigint | null> {
  const live = full(inp, first);
  const greens = [...live].filter(([, t]) => t === first).map(([c]) => c);
  const best = new Map<number, bigint | null>(greens.map((x) => [x, null]));
  for (let r = 0; r < inp.m; r++) {
    for (let d = step; d < inp.costs[r]; d += step) {
      const after = full(gift(inp, r, d), first);
      for (const x of greens) {
        const b = best.get(x)!;
        if (x !== r && after.get(x) !== first && (b === null || d < b)) best.set(x, d);
      }
    }
  }
  return best;
}

/** Whether giving `d` to some initiative other than `x` pushes `x` out of tier `first`. */
function pushedOutBySome(inp: ChainInputs, first: number, x: number, d: bigint): boolean {
  for (let r = 0; r < inp.m; r++) {
    if (r === x) continue;
    if (!chainTally(gift(inp, r, d), first, first + 1)[0].order.includes(x)) return true;
  }
  return false;
}

/** From the closed test round's /api/vote/round body; `keep`: only the initiatives the most
 * ballots place. */
function testRound(keep?: number): ChainInputs {
  const bytes = (h: string) =>
    Array.from(
      { length: (h.length - 2) / 2 },
      (_, i) => parseInt(h.slice(2 + 2 * i, 4 + 2 * i), 16),
    );
  const accepted = round.accepted as Record<string, string>;
  const voters = Object.keys(accepted).sort((a, b) => Number(a) - Number(b));
  let ballots = voters.map((v) => bytes(accepted[v]));
  let costs = round.asks.map((a) => BigInt(a));
  if (keep) {
    const placed = costs.map((_, c) => ballots.filter((b) => b[c] !== 0 && b[c] !== 255).length);
    const idx = [...costs.keys()]
      .sort((a, b) => placed[b] - placed[a])
      .slice(0, keep)
      .sort((a, b) => a - b);
    ballots = ballots.map((b) => idx.map((c) => b[c]));
    costs = idx.map((c) => costs[c]);
  }
  const m = costs.length;
  return {
    m,
    costs,
    voters,
    weights: voters.map(() => BigInt(round.share)),
    ranks: ballots.map((b) => effectiveRanks(b, m)),
    ballots,
    poolUsd: BigInt(round.poolUsd),
    spent: 0n,
    done: new Set(),
    withdrawn: new Set(),
  };
}

/** `v` is `b` narrowed to $10: null together, else within the step below it. */
function matches(v: bigint | null, b: bigint | null, step: bigint) {
  if (b === null) {
    expect(v).toBeNull();
    return;
  }
  expect(v).not.toBeNull();
  expect(v! <= b).toBe(true);
  expect(v! > b - step).toBe(true);
  expect(v! % FINE).toBe(0n);
}

// A seeded round where green 3's only threat (at $250 steps) is a donation to green 7,
// found by brute force. Withdrawing 7 keeps 3 green; that isn't so in every round (a
// green rival withdrawn frees the pool, and the live tally changes with it).
const GREEN_RIVAL = { seed: 348, m: 8, x: 3, y: 7 };

/** Made-up rounds, each funding a few in S-Tier, most with a number, some with none found. */
const ROUNDS = () => [
  inputs([40, 40, 30], [25, 25], [[1, 1, 1], [1, 1, 1]], 60),
  seeded(17, 6),
  seeded(66, 8),
  seeded(52, 8),
];

/** The round where one donation can't push its only green row out. */
const SAFE = () => inputs([30, 50, 50], [40], [[1, 0, 0]], 200);

describe("the green number", () => {
  it("checks the exact entry donation when the coarse grid skips the entire danger range", async () => {
    // Both are backed in S-Tier. The subject wins an equal-ask tie. Giving $2,810 to
    // the rival gets it picked first, leaving too little pool; $2,900 lets both in.
    const inp = { ...inputs([1.9, 4.7], [3.7], [[1, 1]]), poolUsd: 3_700_000_000n };
    const given = (usd: number) =>
      chainTally(gift(inp, 1, BigInt(usd) * 1_000_000n), 0, 1)[0].order;
    expect(given(2800)).toEqual([0]);
    expect(given(2810)).toEqual([1]);
    expect(given(2900)).toEqual([1, 0]);
    // The old $250 scan starts at $3,000, after the danger has passed.
    expect(rivalAmounts(inp, 0, 1, THREAT_STEP)[0]).toBe(3n * K);
    expect(threats(inp, 0).get(0)).toBe(2_810_000_000n);
    expect(threatOf(inp, 0, 0)).toBe(2_810_000_000n);
    expect(await threatsAsync(inp, 0)).toEqual(threats(inp, 0));
    expect(await threatOfAsync(inp, 0, 0)).toBe(2_810_000_000n);
  });

  it("never probes a covering amount when the first $10 entry step meets the ask", () => {
    const inp = inputs([0.01, 0.009], [0.01], [[1, 0]], 1);
    expect(threats(inp, 0).get(0)).toBeNull();
    expect(threatOf(inp, 0, 0)).toBeNull();
  });

  it("finds checked threats consistent with the coarse oracle on the sample rounds", () => {
    for (const inp of ROUNDS()) {
      const got = threats(inp, 0, chainTally, K);
      const want = brute(inp, 0, K);
      expect(got.size).toBeGreaterThan(0);
      expect(new Set(got.keys())).toEqual(new Set(want.keys()));
      for (const [x, v] of got) {
        matches(v, want.get(x)!, K);
        if (v !== null) expect(pushedOutBySome(inp, 0, x, v)).toBe(true);
      }
    }
  });

  it("no threat found is null, distinct from an initiative with no figure", () => {
    expect(threats(SAFE(), 0).get(0)).toBeNull();
  });

  it("a donation to another green initiative counts", () => {
    const { seed, m, x, y } = GREEN_RIVAL;
    const inp = seeded(seed, m);
    const greens = chainTally(inp, 0, 1)[0].order;
    expect(greens).toContain(x);
    expect(greens).toContain(y);
    const v = threats(inp, 0).get(x);
    expect(v).not.toBeNull();
    expect(v).not.toBeUndefined();
    expect(chainTally(gift(inp, y, v!), 0, 1)[0].order).not.toContain(x);
  });

  it("a withdrawn initiative is no rival", () => {
    const { seed, m, x, y } = GREEN_RIVAL;
    const inp = seeded(seed, m);
    const before = threats(inp, 0).get(x)!;
    const without = { ...inp, withdrawn: new Set([y]) };
    expect(chainTally(without, 0, 1)[0].order).toContain(x);
    const after = threats(without, 0).get(x);
    expect(after === null || after! > before).toBe(true);
  });

  it("only the tier settling now: keys are what the live tally funds there", () => {
    const cases: [ChainInputs, number][] = [
      [seeded(21, 7), 0],
      [seeded(22, 7), 1],
      [{ ...seeded(23, 7), done: new Set([0]) }, 1],
    ];
    for (const [inp, first] of cases) {
      const want = new Set(chainTally(inp, first, first + 1)[0].order);
      expect(new Set(threats(inp, first, chainTally, K).keys())).toEqual(want);
    }
  });

  it("the real test round, cut to 60 initiatives, matches brute force at $1k steps", () => {
    const inp = testRound(60);
    const got = threats(inp, 0, chainTally, K);
    const want = brute(inp, 0, K);
    expect(new Set(got.keys())).toEqual(new Set(want.keys()));
    for (const [x, v] of got) matches(v, want.get(x)!, K);
  }, 300_000);

  it("entry probes find the real narrow range even when the coarse grid misses it", () => {
    const inp = testRound();
    expect(threats(inp, 0).get(81)! < 45_000n * 1_000_000n).toBe(true);
    expect(brute(inp, 0, K).get(81)! > 160_000n * 1_000_000n).toBe(true);
    expect(threats(inp, 0, chainTally, K).get(81)! < 45_000n * 1_000_000n).toBe(true);
  }, 120_000);

  it("a rival's amounts start at the least step that could get it into the tier", () => {
    const rounds: [ChainInputs, number][] = [
      ...[17, 21, 22, 52, 66, 348].map((seed): [ChainInputs, number] => [seeded(seed, 8), 0]),
      [seeded(22, 7), 1],
      [testRound(60), 0],
    ];
    let starts = 0, none = 0;
    for (const [inp, first] of rounds) {
      const greens = chainTally(inp, first, first + 1)[0].order;
      for (let r = 0; r < inp.m; r++) {
        if (inp.done.has(r) || inp.withdrawn.has(r) || inp.costs[r] === 0n) continue;
        for (const step of [K, THREAT_STEP]) {
          const got = rivalAmounts(inp, first, r, step);
          const into = (d: bigint) =>
            chainTally(gift(inp, r, d), first, first + 1)[0].order.includes(r);
          // Each step from the first up to the last below its cost.
          got.forEach((d, i) => expect(d).toBe(got[0] + BigInt(i) * step));
          if (got.length) expect(got.at(-1)! + step >= inp.costs[r]).toBe(true);
          if (greens.includes(r)) {
            // In the tier already: every step is worth trying.
            expect(got[0]).toBe(step);
            continue;
          }
          const q = maxWinningAsk(inp, first, r, first + 1);
          if (q === 0n) {
            none++;
            expect(got).toEqual([]);
            continue;
          }
          if (got.length === 0) {
            // Its first entering amount rounds up to its whole ask.
            expect(((inp.costs[r] - q + step - 1n) / step) * step >= inp.costs[r]).toBe(true);
            continue;
          }
          starts++;
          expect(into(got[0])).toBe(true);
          if (got[0] > step) expect(into(got[0] - step)).toBe(false);
        }
      }
    }
    expect(starts).toBeGreaterThan(10);
    expect(none).toBeGreaterThan(5);
  }, 120_000);

  it("a step that isn't whole $10s is refused", () => {
    const inp = seeded(17, 6);
    expect(() => threats(inp, 0, chainTally, FINE + 1n)).toThrow(/FINE/);
    expect(() => threats(inp, 0, chainTally, FINE / 2n)).toThrow(/FINE/);
    expect(() => threatOf(inp, 0, 0, { step: 0n })).toThrow(/FINE/);
  });

  it("the async variant gives the same result", async () => {
    for (const inp of [seeded(17, 6), seeded(GREEN_RIVAL.seed, GREEN_RIVAL.m)]) {
      const want = threats(inp, 0);
      expect([...want.values()].some((v) => v !== null)).toBe(true);
      expect(await threatsAsync(inp, 0)).toEqual(want);
    }
  });
});

describe("one green row", () => {
  it("one row's number is the all-rows search's", () => {
    for (const inp of [...ROUNDS(), seeded(GREEN_RIVAL.seed, GREEN_RIVAL.m)]) {
      for (const [x, v] of threats(inp, 0, chainTally, K)) {
        expect(threatOf(inp, 0, x, { step: K })).toBe(v);
      }
    }
  });

  it("not in the tier settling now: no number", () => {
    const inp = seeded(17, 6);
    const greens = chainTally(inp, 0, 1)[0].order;
    const out = [...Array(inp.m).keys()].filter((c) => !greens.includes(c));
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(threatOf(inp, 0, c)).toBeUndefined();
  });

  it("the suggestions have a higher checked threat or none found", () => {
    let seen = 0;
    for (const inp of ROUNDS()) {
      for (const [x, now] of threats(inp, 0)) {
        if (now === null) continue;
        const js = jumps(inp, 0, x);
        if (js.length === 0) continue;
        seen++;
        expect(js.length).toBeLessThanOrEqual(2);
        if (js.length === 2) expect(js[0].usd < js[1].usd).toBe(true);
        if (js.some((j) => j.threat === null)) expect(js.at(-1)!.threat).toBeNull();
        const higher = (v: bigint | null | undefined) => v === null || (v !== undefined && v > now);
        js.forEach((j) => {
          expect(j.usd % STEP).toBe(0n);
          expect(j.usd > 0n && j.usd < inp.costs[x]).toBe(true);
          // Its number is the $250-step one, as the server's.
          expect(threatOf(gift(inp, x, j.usd), 0, x, { step: THREAT_STEP })).toBe(j.threat);
          // A number is higher than now; one step less is not. Safe: one step less isn't.
          expect(higher(j.threat)).toBe(true);
          if (j.usd > STEP) {
            const less = threatOf(gift(inp, x, j.usd - STEP), 0, x);
            if (j.threat === null) expect(less).not.toBeNull();
            else expect(higher(less)).toBe(false);
          }
        });
        if (js.length === 2) expect(js[0].threat).not.toBeNull();
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("a row with no threat found has no jumps", () => {
    expect(jumps(SAFE(), 0, 0)).toEqual([]);
  });

  it("aborting stops the work", async () => {
    const inp = seeded(17, 6);
    const x = [...threats(inp, 0)].find(([, v]) => v !== null)![0];
    const c = new AbortController();
    const p = jumpsAsync(inp, 0, x, { sliceMs: 0, signal: c.signal });
    const reason = new Error("not wanted");
    c.abort(reason);
    await expect(p).rejects.toBe(reason);
  });
});

describe("a chip's number at $250 steps", () => {
  // A made-up tally: green 0 drops out once 1 is given $5k; with $3k given to 0, only
  // in a narrow range [lo, lo + $250) or from $50k; with $6k, never.
  const inp = inputs([10, 100], [200], [[1, 1]]);
  const usd = (n: bigint) => n * 1_000_000n;
  const narrowAt = (lo: bigint) =>
    ((i: ChainInputs, first: number, upTo = 3) => {
      const gx = inp.costs[0] - i.costs[0], g1 = inp.costs[1] - i.costs[1];
      const out = gx >= usd(6000n)
        ? false
        : gx >= usd(3000n)
        ? (g1 >= lo && g1 < lo + usd(250n)) || g1 >= usd(50_000n)
        : g1 >= usd(5000n);
      return Array.from({ length: upTo - first }, (_, k) => ({
        order: k === 0 ? (out ? [1] : [0]) : [],
        shares: new Map(),
      }));
    }) as Tally;

  it("is worked out at $250 steps, not the $1k of the search", () => {
    const tally = narrowAt(usd(20_250n));
    expect(threatOf(inp, 0, 0, { tally })).toBe(usd(5000n));
    expect(jumps(inp, 0, 0, { tally })).toEqual([
      { usd: 3n * K, threat: usd(20_250n) },
      { usd: 6n * K, threat: null },
    ]);
    expect(threatOf(gift(inp, 0, 3n * K), 0, 0, { tally, step: K })).toBe(usd(50_000n));
  });

  it("a chip whose number at $250 steps is no higher is dropped", () => {
    // At $1k steps, $3k given looks higher; at $250 steps its number is $4,250.
    const tally = narrowAt(usd(4250n));
    expect(threatOf(gift(inp, 0, 3n * K), 0, 0, { tally })).toBe(usd(4250n));
    expect(jumps(inp, 0, 0, { tally })).toEqual([{ usd: 6n * K, threat: null }]);
  });
});
