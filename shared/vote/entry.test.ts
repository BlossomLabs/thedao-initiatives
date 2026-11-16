import { describe, expect, it } from "vitest";
import { effectiveRanks } from "../../vote/shared/ranks";
import { TIERS } from "./ballot";
import { type ChainInputs, chainTally } from "./chain";
import { entries, maxWinningAsk, minExtraBacking } from "./entry";
import {
  finalWhatIfs,
  FINE,
  gapTo,
  giftGaps,
  giftGapTo,
  type NextTier,
  nextTiers,
  STEP,
  withGift,
} from "./next-tier";
import round from "./fixtures/test-round-2026-11-15.json";

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

/** A made-up round part way through: 6–10 initiatives with odd micro-dollar asks, ballots
 * placing a few in S-Tier, A-Tier and B-Tier (competition ranks, some withheld), and
 * some settled, withdrawn or covered (asking $0) initiatives and some pool spent. Even
 * seeds ask whole $1K amounts from a narrow range instead, so asks (and so ties broken on
 * the ask, then the manifest order) are often equal. */
function seeded(seed: number): ChainInputs {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const micro = (lo: number, hi: number) =>
    BigInt(int(lo, hi)) * 1_000_000_000n + BigInt(int(0, 999_999_999));
  const m = int(6, 10), n = int(4, 12);
  const costs = Array.from(
    { length: m },
    () => seed % 2 ? micro(5, 60) : BigInt(int(8, 14)) * 1_000_000_000n,
  );
  const weights = Array.from({ length: n }, () => micro(3, 20));
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
      if (t === undefined) return r() < 0.15 ? 255 : 0;
      return 1 + [...tierOf.values()].filter((u) => u < t).length;
    });
  });
  const pick = (k: number) => {
    const out = new Set<number>();
    for (let i = 0; i < k; i++) out.add(int(0, m - 1));
    return out;
  };
  const done = pick(int(0, 2));
  const withdrawn = new Set([...pick(int(0, 1))].filter((c) => !done.has(c)));
  for (const c of pick(int(0, 1))) if (!done.has(c) && !withdrawn.has(c)) costs[c] = 0n;
  const poolUsd = micro(40, 200);
  return {
    m,
    costs,
    voters: weights.map((_, i) => `v${i}`),
    weights,
    ranks: ballots.map((b) => effectiveRanks(b, m)),
    ballots,
    poolUsd,
    spent: done.size ? poolUsd / BigInt(int(3, 8)) : 0n,
    done,
    withdrawn,
  };
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

/** Open: neither settled, withdrawn nor covered. */
const open = (inp: ChainInputs, c: number) =>
  !inp.done.has(c) && !inp.withdrawn.has(c) && inp.costs[c] > 0n;

/** Whether `c` is funded in a stage from `first` up to (not including) `upTo`. */
const reaches = (inp: ChainInputs, first: number, c: number, upTo: number) =>
  chainTally(inp, first, upTo).some((s) => s.order.includes(c));

/** `inp` plus a voter backing only `c`, at the first rank, with `weight` (as next-tier's). */
function withPhantom(inp: ChainInputs, c: number, weight: bigint): ChainInputs {
  return {
    ...inp,
    voters: [...inp.voters, "phantom"],
    weights: [...inp.weights, weight],
    ranks: [...inp.ranks, Array.from({ length: inp.m }, (_, i) => (i === c ? 1 : inp.m + 2))],
  };
}

