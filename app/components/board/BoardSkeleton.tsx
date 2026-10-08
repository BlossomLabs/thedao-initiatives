import Skeleton from "~/components/ui/Skeleton";
import { LAYOUT_KEY } from "~/lib/board-view";

/**
 * Inline head script (root.tsx) that picks the board's loading shape before
 * the first paint: the list unless the URL, or else this device's last
 * choice, says cards. The board keeps the mark in step afterwards.
 */
export const BOARD_SCRIPT =
  "if(location.pathname==='/')try{if((new URLSearchParams(location.search).get('view')||localStorage.getItem(" +
  JSON.stringify(LAYOUT_KEY) +
  "))==='cards')document.documentElement.dataset.board='cards'}catch(e){}";

/** Record the layout in use, for the next time the board shows its skeleton. */
export function markBoardLayout(view: "cards" | "list") {
  if (view === "cards") document.documentElement.dataset.board = "cards";
  else delete document.documentElement.dataset.board;
}

const SECTIONS = [4, 3];

/** The list's shape: a category heading over a panel of rows, as BoardList
 * draws them (heading 26px, column header 28.8px, a one-line row 59px). */
export function ListSkeleton() {
  return (
    <>
      {SECTIONS.map((rows, i) => (
        <div key={i} className="mt-9 first:mt-0">
          <Skeleton className="mb-4 h-[26px] w-56" />
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.04]">
            <div className="h-[28.8px] border-b border-white/10 max-[640px]:hidden" />
            {Array.from({ length: rows }, (_, r) => (
              <div
                key={r}
                className="flex h-[59px] items-center gap-4 border-b border-white/[.07] px-4 last:border-b-0 max-[640px]:h-[82px]"
              >
                <Skeleton className="size-5 flex-none rounded-md" />
                <Skeleton className="h-4 w-14 flex-none rounded-full max-[640px]:hidden" />
                <Skeleton className="h-4 min-w-0 flex-1" />
                <Skeleton className="h-4 w-40 flex-none max-[640px]:w-16" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

const CARD_SECTIONS = [2, 4];

/** The cards' shape: a category heading over a grid of cards, as the board
 * draws them by category (heading 26px, a card with a one-line title 273px). */
function CardsSkeleton() {
  return (
    <>
      {CARD_SECTIONS.map((cards, i) => (
        <div key={i} className="mt-9 first:mt-0">
          <Skeleton className="mb-4 h-[26px] w-56" />
          <div className="grid grid-cols-2 gap-5 max-[860px]:grid-cols-1">
            {Array.from(
              { length: cards },
              (_, c) => <Skeleton key={c} className="h-[273px] rounded-2xl" />,
            )}
          </div>
        </div>
      ))}
    </>
  );
}

const PILL = "h-8 flex-none rounded-full";

/**
 * The search box and the filter row above the cards, in the sizes BoardSearch
 * and FilterBar take (the same margins, gaps and wrapping), so the initiatives
 * land where their skeleton was instead of moving down when the two appear.
 */
function ControlsSkeleton() {
  return (
    <>
      <Skeleton className="mb-5 mt-1 h-[51px] rounded-[14px]" />
      <div className="mb-6 flex flex-col">
        <div className="flex flex-wrap items-center gap-2">
          {/* Desktop: "Filters:", Type, Category, Funding. */}
          <Skeleton className="mr-1 h-5 w-[35px] max-[641px]:hidden" />
          <Skeleton className={PILL + " w-[127.5px] max-[641px]:hidden"} />
          <Skeleton className={PILL + " w-[132px] max-[641px]:hidden"} />
          <Skeleton className={PILL + " w-[107px] max-[641px]:hidden"} />
          {/* Phones: Filters (N). */}
          <Skeleton className="hidden h-11 w-[110px] rounded-full max-[641px]:block" />
          {/* Where Clear filters goes: empty, but one more gap, so the row wraps where the real one does. */}
          <span className="max-[641px]:hidden" />
          {/* The count, Sort and the layout toggle. */}
          <span className="ml-auto flex items-center gap-3">
            <Skeleton className="h-5 w-[67.5px] max-[641px]:hidden" />
            <Skeleton className={PILL + " w-[146.5px] max-[641px]:h-11 max-[641px]:w-[98px]"} />
            <Skeleton className={PILL + " w-[70px] max-[641px]:h-10 max-[641px]:w-[78px]"} />
          </span>
        </div>
        <Skeleton className="mt-3 hidden h-5 w-28 max-[641px]:block" />
      </div>
    </>
  );
}

/**
 * The board while its data loads. The page is prerendered, so it carries both
 * layouts' shapes and `html[data-board="cards"]` (app.css) shows the one the
 * visitor is about to get: no jump from one shape to the other.
 */
export default function BoardSkeleton() {
  return (
    <>
      <ControlsSkeleton />
      <div className="board-skeleton-list">
        <ListSkeleton />
      </div>
      <div className="board-skeleton-cards">
        <CardsSkeleton />
      </div>
    </>
  );
}
