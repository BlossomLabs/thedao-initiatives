import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { LinkButton } from "~/components/ui/Button";
import CategoryDot from "~/components/ui/CategoryDot";
import { categoryOf } from "~/lib/categories";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { PeekChoice } from "./InitiativePeek";
import type { BallotItem } from "./TierBallot";

/** How far a finger has to travel sideways for a swipe to the next or previous card. */
export const SWIPE_PX = 70;
/** A move this far, mostly sideways, makes it a swipe rather than a tap or a scroll. */
const SLOP = 10;

/** Where a swipe ends: the next card (1), the previous (-1), or back where it was (0). */
export function swipeStep(dx: number, index: number, count: number): -1 | 0 | 1 {
  if (dx <= -SWIPE_PX && index < count - 1) return 1;
  if (dx >= SWIPE_PX && index > 0) return -1;
  return 0;
}

/**
 * On a phone, an initiative's card fills the screen: what it is, then where it goes on
 * this ballot (the three tiers as big buttons, Not ranked and Skip under them). A choice
 * moves it and the card stays; a swipe sideways (or ‹ ›) goes to the next or previous
 * initiative, in the order the list showed when the card opened.
 */
export default function PhoneCard<W extends string>(
  { item, nav, choices, current, onChoose, note, paid, onClose }: {
    item: BallotItem;
    nav: { index: number; count: number; onStep: (dir: -1 | 1) => void };
    /** The three tiers, then the list and skipped, in order (as InitiativePeek's). */
    choices: PeekChoice<W>[];
    current: W;
    /** A choice: the initiative moves there; the card stays open. */
    onChoose: (w: W) => void;
    /** Why it can't move (a settled tier), and what it paid. */
    note?: string;
    /** What this badge paid for it, once its tier has settled: "$7,000". */
    paid?: string;
    onClose: () => void;
  },
) {
  const titleId = useId();
  const tiers = choices.filter((c) => c.value.length === 1);
  const others = choices.filter((c) => c.value.length !== 1);
  const now = choices.find((c) => c.value === current);
  const inTier = current.length === 1;
  const r = item.card?.initiative;
  const cat = r?.categories[0];

  // The swipe: how far the card has followed the finger, and which way the next one
  // came in from (for its slide).
  const [dx, setDx] = useState(0);
  const [from, setFrom] = useState<-1 | 0 | 1>(0);
  const track = useRef<{ id: number; x0: number; y0: number; sideways?: boolean } | null>(null);

  const step = (dir: -1 | 1) => {
    if (dir === 1 && nav.index >= nav.count - 1) return;
    if (dir === -1 && nav.index <= 0) return;
    setFrom(dir);
    setDx(0);
    nav.onStep(dir);
  };

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      const field = (e.target as HTMLElement | null)?.closest?.("input, textarea, select");
      if (field || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft") stepRef.current(-1);
      if (e.key === "ArrowRight") stepRef.current(1);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.querySelector<HTMLElement>("[data-phone-card] [data-phone-back]")
      ?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  const swipe = {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button, a")) return;
      track.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const t = track.current;
      if (!t || t.id !== e.pointerId) return;
      const x = e.clientX - t.x0;
      const y = e.clientY - t.y0;
      if (t.sideways === undefined) {
        if (Math.hypot(x, y) < SLOP) return;
        t.sideways = Math.abs(x) > Math.abs(y);
        if (!t.sideways) {
          // A scroll of the description: let it be.
          track.current = null;
          return;
        }
      }
      // At the first or last card it gives a little, then stops.
      const edge = (x > 0 && nav.index === 0) || (x < 0 && nav.index === nav.count - 1);
      setDx(edge ? x / 4 : x);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const t = track.current;
      track.current = null;
      if (!t || t.id !== e.pointerId || !t.sideways) return;
      const dir = swipeStep(dx, nav.index, nav.count);
      if (dir) step(dir);
      else setDx(0);
    },
    onPointerCancel: () => {
      track.current = null;
      setDx(0);
    },
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-phone-card={item.slug}
      className="fixed inset-0 z-[200] flex flex-col bg-dao-blue bg-[linear-gradient(160deg,var(--color-dao-blue)_30%,var(--color-dao-blue-dark)_90%)] pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(.5rem,env(safe-area-inset-top))]"
    >
      <div className="flex flex-none items-center gap-2 px-4">
        <button
          type="button"
          data-phone-back=""
          aria-label="Back to the list"
          onClick={onClose}
          className="-ml-3 grid size-11 place-items-center rounded-lg text-white/85 hover:bg-white/10"
        >
          <ChevronLeft className="size-6" aria-hidden="true" />
        </button>
        <p
          className={cn(
            "m-0 flex min-w-0 flex-1 items-center gap-1.5 truncate font-inter-tight text-[15px] font-semibold",
            note ? "text-vote" : inTier ? "text-[#a7e3a5]" : "text-white/80",
          )}
        >
          {now?.display}
          {note && <Lock className="size-3.5 flex-none" aria-hidden="true" />}
        </p>
        <span className="flex-none text-[13px] text-white/65 tnum">
          {nav.index + 1} of {nav.count}
        </span>
      </div>
      <div className="mx-4 mt-2 h-1 flex-none overflow-hidden rounded-full bg-white/[.12]">
        <div
          className="h-full rounded-full bg-white/70 transition-[width] duration-200"
          style={{ width: `${((nav.index + 1) / Math.max(1, nav.count)) * 100}%` }}
        />
      </div>

      <div className="relative min-h-0 flex-1 px-4 pt-3.5">
        <article
          key={item.slug}
          {...swipe}
          style={{
            transform: dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined,
            transition: track.current?.sideways ? "none" : undefined,
          }}
          className={cn(
            "flex h-full touch-pan-y select-none flex-col rounded-[20px] border border-white/15 bg-white/[.07] p-5 shadow-[0_14px_30px_rgba(0,0,0,.2)] transition-transform duration-200",
            from === 1 &&
              "motion-safe:animate-in motion-safe:slide-in-from-right-10 motion-safe:fade-in",
            from === -1 &&
              "motion-safe:animate-in motion-safe:slide-in-from-left-10 motion-safe:fade-in",
          )}
        >
          <p className="m-0 flex min-w-0 items-center gap-1.5 truncate text-[13px] text-white/65">
            {cat && <CategoryDot slug={cat} className="size-2 flex-none" />}
            {cat && <span className="truncate">{categoryOf(cat)?.label}</span>}
          </p>
          <h2
            id={titleId}
            className="m-0 mt-2.5 font-inter-tight text-[22px] font-bold leading-[1.22] text-white"
          >
            {item.title}
          </h2>
          {r && (
            <p className="m-0 mt-2.5 text-[15px] tnum">
              <b className="font-semibold text-white">{usd(r.goalUsd)}</b>{" "}
              <span className="text-white/60">goal</span>
              {paid && <span className="ml-2 text-vote">You paid {paid}</span>}
            </p>
          )}
          {note && <p className="m-0 mt-2 text-[13px] leading-snug text-vote">{note}</p>}
          <div className="mt-3.5 min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {r?.summary && (
              <p className="m-0 select-text text-[14px] leading-relaxed text-white/75">
                {r.summary}
              </p>
            )}
          </div>
          <div className="mt-3 flex flex-none items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Previous initiative"
              disabled={nav.index === 0}
              onClick={() => step(-1)}
              className="grid size-11 place-items-center rounded-full border border-white/15 text-white/80 disabled:opacity-30"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <LinkButton
              variant="ghost"
              sm
              to={`/initiative/${item.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open full page for ${item.title} (opens in a new tab)`}
            >
              Open full page
            </LinkButton>
            <button
              type="button"
              aria-label="Next initiative"
              disabled={nav.index >= nav.count - 1}
              onClick={() => step(1)}
              className="grid size-11 place-items-center rounded-full border border-white/15 text-white/80 disabled:opacity-30"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>
        </article>
      </div>
      <p className="m-0 flex-none pt-2 text-center text-[12px] text-white/50">
        Swipe for the next initiative
      </p>

      <div className="flex-none px-4 pt-3" role="group" aria-label={`Where ${item.title} goes`}>
        <div className="grid grid-cols-3 gap-2">
          {tiers.map((c) => {
            const on = c.value === current;
            return (
              <button
                key={c.value}
                type="button"
                aria-pressed={on}
                aria-label={c.name}
                disabled={c.disabled && !on}
                onClick={() => !on && !c.disabled && onChoose(c.value)}
                className={cn(
                  "flex h-[68px] flex-col items-center justify-center gap-0.5 rounded-[14px] border font-inter-tight transition-colors disabled:opacity-40",
                  on
                    ? "border-dao-green bg-dao-green text-[#0f2a17]"
                    : "border-dao-green/50 bg-dao-green/[.12] text-white",
                )}
              >
                <span className="text-[17px] font-bold leading-none">
                  {c.display.split(" · ")[0]}
                </span>
                <span className="text-[12px] opacity-75">{c.label}</span>
              </button>
            );
          })}
        </div>
        {others.length > 0 && (
          <div className="mt-2 flex gap-2">
            {others.map((c) => {
              const on = c.value === current;
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={on}
                  aria-label={c.name}
                  disabled={c.disabled && !on}
                  onClick={() => !on && !c.disabled && onChoose(c.value)}
                  className={cn(
                    "h-11 flex-1 rounded-xl border text-[14px] transition-colors disabled:opacity-40",
                    on ? "border-white/70 text-white" : "border-white/15 text-white/80",
                  )}
                >
                  {c.label === "Skip" ? "Skip: hide it" : c.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
