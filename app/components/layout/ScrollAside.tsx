import { useEffect, useRef } from "react";
import { cn } from "~/lib/utils";

/** Where the columns sit side by side (Tailwind breakpoints): below it they stack, and the
 * aside is part of the page. The classes are spelled out whole for Tailwind to find. */
const AT = {
  // Under the top bar (86 px) with StickyAside's 16 px gap below; its own scrollbar,
  // thin, so the column reads as scrollable.
  lg: {
    narrow: "(max-width: 1023.98px)",
    classes:
      "lg:sticky lg:top-[86px] lg:max-h-[calc(100dvh-102px)] lg:overflow-y-auto lg:[scrollbar-width:thin]",
  },
  sm: {
    narrow: "(max-width: 639.98px)",
    classes:
      "sm:sticky sm:top-[86px] sm:max-h-[calc(100dvh-102px)] sm:overflow-y-auto sm:[scrollbar-width:thin]",
  },
} as const;
/** What a line of wheel scrolling is, in pixels (deltaMode 1: Firefox with a mouse). */
const LINE = 16;

/**
 * A column beside another that scrolls on its own (#95): pinned under the top bar, no
 * taller than the screen, and the wheel over it moves only it, never the page, even at
 * its ends. So to scroll a side, the cursor has to be on that side: the page (and the
 * column beside it) scrolls with the cursor anywhere else. A column with nothing to
 * scroll lets the wheel through to the page. Stacked (below `from`) it is part of the
 * page again.
 *
 * For two peer columns (TheDAO's ballot beside the list; the tiers beside the list).
 * A page with a sidebar of cards keeps StickyAside, which follows the page.
 */
export default function ScrollAside(
  { className, children, from = "lg", ...rest }:
    & React.HTMLAttributes<HTMLElement>
    & {
      /** The breakpoint the columns sit side by side from. */
      from?: keyof typeof AT;
    },
) {
  const ref = useRef<HTMLElement>(null);
  const { narrow: narrowQuery, classes } = AT[from];
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const narrow = globalThis.matchMedia?.(narrowQuery);
    const onWheel = (e: WheelEvent) => {
      // Stacked; a pinch or ctrl-wheel zoom; a sideways scroll; or nothing to scroll here.
      if (
        narrow?.matches || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) ||
        el.scrollHeight <= el.clientHeight
      ) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? el.clientHeight : 1;
      el.scrollTop += e.deltaY * unit;
    };
    // Not passive: it stops the page from scrolling.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [narrowQuery]);
  return (
    <aside ref={ref} className={cn(classes, className)} {...rest}>
      {children}
    </aside>
  );
}
