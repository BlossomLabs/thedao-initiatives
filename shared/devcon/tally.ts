import { pbearTranscript } from "../../vote/shared/pbear";

export type TallyCard = { slug: string; goalUsd: number; total: number };
export type DevconTally = {
  /** USD the vote would give each initiative if voting closed now (0 = not funded). */
  bySlug: Map<string, number>;
  fundedUsd: number;
  ballots: number;
};

const MICRO = 1_000_000;

/** "If voting closed now": one PB-EAR tally of the latest ballots. Each initiative
 * costs what it still needs (goal − raised, as the homepage shows them); the pool
 * is split equally between ballots. Browser-only (vote/shared imports are
 * extensionless). */
export function devconTally(
  cards: TallyCard[],
  ballots: Uint8Array[],
  slugs: string[],
  poolUsd: bigint,
): DevconTally {
  const bySlug = new Map<string, number>(slugs.map((s) => [s, 0]));
  if (ballots.length === 0) return { bySlug, fundedUsd: 0, ballots: 0 };
  const card = new Map(cards.map((c) => [c.slug, c]));
  const costs = slugs.map((s) => {
    const c = card.get(s);
    if (!c) return 0n;
    return BigInt(Math.max(0, Math.round((c.goalUsd - c.total) * MICRO)));
  });
  const weight = poolUsd / BigInt(ballots.length);
  const { funded } = pbearTranscript(
    costs,
    ballots.map((b) => ({ weight, ballot: [...b] })),
    [],
    poolUsd,
  );
  let fundedUsd = 0;
  for (const i of funded) {
    const usd = Number(costs[i]) / MICRO;
    bySlug.set(slugs[i], usd);
    fundedUsd += usd;
  }
  return { bySlug, fundedUsd, ballots: ballots.length };
}
