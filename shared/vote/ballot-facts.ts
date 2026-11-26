/** On the ballot the round leads (#149): the words the site and the API use when a fact
 * the round contract stores can only change there. */
import { type Tier, tierName } from "./ballot.ts";

export const ON_BALLOT = "On the ballot: a round admin changes this on the round.";

/** Why a ballot initiative's goal can't change any more (#149), or null: it settled (its
 * award is final) or was withdrawn. `standing` is the round's, in slot order; unknown
 * (null) stops nothing here (signing still waits for it). */
export function goalStop(
  standing: { withdrawn: boolean; settledIn: Tier | null }[] | null,
  slot: number,
): string | null {
  const x = standing?.[slot];
  if (x?.settledIn) return settledGoalText(x.settledIn);
  if (x?.withdrawn) return WITHDRAWN_GOAL;
  return null;
}

export const settledGoalText = (tier: Tier) =>
  `Settled in ${tierName(tier)}: its award is final, so its goal stays.`;
export const WITHDRAWN_GOAL = "Withdrawn from the vote: undo the withdrawal to change its goal.";
