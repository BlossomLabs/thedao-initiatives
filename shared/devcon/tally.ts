import { pbearTranscript } from "../../vote/shared/pbear";
import { type Tier, WITHHELD } from "./ballot";

export type TallyCard = { slug: string; goalUsd: number; total: number };
export type DevconTally = {
  /** USD the vote would give each initiative if voting closed now (0 = not funded). */
  bySlug: Map<string, number>;
  /** Result stage in which a positive USD award was funded; not a settled quiet-ending tier. */
  tierBySlug: Map<string, Tier>;
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
  const tierBySlug = new Map<string, Tier>();
  if (ballots.length === 0) return { bySlug, tierBySlug, fundedUsd: 0, ballots: 0 };
  const card = new Map(cards.map((c) => [c.slug, c]));
  const costs = slugs.map((s) => {
    const c = card.get(s);
    if (!c) return 0n;
    return BigInt(Math.max(0, Math.round((c.goalUsd - c.total) * MICRO)));
  });
  const weight = poolUsd / BigInt(ballots.length);
  const { funded, transcript } = pbearTranscript(
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
  // Match the result stages in quiet_ending_steps.py's tier_levels/bound:
  // S ends at level 1; A ends once every ballot's second tier has opened.
  // Competition ranks count proposals, not tiers, so A can open above level 2.
  // A short ballot's B choices can already contribute during the result's A stage.
  const aLevel = ballots.reduce((highest, ballot) => {
    const ranks = [...new Set(ballot)].filter((r) => r !== WITHHELD).sort((a, b) => a - b);
    return Math.max(highest, ranks[1] ?? 1);
  }, 1);
  for (const step of transcript) {
    const index = Number(step[costs.length + 1]);
    if (index >= slugs.length || costs[index] === 0n) continue; // no award at this step
    const level = Number(step[0]);
    tierBySlug.set(slugs[index], level === 1 ? "S" : level <= aLevel ? "A" : "B");
  }
  return { bySlug, tierBySlug, fundedUsd, ballots: ballots.length };
}
