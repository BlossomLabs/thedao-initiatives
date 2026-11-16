/** Exact entry thresholds: how far an initiative's ask must fall (a donation), or how much
 * backing a voter backing only it must bring (the phantom), for the tally to pick it in
 * the stages from `first` up to (not including) `upTo`. Until it is picked, changing only
 * its ask or adding such a voter changes no other pick or payment; so one run of the tally
 * with it held out of selection shows every point where it could have been picked, and
 * the threshold is read off those points (spec 2026-11-16-green-number-design.md,
 * "Addendum: formulas and the follow-up spike"). Amounts are micro-USD bigints.
 * Pure; browser and Deno. */
import { type ChainInputs, stageLevel } from "./chain.ts";
import { cumulativeDeductions } from "./stage.ts";

/** One decision point: what's left of the pool, every tracked initiative's support, and
 * the one the tally picks there (null: none, so a rank level opens or the stage ends). */
type Point = { room: bigint; support: Map<number, bigint>; best: number | null };

/** chainTally from `first` up to `upTo`, with `held` (if any) never picked, calling `visit`
 * at every decision point, before the pick. stageTally's rules line for line (tie order,
 * payments, support decrements, stage bounds), with one difference: where stageTally stops
 * because no ask fits, this keeps opening rank levels up to the stage's bound, as a
 * lowered ask may fit and gather support there. Nothing is picked or paid after that
 * point, so the picks are chainTally's. `visit` gets the stage index too, and `endStage`
 * runs after each stage with the initiatives it picked. */
function trace(
  inp: ChainInputs,
  first: number,
  upTo: number,
  held: number | null,
  visit: (p: Point) => void,
  endStage: (picked: number[]) => void = () => {},
): void {
  const { m, costs, ranks, poolUsd } = inp;
  const weights = [...inp.weights];
  const done = new Set(inp.done);
  let spent = inp.spent;
  for (let t = first; t < upTo; t++) {
    const lastLevel = Math.min(m, stageLevel(inp, t));
    const cands = [...Array(m).keys()].filter((c) =>
      !done.has(c) && !inp.withdrawn.has(c) && costs[c] > 0n
    );
    const opens: [number, number][][] = Array.from({ length: m + 2 }, () => []);
    ranks.forEach((r, i) => {
      for (const c of cands) if (r[c] <= m + 1) opens[r[c]].push([i, c]);
    });
    const approved: number[][] = ranks.map(() => []);
    const approvers = new Map<number, number[]>(cands.map((c) => [c, []]));
    const support = new Map<number, bigint>(cands.map((c) => [c, 0n]));
    const picked: number[] = [];
    const isPicked = new Set<number>();
    const openLevel = (level: number) => {
      for (const [i, c] of opens[level]) {
        approved[i].push(c);
        approvers.get(c)!.push(i);
        support.set(c, support.get(c)! + weights[i]);
      }
    };
    const pay = (c: number) => {
      const payers = approvers.get(c)!.filter((i) => weights[i] > 0n).sort((a, b) => a - b);
      const deductions = cumulativeDeductions(payers.map((i) => weights[i]), costs[c]);
      payers.forEach((i, k) => {
        const d = deductions[k];
        weights[i] -= d;
        for (const other of approved[i]) {
          if (support.has(other)) support.set(other, support.get(other)! - d);
        }
      });
      isPicked.add(c);
      picked.push(c);
      spent += costs[c];
    };
    let level = 1;
    openLevel(1);
    for (;;) {
      const room = poolUsd - spent;
      let best: number | null = null;
      for (const c of cands) {
        if (c === held || isPicked.has(c) || costs[c] > room) continue;
        const s = support.get(c)!;
        if (s < costs[c]) continue;
        if (
          best === null || s > support.get(best)! ||
          (s === support.get(best)! && costs[c] < costs[best])
        ) best = c;
      }
      visit({ room, support, best });
      if (best !== null) {
        pay(best);
        continue;
      }
      if (level >= lastLevel) break;
      level += 1;
      openLevel(level);
    }
    for (const c of picked) done.add(c);
    endStage(picked);
  }
}

/** Whether `c`, its support tied with `b`'s, loses the tie with the ask `ask`: a smaller
 * ask wins it, then the earlier manifest index. */
