/** For each initiative, how much more backing it needs to be funded one tier higher,
 * and who would come in or drop out if it were. The tally is re-run with a made-up
 * voter ("phantom") who backs only that initiative. Pure; browser and Deno. */
import { type Tier, TIERS } from "./ballot.ts";
import { type ChainInputs, chainTally } from "./chain.ts";

/** Gaps are whole $1K steps, rounded up. */
export const STEP = 1_000_000_000n;

export type NextTier = {
  tier: Tier; // the target
  gap: bigint | null; // micro-USD, a multiple of STEP; null = out of reach
  comesIn: [number, Tier][]; // newly funded, with their tier
  dropsOut: [number, Tier][]; // no longer funded, with the tier they lose
  moves: [number, Tier, Tier][]; // still funded, from → to
};

/** Candidate → tier index, over the stages from `first`. */
function tiersOf(inp: ChainInputs, first: number): Map<number, number> {
  const out = new Map<number, number>();
  chainTally(inp, first).forEach((stage, k) => {
    for (const c of stage.order) out.set(c, first + k);
  });
  return out;
}

/** `inp` plus a voter who backs only `c` with `weight`. The rank `m + 2` never opens,
 * and `ballots` stays as it is, so the stage bounds do not move. */
function withPhantom(inp: ChainInputs, c: number, weight: bigint): ChainInputs {
  const ranks = Array.from({ length: inp.m }, (_, i) => (i === c ? 1 : inp.m + 2));
  return {
    ...inp,
    voters: [...inp.voters, "phantom"],
    weights: [...inp.weights, weight],
    ranks: [...inp.ranks, ranks],
  };
}

/** Keyed by initiative index; an initiative with no higher tier to reach has no entry.
 * Settled initiatives are already funded, so they have none either. */
export function nextTiers(inp: ChainInputs, firstOpen: number): Map<number, NextTier> {
  const live = tiersOf(inp, firstOpen);
  const hiSteps = (inp.poolUsd - inp.spent) / STEP; // bigint division rounds down
  const out = new Map<number, NextTier>();
  for (let c = 0; c < inp.m; c++) {
    if (inp.done.has(c)) continue;
    const now = live.get(c);
    const target = now === undefined ? TIERS.length - 1 : now - 1;
    if (target < firstOpen || target < 0) continue;
    const run = (k: bigint) => tiersOf(withPhantom(inp, c, k * STEP), firstOpen);
    const reaches = (r: Map<number, number>) => r.has(c) && r.get(c)! <= target;
    const entry: NextTier = {
      tier: TIERS[target],
      gap: null,
      comesIn: [],
      dropsOut: [],
      moves: [],
    };
    out.set(c, entry);
    if (hiSteps < 1n || !reaches(run(hiSteps))) continue;
    // Reaching is not assumed monotone in the amount; the search only ever returns a
    // step whose run reached (hiSteps does, by the check above).
    let lo = 1n, hi = hiSteps;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if (reaches(run(mid))) hi = mid;
      else lo = mid + 1n;
    }
    entry.gap = hi * STEP;
    const after = run(hi);
    for (let o = 0; o < inp.m; o++) {
      if (o === c) continue;
      const was = live.get(o), is = after.get(o);
      if (was === undefined && is !== undefined) entry.comesIn.push([o, TIERS[is]]);
      else if (was !== undefined && is === undefined) entry.dropsOut.push([o, TIERS[was]]);
      else if (was !== undefined && is !== undefined && was !== is) {
        entry.moves.push([o, TIERS[was], TIERS[is]]);
      }
    }
  }
  return out;
}
