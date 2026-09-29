import { ChevronDown } from "lucide-react";
import CategoryDot from "~/components/ui/CategoryDot";
import { categoryOf } from "~/lib/categories";

/** The small pill both board filters use; the Category dropdown's stand-in shares it. */
export const FILTER_PILL =
  "inline-flex h-8 max-[641px]:h-10 w-auto cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border border-white/12 bg-white/[.03] pl-2.5 pr-2 font-inter-tight text-[12.5px] text-white/80 outline-none transition-colors hover:border-white/25 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dao-bright data-[popup-open]:border-white/30 data-[popup-open]:bg-white/[.07] data-[popup-open]:text-white";

/** A filter pill that narrows the board: a touch brighter, so it reads as on. */
export const FILTER_PILL_ON = "border-white/25 bg-white/[.07] text-white";

export const TRIGGER = FILTER_PILL;

/** Pairs the stand-in with the real trigger for the focus hand-over. */
export const FILTER_FOCUS_KEY = "board-category-filter";

export const triggerLabel = (count: number) => count ? `Category, ${count} selected` : "Category";

/** Plain muted dots (no rings) stand for "any category" until some are picked. */
const IDLE = ["#8FA3B8", "#7189A1", "#5A7089"];

/**
 * The Category pill's face: "Category" with nothing picked, the category's
 * name with one, "N Categories" with several; its dots are the picks' colours
 * (the same dots the cards carry).
 */
export function TriggerFace({ value }: { value: string[] }) {
  const title = value.length === 0
    ? "Category"
    : value.length === 1
    ? categoryOf(value[0])?.label ?? "Category"
    : `${value.length} Categories`;
  return (
    <>
      <span className="flex items-center gap-1" aria-hidden="true">
        {value.length
          ? value.slice(0, 3).map((s) => <CategoryDot key={s} slug={s} />)
          : IDLE.map((c) => (
            <span
              key={c}
              className="inline-block size-2 rounded-full"
              style={{ background: c }}
            />
          ))}
      </span>
      <span>{title}</span>
      <ChevronDown className="size-3.5 text-white/45" aria-hidden="true" />
    </>
  );
}
