import { VoteTick } from "~/components/board/VoteMark";
import { cn } from "~/lib/utils";

const clamp = (x: number) => Math.max(0, Math.min(100, x));

/** Where the vote's share sits on a bar after the raised part: the settled money,
 * then the settling tier's "if it settled now" (part of `votePct`), each capped at
 * the end of the bar. Null when there is nothing to draw. */
export function voteSegments(pct: number, votePct = 0, pendingPct = 0) {
  const raised = clamp(pct);
  if (votePct <= 0 || raised >= 100) return null;
  const pending = Math.min(Math.max(0, pendingPct), votePct);
  const settled = Math.min(votePct - pending, 100 - raised);
  const left = raised + settled;
  return {
    settled: settled > 0 ? { left: `${raised}%`, width: `${settled}%` } : null,
    pending: pending > 0 && left < 100
      ? { left: `${left}%`, width: `${Math.min(pending, 100 - left)}%` }
      : null,
  };
}

/** Progress bar; `tick` marks the vote floor (a percentage), `label` is what a screen reader hears. */
export default function Bar(
  { pct, big, tick, label, className, children, votePct, votePendingPct }: {
    pct: number;
    /** The vote's share (% of the goal), drawn in gold after the raised part. */
    votePct?: number;
    /** The part of `votePct` a settling tier would add if it settled now (lighter gold). */
    votePendingPct?: number;
    /** Drawn over the bar with the tick (the vote callout). */
    children?: React.ReactNode;
    big?: boolean;
    tick?: number;
    label?: string;
    className?: string;
  },
) {
  const seg = voteSegments(pct, votePct, votePendingPct);
  const bar = (
    <div
      className={cn(
        "bar",
        big && "bar-big",
        votePct !== undefined && "relative",
        tick === undefined && className,
      )}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={label}
    >
      <i style={{ width: `${clamp(pct)}%` }} />
      {seg?.settled && (
        <span
          data-vote-fill
          className="absolute inset-y-0 min-w-[2px] rounded-full bg-vote shadow-bar transition-[left,width] duration-700 ease-out motion-reduce:transition-none"
          style={seg.settled}
        />
      )}
      {seg?.pending && (
        <span
          data-vote-pending
          className="absolute inset-y-0 min-w-[2px] rounded-full bg-vote/45 transition-[left,width] duration-700 ease-out motion-reduce:transition-none"
          style={seg.pending}
        />
      )}
    </div>
  );
  if (tick === undefined) return bar;
  return (
    <div className={cn("relative", big && "max-w-[760px]", className)}>
      {bar}
      <VoteTick at={tick} reached={pct >= tick} />
      {children}
    </div>
  );
}
