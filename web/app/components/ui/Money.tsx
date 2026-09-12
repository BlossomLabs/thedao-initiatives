import { useTweenedNumber } from "~/hooks/use-tweened-number";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";

/**
 * A USD amount that rolls to its new value and glows green for a moment
 * when it changes (the funding numbers refresh every 15-30 s).
 */
export default function Money({ value, className }: { value: number; className?: string }) {
  const { shown, changed } = useTweenedNumber(value);
  return (
    <span
      className={cn(
        "tnum transition-colors duration-700 ease-out",
        changed && "text-dao-bright",
        className,
      )}
      data-changed={changed || undefined}
    >
      {usd(shown)}
    </span>
  );
}
