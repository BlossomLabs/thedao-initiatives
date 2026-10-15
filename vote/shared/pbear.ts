// Integer-exact PB-EAR transcript generation and public replay, ported from reference/pbear.py.
const NONE = (1n << 64n) - 1n;
import { effectiveRanks, validate } from "./ranks";

export type Entry = { weight: bigint; ballot: number[] | null };

export function cumulativeDeductions(
  weights: bigint[],
  thr: bigint,
  total?: bigint,
  start = 0n,
): bigint[] {
  const t = total ?? weights.reduce((a, b) => a + b, 0n);
  const out: bigint[] = [];
  let cum = start;
  for (const w of weights) {
    const next = cum + w;
    out.push((next * thr) / t - (cum * thr) / t);
    cum = next;
  }
  return out;
}

function ranksOf(entries: Entry[], m: number): (number[] | null)[] {
  return entries.map((e) => {
    if (e.ballot === null) return null;
    if (!validate(e.ballot, m)) throw new Error("invalid ballot");
    return effectiveRanks(e.ballot, m);
  });
}

function support(
  weights: bigint[],
  ranks: (number[] | null)[],
  indices: number[],
  funded: boolean[],
  level: number,
  m: number,
): bigint[] {
  const s = new Array<bigint>(m).fill(0n);
  for (const i of indices) {
    const r = ranks[i];
    if (r === null || weights[i] === 0n) continue;
    for (let c = 0; c < m; c++) {
      if (!funded[c] && r[c] <= level) s[c] += weights[i];
    }
  }
  return s;
}

function argmax(
  costs: bigint[],
  sum: bigint[],
  funded: boolean[],
): number | null {
  let best: number | null = null;
  for (let c = 0; c < costs.length; c++) {
    if (funded[c] || sum[c] < costs[c]) continue;
    if (
      best === null || sum[c] > sum[best] ||
      (sum[c] === sum[best] && costs[c] < costs[best])
    ) best = c;
  }
  return best;
}

export function pbearTranscript(
  costs: bigint[],
  pub: Entry[],
  sealed: Entry[],
  budget: bigint,
): { funded: number[]; transcript: bigint[][] } {
  const m = costs.length;
  const entries = [...pub, ...sealed];
  const weights = entries.map((e) => e.weight);
  if (weights.reduce((a, b) => a + b, 0n) > budget) {
    throw new Error("entry weights exceed the budget");
  }
  const ranks = ranksOf(entries, m);
  const pubIdx = pub.map((_, i) => i);
  const sealedIdx = sealed.map((_, i) => pub.length + i);
  const funded: number[] = [];
  const isFunded = new Array<boolean>(m).fill(false);
  let spent = 0n;
  let level = 1;
  const transcript: bigint[][] = [];
  const exhausted = () =>
    costs.every((c, i) => isFunded[i] || spent + c > budget);
  while (!exhausted()) {
    const ps = support(weights, ranks, pubIdx, isFunded, level, m);
    const ss = support(weights, ranks, sealedIdx, isFunded, level, m);
    const sum = ps.map((p, c) => p + ss[c]);
    const best = argmax(costs, sum, isFunded);
    if (best === null) {
      transcript.push([BigInt(level), ...ps, NONE, 0n]);
      if (level >= m) break;
      level++;
      continue;
    }
    transcript.push([BigInt(level), ...ps, BigInt(best), sum[best]]);
    const supporters = entries.map((_, i) => i).filter((i) =>
      ranks[i] !== null && weights[i] !== 0n && ranks[i]![best] <= level
    );
    const ded = cumulativeDeductions(
      supporters.map((i) => weights[i]),
      costs[best],
    );
    supporters.forEach((i, j) => (weights[i] -= ded[j]));
    isFunded[best] = true;
    funded.push(best);
    spent += costs[best];
  }
  if (transcript.length > 2 * m) {
    throw new Error("transcript longer than 2m steps");
  }
  return { funded, transcript };
}

/** Replay the public block against a transcript using only public data. */
export function replayPublic(
  costs: bigint[],
  pub: Entry[],
  transcript: bigint[][],
  budget: bigint,
): boolean {
  const m = costs.length;
  const weights = pub.map((e) => e.weight);
  let ranks: (number[] | null)[];
  try {
    ranks = ranksOf(pub, m);
  } catch {
    return false;
  }
  const isFunded = new Array<boolean>(m).fill(false);
  let spent = 0n;
  let level: number | null = 1;
  const exhausted = () =>
    costs.every((c, i) => isFunded[i] || spent + c > budget);
  const all = pub.map((_, i) => i);
  for (const step of transcript) {
    if (step.length !== m + 3 || level === null || exhausted()) return false;
    const [lv, ...rest] = step;
    const ps = rest.slice(0, m);
    const best = rest[m];
    const total = rest[m + 1];
    if (Number(lv) !== level) return false;
    const expected = support(weights, ranks, all, isFunded, level, m);
    if (ps.some((p, c) => p !== expected[c])) return false;
    if (best === NONE) {
      if (total !== 0n || ps.some((p, c) => !isFunded[c] && p >= costs[c])) {
        return false;
      }
      if (level >= m) level = null;
      else level++;
      continue;
    }
    const b = Number(best);
    if (b < 0 || b >= m || isFunded[b]) return false;
    if (total < costs[b] || total < ps[b] || spent + costs[b] > budget) {
      return false;
    }
    const sup = all.filter((i) =>
      ranks[i] !== null && weights[i] !== 0n && ranks[i]![b] <= level!
    );
    const ded = cumulativeDeductions(
      sup.map((i) => weights[i]),
      costs[b],
      total,
    );
    sup.forEach((i, j) => (weights[i] -= ded[j]));
    isFunded[b] = true;
    spent += costs[b];
  }
  return level === null ? true : exhausted();
}
