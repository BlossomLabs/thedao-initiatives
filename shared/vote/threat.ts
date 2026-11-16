/** The green number: for each initiative the live tally funds in the tier settling now,
 * a checked single donation to another initiative that pushes it out of that tier
 * (null: none found, not a safety guarantee). Checks exact entry amounts and a $250
 * grid, refining hits to checked $10 amounts. Smaller threats can be missed.
 * Pure; browser and Deno. */
import { type ChainInputs, chainTally, stageLevel } from "./chain.ts";
import { entries, maxWinningAsk } from "./entry.ts";
import { drive, driveAsync, FINE, STEP, type Tally, withGift } from "./next-tier.ts";

/** The grid the number is searched on: $250. */
export const THREAT_STEP = 250_000_000n;

/** Keyed by every initiative the live tally funds in tier `first`: the smallest checked
 * donation found (a multiple of FINE) that pushes it out, or null when none was found.
 * A number is an upper bound on the true minimum; null does not prove safety. */
export type Threats = Map<number, bigint | null>;

/** What tier `first` funds with `inp`; the later tiers don't change who stays in it. */
const inTier = (tally: Tally, inp: ChainInputs, first: number) =>
  new Set(tally(inp, first, first + 1)[0].order);

/** The amounts worth trying for rival `r`, multiples of `step`: a donation can push a
 * green row out only once it gets `r` funded in the tier (until the tally picks `r`, its
 * ask changes no other pick or payment). That takes at least `cost − ask`, where `ask` is
 * the largest with which the tally would pick it there (entry.ts; at or above its cost
 * when it is picked already): from there (at least one step) to the last step below its
 * cost. Never more than the most support it could get there (the voters whose rank for it
 * opens within the stage's bound) allows. None when no donation short of its whole ask
 * gets it in. */
export function rivalAmounts(
  inp: ChainInputs,
  first: number,
  r: number,
  step: bigint,
  ask: bigint = maxWinningAsk(inp, first, r, first + 1),
): bigint[] {
  const lo = rivalStart(inp, first, r, step, ask);
  if (lo === null) return [];
  const out: bigint[] = [];
  for (let d = lo; d < inp.costs[r]; d += step) out.push(d);
  return out;
}

/** The first permitted amount at which the rival could enter, rounded to `step`. */
function rivalStart(
  inp: ChainInputs,
  first: number,
  r: number,
  step: bigint,
  ask: bigint,
): bigint | null {
  const opens = Math.min(inp.m, stageLevel(inp, first));
  let most = 0n;
  inp.ranks.forEach((rk, i) => {
    if (rk[r] <= opens) most += inp.weights[i];
  });
  if (most === 0n || ask === 0n) return null;
  const cost = inp.costs[r];
  const reach = most < ask ? most : ask;
  const short = cost - reach;
  const lo = short > step ? ((short + step - 1n) / step) * step : step;
  return lo < cost ? lo : null;
}

/** Also test the exact $10 entry amount: rounding it to the coarse grid can skip the
 * entire range where it displaces another initiative. These are still samples: later
 * danger ranges may lie between grid points. No amount covering the whole ask is tried. */
function rivalTries(
  inp: ChainInputs,
  first: number,
  r: number,
  step: bigint,
  ask: bigint,
): bigint[] {
  const entry = rivalStart(inp, first, r, FINE, ask);
  if (entry === null) return [];
  const grid = rivalAmounts(inp, first, r, step, ask);
  return entry % step === 0n ? grid : [entry, ...grid];
}

/** Every rival's largest winning ask in tier `first` (see rivalAmounts) from one run of
 * the tally; one the tally picks there already gets its cost. The thresholds follow
 * chainTally's rules: with a made-up `tally` (tests), every rival gets its cost, so its
 * whole range is scanned. */
function rivalAsks(inp: ChainInputs, first: number, tally: Tally): (r: number) => bigint {
  if (tally !== chainTally) return (r) => inp.costs[r];
  const all = entries(inp, first, first + 1);
  return (r) => all.get(r)?.[0]?.ask ?? inp.costs[r];
}

/** Every green row's number at once: one scan per rival over its amounts, each tally
 * showing every green row it pushes out; then each row's hit narrowed to $10. Yields
 * after every tally. */
function* threatsSearch(
  inp: ChainInputs,
  first: number,
  tally: Tally,
  step: bigint,
): Generator<void, Threats> {
  checkStep(step);
  const greens = [...inTier(tally, inp, first)];
  yield;
  const askOf = rivalAsks(inp, first, tally);
  yield;
  // Per green row: the smallest step found and the rival it was given to.
  const best = new Map<number, [bigint, number]>();
  for (let r = 0; r < inp.m; r++) {
    // Settled, withdrawn or covered: never a candidate, so no donation brings it in.
    if (inp.done.has(r) || inp.withdrawn.has(r) || inp.costs[r] === 0n) continue;
    for (const d of rivalTries(inp, first, r, step, askOf(r))) {
      // Nothing left to find below every green row's best so far: stop this rival.
      if (greens.every((x) => x === r || (best.has(x) && best.get(x)![0] <= d))) break;
      const after = inTier(tally, withGift(inp, r, d), first);
      yield;
      for (const x of greens) {
        if (x === r || after.has(x)) continue;
        const b = best.get(x);
        if (!b || d < b[0]) best.set(x, [d, r]);
      }
    }
  }
  const out: Threats = new Map();
  for (const x of greens) {
    const b = best.get(x);
    if (!b) {
      out.set(x, null);
      continue;
    }
    out.set(x, yield* narrow(inp, first, tally, x, b[1], b[0], step));
  }
  return out;
}

