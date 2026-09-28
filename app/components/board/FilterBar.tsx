import { useState } from "react";
import { LayoutGrid, List, Search, SlidersHorizontal } from "lucide-react";
import { CategoryChip } from "~/components/ui/CategoryTag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import { Dialog } from "~/components/ui/Dialog";
import { Button } from "~/components/ui/Button";
import {
  type BoardSort,
  type BoardStatus,
  type BoardType,
  type BoardView,
  type BoardViewMode,
  isFiltered,
  SORTS,
} from "~/lib/board-view";
import { CATEGORIES } from "~/lib/categories";
import { usePhone } from "~/hooks/use-media";
import { cn } from "~/lib/utils";

const TYPE_LABELS: [BoardType, string][] = [["all", "All"], ["rfp", "RFPs"], ["grant", "Grants"]];
const SORT_ITEMS = SORTS.map(([value, label]) => ({ value, label }));
const segBtn = (on: boolean) =>
  cn(
    "inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-[9px] border-0 px-3 font-inter-tight text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-dao-bright",
    on ? "bg-white/[.12] text-dao-green" : "bg-transparent text-white/70 hover:text-white",
  );

type Props = {
  view: BoardView;
  onChange: (next: Partial<BoardView>) => void;
  counts: { type: Record<BoardType, number>; cats: Record<string, number> };
  shown: number;
  total: number;
  /** Offer "Vote-eligible" (the vote display is flagged on). */
  voteOn?: boolean;
};

/**
 * Between the AI search and the grid. Row 1: type, status, sort, cards or
 * list, keyword filter, the count and Clear; on phones it folds into a
 * "Filters" sheet. Row 2: the categories with live counts (OR among
 * themselves, AND with the rest), one sideways-scrolling row on phones.
 */
export default function FilterBar(p: Props) {
  const { view, onChange } = p;
  const phone = usePhone();
  const [sheet, setSheet] = useState(false);
  const active = Number(view.type !== "all") + Number(view.status !== "all") +
    Number(view.q.trim() !== "");
  const clear = () => onChange({ type: "all", status: "all", cats: [], q: "" });
  const statusItems = [
    { value: "all", label: "All statuses" },
    { value: "open", label: "Open for funding" },
    { value: "funded", label: "Fully funded" },
    ...(p.voteOn ? [{ value: "vote", label: "Vote-eligible" }] : []),
  ];
  const controls = (
    <>
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
            className={segBtn(view.type === value)}
          >
            {label} <span className="text-white/40">{p.counts.type[value]}</span>
          </button>
        ))}
      </div>
      <Select
        value={view.status}
        items={statusItems}
        onValueChange={(v) => onChange({ status: v as BoardStatus })}
      >
        <SelectTrigger size="sm" aria-label="Status" className="min-h-[42px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusItems.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select
        value={view.sort}
        items={SORT_ITEMS}
        onValueChange={(v) => onChange({ sort: v as BoardSort })}
      >
        <SelectTrigger size="sm" aria-label="Sort" className="min-h-[42px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_ITEMS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <div
        className="inline-flex rounded-[12px] border border-white/10 bg-white/5 p-1"
        role="group"
        aria-label="Layout"
      >
        {([["cards", "Cards", LayoutGrid], ["list", "List", List]] as const).map((
          [value, label, Icon],
        ) => (
          <button
            key={value}
            type="button"
            aria-pressed={view.view === value}
            onClick={() => onChange({ view: value as BoardViewMode })}
            className={segBtn(view.view === value)}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <label className="relative min-w-[200px] flex-1 max-[640px]:w-full">
        <span className="sr-only">Filter by name or keyword</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40"
          aria-hidden="true"
        />
        <input
          type="search"
          className="field min-h-[42px] border-white/10 py-2 pl-9 text-[13px] placeholder:text-white/30"
          placeholder="Filter by name or keyword"
          maxLength={100}
          value={view.q}
          onChange={(e) => onChange({ q: e.target.value })}
        />
      </label>
    </>
  );
  const count = (
    <span className="flex items-center gap-3 whitespace-nowrap small dim" aria-live="polite">
      Showing {p.shown} of {p.total}
      {isFiltered(view) && (
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-dao-green underline"
          onClick={clear}
        >
          Clear
        </button>
      )}
    </span>
  );

  return (
    <div className="mb-5 flex flex-col gap-3" role="group" aria-label="Filter and sort initiatives">
      {phone
        ? (
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              sm
              onClick={() => setSheet(true)}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Filters{active ? ` (${active})` : ""}
            </Button>
            {count}
          </div>
        )
        : (
          <div className="flex flex-wrap items-center gap-2.5">
            {controls}
            <span className="ml-auto">{count}</span>
          </div>
        )}
      {phone && (
        <Dialog
          open={sheet}
          onOpenChange={setSheet}
          title="Filters"
          className="-mb-5 w-full max-w-none self-end rounded-b-none"
        >
          <div className="flex flex-col items-start gap-3">{controls}</div>
          <div className="mt-1 flex items-center justify-between gap-3">
            {count}
            <Button
              variant="primary"
              sm
              onClick={() => setSheet(false)}
            >
              Show {p.shown}
            </Button>
          </div>
        </Dialog>
      )}
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
            dim={!p.counts.cats[c.slug]}
            onToggle={() =>
              onChange({
                cats: view.cats.includes(c.slug)
                  ? view.cats.filter((s) => s !== c.slug)
                  : [...view.cats, c.slug],
              })}
            after={<span className="opacity-60">{p.counts.cats[c.slug]}</span>}
          />
        ))}
      </div>
    </div>
  );
}
