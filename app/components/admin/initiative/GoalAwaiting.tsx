/** A ballot initiative's new goal waiting for a round admin to sign it (#149): the goal
 * it replaces struck through, the new one, who asked and when, and Discard where the
 * page can drop it. */
import { Button } from "~/components/ui/Button";
import { AwaitingChip } from "~/components/admin/initiative/Pledges";
import type { GoalRequestJson } from "~/lib/api-types";
import { dayTime, shortAddr, usd } from "~/lib/format";

export default function GoalAwaiting(
  { request, current, onDiscard, className = "" }: {
    request: GoalRequestJson;
    /** The goal the page has now (and the round). */
    current: number;
    onDiscard?: () => void;
    className?: string;
  },
) {
  return (
    <div
      role="group"
      aria-label="New goal awaiting signature"
      className={`flex items-center gap-4 rounded-xl border border-white/15 bg-white/[.04] px-4 py-3 ${className}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-inter-tight text-[11px] font-semibold uppercase tracking-[.4px] text-white/60">
            New goal
          </span>
          <AwaitingChip />
        </div>
        <div className="mt-1 font-inter-tight text-[17px]">
          <span className="text-white/45 line-through">{usd(current)}</span>
          <span aria-hidden="true" className="mx-1.5 text-white/45">→</span>
          <b className="font-semibold text-white">{usd(request.goalUsd)}</b>
        </div>
        {request.by && (
          <div className="small dim mt-0.5">
            Asked by {shortAddr(request.by)} · {dayTime(request.at)}
          </div>
        )}
      </div>
      {onDiscard && (
        <Button sm variant="ghost" aria-label="Discard the goal change" onClick={onDiscard}>
          Discard
        </Button>
      )}
    </div>
  );
}
