import type { Tier } from "@shared/vote/ballot";
import { FundedChip } from "~/components/ui/Badge";
import VoteTierChip from "~/components/board/VoteTierChip";

/** The funding-status slot: a DAO result tier, or the usual Funded chip. */
export default function FundingStatus({ tier, byVote = false }: { tier?: Tier; byVote?: boolean }) {
  const label = byVote ? "Funded with the vote" : "Fully funded from existing support";
  return (
    <span className="inline-flex flex-none items-center align-middle text-dao-green" title={label}>
      {byVote && tier ? <VoteTierChip tier={tier} /> : <FundedChip />}
      <span className="sr-only">{label}</span>
    </span>
  );
}
