import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import SectionHeading from "~/components/layout/SectionHeading";
import BackerLogo from "~/components/ui/BackerLogo";
import Skeleton from "~/components/ui/Skeleton";
import type { Sponsor } from "~/lib/api-types";
import { rememberSponsorsHeight } from "~/lib/sponsors-height";
import { cn } from "~/lib/utils";

/** How the row is drawn at the full page width: up to four side by side at full size,
 * five at a smaller one, six to eight stacked (logo over name over amount) to fill
 * the panel, and more than eight stacked at a fixed width, swiped through. Under the
 * full width it is always the swiped row. */
type Fit = "wide" | "tight" | "stack" | "scroll";
const fitOf = (n: number): Fit => n > 8 ? "scroll" : n > 5 ? "stack" : n > 4 ? "tight" : "wide";
/** Side by side: the amount follows the name instead of heading the entry. */
const beside = (fit: Fit) => fit === "wide" || fit === "tight";

/** The fade on each edge that has more to scroll to: it grows in, with the arrow over it,
 * over the first RAMP pixels scrolled from that end (`--edge-l`, `--edge-r`, 0 to 1). */
const FADE = 40;
const RAMP = 64;
const MASK = `linear-gradient(to right, transparent, #000 calc(var(--edge-l, 0) * ${FADE}px), ` +
  `#000 calc(100% - var(--edge-r, 0) * ${FADE}px), transparent)`;

/** "Top sponsors of security for Ethereum": every sponsor over the floor, biggest first,
 * in one panel with a hairline between each. Up to eight share the full page width;
 * past that, and on narrower screens, the row scrolls sideways, a fade on the edge that
 * has more. While the board loads, a skeleton holds the place so the rest of the
 * page does not jump once the sponsors arrive: as tall as the panel this device
 * last drew (sponsors-height.ts), else as a stacked row (three side by side at full width). */
export default function Sponsors(
  { sponsors, loading }: { sponsors?: Sponsor[]; loading?: boolean },
) {
  if (!loading && !sponsors?.length) return null;
  const fit = fitOf(sponsors?.length ?? 0);
  const panel = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const shown = Boolean(sponsors?.length);
  useEffect(() => {
    const el = panel.current;
    const list = row.current;
    if (!el || !list) return;
    const measure = () => {
      const before = list.scrollLeft;
      const after = list.scrollWidth - list.clientWidth - list.scrollLeft;
      // Set straight on the panel: a scroll does not re-render the row.
      el.style.setProperty("--edge-l", String(Math.min(1, Math.max(0, before / RAMP))));
      el.style.setProperty("--edge-r", String(Math.min(1, Math.max(0, after / RAMP))));
      const left = before > 1;
      const right = after > 1;
      setEdges((e) => e.left === left && e.right === right ? e : { left, right });
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    // Also after the fonts arrive and when the window changes width.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      rememberSponsorsHeight(innerWidth, el.getBoundingClientRect().height);
      measure();
    });
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      list.removeEventListener("scroll", measure);
    };
  }, [shown, sponsors?.length]);
  const scrolls = edges.left || edges.right;
  // A page at a time, less one entry so the last one seen stays in view; the snap lines it up.
  const page = (dir: 1 | -1) => {
    const list = row.current;
    if (!list) return;
    const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    list.scrollBy({
      left: dir * Math.max(list.clientWidth - 128, 128),
      behavior: still ? "auto" : "smooth",
    });
  };
  return (
    <section className="mx-auto max-w-[1100px] px-6" aria-labelledby="sponsors">
      <SectionHeading id="sponsors" className="max-[640px]:text-center">
        Top sponsors of security for Ethereum
      </SectionHeading>
      {sponsors?.length
        ? (
          // The panel and the hint under it: what the height memory measures, and where
          // the edge variables live.
          <div ref={panel}>
            <div className="relative rounded-2xl border border-white/[.09] bg-white/5">
              <ol
                ref={row}
                aria-labelledby="sponsors"
                // Keyboard users scroll it with the arrow keys, whether or not the entries link.
                tabIndex={scrolls ? 0 : undefined}
                style={scrolls ? { maskImage: MASK, WebkitMaskImage: MASK } : undefined}
                className={cn(
                  "m-0 flex snap-x snap-mandatory [&::-webkit-scrollbar]:hidden scroll-px-3 list-none overflow-x-auto overscroll-x-contain rounded-2xl px-3 py-6 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-dao-green/60",
                  {
                    wide:
                      "min-[1100px]:grid min-[1100px]:auto-cols-[minmax(0,1fr)] min-[1100px]:grid-flow-col min-[1100px]:overflow-visible min-[1100px]:px-1",
                    tight:
                      "min-[1100px]:grid min-[1100px]:auto-cols-[minmax(0,1fr)] min-[1100px]:grid-flow-col min-[1100px]:overflow-visible min-[1100px]:px-2 min-[1100px]:py-5",
                    stack:
                      "min-[1100px]:grid min-[1100px]:auto-cols-[minmax(0,1fr)] min-[1100px]:grid-flow-col min-[1100px]:overflow-visible",
                    scroll: "",
                  }[fit],
                )}
              >
                {sponsors.map((s) => <Entry key={s.company} s={s} fit={fit} />)}
              </ol>
              {/* The fade says there is more; the arrow on it says so louder and scrolls to it. */}
              {edges.left && <Arrow dir={-1} onClick={() => page(-1)} />}
              {edges.right && <Arrow dir={1} onClick={() => page(1)} />}
            </div>
            {
              /* Fades out with the right arrow and does what it does; its line stays, so
             nothing below moves. Centred on phones like the heading, else under the
             right arrow. The arrow is the one keyboards and screen readers get. */
            }
            {scrolls && (
              <div className="mt-2 flex justify-center min-[641px]:justify-end">
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  disabled={!edges.right}
                  onClick={() => page(1)}
                  style={{ opacity: "var(--edge-r, 0)" }}
                  className="flex items-center gap-1 pr-1 text-[9px] uppercase leading-4 tracking-[.18em] text-white/35 transition-colors hover:text-white/60 disabled:cursor-default"
                >
                  Scroll sideways for more <ArrowRight className="size-2.5" aria-hidden />
                </button>
              </div>
            )}
          </div>
        )
        : (
          <div aria-busy="true">
            <Skeleton className="h-[var(--sponsors-h,200px)] rounded-2xl min-[1100px]:h-[var(--sponsors-h,114px)]" />
          </div>
        )}
    </section>
  );
}