/** The narrowing needs whole $10s in a step: a step of at least FINE, a multiple of it. */
function checkStep(step: bigint) {
  if (step < FINE || step % FINE !== 0n) {
    throw new Error(`threat step ${step} is not a positive multiple of FINE (${FINE})`);
  }
}

/** Refine a coarse hit to another checked $10 amount for the same rival. This does not
 * establish a minimum: displacement can disappear and recur inside the bracket.
 * An off-grid hit is the exact entry probe and is already on the $10 grid. */
function* narrow(
  inp: ChainInputs,
  first: number,
  tally: Tally,
  x: number,
  r: number,
  hit: bigint,
  step: bigint,
): Generator<void, bigint> {
  if (hit % step !== 0n) return hit;
  let lo = (hit - step) / FINE + 1n, hi = hit / FINE;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const gone = !inTier(tally, withGift(inp, r, mid * FINE), first).has(x);
    yield;
    if (gone) hi = mid;
    else lo = mid + 1n;
  }
  return hi * FINE;
}

/** Keyed by every initiative the live tally funds in tier `first`: a checked donation
 * elsewhere that pushes it out if the tier settled now. Entry probes and the `step`
 * grid are sampled, then hits refined to $10. Null means no threat found in these
 * checks; smaller threats and narrow danger ranges can be missed. */
export function threats(
  inp: ChainInputs,
  first: number,
  tally: Tally = chainTally,
  step: bigint = THREAT_STEP,
): Threats {
  return drive(threatsSearch(inp, first, tally, step));
}

/** `threats`, handing the event loop back between tallies (after `sliceMs` of them). */
export function threatsAsync(
  inp: ChainInputs,
  first: number,
  tally: Tally = chainTally,
  sliceMs = 0,
  step: bigint = THREAT_STEP,
): Promise<Threats> {
  return driveAsync(threatsSearch(inp, first, tally, step), sliceMs);
}

/** The first checked entry/grid amount (then by rival) given to another initiative
 * that pushes green row `x` out, with that rival; only amounts up to `limit` are tried.
 * Null when none does. Yields after every tally. */
function* firstHit(
  inp: ChainInputs,
  first: number,
  x: number,
  tally: Tally,
  step: bigint,
  limit?: bigint,
): Generator<void, [bigint, number] | null> {
  const tries: [bigint, number][] = [];
  const askOf = rivalAsks(inp, first, tally);
  yield;
  for (let r = 0; r < inp.m; r++) {
    // Settled, withdrawn or covered: never a candidate, so no donation brings it in.
    if (r === x || inp.done.has(r) || inp.withdrawn.has(r) || inp.costs[r] === 0n) continue;
    for (const d of rivalTries(inp, first, r, step, askOf(r))) {
      if (limit !== undefined && d > limit) break;
      tries.push([d, r]);
    }
  }
  tries.sort(([d, r], [e, s]) => d < e ? -1 : d > e ? 1 : r - s);
  for (const [d, r] of tries) {
    const gone = !inTier(tally, withGift(inp, r, d), first).has(x);
    yield;
    if (gone) return [d, r];
  }
  return null;
}

/** One row's checked threat: every rival's entry/grid amounts together, smallest
 * first (then by rival), stopping at a hit and refining it to a checked $10 amount.
 * It need not find the true minimum, or the same witness as the all-rows scan.
 * Undefined when `x` is not in tier `first`. Yields after every tally. */
function* threatOfSearch(
  inp: ChainInputs,
  first: number,
  x: number,
  tally: Tally,
  step: bigint,
): Generator<void, bigint | null | undefined> {
  checkStep(step);
  const green = inTier(tally, inp, first).has(x);
  yield;
  if (!green) return undefined;
  const hit = yield* firstHit(inp, first, x, tally, step);
  return hit === null ? null : yield* narrow(inp, first, tally, x, hit[1], hit[0], step);
}

type OneRow = { tally?: Tally; sliceMs?: number; signal?: AbortSignal };

/** One row's number (see `threats`); undefined when `x` is not in tier `first`. */
export function threatOf(
  inp: ChainInputs,
  first: number,
  x: number,
  opts: OneRow & { step?: bigint } = {},
): bigint | null | undefined {
  return drive(threatOfSearch(inp, first, x, opts.tally ?? chainTally, opts.step ?? THREAT_STEP));
}

/** `threatOf`, handing the event loop back (after `sliceMs` of tallies); rejects with
 * `signal.reason` at the first hand-back after an abort. */
