import { useRef, useState } from "react";
import { Star } from "lucide-react";
import { cn } from "~/lib/utils";
import { STARS, type Stars as StarCount } from "@shared/ratings";

/** Five stars, the first `value` lit (rounded to whole stars). */
export function StarRow(
  { value, className, size = "size-3.5" }: { value: number; className?: string; size?: string },
) {
  const lit = Math.round(value);
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      role="img"
      aria-label={`${value} of 5 stars`}
    >
      {STARS.map((n) => (
        <Star
          key={n}
          className={cn(size, n <= lit ? "text-dao-amber" : "text-white/20")}
          fill={n <= lit ? "currentColor" : "none"}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/** Pick 1 to 5 stars: a radio group (arrow keys move, clicking the picked star clears it). */
export function StarInput(
  { value, onChange, label, disabled, compact = false }: {
    value: StarCount | null;
    onChange: (v: StarCount | null) => void;
    label: string;
    disabled?: boolean;
    /** Smaller cells, for a narrow side card. */
    compact?: boolean;
  },
) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // The star under the pointer lights up to itself, a preview of the pick.
  const [hover, setHover] = useState<number | null>(null);
  const lit = disabled ? value : hover ?? value;
  const move = (to: number) => {
    const n = Math.min(5, Math.max(1, to)) as StarCount;
    onChange(n);
    refs.current[n - 1]?.focus();
  };
  return (
    <span
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center gap-0.5"
      onMouseLeave={() => setHover(null)}
    >
      {STARS.map((n) => (
        <button
          key={n}
          ref={(el) => {
            refs.current[n - 1] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          // One tab stop: the picked star, or the first.
          tabIndex={(value ?? 1) === n ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(value === n ? null : n)}
          onMouseEnter={() => setHover(n)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowUp") move((value ?? 0) + 1);
            else if (e.key === "ArrowLeft" || e.key === "ArrowDown") move((value ?? 2) - 1);
            else return;
            e.preventDefault();
          }}
          className={cn(
            "group grid cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-dao-bright disabled:cursor-default disabled:hover:scale-100",
            compact ? "size-6" : "size-7",
          )}
        >
          <Star
            className={cn(
              compact ? "size-4" : "size-[18px]",
              "transition-colors",
              lit !== null && n <= lit ? "text-dao-amber" : "text-white/25",
            )}
            fill={lit !== null && n <= lit ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>
      ))}
    </span>
  );
}
