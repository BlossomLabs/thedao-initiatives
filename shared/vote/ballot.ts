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
