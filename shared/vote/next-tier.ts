/** For each initiative, how much more backing it needs to be funded one tier higher,
 * and who would come in or drop out if it were. The tally is re-run with a made-up
 * voter ("phantom") who backs only that initiative. Also how far ahead a Tier-S
 * initiative is, and the same figures judged at each settlement once the round has
 * closed. Pure; browser and Deno. */
import { type Tier, TIERS } from "./ballot.ts";
import { type ChainInputs, chainTally } from "./chain.ts";
import { cumulativeDeductions, stageBound } from "./stage.ts";

/** Gaps are whole $1K steps, rounded up; leads are rounded down. */
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

/** The gap search for one initiative, against `live` (the run from `first` without a
 * phantom). The searches are generators that yield after every tally they run, so the
 * async variants can let other work in between; they return the result. */
function* gapSearch(
  inp: ChainInputs,
  first: number,
  c: number,
  target: number,
  live: Map<number, number>,
  tally: Tally,
  onlyTarget: boolean,
): Generator<void, NextTier> {
  const entry: NextTier = {
    tier: TIERS[target],
    gap: null,
    comesIn: [],
    dropsOut: [],
    moves: [],
  };
  // A target before the first tier counted has already settled: nothing can reach it.
  if (target < first) return entry;
  const room = inp.poolUsd - inp.spent;
  const hiSteps = room / STEP; // bigint division rounds down
  const run = (k: bigint) => tiersOf(tally, withPhantom(inp, c, k * STEP), first);
  const reaches = (r: Map<number, number>) => r.has(c) && r.get(c)! <= target;
  // What's left of the pool can't pay for it, whoever backs it.
  if (hiSteps < 1n || inp.costs[c] > room) return entry;
  // Backing its whole need almost always gets it there, so look below that first, and
  // up to the whole pool only when it doesn't.
  const need = (inp.costs[c] + STEP - 1n) / STEP;
  const cap = need < 1n ? 1n : need < hiSteps ? need : hiSteps;
  let hi = cap, after = run(cap);
  yield;
  if (!reaches(after)) {
    if (cap === hiSteps) return entry;
    [hi, after] = [hiSteps, run(hiSteps)];
    yield;
    if (!reaches(after)) return entry;
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
    if (onlyTarget) {
      // The tiers below the target settle later, so where an initiative pushed out of
      // it would finally have landed isn't known: only the target tier is listed.
      if (was !== target && is === target) entry.comesIn.push([o, TIERS[target]]);
      else if (was === target && is !== target) entry.dropsOut.push([o, TIERS[target]]);
    } else if (was === undefined && is !== undefined) entry.comesIn.push([o, TIERS[is]]);
    else if (was !== undefined && is === undefined) entry.dropsOut.push([o, TIERS[was]]);
    else if (was !== undefined && is !== undefined && was !== is) {
      entry.moves.push([o, TIERS[was], TIERS[is]]);
    }
  }
  return entry;
}

/** Every open initiative's gap to the tier above where the live tally puts it. */
function* search(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally,
): Generator<void, Map<number, NextTier>> {
  const live = tiersOf(tally, inp, firstOpen);
  yield;
  const out = new Map<number, NextTier>();
  for (let c = 0; c < inp.m; c++) {
    if (inp.done.has(c)) continue;
    const now = live.get(c);
    const target = now === undefined ? TIERS.length - 1 : now - 1;
    if (target < firstOpen || target < 0) continue;
    out.set(c, yield* gapSearch(inp, firstOpen, c, target, live, tally, false));
  }
  return out;
}

/** The lead search: the largest step verified to keep `c` funded in tier `first` when
 * its backers give that much less, spread over them by weight. Less backing lowers its
 * support, so a rival that shares its backers can be picked before it. */
function* leadSearch(
  inp: ChainInputs,
  first: number,
  c: number,
  tally: Tally,
): Generator<void, bigint | null> {
  // A backer is a voter whose rank for `c` opens within the stage, as chainTally bounds
  // it. An unplaced initiative gets a real rank too, but one past the stage's bound
  // counts for nothing there, and spreading the loss onto it would overstate the lead.
  const last = TIERS.length - 1;
  const bound = first >= last ? inp.m : stageBound(inp.ballots, first, TIERS.length, inp.m);
  const opens = Math.min(inp.m, bound);
  const backers = inp.ranks.flatMap((r, i) => (r[c] <= opens ? [i] : []));
  const backing = backers.map((i) => inp.weights[i]);
  const funded = (l: bigint) => {
    const weights = [...inp.weights];
    if (l > 0n) {
      // Exact integer shares; the remainder falls on the last backer.
      const less = cumulativeDeductions(backing, l * STEP);
      backers.forEach((i, k) => (weights[i] -= less[k]));
    }
    return tally({ ...inp, weights }, first, first + 1)[0].order.includes(c);
  };
  const now = funded(0n);
  yield;
  if (!now) return null;
  // Its backers can't give less than everything they hold.
  const hiSteps = backing.reduce((a, b) => a + b, 0n) / STEP;
  if (hiSteps < 1n) return 0n;
  const top = funded(hiSteps);
  yield;
  if (top) return hiSteps * STEP;
  // Not assumed monotone: `lo` is always a step that was funded, `hi` one that wasn't.
  let lo = 0n, hi = hiSteps;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const ok = funded(mid);
    yield;
    if (ok) lo = mid;
    else hi = mid;
  }
  return lo * STEP;
}