describe("the entry thresholds", () => {
  it(
    "the largest winning ask: a donation of the ask less it gets it in, a micro-dollar less doesn't",
    { timeout: 60_000 },
    () => {
      let entering = 0, never = 0, already = 0;
      for (const seed of SEEDS) {
        const inp = seeded(seed);
        for (const first of [0, 1, 2]) {
          for (const upTo of new Set([first + 1, 3])) {
            for (let c = 0; c < inp.m; c++) {
              const q = maxWinningAsk(inp, first, c, upTo);
              if (!open(inp, c)) {
                expect(q).toBe(0n);
                continue;
              }
              const C = inp.costs[c];
              const enters = (d: bigint) => reaches(withGift(inp, c, d), first, c, upTo);
              if (q >= C) {
                already++;
                expect(reaches(inp, first, c, upTo)).toBe(true);
              } else if (q === 0n) {
                never++;
                // Monotone in the ask: the largest donation short of covering it is the test.
                expect(enters(C - 1n)).toBe(false);
                for (let k = 1n; k < 5n; k++) expect(enters((C * k) / 5n)).toBe(false);
              } else {
                entering++;
                expect(reaches(inp, first, c, upTo)).toBe(false);
                expect(enters(C - q)).toBe(true);
                if (C - q > 1n) expect(enters(C - q - 1n)).toBe(false);
              }
            }
          }
        }
      }
      // The seeded rounds cover all three outcomes many times over.
      expect(Math.min(entering, never, already)).toBeGreaterThan(100);
    },
  );

  it("the least extra backing: a phantom with that much gets it in, a micro-dollar less doesn't", {
    timeout: 60_000,
  }, () => {
    let reached = 0, none = 0;
    for (const seed of SEEDS) {
      const inp = seeded(seed);
      for (const first of [0, 1, 2]) {
        for (const upTo of new Set([first + 1, 3])) {
          for (let c = 0; c < inp.m; c++) {
            const x = minExtraBacking(inp, first, c, upTo);
            const gets = (w: bigint) => reaches(withPhantom(inp, c, w), first, c, upTo);
            if (x === null) {
              none++;
              // Even backing four times the pool doesn't.
              expect(gets(inp.poolUsd * 4n)).toBe(false);
              continue;
            }
            reached++;
            expect(open(inp, c)).toBe(true);
            expect(gets(x)).toBe(true);
            if (x > 0n) expect(gets(x - 1n)).toBe(false);
            else expect(reaches(inp, first, c, upTo)).toBe(true);
          }
        }
      }
    }
    expect(Math.min(reached, none)).toBeGreaterThan(100);
  });

  it("one shared run gives every initiative's thresholds until the tally picks it", {
    timeout: 60_000,
  }, () => {
    for (const seed of SEEDS.slice(0, 120)) {
      const inp = seeded(seed);
      for (const first of [0, 1, 2]) {
        const all = entries(inp, first, 3);
        const funded = new Map<number, number>();
        chainTally(inp, first).forEach((s, k) => s.order.forEach((c) => funded.set(c, first + k)));
        for (let c = 0; c < inp.m; c++) {
          const got = all.get(c);
          if (!open(inp, c)) {
            expect(got).toBeUndefined();
            continue;
          }
          // Through every stage before the one that funds it.
          const before = (funded.get(c) ?? 3) - first;
          expect(got!.length).toBe(before);
          got!.forEach((e, k) => {
            expect(e.ask).toBe(maxWinningAsk(inp, first, c, first + k + 1));
            expect(e.backing).toBe(minExtraBacking(inp, first, c, first + k + 1));
          });
        }
      }
    }
  });
});

/** Two initiatives, `asksK` in $1K; every voter ranks 0 second and 1 first; B-Tier counts
 * both rank levels. */
function twoLevels(asksK: number[], weightsK: number[], poolK: number): ChainInputs {
  const ballots = weightsK.map(() => [2, 1]);
  return {
    m: 2,
    costs: asksK.map((a) => BigInt(a) * STEP),
    voters: weightsK.map((_, i) => `v${i}`),
    weights: weightsK.map((w) => BigInt(w) * STEP),
    ranks: ballots.map((b) => effectiveRanks(b, 2)),
    ballots,
    poolUsd: BigInt(poolK) * STEP,
    spent: 0n,
    done: new Set(),
    withdrawn: new Set(),
  };
}