/** Over the faded edge of the row, so the sponsors keep the panel's full width. Under
 * the chevron, the panel's own colour (the page plus its white wash), fading out
 * toward the entries in a tall ellipse, strongest beside the chevron, so the
 * chevron reads over whatever entry is under it. */
function Arrow({ dir, onClick }: { dir: 1 | -1; onClick: () => void }) {
  const Icon = dir > 0 ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      aria-label={dir > 0 ? "More sponsors" : "Previous sponsors"}
      onClick={onClick}
      style={{ opacity: `var(${dir > 0 ? "--edge-r" : "--edge-l"}, 0)` }}
      className={cn(
        "group absolute inset-y-0 z-10 grid w-8 items-center outline-none",
        dir > 0 ? "right-0 justify-items-end" : "left-0 justify-items-start",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "page-ground absolute inset-0",
          dir > 0
            ? "rounded-r-[15px] [mask-image:radial-gradient(ellipse_100%_120%_at_100%_50%,#000_45%,transparent)]"
            : "rounded-l-[15px] [mask-image:radial-gradient(ellipse_100%_120%_at_0%_50%,#000_45%,transparent)]",
        )}
      >
        <span className="absolute inset-0 bg-white/5" />
      </span>
      <span className="relative grid size-6 place-items-center rounded-full text-white/80 transition-colors group-hover:text-dao-green group-focus-visible:ring-2 group-focus-visible:ring-dao-green/60">
        <Icon className="size-5" aria-hidden />
      </span>
    </button>
  );
}

/** Whole dollars: a leaderboard ranks, it does not account. */
const dollars = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

function Entry({ s, fit }: { s: Sponsor; fit: Fit }) {
  const side = beside(fit);
  return (
    <li
      className={cn(
        // `relative`: the name's link covers the whole entry.
        "relative flex w-32 min-w-0 flex-none snap-start flex-col items-center justify-start gap-3.5 border-l border-white/10 px-2 text-center font-inter-tight text-white first:border-l-0",
        fit !== "scroll" && "min-[1100px]:w-auto",
        {
          wide: "min-[1100px]:flex-row min-[1100px]:gap-4 min-[1100px]:px-5 min-[1100px]:text-left",
          tight:
            "min-[1100px]:flex-row min-[1100px]:gap-2 min-[1100px]:px-3 min-[1100px]:text-left",
          stack: "",
          scroll: "",
        }[fit],
      )}
    >
      {/* The cards' "Pledged by" mark, larger; a silhouette when none was uploaded. */}
      <BackerLogo
        logoUrl={s.logoUrl}
        company={s.company}
        className={cn(
          "size-[52px] flex-none p-2 [&>svg]:size-5",
          {
            wide: "min-[1100px]:size-16 min-[1100px]:p-2.5 min-[1100px]:[&>svg]:size-6",
            tight: "min-[1100px]:size-12 min-[1100px]:p-1.5",
            stack: "",
            scroll: "",
          }[fit],
        )}
      />
      {
        /* Stacked, the amount leads, above the logo, so the amounts share one line
       however many lines the names take. */
      }
      <div className={cn("contents", side && "min-[1100px]:block min-[1100px]:min-w-0")}>
        <b
          title={s.company}
          className={cn(
            "line-clamp-3 w-full text-balance break-words text-[14px] font-semibold leading-[1.3]",
            {
              wide:
                "min-[1100px]:w-auto min-[1100px]:text-[19px] min-[1100px]:font-bold min-[1100px]:leading-[1.2]",
              tight:
                "min-[1100px]:w-auto min-[1100px]:text-[16px] min-[1100px]:font-bold min-[1100px]:leading-[1.2]",
              stack: "",
              scroll: "",
            }[fit],
          )}
        >
          {s.url
            ? (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white hover:underline after:absolute after:inset-0 after:content-['']"
              >
                {s.company}
              </a>
            )
            : s.company}
        </b>
        <span
          className={cn(
            "mono order-first block text-[16px] leading-none text-dao-green",
            side &&
              "min-[1100px]:order-none min-[1100px]:mt-1 min-[1100px]:text-[13px] min-[1100px]:leading-[inherit]",
            fit === "wide" && "min-[1100px]:text-[14px]",
          )}
        >
          <span className="whitespace-nowrap">{dollars(s.totalUsd)}</span> {
            /* Stacked, the figure is the headline and "pledged by" its caption, read
            down into the logo and the name; side by side, "$5,000 pledged". */
          }
          <span className={cn("hidden", side && "min-[1100px]:inline")}>pledged</span>
          <span
            className={cn(
              "mt-2 block font-inter-tight text-[10px] uppercase tracking-[.18em] text-white/45",
              side && "min-[1100px]:hidden",
            )}
          >
            pledged by
          </span>
        </span>
      </div>
    </li>
  );
}
