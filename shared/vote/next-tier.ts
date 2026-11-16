/** For each initiative, how much more backing it needs to be funded one tier higher,
 * and who would come in or drop out if it were. The tally is re-run with a made-up
 * voter ("phantom") who backs only that initiative. Also how far ahead an initiative in
 * the tier settling now is, and the same figures judged at each settlement once the round
 * has closed. And the donation that would get each initiative one tier higher.
 * Pure; browser and Deno. */
import { type Tier, TIERS } from "./ballot.ts";
import { type ChainInputs, chainTally } from "./chain.ts";
import { entries, type Entry, maxWinningAsk, minExtraBacking } from "./entry.ts";
import { cumulativeDeductions, stageBound } from "./stage.ts";

/** Gaps are whole $1K steps, rounded up; leads are rounded down. */
export const STEP = 1_000_000_000n;
/** The live donation figures and leads, finer: whole $10 steps, so a page can say them to
 * three digits ("$300", "$1.53k", "$11.3k"). */
export const FINE = 10_000_000n;

export type NextTier = {
  tier: Tier; // the target; for a donation with a gap, the tier that gap lands it in
  gap: bigint | null; // micro-USD, a multiple of STEP; null = out of reach
  comesIn: [number, Tier][]; // newly funded, with their tier
  dropsOut: [number, Tier][]; // no longer funded, with the tier they lose
  moves: [number, Tier, Tier][]; // still funded, from → to
};

/** The tally the search re-runs; a parameter so tests can count the runs. A tally passed
 * here must follow chainTally's rules (chainTally itself, wrapped to count): the gap
 * formulas (entry.ts) are chainTally's, and a different tally only drives the live and
 * knock-on runs. Where the knock-on run doesn't fund the initiative in the target tier
 * or higher, the two disagree, and there is no figure (gap null) rather than a wrong one. */
export type Tally = typeof chainTally;

/** Candidate → tier index, over the stages from `first` up to (not including) `upTo`. */
function tiersOf(
  tally: Tally,
  inp: ChainInputs,
  first: number,
  upTo: number = TIERS.length,
): Map<number, number> {
  const out = new Map<number, number>();
  tally(inp, first, upTo).forEach((stage, k) => {
    for (const c of stage.order) out.set(c, first + k);
  });
  return out;
}

/** Whether `run` funds `c` in tier `target` or higher. */
const reaches = (run: Map<number, number>, c: number, target: number) =>
  run.has(c) && run.get(c)! <= target;

/** `inp` plus a voter who backs only `c` with `weight`. The rank `m + 2` never opens,
 * and `ballots` stays as it is, so the stage bounds do not move.
 *
 * The phantom backs `c` at the first level, so `c` is counted as early as it can be and
 * the gap is the best case. For B-Tier with a tight pool that is optimistic: backers who
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

/** The gap for one initiative, against `live` (the run from `first` without a phantom):
 * the least extra backing that gets it to `target` or higher (entry.ts), rounded up to a
 * $1K step, then one run with that much for the knock-on. `backing` is that least backing
 * when the caller has it already (entries: one run for every initiative); undefined: it
 * is worked out here. The searches are generators that yield after every tally they run,
 * so the async variants can let other work in between; they return the result. */