describe("a threshold only a later rank level opens", () => {
  it("no ask fits at the first level: a lowered ask is picked at the second", () => {
    // $150 and $200 asks, a $100 pool: nothing fits, and the tally stops at level 1,
    // where 0 has no support (q would be 0 there). Lowered to $100, it fits, and level 2
    // brings it $110 of support.
    const inp = twoLevels([150, 200], [60, 50], 100);
    expect(chainTally(inp, 2)[0].order).toEqual([]);
    const q = maxWinningAsk(inp, 2, 0, 3);
    expect(q).toBe(100n * STEP);
    const enters = (d: bigint) => reaches(withGift(inp, 0, d), 2, 0, 3);
    expect(enters(inp.costs[0] - q)).toBe(true);
    expect(enters(inp.costs[0] - q - 1n)).toBe(false);
    expect(giftGapTo(inp, 2, 0, 2, undefined, undefined, FINE)).toBe(50n * STEP);
  });

  it("the phantom: picked once the second level adds its backers", () => {
    // A $90 ask fits, but nothing else does and 0 has no support at level 1: stopping
    // there would ask the phantom for all $90. Level 2 brings $50, so $40 does.
    const inp = twoLevels([90, 200], [30, 20], 100);
    expect(chainTally(inp, 2)[0].order).toEqual([]);
    const x = minExtraBacking(inp, 2, 0, 3);
    expect(x).toBe(40n * STEP);
    const gets = (w: bigint) => reaches(withPhantom(inp, 0, w), 2, 0, 3);
    expect(gets(x!)).toBe(true);
    expect(gets(x! - 1n)).toBe(false);
    expect(gapTo(inp, 2, 0, 2).gap).toBe(40n * STEP);
  });
});

describe("a tally that disagrees with the formulas", () => {
  // A made-up tally that never funds initiative 0: the formula's figure can't be borne
  // out, so there is no figure (and no tier from an undefined lookup).
  const never0 =
    ((inp: ChainInputs, first: number, upTo?: number) =>
      chainTally(inp, first, upTo).map((s) => ({
        ...s,
        order: s.order.filter((c) => c !== 0),
      }))) as typeof chainTally;
  const inp = twoLevels([150, 200], [60, 50], 100);
  const none = { gap: null, comesIn: [], dropsOut: [], moves: [] };

  it("a donation gap is null, not a wrong figure", () => {
    expect(giftGaps({ ...inp }, 2).get(0)!.gap).toBe(50n * STEP);
    expect(giftGaps(inp, 2, never0).get(0)).toEqual({ tier: "B", ...none });
  });

  it("a backing gap is null, not a wrong figure", () => {
    const fits = twoLevels([90, 200], [30, 20], 100);
    expect(nextTiers(fits, 2).get(0)!.gap).toBe(40n * STEP);
    expect(nextTiers(fits, 2, never0).get(0)).toEqual({ tier: "B", ...none });
    for (const onlyTarget of [false, true]) {
      expect(gapTo(fits, 2, 0, 2, { onlyTarget, tally: never0 })).toEqual({ tier: "B", ...none });
    }
  });
});

// ---------------------------------------------------------------------------------------
// The searches as they were before the formulas: the oracle the parity tests compare with.

function oldTiersOf(inp: ChainInputs, first: number, upTo = 3): Map<number, number> {
  const out = new Map<number, number>();
  chainTally(inp, first, upTo).forEach((s, k) => s.order.forEach((c) => out.set(c, first + k)));
  return out;
}

