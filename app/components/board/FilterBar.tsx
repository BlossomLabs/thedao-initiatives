import {
  type BoardSort,
  type BoardType,
  type BoardView,
  CLEARED,
  isFiltered,
  resultLabel,
} from "~/lib/board-view";
import { Suspense } from "react";
import { lazyPart } from "~/lib/lazy-part";
import { standInFocus } from "~/lib/focus-handover";
import { cn } from "~/lib/utils";
import {
  FILTER_FOCUS_KEY,
  FILTER_PILL_ON,
  TRIGGER,
  TriggerFace,
  triggerLabel,
} from "./filters/CategoryTrigger";
import SortSelect from "./filters/SortSelect";
import StatusSelect from "./filters/StatusSelect";
import TypeSelect from "./filters/TypeSelect";

/** A plain button with the Category dropdown's face, until (or if never) its code arrives. */
function CategoryFilterStandIn({ value }: { value: string[] }) {
  return (
    <button
      type="button"
      className={cn(TRIGGER, value.length > 0 && FILTER_PILL_ON)}
      aria-label={triggerLabel(value.length)}
      onPointerEnter={preloadFilters}
      {...standInFocus(FILTER_FOCUS_KEY)}
      onFocusCapture={preloadFilters}
      onClick={preloadFilters}
    >
      <TriggerFace value={value} />
    </button>
  );
}

// The combobox loads after the board (preloadFilters, called once it has mounted).
const filter = lazyPart(() => import("./filters/CategoryFilter"), CategoryFilterStandIn);
export const preloadFilters = filter.preload;
const CategoryFilter = filter.Component;

/**
 * Between the AI search and the grid. One row of pills: Type, Category and
 * Funding, with the count and Sort on the right (Sort orders, it does not
 * narrow). The active filters follow on their own row as removable tokens.
 * Phones (<=640px): Type, Filters (N) (the sheet with Category and Funding) and
 * Sort, then the count.
 */
export default function FilterBar({
  view,
  onChange,
  counts,
  shown,
  total,
  ai,
  featured = true,
  onSort,
  sheet,
}: {
  view: BoardView;
  onChange: (next: Partial<BoardView>) => void;
  counts: { type: Record<BoardType, number>; cats: Record<string, number> };
  shown: number;
  total: number;
  ai: boolean;
  /** Whether anything is featured (the Featured sort is offered only then). */
  featured?: boolean;
  onSort: (s: BoardSort) => void;
  /** The phone Filters (N) button with its sheet. */
  sheet: React.ReactNode;
}) {
  const label = resultLabel(shown, total, isFiltered(view));
  const filtered = isFiltered(view);
  const clear = filtered && (
    <button
      type="button"
      className="cursor-pointer border-0 bg-transparent px-1 py-0 font-inter-tight text-[12px] text-white/55 underline decoration-white/25 underline-offset-2 hover:text-white"
      onClick={() => onChange({ ...CLEARED })}
    >
      Clear filters
    </button>
  );
  return (
    <div className="mb-6 flex flex-col" role="group" aria-label="Filter and sort initiatives">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 small dim max-[641px]:hidden">Filters:</span>
        <TypeSelect
          value={view.type}
          counts={counts.type}
          onChange={(type) => onChange({ type })}
        />
        <div className="contents max-[641px]:hidden">
          <Suspense fallback={<CategoryFilterStandIn value={view.cats} />}>
            <CategoryFilter
              value={view.cats}
              counts={counts.cats}
              onChange={(cats) => onChange({ cats })}
            />
          </Suspense>
          <StatusSelect value={view.status} onChange={(status) => onChange({ status })} />
        </div>
        <div className="hidden max-[641px]:contents">{sheet}</div>
        <span className="max-[641px]:hidden">{clear}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="small dim tnum max-[641px]:hidden" aria-live="polite">{label}</span>
          <SortSelect
            sort={view.sort}
            ai={ai}
            featured={featured}
            onSort={onSort}
            className="min-h-[32px] border-transparent bg-transparent px-1.5 hover:border-white/15"
          />
        </span>
      </div>
      <p
        className="m-0 mt-3 hidden items-center gap-2 small dim tnum max-[641px]:flex"
        aria-live="polite"
      >
        {label}
        {clear}
      </p>
    </div>
  );
}
