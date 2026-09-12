import { useEffect, useRef } from "react";
import { cn } from "~/lib/utils";

/** Space under the top bar; matches the old `top-[86px]`. */
const TOP = 86;
const GAP = 16;

/**
 * A sticky sidebar that pins whichever edge fits. Shorter than the viewport:
 * it sticks under the top bar as before. Taller: its sticky offset becomes
 * `viewport - height`, so it scrolls with the page until its bottom edge
 * reaches the viewport bottom and sticks there, and scrolling up brings the
 * top cards back. Nothing is clipped and there is no inner scrollbar.
 */
export default function StickyAside(
  { className, children, ...rest }: React.HTMLAttributes<HTMLElement>,
) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const h = el.offsetHeight;
      const room = globalThis.innerHeight - TOP - GAP;
      el.style.top = h > room ? `${globalThis.innerHeight - h - GAP}px` : `${TOP}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    globalThis.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      globalThis.removeEventListener("resize", fit);
    };
  }, []);
  return (
    <aside ref={ref} className={cn("sticky top-[86px]", className)} {...rest}>
      {children}
    </aside>
  );
}