export function threatOfAsync(
  inp: ChainInputs,
  first: number,
  x: number,
  opts: OneRow & { step?: bigint } = {},
): Promise<bigint | null | undefined> {
  const it = threatOfSearch(inp, first, x, opts.tally ?? chainTally, opts.step ?? THREAT_STEP);
  return driveAsync(it, opts.sliceMs, opts.signal);
}

/** A suggested donation to a green row and a checked threat after it (null: none found). */
export type Jump = { usd: bigint; threat: bigint | null };

/** Suggestions whose checked threat is higher than now or has no threat found; one when
 * the amounts coincide. Neither a minimum suggestion nor greater safety is guaranteed.
 * The predicates are treated as monotone to generate candidates, so each is a
 * binary search over the $1K grid below its cost, its checks made at $1K steps too:
 * "higher" limits amounts by the current witness; "no threat found" tries them all. Each chip's
 * number is then worked out at THREAT_STEP, as the server's; a chip whose number there
 * doesn't bear it out (a range narrower than $1k) is dropped. Only amounts whose number
 * was worked out are returned. None when no threat was found now, not green, or nothing below
 * its cost reaches either. Yields after every tally. */
function* jumpsSearch(
  inp: ChainInputs,
  first: number,
  x: number,
  tally: Tally,
): Generator<void, Jump[]> {
  const now = yield* threatOfSearch(inp, first, x, tally, THREAT_STEP);
  if (now === null || now === undefined) return [];
  const cap: bigint = now;
  const top = (inp.costs[x] - 1n) / STEP;
  if (top < 1n) return [];
  // Per k (a gift of k × $1k): whether its checked threat is higher than now (or none found).
  // No threat found ranks above a finite witness for choosing suggestions.
  const higherAt = new Map<bigint, boolean>(), noThreatAt = new Map<bigint, boolean>();
  function* stillGreen(k: bigint): Generator<void, ChainInputs | null> {
    const given = withGift(inp, x, k * STEP);
    const green = inTier(tally, given, first).has(x);
    yield;
    return green ? given : null;
  }
  function* higher(k: bigint): Generator<void, boolean> {
    if (!higherAt.has(k)) {
      if (noThreatAt.get(k)) higherAt.set(k, true);
      else {
        const given = yield* stillGreen(k);
        // Its number at $1k steps is above `cap` unless a hit below `cap + $1k` narrows
        // to at most `cap`; no amount above that is tried.
        const hit = given && (yield* firstHit(given, first, x, tally, STEP, cap + STEP - FINE));
        higherAt.set(
          k,
          given !== null &&
            (hit === null || (yield* narrow(given, first, tally, x, hit[1], hit[0], STEP)) > cap),
        );
      }
    }
    return higherAt.get(k)!;
  }
  function* noThreat(k: bigint): Generator<void, boolean> {
    if (!noThreatAt.has(k)) {
      if (higherAt.get(k) === false) noThreatAt.set(k, false);
      else {
        const given = yield* stillGreen(k);
        noThreatAt.set(
          k,
          given !== null && (yield* firstHit(given, first, x, tally, STEP)) === null,
        );
      }
    }
    return noThreatAt.get(k)!;
  }
  // Find a checked candidate, without a guarantee that it is the first one.
  // Null when the top does not satisfy this suggestion predicate.
  function* candidate(
    lo: bigint,
    reaches: (k: bigint) => Generator<void, boolean>,
  ): Generator<void, bigint | null> {
    if (lo > top || !(yield* reaches(top))) return null;
    let hi = top;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if (yield* reaches(mid)) hi = mid;
      else lo = mid + 1n;
    }
    return hi;
  }
  const up = yield* candidate(1n, higher);
  if (up === null) return [];
  const upNoThreat = yield* noThreat(up);
  const sure = upNoThreat ? null : yield* candidate(up + 1n, noThreat);
  // Each chip's number at THREAT_STEP.
  const out: Jump[] = [];
  for (const k of sure === null ? [up] : [up, sure]) {
    const v = yield* threatOfSearch(withGift(inp, x, k * STEP), first, x, tally, THREAT_STEP);
    if (v === undefined) continue;
    // Recheck every suggestion: no threat found, or a higher checked witness.
    if (k !== up ? v !== null : !(v === null || v > now)) continue;
    // If the first chip already has no threat found, the other adds nothing.
    if (out.length && out[0].threat === null) continue;
    out.push({ usd: k * STEP, threat: v });
  }
  return out;
}

/** The donations at which green row `x`'s number jumps (see `jumpsSearch`). */
export function jumps(
  inp: ChainInputs,
  first: number,
  x: number,
  opts: OneRow = {},
): Jump[] {
  return drive(jumpsSearch(inp, first, x, opts.tally ?? chainTally));
}

/** `jumps`, handing the event loop back (after `sliceMs` of tallies); rejects with
 * `signal.reason` at the first hand-back after an abort. */
export function jumpsAsync(
  inp: ChainInputs,
  first: number,
  x: number,
  opts: OneRow = {},
): Promise<Jump[]> {
  return driveAsync(
    jumpsSearch(inp, first, x, opts.tally ?? chainTally),
    opts.sliceMs,
    opts.signal,
  );
}
