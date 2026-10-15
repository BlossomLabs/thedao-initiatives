/** Ballot byte for an unranked project the voter's money must not fund (PBEAR.WITHHELD). */
export const WITHHELD = 255;

export function pack(ranks: number[]): bigint {
  return ranks.reduce((acc, r, c) => acc + (BigInt(r) << BigInt(8 * c)), 0n);
}

/** Competition-ranking check, identical to PBEAR._setBallot. Withheld projects are not ranked. */
export function validate(ranks: number[], m: number): boolean {
  if (
    ranks.length !== m || m >= WITHHELD ||
    ranks.some((r) => r !== WITHHELD && (!Number.isInteger(r) || r < 0 || r > m))
  ) return false;
  const counts = new Array<number>(m + 1).fill(0);
  for (const r of ranks) if (r !== WITHHELD) counts[r]++;
  let seen = 0;
  for (let r = 1; r <= m; r++) {
    if (counts[r] !== 0 && r !== seen + 1) return false;
    seen += counts[r];
  }
  return true;
}

export function unpack(packed: bigint, m: number): number[] | null {
  if (packed < 0n || packed >= 1n << BigInt(8 * m)) return null;
  const ranks: number[] = [];
  for (let c = 0; c < m; c++) {
    ranks.push(Number((packed >> BigInt(8 * c)) & 0xffn));
  }
  return validate(ranks, m) ? ranks : null;
}

/** A withheld project keeps its mark, which is above every rank level, so it is never supported. */
export function effectiveRanks(ranks: number[], m: number): number[] {
  const def = 1 +
    ranks.slice(0, m).filter((r) => r !== 0 && r !== WITHHELD).length;
  return ranks.map((r) => (r === 0 ? def : r));
}