function* gapSearch(
  inp: ChainInputs,
  first: number,
  c: number,
  target: number,
  live: Map<number, number>,
  tally: Tally,
  onlyTarget: boolean,
  backing?: bigint | null,
): Generator<void, NextTier> {
  const entry: NextTier = {
    tier: TIERS[target],
    gap: null,
    comesIn: [],
    dropsOut: [],
    moves: [],
  };
  // A target before the first tier counted has already settled: nothing can reach it.
  // A withdrawn initiative is no candidate: no backing gets it anywhere.
  if (target < first || inp.withdrawn.has(c)) return entry;
  const room = inp.poolUsd - inp.spent;
  const hiSteps = room / STEP; // bigint division rounds down
  // What's left of the pool can't pay for it, whoever backs it.
  if (hiSteps < 1n || inp.costs[c] > room) return entry;
  if (backing === undefined) {
    backing = minExtraBacking(inp, first, c, target + 1);
    yield;
  }
  if (backing === null) return entry;
  // Whole $1K steps, at least one; no more than what's left of the pool.
  const k = backing > STEP ? (backing + STEP - 1n) / STEP : 1n;
  if (k > hiSteps) return entry;
  entry.gap = k * STEP;
  // An onlyTarget knock-on only looks at the stages up to the target.
  const upTo = onlyTarget ? target + 1 : TIERS.length;
  const after = tiersOf(tally, withPhantom(inp, c, entry.gap), first, upTo);
  yield;
  // The run disagrees with the formula (a tally not following chainTally's rules): no figure.
  if (!reaches(after, c, target)) return { ...entry, gap: null };
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

/** `inp` with `c`'s need lowered by `given`: a donation (or pledge) pays that much of it,
 * so the pool is asked for less. */
export function withGift(inp: ChainInputs, c: number, given: bigint): ChainInputs {
  const costs = [...inp.costs];
  costs[c] = costs[c] > given ? costs[c] - given : 0n;
  return { ...inp, costs };
}

/** The donation for one initiative: the least `step` that, given to it, gets it funded
 * in tier `target` or higher if the open tiers (from `first`) settled now (the entry's
 * tier is where it lands with it). From the largest ask with which the tally would pick
 * it (entry.ts): its ask less that, rounded up to a step, at least one. The last step
 * short of its whole need is the most anyone can give it (given all of it, it is covered,
 * in no tier); when it takes more, the gap is null. `ask` is that largest ask when the
 * caller has it already; undefined: it is worked out here. With `knockOn`, one run with
 * the donation names the tier it lands in and, over every open tier, who comes in, drops
 * out or moves. */
function* giftSearch(
  inp: ChainInputs,
  first: number,
  c: number,
  target: number,
  live: Map<number, number>,
  tally: Tally,
  step: bigint = STEP,
  ask?: bigint,
  knockOn = true,
): Generator<void, NextTier> {
  const entry: NextTier = {
    tier: TIERS[target],
    gap: null,
    comesIn: [],
    dropsOut: [],
    moves: [],
  };
  // Withdrawn: no candidate, so no donation gets it anywhere.
  if (inp.withdrawn.has(c)) return entry;
  if (ask === undefined) {
    ask = maxWinningAsk(inp, first, c, target + 1);
    yield;
  }
  if (ask === 0n) return entry;
  const cost = inp.costs[c];
  const short = cost > ask ? cost - ask : 0n;
  const k = short > step ? (short + step - 1n) / step : 1n;
  if (k * step >= cost) return entry;
  entry.gap = k * step;
  if (!knockOn) return entry;
  const after = tiersOf(tally, withGift(inp, c, entry.gap), first);
  yield;
  // The run disagrees with the formula (a tally not following chainTally's rules): no figure.
  if (!reaches(after, c, target)) return { ...entry, gap: null };
  // The amount that reaches the target can land it higher still (its backers rank it
  // there): name the tier it lands in, so the page says one tier for one amount.
  entry.tier = TIERS[after.get(c)!];
  for (let o = 0; o < inp.m; o++) {
    if (o === c) continue;
    const was = live.get(o), is = after.get(o);
    if (was === undefined && is !== undefined) entry.comesIn.push([o, TIERS[is]]);
    else if (was !== undefined && is === undefined) entry.dropsOut.push([o, TIERS[was]]);
    else if (was !== undefined && is !== undefined && was !== is) {
      entry.moves.push([o, TIERS[was], TIERS[is]]);
    }
  }
  return entry;
}

/** Initiative `c`'s thresholds through stage `target` from `all` (entries from `first`);
 * undefined when the run picks it by then. */
const through = (all: Map<number, Entry[]>, first: number, c: number, target: number) =>
  all.get(c)?.[target - first];

/** Every open initiative below the tier settling now (`firstOpen`), as the live tally has
 * it: the donation that gets it one tier higher (into B-Tier when it isn't funded). Those
 * in the tier settling now have their threat instead (shared/vote/threat.ts). */
function* giftsSearch(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally,
): Generator<void, Map<number, NextTier>> {
  const out = new Map<number, NextTier>();
  if (firstOpen < 0 || firstOpen >= TIERS.length) return out;
  const live = tiersOf(tally, inp, firstOpen);
  yield;
  // One run for every initiative's threshold: none of them is picked before its target.
  const all = entries(inp, firstOpen, TIERS.length);
  yield;
  for (let c = 0; c < inp.m; c++) {
    // Settled, covered by donations (asking $0) or withdrawn: nothing more to give it.
    if (inp.done.has(c) || inp.withdrawn.has(c) || inp.costs[c] === 0n) continue;
    const now = live.get(c);
    if (now === firstOpen) continue;
    const target = now === undefined ? TIERS.length - 1 : now - 1;
    const ask = through(all, firstOpen, c, target)?.ask;
    out.set(c, yield* giftSearch(inp, firstOpen, c, target, live, tally, FINE, ask));
  }
  return out;
}

/** Every open initiative's gap to the tier above where the live tally puts it. */
function* search(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally,
): Generator<void, Map<number, NextTier>> {
  const live = tiersOf(tally, inp, firstOpen);
  yield;
  // One run for every initiative's threshold: none of them is picked before its target.
  const all = firstOpen >= 0 && firstOpen < TIERS.length
    ? entries(inp, firstOpen, TIERS.length)
    : new Map<number, Entry[]>();
  yield;
  const out = new Map<number, NextTier>();
  for (let c = 0; c < inp.m; c++) {
    // Settled, covered (asking $0: in no tier, and no gap to one) or withdrawn.
    if (inp.done.has(c) || inp.withdrawn.has(c) || inp.costs[c] === 0n) continue;
    const now = live.get(c);
    const target = now === undefined ? TIERS.length - 1 : now - 1;
    if (target < firstOpen || target < 0) continue;
    const backing = through(all, firstOpen, c, target)?.backing;
    out.set(c, yield* gapSearch(inp, firstOpen, c, target, live, tally, false, backing));
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
  step: bigint = STEP,
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
      const less = cumulativeDeductions(backing, l * step);
      backers.forEach((i, k) => (weights[i] -= less[k]));
    }
    return tally({ ...inp, weights }, first, first + 1)[0].order.includes(c);
  };
  const now = funded(0n);
  yield;
  if (!now) return null;
  // Its backers can't give less than everything they hold.
  const hiSteps = backing.reduce((a, b) => a + b, 0n) / step;
  if (hiSteps < 1n) return 0n;
  const top = funded(hiSteps);
  yield;
  if (top) return hiSteps * step;
  // Not assumed monotone: `lo` is always a step that was funded, `hi` one that wasn't.
  let lo = 0n, hi = hiSteps;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const ok = funded(mid);
    yield;
    if (ok) lo = mid;
    else hi = mid;
  }
  return lo * step;
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
  // Each settlement's run without a phantom, and the one giving every initiative's
  // threshold, shared by every figure judged there.
  const lives = new Map<number, [Map<number, number>, Map<number, Entry[]>]>();
  // Each tier is judged where it would have had to win: at its own settlement.
  function* gap(t: number, c: number): Generator<void, void> {
    const inp = at(t);
    // Covered or withdrawn at that settlement (or settled before it): no tier to have reached.
    if (!inp || inp.done.has(c) || inp.withdrawn.has(c) || inp.costs[c] === 0n) return;
    let got = lives.get(t);
    if (!got) {
      // Every figure here targets tier t itself: the later stages aren't looked at.
      got = [tiersOf(tally, inp, t, t + 1), entries(inp, t, t + 1)];
      lives.set(t, got);
      yield;
    }
    const [live, all] = got;
    // Already in the target tier at these inputs (a stored snapshot the re-tally doesn't
    // reproduce): there is no gap to tell.
    if (live.has(c) && live.get(c)! <= t) return;
    const backing = through(all, t, c, t)?.backing;
    next.set(c, yield* gapSearch(inp, t, c, t, live, tally, true, backing));
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

export function drive<T>(it: Generator<void, T>): T {
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
  }
}

