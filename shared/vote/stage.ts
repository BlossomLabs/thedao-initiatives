/** The quiet ending's stage tally, ported line for line from the Python reference
 * (vote/reference/quiet_ending.py `_ear`, quiet_ending_steps.py `tier_levels`,
 * `bound`, `tier_of`) and checked against fixtures it writes
 * (vote/reference/export_stage_fixtures.py). Amounts are micro-USD bigints.
 * Browser and Deno. */
/** pbear's cumulative_deductions: `thr` deducted from `weights` in proportion,
 * integer-exact (vote/shared/pbear.ts has the same; that module only loads in the
 * browser, and this one runs on the server too). */
export function cumulativeDeductions(weights: bigint[], thr: bigint): bigint[] {
  const total = weights.reduce((a, b) => a + b, 0n);
  const out: bigint[] = [];
  let cum = 0n;
  for (const w of weights) {
    const next = cum + w;
    out.push((next * thr) / total - (cum * thr) / total);
    cum = next;
  }
  return out;
}

const WITHHELD = 255;

export type StageResult = { order: number[]; shares: Map<number, Map<number, bigint>> };

/** Expanding approvals over `candidates`, starting from `weights` (mutated) and
 * `spent`, stopping once nothing more can be funded at `maxLevel`. `ranks` are
 * effective ranks; a rank above the last level (withheld) never opens. */
export function stageTally(
  costs: bigint[],
  weights: bigint[],
  ranks: (number[] | null)[],
  budget: bigint,
  spent: bigint,
  candidates: number[],
  maxLevel: number,
): StageResult {
  const m = costs.length;
  const lastLevel = Math.min(m, maxLevel);
  const cands = [...candidates].sort((a, b) => a - b);
  const opens: [number, number][][] = Array.from({ length: m + 2 }, () => []);
  ranks.forEach((r, i) => {
    if (!r) return;
    for (const c of cands) if (r[c] <= m + 1) opens[r[c]].push([i, c]);
  });
  const approved: number[][] = ranks.map(() => []);
  const approvers = new Map<number, number[]>(cands.map((c) => [c, []]));
  const support = new Map<number, bigint>(cands.map((c) => [c, 0n]));
  const done = new Set<number>();
  const order: number[] = [];
  const shares = new Map<number, Map<number, bigint>>();

  const openLevel = (level: number) => {
    for (const [i, c] of opens[level]) {
      approved[i].push(c);
      approvers.get(c)!.push(i);
      support.set(c, support.get(c)! + weights[i]);
    }
  };
  const pay = (c: number, payers: number[], amount: bigint) => {
    const deductions = amount ? cumulativeDeductions(payers.map((i) => weights[i]), amount) : [];
    const paid = new Map<number, bigint>();
    payers.forEach((i, k) => {
      if (k >= deductions.length) return;
      const d = deductions[k];
      weights[i] -= d;
      paid.set(i, d);
      for (const other of approved[i]) {
        if (support.has(other)) support.set(other, support.get(other)! - d);
      }
    });
    shares.set(c, paid);
    done.add(c);
    order.push(c);
  };

  let level = 1;
  openLevel(1);
  for (;;) {
    const room = budget - spent;
    const fitting = cands.filter((c) => !done.has(c) && costs[c] <= room);
    if (fitting.length === 0) break;
    let best: number | null = null;
    for (const c of fitting) {
      const s = support.get(c)!;
      if (s < costs[c]) continue;
      if (
        best === null || s > support.get(best)! ||
        (s === support.get(best)! && costs[c] < costs[best])
      ) best = c;
    }
    if (best === null) {
      if (level >= lastLevel) break;
      level += 1;
      openLevel(level);
      continue;
    }
    pay(
      best,
      approvers.get(best)!.filter((i) => weights[i] > 0n).sort((a, b) => a - b),
      costs[best],
    );
    spent += costs[best];
  }
  return { order, shares };
}

/** For each of the first `tiers` tiers, the rank level at which the last voter's tier
 * opens (null if no ballot has that many tiers). Withheld is no tier. */
export function tierLevels(ballots: (number[] | null)[], tiers: number): (number | null)[] {
  const distinct = ballots.filter((b): b is number[] => b !== null).map((b) =>
    [...new Set(b.filter((r) => r !== 0 && r !== WITHHELD))].sort((x, y) => x - y)
  );
  return Array.from({ length: tiers }, (_, t) => {
    const at = distinct.filter((r) => r.length > t).map((r) => r[t]);
    return at.length ? Math.max(...at) : null;
  });
}

/** The level stage `stage` counts to: where every voter's tier `stage` has opened
 * (level 1 at least), and the last level for the stage after the tiers. */
export function stageBound(
  ballots: (number[] | null)[],
  stage: number,
  tiers: number,
  m: number,
): number {
  if (stage >= tiers) return m;
  let highest = 1;
  for (const level of tierLevels(ballots, tiers).slice(0, stage + 1)) {
    if (level !== null) highest = Math.max(highest, level);
  }
  return highest;
}

/** Which tier of `ballot` holds proposal `c`: 0 for the first distinct rank;
 * withheld, unplaced or no ballot comes after every tier. */
export function tierOf(ballot: number[] | null, c: number): number {
  if (!ballot || ballot[c] === 0 || ballot[c] === WITHHELD) return (ballot?.length ?? 0) + 1;
  return [...new Set(ballot.filter((r) => r !== 0 && r !== WITHHELD))]
    .sort((x, y) => x - y).indexOf(ballot[c]);
}
