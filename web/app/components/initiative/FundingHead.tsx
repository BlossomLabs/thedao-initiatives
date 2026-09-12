import { Trophy } from "lucide-react";
import Bar from "~/components/ui/Bar";
import type { Summary } from "~/lib/api-types";
import { pctText, usd } from "~/lib/format";

export default function FundingHead(
  { summary, goal, pct, funded }: { summary: Summary; goal: number; pct: number; funded: boolean },
) {
  const split = (
    <div className="mt-2.5 flex flex-wrap gap-[26px] text-[13px] text-muted">
      {funded && (
        <span>
          <b className="text-white">{usd(summary.total)}</b> raised of {usd(goal)}
        </span>
      )}
      <span>
        <b className="text-white">{usd(summary.pledged)}</b> pledged by backers
      </span>
      <span>
        <b className="text-white">{usd(summary.donated)}</b> donated on-chain
      </span>
      {summary.paidOut > 0 && (
        <span>
          <b className="text-white">{usd(summary.paidOut)}</b> already paid to the team
        </span>
      )}
      {!funded && (
        <span>
          <b className="text-white">{pctText(pct)}</b> of goal
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
        <b className="font-bold">{usd(summary.total)}</b>{" "}
        <span className="text-muted">of {usd(goal)}</span>
      </div>
      <Bar pct={pct} big />
      {split}
    </div>
  );
}