const losesTie = (inp: ChainInputs, c: number, ask: bigint, b: number) =>
  ask > inp.costs[b] || (ask === inp.costs[b] && c > b);

/** The largest ask with which `c` would be picked at point `p` (0n: none). */
function askAt(inp: ChainInputs, c: number, p: Point): bigint {
  const s = p.support.get(c)!;
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  if (p.best === null) return min(s, p.room);
  const sb = p.support.get(p.best)!;
  if (s > sb) return min(s, p.room);
  if (s < sb) return 0n;
  // A tie: an ask below the rival's wins it, and one equal to it when c comes first.
  return min(min(s, p.room), inp.costs[p.best] - (c < p.best ? 0n : 1n));
}

/** The least extra backing with which `c`, its ask unchanged, would be picked at point
 * `p`; null when its ask doesn't fit what's left of the pool there. */
function backingAt(inp: ChainInputs, c: number, p: Point): bigint | null {
  const C = inp.costs[c];
  if (C > p.room) return null;
  const s = p.support.get(c)!;
  let x = C - s;
  if (p.best !== null) {
    const beat = p.support.get(p.best)! - s + (losesTie(inp, c, C, p.best) ? 1n : 0n);
    if (beat > x) x = beat;
  }
  return x > 0n ? x : 0n;
}

/** Neither settled, withdrawn nor covered (asking $0): a candidate in every stage until
 * it is picked. */
const open = (inp: ChainInputs, c: number) =>
  !inp.done.has(c) && !inp.withdrawn.has(c) && inp.costs[c] > 0n;

/** The largest ask (micro-USD) with which `c` would be picked in a stage from `first` up
 * to `upTo`, all else as in `inp`: a donation of at least `cost − it` (and below its cost)
 * gets it in, a smaller one doesn't. At or above its cost: the tally picks it already.
 * 0n: no donation short of its whole ask does. */
export function maxWinningAsk(inp: ChainInputs, first: number, c: number, upTo: number): bigint {
  if (!open(inp, c)) return 0n;
  let q = 0n;
  trace(inp, first, upTo, c, (p) => {
    const at = askAt(inp, c, p);
    if (at > q) q = at;
  });
  return q;
}

/** The least weight (micro-USD) of a made-up voter backing only `c`, at the first rank,
 * with which `c` would be picked in a stage from `first` up to `upTo` (the ballots, and so
 * the stage bounds, unchanged). 0n: the tally picks it already. Null: no backing does
 * (its ask never fits what's left of the pool, or it isn't open). */
export function minExtraBacking(
  inp: ChainInputs,
  first: number,
  c: number,
  upTo: number,
): bigint | null {
  if (!open(inp, c)) return null;
  let x: bigint | null = null;
  trace(inp, first, upTo, c, (p) => {
    const at = backingAt(inp, c, p);
    if (at !== null && (x === null || at < x)) x = at;
  });
  return x;
}

/** Both thresholds through one stage (see maxWinningAsk, minExtraBacking). */
export type Entry = { ask: bigint; backing: bigint | null };

/** Every open initiative's thresholds from one run of the tally: as long as the tally
 * hasn't picked an initiative, holding it out changes nothing, so its points are this
 * run's. Keyed by initiative; entry k is through stage `first + k` (as
 * `maxWinningAsk(inp, first, c, first + k + 1)` and `minExtraBacking` give them), for
 * every stage before the one that picks it. Settled, withdrawn and covered initiatives
 * have none. */
export function entries(inp: ChainInputs, first: number, upTo: number): Map<number, Entry[]> {
  const out = new Map<number, Entry[]>();
  const now = new Map<number, Entry>();
  for (let c = 0; c < inp.m; c++) {
    if (!open(inp, c)) continue;
    out.set(c, []);
    now.set(c, { ask: 0n, backing: null });
  }
  trace(inp, first, upTo, null, (p) => {
    for (const [c, e] of now) {
      if (c === p.best) continue; // picked here: its threshold is its whole ask
      const ask = askAt(inp, c, p);
      if (ask > e.ask) e.ask = ask;
      const backing = backingAt(inp, c, p);
      if (backing !== null && (e.backing === null || backing < e.backing)) e.backing = backing;
    }
  }, (picked) => {
    for (const c of picked) now.delete(c);
    for (const [c, e] of now) out.get(c)!.push({ ...e });
  });
  return out;
}
