import { VoteTick } from "~/components/board/VoteMark";
import { cn } from "~/lib/utils";

/** Progress bar; `tick` marks the vote floor (a percentage), `label` is what a screen reader hears. */
export default function Bar(
  { pct, big, tick, label, className, children }: {
    pct: number;
    /** Drawn over the bar with the tick (the vote callout). */
    children?: React.ReactNode;
    big?: boolean;
    tick?: number;
    label?: string;
    className?: string;
  },
) {
  const bar = (
    <div
      className={cn("bar", big && "bar-big", tick === undefined && className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={label}
    >
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
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
