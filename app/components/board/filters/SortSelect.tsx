import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import { type BoardSort, SORTS } from "~/lib/board-view";
import { cn } from "~/lib/utils";

const ITEMS: { value: string; label: string }[] = SORTS.map(([value, label]) => ({
  value,
  label,
}));
const AI = { value: "ai", label: "AI matches" };

/**
 * The eight sorts. While the AI order is on it reads "AI matches" (not an
 * option: it is set by Find matches), and any manual pick, even the sort
 * already in the URL, hands the order back to the sort.
 */
export default function SortSelect(
  { sort, ai, featured = true, onSort, className }: {
    sort: BoardSort;
    ai: boolean;
    /** Whether anything is featured; without, the Featured sort is not offered. */
    featured?: boolean;
    onSort: (s: BoardSort) => void;
    className?: string;
  },
) {
  const items = featured ? ITEMS : ITEMS.filter((s) => s.value !== "recommended");
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
        <span className="text-white/50 max-[641px]:hidden">Sort:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {items.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
