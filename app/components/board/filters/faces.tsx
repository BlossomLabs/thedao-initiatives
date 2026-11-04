/**
 * What the board's Type, Funding and Sort pills show, apart from the Select that
 * opens their menus. The real controls (TypeSelect, StatusSelect, SortSelect) and
 * the stand-ins FilterBar shows while their code loads both draw these, so the
 * swap is invisible. No Base UI here: this file is in the board's first load.
 */
import { ChevronDown } from "lucide-react";
import {
  SELECT_ICON,
  SELECT_TRIGGER,
  SELECT_TRIGGER_SM,
  SELECT_VALUE,
} from "~/components/ui/select-styles";
import {
  type BoardSort,
  type BoardStatus,
  type BoardType,
  SORTS,
  STATUS_LABELS,
} from "~/lib/board-view";
import { cn } from "~/lib/utils";
import { FILTER_PILL, FILTER_PILL_ON } from "./CategoryTrigger";
import FundingGlyph from "./FundingGlyph";
import TypeGlyph from "./TypeGlyph";

/** Pair each stand-in with its real control for the focus hand-over. */
export const TYPE_FOCUS_KEY = "board-type-filter";
export const STATUS_FOCUS_KEY = "board-status-filter";
export const SORT_FOCUS_KEY = "board-sort";

export const TYPE_LABELS: Record<BoardType, string> = {
  all: "All types",
  rfp: "RFPs",
  grant: "Grants",
};
export const typePill = (value: BoardType) => cn(FILTER_PILL, value !== "all" && FILTER_PILL_ON);
export const statusPill = (value: BoardStatus) =>
  cn(FILTER_PILL, value !== "all" && FILTER_PILL_ON);

export function TypeFace({ value, count }: { value: BoardType; count: number }) {
  return (
    <>
      <TypeGlyph type={value} />
      <span>
        {TYPE_LABELS[value]} <span className="tnum text-white/50">{count}</span>
      </span>
      <ChevronDown className="size-3.5 text-white/45" aria-hidden="true" />
    </>
  );
}

export function StatusFace({ value }: { value: BoardStatus }) {
  return (
    <>
      <FundingGlyph status={value} />
      <span>{value === "all" ? "Funding" : STATUS_LABELS[value]}</span>
      <ChevronDown className="size-3.5 text-white/45" aria-hidden="true" />
    </>
  );
}

export const AI_SORT_LABEL = "AI matches";
export const SORT_TRIGGER = "min-h-[40px] max-[641px]:min-h-[44px]";
export const sortLabel = (sort: BoardSort, ai: boolean): string =>
  ai ? AI_SORT_LABEL : SORTS.find(([v]) => v === sort)?.[1] ?? "";

/** Sort's trigger as SelectTrigger draws it (size "sm"), for its stand-in. */
export const sortStandInClass = (className?: string) =>
  cn(SELECT_TRIGGER, SELECT_TRIGGER_SM, SORT_TRIGGER, className);

export function SortFaceLead() {
  return <span className="text-white/50 max-[641px]:hidden">Sort by:</span>;
}

export function SortStandInFace({ sort, ai }: { sort: BoardSort; ai: boolean }) {
  return (
    <>
      <SortFaceLead />
      <span className={SELECT_VALUE}>{sortLabel(sort, ai)}</span>
      <span className={SELECT_ICON}>
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </span>
    </>
  );
}
