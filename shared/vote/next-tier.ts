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

/** The tally the search re-runs; a parameter so tests can count the runs. */
export type Tally = typeof chainTally;

/** Candidate → tier index, over the stages from `first`. */
function tiersOf(tally: Tally, inp: ChainInputs, first: number): Map<number, number> {
  const out = new Map<number, number>();
  tally(inp, first).forEach((stage, k) => {
    for (const c of stage.order) out.set(c, first + k);
  });
  return out;
}

/** `inp` plus a voter who backs only `c` with `weight`. The rank `m + 2` never opens,
 * and `ballots` stays as it is, so the stage bounds do not move.
 *
 * The phantom backs `c` at the first level, so `c` is counted as early as it can be and
 * the gap is the best case. For Tier-B with a tight pool that is optimistic: backers who
 * rank it lower are counted later, after others may already have taken the pool. */
function withPhantom(inp: ChainInputs, c: number, weight: bigint): ChainInputs {
  const ranks = Array.from({ length: inp.m }, (_, i) => (i === c ? 1 : inp.m + 2));
  return {
    ...inp,
    voters: [...inp.voters, "phantom"],
    weights: [...inp.weights, weight],
    ranks: [...inp.ranks, ranks],
  };
}

/** The search. It yields after every tally it runs, so the async variant can let other
 * work in between; it returns the entries. */
function* search(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally,
): Generator<void, Map<number, NextTier>> {
  const live = tiersOf(tally, inp, firstOpen);
  yield;
  const room = inp.poolUsd - inp.spent;
  const hiSteps = room / STEP; // bigint division rounds down
  const out = new Map<number, NextTier>();
  for (let c = 0; c < inp.m; c++) {
    if (inp.done.has(c)) continue;
    const now = live.get(c);
    const target = now === undefined ? TIERS.length - 1 : now - 1;
    if (target < firstOpen || target < 0) continue;
    const run = (k: bigint) => tiersOf(tally, withPhantom(inp, c, k * STEP), firstOpen);
    const reaches = (r: Map<number, number>) => r.has(c) && r.get(c)! <= target;
    const entry: NextTier = {
      tier: TIERS[target],
      gap: null,
      comesIn: [],
      dropsOut: [],
      moves: [],
    };
    out.set(c, entry);
    // What's left of the pool can't pay for it, whoever backs it.
    if (hiSteps < 1n || inp.costs[c] > room) continue;
    // Backing its whole need almost always gets it there, so look below that first, and
    // up to the whole pool only when it doesn't.
    const need = (inp.costs[c] + STEP - 1n) / STEP;
    const cap = need < 1n ? 1n : need < hiSteps ? need : hiSteps;
    let hi = cap, after = run(cap);
    yield;
    if (!reaches(after)) {
      if (cap === hiSteps) continue;
      [hi, after] = [hiSteps, run(hiSteps)];
      yield;
      if (!reaches(after)) continue;
    }
    // Reaching is not assumed monotone in the amount: the search only ever returns a
    // step whose run reached, and keeps that run for the knock-on.
    let lo = 1n;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      const r = run(mid);
      yield;
      if (reaches(r)) [hi, after] = [mid, r];
      else lo = mid + 1n;
    }
    entry.gap = hi * STEP;
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

/** Keyed by initiative index; an initiative with no higher tier to reach has no entry.
 * Settled initiatives are already funded, so they have none either. */
export function nextTiers(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally = chainTally,
): Map<number, NextTier> {
  const it = search(inp, firstOpen, tally);
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
  }
}

/** `nextTiers`, handing the event loop back after every tally it runs: a server isolate
 * keeps answering (ballot relays among them) while a large round is searched. */
export async function nextTiersAsync(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally = chainTally,
): Promise<Map<number, NextTier>> {
  const it = search(inp, firstOpen, tally);
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
    await new Promise((r) => setTimeout(r, 0));
  }
}
