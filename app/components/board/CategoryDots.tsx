import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import { ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { useTakeFocus } from "~/lib/focus-handover";
import { Link, useLocation } from "react-router";
import { categoryBoardUrl } from "~/lib/board-links";
import { CategoryIcon, Dots, DOTS_BUTTON, dotsLabel, dotsOf } from "./DotsFace";

const PANEL = "rounded-[14px] border border-edge2 bg-panel shadow-menu outline-none";

/**
 * A card's categories as its primary category's icon in one button (a 24px target).
 * Hover or focus names them; a click opens a popover that stays until
 * dismissed, each category a row that browses the board by it. Tapping the
 * dots never navigates.
 */
export default function CategoryDots(
  { slugs, focusKey }: { slugs: string[]; focusKey?: string },
) {
  const location = useLocation();
  const boardSearch = location.pathname === "/" ? location.search : "";
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useTakeFocus(focusKey ?? "", trigger);
  const cats = dotsOf(slugs);
  if (!cats.length) return null;
  const names = cats.map((c) => c.label).join(", ");
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Root disabled={open}>
        <Tooltip.Trigger
          ref={trigger}
          render={
            <Popover.Trigger
              aria-label={dotsLabel(cats)}
              className={DOTS_BUTTON}
              data-ready=""
            />
          }
        >
          <Dots cats={cats} />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={6} className="z-[210]">
            <Tooltip.Popup
              className={`${PANEL} px-2.5 py-1.5 font-inter-tight text-[12px] text-white`}
            >
              {names}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="z-[210]">
          <Popover.Popup className={`${PANEL} w-[min(300px,calc(100vw-32px))] p-1.5`}>
            <Popover.Title className="sr-only">Categories</Popover.Title>
            <ul className="m-0 flex list-none flex-col p-0">
              {cats.map((c) => (
                <li key={c.slug}>
                  {/* The row is the link to the board filtered by it; the chevron says so. */}
                  <Link
                    to={categoryBoardUrl(boardSearch, c.slug)}
                    preventScrollReset
                    aria-label={`Browse category: ${c.label}`}
                    className="flex min-h-[40px] items-center gap-2.5 rounded-[9px] px-2.5 font-inter-tight text-[13.5px] text-white no-underline outline-none hover:bg-white/[.06] hover:text-white hover:no-underline focus-visible:bg-white/[.06]"
                    onClick={() => setOpen(false)}
                  >
                    <CategoryIcon cat={c} />
                    <span className="flex-1">{c.label}</span>
                    <ChevronRight className="size-4 text-white/45" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