function knockOn(
  entry: NextTier,
  m: number,
  c: number,
  live: Map<number, number>,
  after: Map<number, number>,
  onlyTarget: number | null,
) {
  for (let o = 0; o < m; o++) {
    if (o === c) continue;
    const was = live.get(o), is = after.get(o);
    if (onlyTarget !== null) {
      const target = onlyTarget;
      if (was !== target && is === target) entry.comesIn.push([o, TIERS[target]]);
      else if (was === target && is !== target) entry.dropsOut.push([o, TIERS[target]]);
    } else if (was === undefined && is !== undefined) entry.comesIn.push([o, TIERS[is]]);
    else if (was !== undefined && is === undefined) entry.dropsOut.push([o, TIERS[was]]);
    else if (was !== undefined && is !== undefined && was !== is) {
      entry.moves.push([o, TIERS[was], TIERS[is]]);
    }
  }
}

function oldGapSearch(
  inp: ChainInputs,
  first: number,
  c: number,
  target: number,
  live: Map<number, number>,
  onlyTarget: boolean,
): NextTier {
  const entry: NextTier = { tier: TIERS[target], gap: null, comesIn: [], dropsOut: [], moves: [] };
  if (target < first || inp.withdrawn.has(c)) return entry;
  const room = inp.poolUsd - inp.spent;
  const hiSteps = room / STEP;
  const upTo = onlyTarget ? target + 1 : 3;
  const run = (k: bigint) => oldTiersOf(withPhantom(inp, c, k * STEP), first, upTo);
  const ok = (r: Map<number, number>) => r.has(c) && r.get(c)! <= target;
  if (hiSteps < 1n || inp.costs[c] > room) return entry;
  const need = (inp.costs[c] + STEP - 1n) / STEP;
  const cap = need < 1n ? 1n : need < hiSteps ? need : hiSteps;
  let hi = cap, after = run(cap);
  if (!ok(after)) {
    if (cap === hiSteps) return entry;
    [hi, after] = [hiSteps, run(hiSteps)];
    if (!ok(after)) return entry;
  }
  let lo = 1n;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const r = run(mid);
    if (ok(r)) [hi, after] = [mid, r];
    else lo = mid + 1n;
  }
  entry.gap = hi * STEP;
  knockOn(entry, inp.m, c, live, after, onlyTarget ? target : null);
  return entry;
}

function oldGiftSearch(
  inp: ChainInputs,
  first: number,
  c: number,
  target: number,
  live: Map<number, number>,
  step: bigint,
): NextTier {
  const entry: NextTier = { tier: TIERS[target], gap: null, comesIn: [], dropsOut: [], moves: [] };
  if (inp.withdrawn.has(c)) return entry;
  const most = (inp.costs[c] - 1n) / step;
  if (most < 1n) return entry;
  const run = (k: bigint) => oldTiersOf(withGift(inp, c, k * step), first);
  const ok = (r: Map<number, number>) => r.has(c) && r.get(c)! <= target;
  let hi = most, after = run(most);
  if (!ok(after)) return entry;
  let lo = 1n;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const r = run(mid);
    if (ok(r)) [hi, after] = [mid, r];
    else lo = mid + 1n;
  }
  entry.gap = hi * step;
  entry.tier = TIERS[after.get(c)!];
  knockOn(entry, inp.m, c, live, after, null);
  return entry;
}

function oldGiftGaps(inp: ChainInputs, firstOpen: number): Map<number, NextTier> {
  const out = new Map<number, NextTier>();
  if (firstOpen < 0 || firstOpen >= 3) return out;
  const live = oldTiersOf(inp, firstOpen);
  for (let c = 0; c < inp.m; c++) {
    if (!open(inp, c)) continue;
    const now = live.get(c);
    if (now === firstOpen) continue;
    const target = now === undefined ? 2 : now - 1;
    out.set(c, oldGiftSearch(inp, firstOpen, c, target, live, FINE));
  }
  return out;
}

function oldNextTiers(inp: ChainInputs, firstOpen: number): Map<number, NextTier> {
  const live = oldTiersOf(inp, firstOpen);
  const out = new Map<number, NextTier>();
  for (let c = 0; c < inp.m; c++) {
    if (!open(inp, c)) continue;
    const now = live.get(c);
    const target = now === undefined ? 2 : now - 1;
    if (target < firstOpen || target < 0) continue;
    out.set(c, oldGapSearch(inp, firstOpen, c, target, live, false));
  }
  return out;
}

