import { cn } from "~/lib/utils";

/** Progress bar; `tick` marks a threshold (the vote floor) as a percentage. */
export default function Bar(
  { pct, big, tick, className }: { pct: number; big?: boolean; tick?: number; className?: string },
) {
  return (
    <div className={cn("relative", className)}>
      <div
        className={cn("bar", big && "bar-big")}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      {tick !== undefined && (
        <span
          aria-hidden="true"
          className="absolute -top-[3px] h-[calc(100%+6px)] w-[2px] rounded-full bg-white/70"
          style={{ left: `calc(${Math.max(0, Math.min(100, tick))}% - 1px)` }}
        />
      )}
    </div>
  );
}
