/** Tier ballots as the contract stores them: one byte per initiative, competition
 * ranks for placed initiatives (S first, then A, then B), 255 = withheld. Byte 0
 * reverts on-chain, so it is never produced. */

export type Tier = "S" | "A" | "B";
export const TIERS: readonly Tier[] = ["S", "A", "B"];
/** A tier in running text: "S-Tier". The letter stands alone only in the tier table. */
export const tierName = (t: Tier): string => `${t}-Tier`;
export const WITHHELD = 255;

export function encodeBallot(
  slugs: string[],
  tiers: Partial<Record<string, Tier>>,
): Uint8Array {
  const rank = new Map<Tier, number>();
  let next = 1;
  for (const t of TIERS) {
    rank.set(t, next);
    next += slugs.filter((s) => tiers[s] === t).length;
  }
  return Uint8Array.from(slugs, (s) => {
    const t = tiers[s];
    return t && rank.has(t) ? rank.get(t)! : WITHHELD;
  });
}

/** The tiers a voter sends: an initiative an admin withdrew is left out of the open tiers,
 * and kept in a `settled` one (the supporter lock needs that tier's set unchanged). The
 * ranks below a dropped one move up to close the gap, as `encodeBallot` counts only what
 * is placed: blanking its byte alone would break the competition ranks. Except where
 * dropping would empty an open tier while a lower one still has picks: those picks would
 * then count a tier higher than the voter put them, so the withdrawn ones stay there as
 * a placeholder (the tally gives them nothing, so they cost the voter nothing). The same
 * object when nothing is dropped. */
export function sendableTiers(
  tiers: Partial<Record<string, Tier>>,
  withdrawn: ReadonlySet<string>,
  settled: ReadonlySet<Tier>,
): Partial<Record<string, Tier>> {
  const entries = Object.entries(tiers).filter((e): e is [string, Tier] => e[1] !== undefined);
  const dropped = new Set<string>();
  // From B-Tier up, so "a lower tier still has picks" counts what is sent there.
  let below = false;
  for (const t of [...TIERS].reverse()) {
    const inTier = entries.filter(([, x]) => x === t).map(([slug]) => slug);
    const out = settled.has(t) ? [] : inTier.filter((slug) => withdrawn.has(slug));
    const placeholder = out.length === inTier.length && out.length > 0 && below;
    if (!placeholder) { for (const slug of out) dropped.add(slug); }
    if (inTier.length > (placeholder ? 0 : out.length)) below = true;
  }
  if (!dropped.size) return tiers;
  return Object.fromEntries(Object.entries(tiers).filter(([slug]) => !dropped.has(slug)));
}

/** A fresh draft (from ratings, or pasted): every withdrawn initiative left out, with no
 * placeholder. Nothing on it was counted yet, so nothing needs keeping: an emptied tier
 * says so and asks the voter to choose. The same object when nothing is withdrawn. */
export function freshDraft(
  tiers: Partial<Record<string, Tier>>,
  withdrawn: ReadonlySet<string>,
): Partial<Record<string, Tier>> {
  if (!Object.keys(tiers).some((slug) => withdrawn.has(slug))) return tiers;
  return Object.fromEntries(Object.entries(tiers).filter(([slug]) => !withdrawn.has(slug)));
}

/** The bytes a voter sends: `sendableTiers`, encoded. */
export const sendableBallot = (
  slugs: string[],
  tiers: Partial<Record<string, Tier>>,
  withdrawn: ReadonlySet<string>,
  settled: ReadonlySet<Tier>,
): Uint8Array => encodeBallot(slugs, sendableTiers(tiers, withdrawn, settled));

export function decodeBallot(bytes: Uint8Array, slugs: string[]): Partial<Record<string, Tier>> {
  // Lossy when a higher tier is empty (an A-only ballot reads back as S); the
  // order, which is all the tally uses, always survives.
  const counts = (r: number) => [...bytes].filter((b) => b === r).length;
  const out: Partial<Record<string, Tier>> = {};
  // Recover which tier each rank is: rank r is S if r = 1, A if r = 1 + |S|, else B.
  const sCount = counts(1);
  const tierOf = (r: number): Tier => {
    if (r === 1) return "S";
    if (r === 1 + sCount) return "A";
    return "B";
  };
  slugs.forEach((s, i) => {
    if (i < bytes.length && bytes[i] !== WITHHELD) out[s] = tierOf(bytes[i]);
  });
  return out;
}

/** Exact port of SignedBallots._validateBallot. */
export function isValidOnchainBallot(bytes: Uint8Array, m: number): boolean {
  if (bytes.length !== m) return false;
  const counts = new Array<number>(m + 1).fill(0);
  for (const rank of bytes) {
    if (rank === WITHHELD) continue;
    if (rank === 0 || rank > m) return false;
    counts[rank]++;
  }
  let seen = 0;
  for (let rank = 1; rank <= m; rank++) {
    if (counts[rank] !== 0 && rank !== seen + 1) return false;
    seen += counts[rank];
  }
  return true;
}
