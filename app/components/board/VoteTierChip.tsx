import type { Tier } from "@shared/devcon/ballot";

/** A live tally's result tier, styled like the other funding chips. */
export default function VoteTierChip({ tier }: { tier: Tier }) {
  return (
    <span
      className="chip flex-none whitespace-nowrap border-vote/40 bg-vote/10 text-vote"
      title={`Funded in the ${tier} tier of the current vote result`}
    >
      {tier}-TIER
    </span>
  );
}
