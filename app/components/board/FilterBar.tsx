import { CategoryChip } from "~/components/ui/CategoryTag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import {
  type BoardSort,
  type BoardStatus,
  type BoardType,
  type BoardView,
  isFiltered,
  SORTS,
} from "~/lib/board-view";
import { CATEGORIES } from "~/lib/categories";
import { cn } from "~/lib/utils";

const TYPE_LABELS: [BoardType, string][] = [["all", "All"], ["rfp", "RFPs"], ["grant", "Grants"]];
const STATUS_ITEMS = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open for funding" },
  { value: "funded", label: "Fully funded" },
];
const SORT_ITEMS = SORTS.map(([value, label]) => ({ value, label }));

/**
 * Between the AI search and the grid. Row 1: type, status, sort, the count and
 * Clear. Row 2: the categories with live counts (OR among themselves, AND with
 * the rest); on phones they scroll sideways in one row.
 */
export default function FilterBar({
  view,
  onChange,
  counts,
  shown,
  total,
}: {
  view: BoardView;
  onChange: (next: Partial<BoardView>) => void;
  counts: { type: Record<BoardType, number>; cats: Record<string, number> };
  shown: number;
  total: number;
}) {
  const toggleCat = (slug: string) =>
    onChange({
      cats: view.cats.includes(slug) ? view.cats.filter((s) => s !== slug) : [...view.cats, slug],
    });
  return (
    <div className="mb-5 flex flex-col gap-3" role="group" aria-label="Filter and sort initiatives">
      <div className="flex flex-wrap items-center gap-2.5">
        <div
          className="inline-flex rounded-[12px] border border-white/10 bg-white/5 p-1"
          role="group"
          aria-label="Type"
        >
          {TYPE_LABELS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view.type === value}
              onClick={() => onChange({ type: value })}
              className={cn(
                "min-h-[34px] cursor-pointer rounded-[9px] border-0 px-3 font-inter-tight text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-dao-bright",
                view.type === value
                  ? "bg-white/[.12] text-dao-green"
                  : "bg-transparent text-white/70 hover:text-white",
              )}
            >
              {label} <span className="text-white/40">{counts.type[value]}</span>
            </button>
          ))}
        </div>
        <Select
          value={view.status}
          items={STATUS_ITEMS}
          onValueChange={(v) =>
            onChange({ status: v as BoardStatus })}
        >
          <SelectTrigger size="sm" aria-label="Status" className="min-h-[42px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_ITEMS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={view.sort}
          items={SORT_ITEMS}
          onValueChange={(v) =>
            onChange({ sort: v as BoardSort })}
        >
          <SelectTrigger size="sm" aria-label="Sort" className="min-h-[42px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_ITEMS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}
            </SelectItem>)}
          </SelectContent>
        </Select>
        <span className="ml-auto flex items-center gap-3 small dim" aria-live="polite">
          Showing {shown} of {total}
          {isFiltered(view) && (
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-dao-green underline"
              onClick={() => onChange({ type: "all", status: "all", cats: [], q: "" })}
            >
              Clear
            </button>
          )}
        </span>
      </div>
      <div
        className="flex flex-wrap gap-2 max-[640px]:-mx-4 max-[640px]:flex-nowrap max-[640px]:overflow-x-auto max-[640px]:px-4 max-[640px]:pb-1"
        role="group"
        aria-label="Categories"
      >
        {CATEGORIES.map((c) => (
          <CategoryChip
            key={c.slug}
            slug={c.slug}
            selected={view.cats.includes(c.slug)}
            dim={!counts.cats[c.slug]}
            onToggle={() => toggleCat(c.slug)}
            after={<span className="opacity-60">{counts.cats[c.slug]}</span>}
          />
        ))}
      </div>
    </div>
  );
}
