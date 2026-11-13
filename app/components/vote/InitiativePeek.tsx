import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Tooltip } from "@base-ui/react/tooltip";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Lock, Pencil, X } from "lucide-react";
import { LinkButton } from "~/components/ui/Button";
import { Select, SelectContent, SelectItem } from "~/components/ui/Select";
import CategoryDot from "~/components/ui/CategoryDot";
import { categoryOf } from "~/lib/categories";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { BallotItem } from "./TierBallot";

/** A ballot initiative's card: a little about it, where it goes on this ballot (a tier, the
 * list, or skipped) and a link to its full page. It opens and closes with the browser's own morph
 * (`peek-morph.ts`): the chip or tile becomes the card, its title and dot travelling into
 * the card's. The page dims behind it; the initiative stays in its place as a dashed outline (TierBallot).
 * Escape, a click outside or the x close it. */

/** A ‹ or › in the card's bottom row, the size of "Open full page" beside it. */
const STEP =
  "grid size-8 place-items-center rounded-lg border border-white/15 text-white/75 transition-colors hover:border-white/35 hover:bg-white/[.06] hover:text-white focus-visible:outline-2 focus-visible:outline-dao-green disabled:pointer-events-none disabled:opacity-30";

/** The description scrolls like the sponsors row, but up and down: no scrollbar, a fade on
 * each edge that has more, growing in over the first RAMP pixels scrolled from that end
 * (`--edge-t`, `--edge-b`, 0 to 1), and over it an arrow that scrolls when clicked. */
const FADE = 28;
const RAMP = 48;
const MASK = `linear-gradient(to bottom, transparent, #000 calc(var(--edge-t, 0) * ${FADE}px), ` +
  `#000 calc(100% - var(--edge-b, 0) * ${FADE}px), transparent)`;

/** Where the initiative is on this ballot, as a ruled stamp on the card: green in a tier,
 * plain off the tiers, gold once its tier has settled. */
const STAMP =
  "inline-flex w-fit -rotate-[1.2deg] items-center gap-2 rounded-lg border-[1.5px] py-1 pl-2.5 font-inter-tight text-[11.5px] font-bold uppercase leading-[22px] tracking-[.12em]";
const IN_TIER = "border-dao-green bg-dao-green/15 text-[#a7e3a5]";
const OFF_TIER = "border-white/25 bg-white/[.04] text-white/75";
const SETTLED = "border-vote bg-vote/[.12] text-vote";

export type PeekChoice<W extends string> = {
  value: W;
  grade: React.ReactNode;
  label: string;
  /** Read out: "S-Tier, Must fund". */
  name: string;
  /** In the closed selector: "S-Tier · Must fund". */
  display: string;
  disabled: boolean;
};

