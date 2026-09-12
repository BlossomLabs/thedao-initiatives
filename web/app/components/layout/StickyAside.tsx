import { useEffect, useRef } from "react";
import { cn } from "~/lib/utils";

/** Space under the top bar; matches the old `top-[86px]`. */
export const TOP = 86;
export const GAP = 16;
/** Below this width the callers make the aside `static` (max-[960px]:static). */
const NARROW = "(max-width: 960px)";

/**
 * How a sidebar taller than the viewport is pinned right now.
 * - `top`: `position: sticky` under the top bar (also the mode for a sidebar that fits).
 * - `bottom`: `position: sticky` with a negative offset, so its bottom edge sits at the viewport bottom.
 * - `float`: `position: relative`, offset to where it was, so it scrolls with the page.
 */
export type Mode = "top" | "bottom" | "float";

export interface Frame {
  /** The aside's viewport rect edges. */
  top: number;
  bottom: number;
  height: number;
  viewport: number;
}

/** True when the aside fits under the top bar with the gap below. */
export const fits = (f: Frame): boolean => f.height <= f.viewport - TOP - GAP;

/**
 * The mode after one scroll step. Scrolling down from the top pin lets the
 * aside float until its bottom edge meets the viewport bottom, then pins it
 * there; scrolling up from the bottom pin floats it until its top edge meets
 * the top bar, then pins it there. A sidebar that fits is always `top`.
 */
export function nextMode(mode: Mode, dir: "down" | "up", f: Frame): Mode {
  if (fits(f)) return "top";
  if (dir === "down") {
    if (mode === "top") return "float";
    if (mode === "float" && f.bottom <= f.viewport - GAP) return "bottom";
    return mode;
  }
  if (mode === "bottom") return "float";
  if (mode === "float" && f.top >= TOP) return "top";
  return mode;
}

/**
 * A sticky sidebar that follows the scroll direction. Shorter than the
 * viewport it sticks under the top bar. Taller, it scrolls down with the page
 * until its bottom edge reaches the viewport bottom and sticks there, and
 * scrolls back up with the page until its top edge reaches the top bar and
 * sticks there again, so every card is reachable in either direction and
 * there is no inner scrollbar.
 */
export default function StickyAside(
  { className, children, ...rest }: React.HTMLAttributes<HTMLElement>,
) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const narrow = globalThis.matchMedia?.(NARROW) ??
      { matches: false, addEventListener() {}, removeEventListener() {} };
    let mode: Mode = "top";
    let lastY = globalThis.scrollY;
    let raf = 0;

    const frame = (): Frame => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: el.offsetHeight, viewport: innerHeight };
    };
    const apply = (next: Mode, f: Frame) => {
      if (next === "float") {
        // Pin it where it is, relative to its slot in the grid: measure the
        // slot with a zero offset, then offset by the difference.
        el.style.position = "relative";
        el.style.top = "0px";
        el.style.top = `${f.top - el.getBoundingClientRect().top}px`;
      } else {
        el.style.position = "";
        el.style.top = next === "bottom" ? `${f.viewport - f.height - GAP}px` : `${TOP}px`;
      }
      mode = next;
    };
    const reset = () => {
      if (narrow.matches) {
        el.style.position = "";
        el.style.top = "";
        mode = "top";
        return;
      }
      apply("top", frame());
    };
    const onScroll = () => {
      if (raf || narrow.matches) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = globalThis.scrollY;
        if (y === lastY) return;
        const dir = y > lastY ? "down" : "up";
        lastY = y;
        const f = frame();
        const next = nextMode(mode, dir, f);
        if (next !== mode) apply(next, f);
      });
    };

    reset();
    const ro = new ResizeObserver(reset);
    ro.observe(el);
    globalThis.addEventListener("resize", reset);
    narrow.addEventListener("change", reset);
    globalThis.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      globalThis.removeEventListener("resize", reset);
      narrow.removeEventListener("change", reset);
      globalThis.removeEventListener("scroll", onScroll);
    };
  }, []);
  return (
    <aside ref={ref} className={cn("sticky top-[86px]", className)} {...rest}>
      {children}
    </aside>
  );
}