function oldGapTo(
  inp: ChainInputs,
  first: number,
  c: number,
  target: number,
  onlyTarget: boolean,
): NextTier {
  const live = oldTiersOf(inp, first, onlyTarget ? target + 1 : 3);
  return oldGapSearch(inp, first, c, target, live, onlyTarget);
}

function oldGiftGapTo(
  inp: ChainInputs,
  first: number,
  c: number,
  target: number,
  step: bigint,
): bigint | null {
  if (target < first) return null;
  return oldGiftSearch(inp, first, c, target, oldTiersOf(inp, first), step).gap;
}

/** finalWhatIfs' `next`, as the old search had it (the leads are unchanged code). */
function oldFinalNext(at: ChainInputs[], finalTier: Map<number, number>, m: number) {
  const next = new Map<number, NextTier>();
  const gap = (t: number, c: number) => {
    const inp = at[t];
    if (!inp || inp.voters.length === 0 || !open(inp, c)) return;
    const live = oldTiersOf(inp, t, t + 1);
    if (live.has(c) && live.get(c)! <= t) return;
    next.set(c, oldGapSearch(inp, t, c, t, live, true));
  };
  for (let c = 0; c < m; c++) {
    const k = finalTier.get(c);
    if (k === undefined) gap(2, c);
    else if (k >= 1) gap(k - 1, c);
  }
  return next;
}

/** Each settlement's inputs and every initiative's final tier, settling tier by tier. */
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

/** From the closed test round's /api/vote/round body; `keep`: only the initiatives the most
 * ballots place (as threat.test.ts cuts it). */
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

/** Every figure the formulas now give, compared with the old searches on `inp`. */
function sameAsBefore(inp: ChainInputs, firsts: number[], targetsEvery = 1) {
  for (const first of firsts) {
    expect(giftGaps(inp, first)).toEqual(oldGiftGaps(inp, first));
    expect(nextTiers(inp, first)).toEqual(oldNextTiers(inp, first));
    for (let c = 0; c < inp.m; c += targetsEvery) {
      for (let target = first; target < 3; target++) {
        for (const step of [FINE, STEP]) {
          expect(giftGapTo(inp, first, c, target, undefined, undefined, step))
            .toBe(oldGiftGapTo(inp, first, c, target, step));
        }
        for (const onlyTarget of [false, true]) {
          expect(gapTo(inp, first, c, target, { onlyTarget }))
            .toEqual(oldGapTo(inp, first, c, target, onlyTarget));
        }
      }
    }
    // A target already settled: nothing.
    if (first > 0) expect(giftGapTo(inp, first, 0, first - 1)).toBeNull();
  }
  const { at, finalTier } = settlements(inp);
  expect(finalWhatIfs(at, finalTier, inp.m).next).toEqual(oldFinalNext(at, finalTier, inp.m));
}

describe("the formulas give what the searches gave", () => {
  it("on seeded rounds, from every tier", { timeout: 120_000 }, () => {
    for (const seed of SEEDS.slice(0, 150)) sameAsBefore(seeded(seed), [0, 1, 2]);
  });

  it("on seeded rounds with $1K asks and a roomy pool (gaps on the step itself)", {
    timeout: 120_000,
  }, () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const inp = seeded(seed);
      const costs = inp.costs.map((c) => (c / STEP) * STEP);
      sameAsBefore({ ...inp, costs, poolUsd: inp.poolUsd * 3n }, [0, 1]);
    }
  });

  it("on the real test round cut to 60 initiatives", { timeout: 120_000 }, () => {
    sameAsBefore(testRound(60), [0], 7);
  });

  it("on the real test round, all 96 initiatives", { timeout: 300_000 }, () => {
    sameAsBefore(testRound(), [0], 13);
  });
});