/** `drive`, handing the event loop back after every tally: a server isolate keeps
 * answering (ballot relays among them) while a large round is searched. With `sliceMs`
 * (a page), after that many milliseconds of tallies instead: a timer costs a few ms
 * itself, so handing back after each one made a page's search many times slower. With
 * `signal`, it throws `signal.reason` at the first hand-back after an abort. */
export async function driveAsync<T>(
  it: Generator<void, T>,
  sliceMs = 0,
  signal?: AbortSignal,
): Promise<T> {
  let since = performance.now();
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
    if (performance.now() - since >= sliceMs) {
      await new Promise((r) => setTimeout(r, 0));
      // Aborted while handed back: the caller no longer wants the result.
      if (signal?.aborted) throw signal.reason;
      since = performance.now();
    }
  }
}

/** Keyed by initiative index; an initiative with no higher tier to reach has no entry.
 * Settled initiatives are already funded, so they have none either, nor do covered ones
 * (asking $0) or withdrawn ones. */
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

/** Keyed by initiative index: for each open initiative not in the tier settling now, the
 * donation (a $10 step, rounded up; null when even its whole need isn't enough) that gets
 * it one tier higher than the live tally has it (B-Tier when unfunded), if the open tiers
 * settled now. Settled initiatives, covered ones (asking $0), withdrawn ones and those
 * in the tier settling now have no entry. */
