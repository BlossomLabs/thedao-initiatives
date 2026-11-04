import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Clock,
  Flag,
  type LucideIcon,
  Pin,
  Shapes,
  Sparkles,
  Star,
  Target,
  UserCheck,
  Users,
} from "lucide-react";
import { useRef } from "react";
import { type BoardSort, RATING_SORTS, SORTS } from "~/lib/board-view";
import { useTakeFocus } from "~/lib/focus-handover";
import { cn } from "~/lib/utils";
import { AI_SORT_LABEL, SORT_FOCUS_KEY, SORT_TRIGGER, SortFaceLead } from "./faces";

const ITEMS: { value: string; label: string }[] = SORTS.map(([value, label]) => ({
  value,
  label,
}));
const AI = { value: "ai", label: AI_SORT_LABEL };
/** Not offered with the ratings, one per rating sort shown, to keep the menu as long. */
const RATING_FOR: readonly BoardSort[] = ["goal-asc", "backers"];

/** One icon per sort, drawn in the menu like the Funding menu's glyphs. */
const ICONS: Record<BoardSort | "ai", LucideIcon> = {
  ai: Sparkles,
  recommended: Pin, // the pinned initiatives first, as their pin on the cards
  closest: Target,
  "least-left": Flag,
  newest: Clock,
  backers: Users,
  "goal-asc": ArrowUpNarrowWide,
  "goal-desc": ArrowDownWideNarrow,
  category: Shapes,
  "rating-avg": Star,
  "rating-mine": UserCheck,
};

/**
 * The eight sorts. While the AI order is on it reads "AI matches" (not an
 * option: it is set by Find matches), and any manual pick, even the sort
 * already in the URL, hands the order back to the sort.
 */
export default function SortSelect(
  { sort, ai, featured = true, rated = false, canRate = false, onSort, className }: {
    sort: BoardSort;
    ai: boolean;
    /** Whether anything is featured; without, the Featured sort is not offered. */
    featured?: boolean;
    /** The ratings have loaded: Top rated is offered. */
    rated?: boolean;
    /** This viewer can rate: My rating is offered too. */
    canRate?: boolean;
    onSort: (s: BoardSort) => void;
    className?: string;
  },
) {
  const shown = rated ? (canRate ? RATING_SORTS : ["rating-avg"]) : [];
  // The rating sorts take the place of the least used ones (still shown while
  // a URL has one on).
  const replaced = RATING_FOR.slice(0, shown.length);
  const items = ITEMS.filter((s) => {
    const v = s.value as BoardSort;
    return (featured || v !== "recommended") &&
      (RATING_SORTS.includes(v) ? shown.includes(v) : !replaced.includes(v) || v === sort);
  });
  const trigger = useRef<HTMLButtonElement>(null);
  useTakeFocus(SORT_FOCUS_KEY, trigger);
  return (
    <Select
      value={ai ? "ai" : sort}
      items={ai ? [AI, ...items] : items}
      onValueChange={(v) => {
        if (v && v !== "ai") onSort(v as BoardSort);
      }}
    >
      <SelectTrigger
        ref={trigger}
        size="sm"
        aria-label="Sort"
        className={cn(SORT_TRIGGER, className)}
      >
        <SortFaceLead />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {items.map((s) => {
          const Icon = ICONS[s.value as BoardSort];
          return (
            <SelectItem key={s.value} value={s.value}>
              <span className="flex items-center gap-2.5">
                <Icon
                  className={cn(
                    "size-3.5 flex-none text-white/55",
                    Icon === Pin && "rotate-45", // tilted, as the pin on the cards
                  )}
                  aria-hidden="true"
                />
                {s.label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
