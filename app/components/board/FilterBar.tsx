import { Bookmark, LayoutGrid, List } from "lucide-react";
import {
  type BoardSort,
  type BoardType,
  type BoardView,
  type BoardViewMode,
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
  FILTER_PILL,
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

/** "My watchlist": only what this browser added to it; offered once something is. */
function WatchlistPill(
  { on, count, onChange, compact }: {
    on: boolean;
    count: number;
    onChange: (on: boolean) => void;
    /** Phones: the bookmark and the count only. */
    compact?: boolean;
  },
) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title="Initiatives on your watchlist in this browser"
      onClick={() => onChange(!on)}
      className={cn(FILTER_PILL, "pr-3", on && FILTER_PILL_ON)}
    >
      <Bookmark
        className={cn("size-3.5", on ? "text-dao-amber" : "text-white/50")}
        fill={on ? "currentColor" : "none"}
        aria-hidden="true"
      />
      {compact ? <span className="sr-only">My watchlist</span> : "My watchlist"}{" "}
      <span className="tnum text-white/45">{count}</span>
    </button>
  );
}

const LAYOUTS = [["cards", "Cards", LayoutGrid], ["list", "List", List]] as const;

/** Cards or list: two icon buttons in one pill, the current one lit. */
function LayoutToggle(
  { value, onChange }: { value: BoardViewMode; onChange: (v: BoardViewMode) => void },
) {
  return (
    <div
      className="inline-flex h-8 flex-none items-center rounded-full border border-white/12 bg-white/[.03] p-0.5 max-[641px]:h-10"
      role="group"
      aria-label="Layout"
    >
      {LAYOUTS.map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          aria-label={label}
          title={label}
          onClick={() => onChange(v)}
          className={cn(
            "grid h-full w-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-white/50 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dao-bright max-[641px]:w-9",
            value === v && "bg-white/[.12] text-white",
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

// The combobox loads after the board (preloadFilters, called once it has mounted).
const filter = lazyPart(() => import("./filters/CategoryFilter"), CategoryFilterStandIn);
export const preloadFilters = filter.preload;
const CategoryFilter = filter.Component;

/**
 * Between the AI search and the grid. One row of pills: Type, Category,
 * Funding and Watchlist (once this browser has one), with the count
 * and Sort on the right (Sort orders, it does not narrow).
 * Phones (<=640px): Filters (N) (the sheet with Type, Category and Funding),
 * Watchlist and Sort, then the count.
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
  watchlistCount = 0,
  voteFilter = false,
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
  /** How many initiatives are on this browser's watchlist. */
  watchlistCount?: number;
  /** The vote display is on: Funding offers First goal reached. */
  voteFilter?: boolean;
}) {
  const label = resultLabel(shown, total, isFiltered(view));
  const filtered = isFiltered(view);
  const watchlist = (compact?: boolean) =>
    (watchlistCount > 0 || view.watchlist) && (
      <WatchlistPill
        on={view.watchlist}
        count={watchlistCount}
        compact={compact}
        onChange={(on) => onChange({ watchlist: on })}
      />
    );
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
        <div className="contents max-[641px]:hidden">
          <TypeSelect
            value={view.type}
            counts={counts.type}
            onChange={(type) => onChange({ type })}
          />
          <Suspense fallback={<CategoryFilterStandIn value={view.cats} />}>
            <CategoryFilter
              value={view.cats}
              counts={counts.cats}
              onChange={(cats) => onChange({ cats })}
            />
          </Suspense>
          <StatusSelect
            value={view.status}
            vote={voteFilter}
            onChange={(status) => onChange({ status })}
          />
          {watchlist()}
        </div>
        <div className="hidden max-[641px]:contents">
          {sheet}
          {watchlist(true)}
        </div>
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
          <LayoutToggle value={view.view} onChange={(v) => onChange({ view: v })} />
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
