import { type Tier, tierName } from "@shared/vote/ballot";

/** An initiative an admin withdrew from the vote: in no tier, funded by no one. */
export function WithdrawnChip() {
  return (
    <span
      className="chip flex-none whitespace-nowrap border-dao-red-pale/40 bg-dao-red/10 text-dao-red-pale"
      title="Withdrawn from the vote by an admin"
    >
      Withdrawn
    </span>
  );
}

/** A live tally's result tier, styled like the other funding chips. */
export default function VoteTierChip({ tier }: { tier: Tier }) {
  return (
    <span
      className="chip flex-none whitespace-nowrap border-vote/40 bg-vote/10 text-vote"
      title={`Funded in ${tierName(tier)} of the current vote result`}
    >
      {tierName(tier)}
    </span>
  );
}
