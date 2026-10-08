import { Trophy } from "lucide-react";
import Bar from "~/components/ui/Bar";
import { Check } from "lucide-react";
import { calloutLabel, calloutText, voteStanding } from "~/components/board/VoteMark";
import { voteFloorPct, voteFloorUsd, type VoteSettings } from "@shared/vote";
import Money from "~/components/ui/Money";
import type { Summary } from "~/lib/api-types";
import { pctText, usd } from "~/lib/format";

export default function FundingHead(
  { summary, goal, pct, funded, vote }: {
    summary: Summary;
    goal: number;
    pct: number;
    funded: boolean;
    /** Where it stands for TheDAO's vote, while the display is on (approved initiatives). */
    vote?: VoteSettings;
  },
) {
  const standing = vote?.show ? voteStanding(summary.total, goal, vote) : null;
  const split = (
    <div className="mt-2.5 flex flex-wrap gap-[26px] text-[13px] text-muted">
      {funded && (
        <span>
          <b className="text-white">
            <Money value={summary.total} />
          </b>{" "}
          raised of {usd(goal)}
        </span>
      )}
      <span>
        <b className="text-white">
          <Money value={summary.pledged} />
        </b>{" "}
        pledged by backers
      </span>
      <span>
        <b className="text-white">
          <Money value={summary.donated} />
        </b>{" "}
        donated on-chain
      </span>
      {summary.paidOut > 0 && (
        <span>
          <b className="text-white">
            <Money value={summary.paidOut} />
          </b>{" "}
          already paid to the team
        </span>
      )}
      {!funded && (
        <span className="inline-flex flex-wrap items-center gap-x-2.5">
          <span>
            <b className="text-white">{pctText(pct)}</b> of goal
          </span>
          {standing && (
            // The board's callout words, beside the % they are about.
            <span className="inline-flex items-center gap-1 font-semibold text-white">
              {standing.kind === "eligible" && (
                <Check className="size-3.5 text-dao-green" strokeWidth={3} aria-hidden="true" />
              )}
              <span aria-hidden="true">{calloutLabel(standing)}</span>
              <span className="sr-only">{calloutText(standing)}</span>
            </span>
          )}
        </span>
      )}
    </div>
  );
  if (funded) {
    return (
      <>
        <div className="mb-2.5 rounded-[10px] border border-[rgba(92,183,90,.5)] bg-gradient-to-r from-[rgba(92,183,90,.25)] to-[rgba(0,255,136,.12)] px-[18px] py-3.5 font-inter-tight text-[16px] font-semibold text-dao-green">
          <Trophy className="mr-2 inline size-[18px] align-[-3px]" />Funded! This initiative reached
          its goal.
        </div>
        {split}
      </>
    );
  }
  return (
    <div className="panel mt-2 px-6">
      <div className="font-inter-tight text-[26px] font-light">
        <b className="font-bold">
          <Money value={summary.total} />
        </b>{" "}
        <span className="text-muted">of {usd(goal)}</span>
      </div>
      <Bar pct={pct} big tick={standing ? voteFloorPct(goal, vote!) : undefined} />
      {split}
      {standing && (
        // Once, where people read: what it takes to qualify and for what.
        <p className="m-0 mt-2.5 text-[12.5px] text-muted">
          {goal - vote!.capUsd > (goal * vote!.floorPct) / 100
            // A large goal: the floor is the goal less what TheDAO distributes at most.
            ? `This initiative qualifies for TheDAO's vote at ${
              usd(voteFloorUsd(goal, vote!))
            }: TheDAO distributes at most ${usd(vote!.capUsd)} to one initiative.`
            : `An initiative qualifies for TheDAO's vote at ${vote!.floorPct}% of its goal.`}
        </p>
      )}
    </div>
  );
}
