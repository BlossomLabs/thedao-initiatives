import { SlidersHorizontal } from "lucide-react";
import type { Card } from "~/lib/api-types";
import { activeFilterCount, type BoardView } from "~/lib/board-view";
import { standInFocus } from "~/lib/focus-handover";
import { lazyPart } from "~/lib/lazy-part";
import { cn } from "~/lib/utils";
import { FILTER_PILL, FILTER_PILL_ON } from "./CategoryTrigger";

/** The phone Filters (N) button's look, shared by the sheet's trigger and its stand-in. */
export const SHEET_TRIGGER = FILTER_PILL;

/** The pill reads as on while filters narrow the board. */
export const sheetTriggerClass = (view: BoardView) =>
  // No chevron at its end, so it needs the right padding the other pills leave to it.
  cn(SHEET_TRIGGER, "pr-3", activeFilterCount(view) > 0 && FILTER_PILL_ON);

/** Pairs the stand-in with the real trigger for the focus hand-over. */
export const SHEET_FOCUS_KEY = "board-filter-sheet";

export function SheetTriggerFace({ view }: { view: BoardView }) {
  return (
    <>
      <SlidersHorizontal className="size-3.5 text-white/60" aria-hidden="true" />
      Filters ({activeFilterCount(view)})
    </>
  );
}

type SheetProps = {
  cards: Card[];
  view: BoardView;
  /** This browser's watchlist, for the sheet's counts while the Watchlist filter is on. */
  watched?: string[];
  onApply: (p: Pick<BoardView, "type" | "cats" | "status">) => void;
};

/** The Filters (N) button on its own, until (or if never) the sheet code arrives. */
function FilterSheetStandIn({ view }: SheetProps) {
  return (
    <button
      type="button"
      className={sheetTriggerClass(view)}
      onPointerEnter={sheet.preload}
      {...standInFocus(SHEET_FOCUS_KEY)}
      onFocusCapture={sheet.preload}
      onClick={sheet.preload}
    >
      <SheetTriggerFace view={view} />
    </button>
  );
}

// The sheet (Drawer, checkboxes, radios) loads after the board.
const sheet = lazyPart(() => import("./FilterSheet"), FilterSheetStandIn);
export const preloadSheet = sheet.preload;
export const FilterSheet = sheet.Component;
export { FilterSheetStandIn };
