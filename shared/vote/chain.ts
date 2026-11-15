/** The chained stage tallies as a pure function, so the live tally can be re-run with
 * a made-up ballot added. Amounts are micro-USD bigints. Browser and Deno. */
import { stageBound, stageTally } from "./stage.ts";

export type ChainInputs = {
  m: number;
  costs: bigint[]; // asks, by candidate index; $0 is covered, never a candidate
  voters: string[]; // tokenIds, sorted
  weights: bigint[]; // each voter's remaining share, same order
  ranks: number[][]; // effectiveRanks per voter
  ballots: number[][]; // for stage bounds only
  poolUsd: bigint;
  spent: bigint; // settled awards so far
  done: ReadonlySet<number>; // settled initiatives: funded, or covered at a settlement
};
export type ChainStage = { order: number[]; shares: Map<number, Map<string, bigint>> };

const TIER_COUNT = 3;

/** Stages `first` up to (not including) `upTo`, chained: each stage pays from what the
 * ones before left. It works on copies, so the same inputs always give the same result. */
export function chainTally(inp: ChainInputs, first: number, upTo = TIER_COUNT): ChainStage[] {
  const { m, costs, voters, ranks, ballots, poolUsd } = inp;
  const weights = [...inp.weights]; // stageTally spends these in place
  const done = new Set(inp.done);
  let spent = inp.spent;
  const stages: ChainStage[] = [];
  for (let t = first; t < upTo; t++) {
    // B, the last tier, counts to the last level (the Python's stage after the tiers).
    const bound = t === TIER_COUNT - 1 ? m : stageBound(ballots, t, TIER_COUNT, m);
    // A project asking $0 is covered by donations: no candidate (plain PB-EAR would fund it).
    const candidates = [...Array(m).keys()].filter((c) => !done.has(c) && costs[c] > 0n);
    const got = stageTally(costs, weights, ranks, poolUsd, spent, candidates, bound);
    const shares = new Map<number, Map<string, bigint>>();
    for (const c of got.order) {
      const paid = new Map<string, bigint>();
      for (const [i, d] of got.shares.get(c)!) paid.set(voters[i], d);
      shares.set(c, paid);
      done.add(c);
      spent += [...paid.values()].reduce((a, b) => a + b, 0n);
    }
    stages.push({ order: got.order, shares });
  }
  return stages;
}
