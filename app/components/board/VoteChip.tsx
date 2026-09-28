import { type VoteSettings, voteState } from "@shared/vote";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";

/** Vote eligibility for one initiative (placeholder copy, behind the flag). */
export default function VoteChip(
  { raised, goal, vote, className }: {
    raised: number;
    goal: number;
    vote: VoteSettings;
    className?: string;
  },
) {
  const s = voteState(raised, goal, vote);
  const base =
    "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 font-inter-tight text-[11.5px] font-semibold";
  if (s.kind === "below") {
    return (
      <span className={cn(base, "border-white/20 text-white/60", className)}>
        {usd(s.toFloorUsd)} to vote floor
      </span>
    );
  }
  if (s.kind === "gap") {
    return (
      <span
        className={cn(base, "border-[rgba(240,180,41,.5)] text-dao-amber", className)}
        title={`Raised ${usd(raised)} of ${usd(goal)}: ${usd(s.gapUsd)} still to raise, above the ${
          usd(s.capUsd)
        } cap.`}
      >
        Eligible, gap above cap
      </span>
    );
  }
  return (
    <span className={cn(base, "border-[rgba(92,183,90,.5)] text-dao-green", className)}>
      Vote-eligible
    </span>
  );
}