export default function InitiativePeek<W extends string>(
  { item, nav, choices, current, onChoose, note, paid, onClose }: {
    item: BallotItem;
    /** ‹ › through the ballot: where this one is (-1 when it's not in the order). */
    nav?: { index: number; count: number; onStep: (dir: -1 | 1) => void };
    /** The tiers, the list and skipped, in order. */
    choices: PeekChoice<W>[];
    current: W;
    /** A choice: the initiative moves there; the card stays open. */
    onChoose: (w: W) => void;
    /** Why the selector is locked (a settled tier), and what it paid: in a popover. */
    note?: string;
    /** What this badge paid for it, once its tier has settled: "$7,000". */
    paid?: string;
    onClose: () => void;
  },
) {
  const titleId = useId();
  /** Where it is now: "S-Tier · Must fund", "Not ranked yet", "Skipped". */
  const now = choices.find((c) => c.value === current);
  const canChange = choices.some((c) => !c.disabled);
  /** The settled tier's popover, open by a hover, a focus or a tap. */
  const [noteOpen, setNoteOpen] = useState(false);

  // The description's edges: which have more to scroll to (the arrows), and how far in
  // (the fade, set straight on the wrapper: a scroll doesn't re-render the card).
  const descWrap = useRef<HTMLDivElement>(null);
  const desc = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const wrap = descWrap.current;
    const sc = desc.current;
    if (!wrap || !sc) return;
    sc.scrollTop = 0;
    const measure = () => {
      const before = sc.scrollTop;
      const after = sc.scrollHeight - sc.clientHeight - sc.scrollTop;
      wrap.style.setProperty("--edge-t", String(Math.min(1, Math.max(0, before / RAMP))));
      wrap.style.setProperty("--edge-b", String(Math.min(1, Math.max(0, after / RAMP))));
      const top = before > 1;
      const bottom = after > 1;
      setEdges((e) => e.top === top && e.bottom === bottom ? e : { top, bottom });
    };
    measure();
    sc.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(sc);
    return () => {
      ro?.disconnect();
      sc.removeEventListener("scroll", measure);
    };
  }, [item.slug]);
  const scrolls = edges.top || edges.bottom;
  // A page at a time, less a couple of lines so the last ones read stay in view.
  const page = (dir: 1 | -1) => {
    const sc = desc.current;
    if (!sc) return;
    const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    sc.scrollBy?.({
      top: dir * Math.max(sc.clientHeight - 40, 40),
      behavior: still ? "auto" : "smooth",
    });
  };
  const r = item.card?.initiative;
  const cat = r?.categories[0];
  const close = onClose;
  const choose = onChoose;

  // Read through a ref: the caller passes a new closure every render, and the effect
  // must not re-run (and re-focus) for that.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An open selector takes its own keys (Escape shuts the list, not the card).
      if (document.querySelector("[data-initiative-peek] [data-popup-open]")) return;
      if (e.key === "Escape") onCloseRef.current();
      // ← → step through the ballot, unless a field has the keys.
      const field = (e.target as HTMLElement | null)?.closest?.("input, textarea, select");
      if (field || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft") navRef.current?.onStep(-1);
      if (e.key === "ArrowRight") navRef.current?.onStep(1);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const card = document.querySelector<HTMLElement>(`[data-initiative-peek="${item.slug}"]`);
    (card?.querySelector<HTMLElement>("[data-peek-select]:not([data-disabled])") ??
      card?.querySelector<HTMLElement>("a"))?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-5"
      data-initiative-peek={item.slug}
    >
      {
        /* The page dims; a click on it closes the card. It stays part of the page during the
         morph, so the dashed chip under it stays dimmed too. */
      }
      <div
        aria-hidden="true"
        onMouseDown={close}
        className="absolute inset-0 bg-[rgba(15,30,44,.55)]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Positioned, so it paints over the dim (an absolute layer) before it.
        className="relative w-[min(400px,100%)]"
      >
        {/* Always the same size: the text scrolls, the choices stay at the bottom. */}
        <div
          data-peek-box=""
          className="flex h-[min(460px,calc(100dvh-40px))] flex-col overflow-hidden rounded-[18px] border border-edge2 bg-panel-modal shadow-modal"
        >
          {/* The header stays put: what it is, its title, where it goes. */}
          <div className="flex flex-none flex-col gap-3 px-5 pb-3 pt-5">
            <div className="flex items-start justify-between gap-3">
              <p className="m-0 flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-white/55">
                {cat && (
                  <CategoryDot
                    slug={cat}
                    className="size-[7px] flex-none"
                    data-peek-dot=""
                  />
                )}
                {cat && <span className="truncate">{categoryOf(cat)?.label}</span>}
                {r && (
                  <span className="whitespace-nowrap tnum">
                    {cat && "· "}
                    {usd(r.goalUsd)} goal
                  </span>
                )}
              </p>
              <div className="-my-1 -mr-1 flex flex-none items-center gap-1">
                <button
                  type="button"
                  aria-label="Close"
                  onClick={close}
                  className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <h3
              id={titleId}
              data-peek-title=""
              className="m-0 font-inter-tight text-[18px] font-medium leading-snug text-white"
            >
              {item.title}
            </h3>
            {/* Where it is on this ballot, as a stamp; its pen opens the places it can go. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {note
                ? (
                  // Settled: a gold stamp with a lock; why, in a popover (hover, focus or tap).
                  <Tooltip.Root open={noteOpen} onOpenChange={setNoteOpen}>
                    <Tooltip.Trigger
                      delay={150}
                      closeOnClick={false}
                      render={
                        <span
                          tabIndex={0}
                          aria-label={note}
                          data-peek-place=""
                          onClick={() => setNoteOpen(true)}
                          className={cn(
                            STAMP,
                            "pr-2 outline-none focus-visible:ring-2 focus-visible:ring-vote",
                            SETTLED,
                          )}
                        />
                      }
                    >
                      {now?.display}
                      <Lock className="size-3" aria-hidden="true" />
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Positioner side="bottom" sideOffset={6} className="z-[220]">
                        <Tooltip.Popup
                          data-peek-note=""
                          className="max-w-[260px] rounded-[12px] border border-edge2 bg-panel px-2.5 py-1.5 font-inter-tight text-[12.5px] leading-snug text-white shadow-menu outline-none"
                        >
                          {note}
                        </Tooltip.Popup>
                      </Tooltip.Positioner>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                )
                : (
                  <span
                    data-peek-place=""
                    className={cn(
                      STAMP,
                      canChange ? "pr-1" : "pr-2.5",
                      now && now.value.length === 1 ? IN_TIER : OFF_TIER,
                    )}
                  >
                    {now?.display}
                    {canChange && (
                      <Select
                        value={current}
                        items={choices.map((c) => ({ value: c.value, label: c.display }))}
                        onValueChange={(v) => {
                          if (v != null) choose(v as W);
                        }}
                      >
                        <SelectPrimitive.Trigger
                          aria-label={`Change where ${item.title} goes`}
                          data-peek-select=""
                          className="grid size-[22px] place-items-center rounded-[5px] bg-white/[.08] text-current outline-none transition-colors hover:bg-white/[.16] focus-visible:ring-2 focus-visible:ring-current data-[popup-open]:bg-white/[.16]"
                        >
                          <Pencil className="size-3" aria-hidden="true" />
                        </SelectPrimitive.Trigger>
                        <SelectContent>
                          {choices.map((c) => (
                            <SelectItem
                              key={c.value}
                              value={c.value}
                              disabled={c.disabled}
                              aria-label={c.name}
                            >
                              <span className="flex items-center gap-2.5">
                                <b
                                  className={cn(
                                    "flex w-5 flex-none justify-center font-inter-tight font-bold",
                                    c.value.length === 1 ? "text-dao-green" : "text-white/55",
                                  )}
                                >
                                  {c.grade}
                                </b>
                                {c.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </span>
                )}
              {paid && (
                <span className="font-inter-tight text-[12.5px] text-vote">You paid {paid}</span>
              )}
            </div>
          </div>
          {/* Only the description scrolls; the arrows on its faded edges scroll it too. */}
          <div ref={descWrap} className="relative min-h-0 flex-1">
            <div
              ref={desc}
              // Keyboard users scroll it with the arrow keys once it has the focus.
              tabIndex={scrolls ? 0 : undefined}
              aria-label={scrolls ? "Description" : undefined}
              style={scrolls ? { maskImage: MASK, WebkitMaskImage: MASK } : undefined}
              className="h-full overflow-y-auto overscroll-contain px-5 pb-3 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dao-green/60 [&::-webkit-scrollbar]:hidden"
            >
              {r?.summary && (
                <p className="m-0 text-[13.5px] leading-relaxed text-white/75">{r.summary}</p>
              )}
            </div>
            {edges.top && <ScrollArrow dir={-1} onClick={() => page(-1)} />}
            {edges.bottom && <ScrollArrow dir={1} onClick={() => page(1)} />}
          </div>
          <div className="flex flex-col gap-3 border-t border-white/[.06] px-5 pb-5 pt-3">
            <div className="flex items-center gap-2">
              {nav && nav.index >= 0 && nav.count > 1 && (
                // The previous and next initiative on the ballot.
                <>
                  <button
                    type="button"
                    aria-label="Previous initiative"
                    disabled={nav.index === 0}
                    onClick={() => nav.onStep(-1)}
                    className={STEP}
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next initiative"
                    disabled={nav.index === nav.count - 1}
                    onClick={() => nav.onStep(1)}
                    className={STEP}
                  >
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </button>
                </>
              )}
              <LinkButton
                className="ml-auto"
                variant="ghost"
                sm
                to={`/initiative/${item.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open full page for ${item.title} (opens in a new tab)`}
              >
                Open full page
              </LinkButton>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Over a faded edge of the description, as the sponsors row's arrows: under the chevron,
 * the card's own colour, fading out toward the text in a wide ellipse, so the chevron reads
 * over whatever line is under it. */
function ScrollArrow({ dir, onClick }: { dir: 1 | -1; onClick: () => void }) {
  const Icon = dir > 0 ? ChevronDown : ChevronUp;
  return (
    <button
      type="button"
      aria-label={dir > 0 ? "Scroll the description down" : "Scroll the description up"}
      onClick={onClick}
      style={{ opacity: `var(${dir > 0 ? "--edge-b" : "--edge-t"}, 0)` }}
      className={cn(
        "group absolute left-1/2 z-10 grid h-8 w-24 -translate-x-1/2 justify-items-center outline-none",
        dir > 0 ? "bottom-0 items-end" : "top-0 items-start",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-panel-modal",
          dir > 0
            ? "[mask-image:radial-gradient(ellipse_60%_100%_at_50%_100%,#000_45%,transparent)]"
            : "[mask-image:radial-gradient(ellipse_60%_100%_at_50%_0%,#000_45%,transparent)]",
        )}
      />
      <span className="relative grid size-6 place-items-center rounded-full text-white/80 transition-colors group-hover:text-dao-green group-focus-visible:ring-2 group-focus-visible:ring-dao-green/60">
        <Icon className="size-5" aria-hidden="true" />
      </span>
    </button>
  );
}