export function giftGaps(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally = chainTally,
): Map<number, NextTier> {
  return drive(giftsSearch(inp, firstOpen, tally));
}

/** `giftGaps`, yielding between tallies. */
export function giftGapsAsync(
  inp: ChainInputs,
  firstOpen: number,
  tally: Tally = chainTally,
  sliceMs = 0,
): Promise<Map<number, NextTier>> {
  return driveAsync(giftsSearch(inp, firstOpen, tally), sliceMs);
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
  const onlyTarget = opts.onlyTarget ?? false;
  const live = tiersOf(tally, inp, first, onlyTarget ? target + 1 : TIERS.length);
  return drive(gapSearch(inp, first, c, target, live, tally, onlyTarget));
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

/** Closed round: tier k's initiatives (k ≥ 1) → gapTo tier k−1 judged at settleInputs[k−1];
 * S-Tier's → leadIn at settleInputs[0]; not funded → gapTo B-Tier at settleInputs[2].
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

/** What a donation of `given` (micro-USD) to `c` does if the open tiers (from `first`)
 * settled now: the tier it lands in before and after (null: not funded), and who else
 * comes in, drops out or moves. One tally with the gift, one without; cheap enough to
 * run as an amount is typed. */
export type GiftEffect = {
  was: Tier | null;
  tier: Tier | null;
  /** The gift is its whole ask: covered by donations, in no tier (not a drop out). */
  covered: boolean;
  comesIn: [number, Tier][];
  dropsOut: [number, Tier][];
  moves: [number, Tier, Tier][];
};
export function giftEffect(
  inp: ChainInputs,
  first: number,
  c: number,
  given: bigint,
  tally: Tally = chainTally,
  live: Map<number, number> = tiersOf(tally, inp, first),
): GiftEffect {
  const after = tiersOf(tally, withGift(inp, c, given), first);
  const name = (t: number | undefined) => (t === undefined ? null : TIERS[t]);
  const out: GiftEffect = {
    was: name(live.get(c)),
    tier: name(after.get(c)),
    covered: inp.costs[c] > 0n && !inp.withdrawn.has(c) && given >= inp.costs[c],
    comesIn: [],
    dropsOut: [],
    moves: [],
  };
  for (let o = 0; o < inp.m; o++) {
    if (o === c) continue;
    const was = live.get(o), is = after.get(o);
    if (was === undefined && is !== undefined) out.comesIn.push([o, TIERS[is]]);
    else if (was !== undefined && is === undefined) out.dropsOut.push([o, TIERS[was]]);
    else if (was !== undefined && is !== undefined && was !== is) {
      out.moves.push([o, TIERS[was], TIERS[is]]);
    }
  }
  return out;
}

/** The live tally from `first`, as giftEffect compares against: candidate → tier index.
 * Computed once for a round, then reused for every amount typed. */
export const liveTiers = (inp: ChainInputs, first: number, tally: Tally = chainTally) =>
  tiersOf(tally, inp, first);

/** The least `step` (a $1K one by default) that, given to `c`, gets it funded in tier
 * `target` (index) or higher if the open tiers (from `first`) settled now; null when
 * even its whole need doesn't. The donation search for any tier, not only the next one
 * up; a donate form's suggestions take a finer step, so an amount below one really
 * doesn't get there. One run of the tally (entry.ts), no knock-on; `_live` is no longer
 * needed and kept so callers passing a step don't change. */
export function giftGapTo(
  inp: ChainInputs,
  first: number,
  c: number,
  target: number,
  tally: Tally = chainTally,
  _live?: Map<number, number>,
  step: bigint = STEP,
): bigint | null {
  if (target < first) return null;
  const it = giftSearch(inp, first, c, target, new Map(), tally, step, undefined, false);
  return drive(it).gap;
}
