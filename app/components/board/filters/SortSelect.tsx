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
import { type BoardSort, RATING_SORTS, SORTS } from "~/lib/board-view";
import { cn } from "~/lib/utils";

const ITEMS: { value: string; label: string }[] = SORTS.map(([value, label]) => ({
  value,
  label,
}));
const AI = { value: "ai", label: "AI matches" };
/** Not offered to admins with the ratings, to keep the menu as long. */
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
  { sort, ai, featured = true, rated = false, onSort, className }: {
    sort: BoardSort;
    ai: boolean;
    /** Whether anything is featured; without, the Featured sort is not offered. */
    featured?: boolean;
    /** An admin with the ratings: the rating sorts are offered. */
    rated?: boolean;
    onSort: (s: BoardSort) => void;
    className?: string;
  },
) {
  const items = ITEMS.filter((s) =>
    (featured || s.value !== "recommended") &&
    (rated
      // The two rating sorts take the place of the least used ones (still
      // shown while a URL has one on).
      ? !RATING_FOR.includes(s.value as BoardSort) || s.value === sort
      : !RATING_SORTS.includes(s.value as BoardSort))
  );
  return (
    <Select
      value={ai ? "ai" : sort}
      items={ai ? [AI, ...items] : items}
      onValueChange={(v) => {
        if (v && v !== "ai") onSort(v as BoardSort);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Sort"
        className={cn("min-h-[40px] max-[641px]:min-h-[44px]", className)}
      >
        <span className="text-white/50 max-[641px]:hidden">Sort by:</span>
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
