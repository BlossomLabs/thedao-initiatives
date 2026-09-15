import { Check } from "lucide-react";
import { letter } from "@shared/draft/mod";
import { cn } from "~/lib/utils";

/**
 * The milestone letter badge: A, B, C… in a 26px round green tint; solid
 * green with a check once the milestone is done. Decorative: the letter is
 * repeated in the row's heading / id, so screen readers skip the badge.
 */
export default function Letter(
  { i, done, className }: { i: number; done?: boolean; className?: string },
) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-[26px] flex-none items-center justify-center rounded-full border font-inter-tight text-[13px] font-semibold",
        done
          ? "border-dao-green bg-dao-green text-[#0f1e2c]"
          : "border-[rgba(92,183,90,.5)] bg-[rgba(92,183,90,.18)] text-[#7dd57e]",
        className,
      )}
    >
      {done ? <Check className="size-3.5" strokeWidth={3} /> : letter(i)}
    </span>
  );
}