function* liveLeadsSearch(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally,
): Generator<void, Map<number, bigint>> {
  const out = new Map<number, bigint>();
  if (firstOpen !== 0) return out;
  const inS = tally(inp, 0, 1)[0].order;
  yield;
  for (const c of inS) {
    const lead = yield* leadSearch(inp, 0, c, tally);
    if (lead !== null) out.set(c, lead);
  }
  return out;
}

export type FinalWhatIfs = { next: Map<number, NextTier>; lead: Map<number, bigint> };

function* finalSearch(
  settleInputs: (ChainInputs | null)[],
  finalTier: Map<number, number>,
  m: number,
  tally: Tally,
): Generator<void, FinalWhatIfs> {
  const next = new Map<number, NextTier>();
  const lead = new Map<number, bigint>();
  // A settlement nobody had voted at has nothing to compare against.
  const at = (t: number) => {
    const inp = settleInputs[t];
    return inp && inp.voters.length > 0 ? inp : null;
  };
  // Each settlement's run without a phantom, shared by every figure judged there.
  const lives = new Map<number, Map<number, number>>();
  // Each tier is judged where it would have had to win: at its own settlement.
  function* gap(t: number, c: number): Generator<void, void> {
    const inp = at(t);
    if (!inp) return;
    let live = lives.get(t);
    if (!live) {
      live = tiersOf(tally, inp, t);
      lives.set(t, live);
      yield;
    }
    // Already in the target tier at these inputs (a stored snapshot the re-tally doesn't
    // reproduce): there is no gap to tell.
    if (live.has(c) && live.get(c)! <= t) return;
    next.set(c, yield* gapSearch(inp, t, c, t, live, tally, true));
  }
  for (let c = 0; c < m; c++) {
    const k = finalTier.get(c);
    if (k === undefined) yield* gap(TIERS.length - 1, c);
    else if (k >= 1) yield* gap(k - 1, c);
    else {
      const inp = at(0);
      if (!inp) continue;
      const l = yield* leadSearch(inp, 0, c, tally);
      if (l !== null) lead.set(c, l);
    }
  }
  return { next, lead };
}

function drive<T>(it: Generator<void, T>): T {
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
  }
}

/** `drive`, handing the event loop back after every tally: a server isolate keeps
 * answering (ballot relays among them) while a large round is searched. */
async function driveAsync<T>(it: Generator<void, T>): Promise<T> {
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** Keyed by initiative index; an initiative with no higher tier to reach has no entry.
 * Settled initiatives are already funded, so they have none either. */
export function nextTiers(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally = chainTally,
): Map<number, NextTier> {
  return drive(search(inp, firstOpen, tally));
}

/** `nextTiers`, yielding between tallies. */
export function nextTiersAsync(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally = chainTally,
): Promise<Map<number, NextTier>> {
  return driveAsync(search(inp, firstOpen, tally));
}

/** Gap for one initiative to reach `target` (tier index), judged with `inp` from tier `first`.
 * `onlyTarget`: the knock-on lists only cover changes in the target tier. */
export function gapTo(
  inp: ChainInputs,
  first: number,
  c: number,
  target: number,
  opts: { onlyTarget?: boolean; tally?: Tally } = {},
): NextTier {
  const tally = opts.tally ?? chainTally;
  const live = tiersOf(tally, inp, first);
  return drive(gapSearch(inp, first, c, target, live, tally, opts.onlyTarget ?? false));
}

/** Largest STEP multiple L (rounded down) with c still funded in tier `first` when its
 * backers give L less, spread over them by weight (cost and pool as they are); null when
 * it isn't funded there at all; 0n under $1K. */
export function leadIn(
  inp: ChainInputs,
  first: number,
  c: number,
  tally: Tally = chainTally,
): bigint | null {
  return drive(leadSearch(inp, first, c, tally));
}

/** Open round: leads for initiatives funded in Tier-S by the live tally (only while firstOpen = 0). */
export function liveLeads(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally = chainTally,
): Map<number, bigint> {
  return drive(liveLeadsSearch(inp, firstOpen, tally));
}

/** `liveLeads`, yielding between tallies. */
export function liveLeadsAsync(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally = chainTally,
): Promise<Map<number, bigint>> {
  return driveAsync(liveLeadsSearch(inp, firstOpen, tally));
}

/** Closed round: tier k's initiatives (k ≥ 1) → gapTo tier k−1 judged at settleInputs[k−1];
 * Tier-S's → leadIn at settleInputs[0]; not funded → gapTo Tier-B at settleInputs[2].
 * Knock-on: onlyTarget. Missing settle inputs → no figure. */
export function finalWhatIfs(
  settleInputs: (ChainInputs | null)[],
  finalTier: Map<number, number>,
  m: number,
  tally: Tally = chainTally,
): FinalWhatIfs {
  return drive(finalSearch(settleInputs, finalTier, m, tally));
}

/** `finalWhatIfs`, yielding between tallies. */
export function finalWhatIfsAsync(
  settleInputs: (ChainInputs | null)[],
  finalTier: Map<number, number>,
  m: number,
  tally: Tally = chainTally,
): Promise<FinalWhatIfs> {
  return driveAsync(finalSearch(settleInputs, finalTier, m, tally));
}
