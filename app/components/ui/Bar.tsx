import { cn } from "~/lib/utils";

export default function Bar(
  { pct, big, className }: { pct: number; big?: boolean; className?: string },
) {
  return (
    <div
      className={cn("bar", big && "bar-big", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
