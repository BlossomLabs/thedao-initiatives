import { type VoteSettings, voteState } from "@shared/vote";
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { usdShort } from "~/lib/format";

/** A missing amount, short and rounded up so it never reads as less than it is. */
const upShort = (n: number) =>
  usdShort(
    n < 1000 ? Math.ceil(n) : n < 10_000 ? Math.ceil(n / 100) * 100 : Math.ceil(n / 1000) * 1000,
  );
import { cn } from "~/lib/utils";

/** How close counts as "almost there": the tag shows within this many points of the floor. */
export const NEAR_POINTS = 5;

/** What the tick's callout says: past the floor, or what is missing when within
 * NEAR_POINTS of it; null (no callout) further away or while the display is off. */
export type CalloutState = { kind: "eligible" } | { kind: "near"; missing: number };
export function voteCallout(
  raised: number,
  goal: number,
  vote?: VoteSettings,
): CalloutState | null {
  if (!vote?.show || !goal) return null;
  const s = voteState(raised, goal, vote);
  if (s.kind !== "below") return { kind: "eligible" };
  return (100 * s.toFloorUsd) / goal <= NEAR_POINTS
    ? { kind: "near", missing: s.toFloorUsd }
    : null;
}

/** The callout for any initiative (list rows, on a click): past the floor, or what is missing. */
export function voteStanding(raised: number, goal: number, vote: VoteSettings): CalloutState {
  const s = voteState(raised, goal, vote);
  return s.kind === "below" ? { kind: "near", missing: s.toFloorUsd } : { kind: "eligible" };
}

/** The callout's words, as it shows them. */
export const calloutLabel = (state: CalloutState): string =>
  state.kind === "eligible" ? "First goal reached" : `${upShort(state.missing)} to first goal`;

/** The callout's words for screen readers. */
export const calloutText = (state: CalloutState): string =>
  state.kind === "eligible" ? "First goal reached" : `${upShort(state.missing)} to the first goal`;

/**
 * "$2k to first goal" (or "First goal reached"): a small callout that stays open over the bar's mark, its
 * arrow on the mark, for initiatives close to the floor. `side` is where it sits
 * (above on cards, below in list rows, where the title fills the space above).
 * The parent is `relative`, as for VoteTick.
 */
export function VoteCallout(
  { state, at, side }: { state: CalloutState; at: number; side: "top" | "bottom" },
) {
  const ok = state.kind === "eligible";
  const edge = ok ? "border-[rgba(92,183,90,.6)]" : "border-white/30";
  return (
    <span
      data-vote-callout
      className={cn(
        // Anchored by its arrow, 14px in from the left: it grows rightwards from the
        // mark (the floor sits on the left of the bar), so it never leaves the row.
        "pointer-events-none absolute z-[1]",
        // ~3px between the arrow's tip and the tick (which stands 2px off the bar).
        side === "top" ? "bottom-full mb-[13px]" : "top-full mt-[13px]",
      )}
      style={{ left: `calc(${Math.max(0, Math.min(100, at))}% - 14px)` }}
    >
      <span
        className={cn(
          // A tight shadow: a soft wide one dims the text around it, as if it showed through.
          "relative flex items-center gap-1 whitespace-nowrap rounded-lg border bg-panel px-2 py-[3px] font-inter-tight text-[11px] font-semibold leading-none text-white shadow-[0_2px_6px_rgba(0,0,0,.3)]",
          edge,
        )}
      >
        {ok
          ? (
            <>
              <Check className="size-3 text-dao-green" strokeWidth={3} aria-hidden="true" />
              {calloutLabel(state)}
            </>
          )
          : calloutLabel(state)}
        {/* The arrow: a square turned 45°, its two outer edges bordered, pointing at the mark. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-[14px] size-[9px] -translate-x-1/2 rotate-45 bg-panel",
            edge,
            side === "top" ? "-bottom-[5.5px] border-b border-r" : "-top-[5.5px] border-l border-t",
          )}
        />
      </span>
    </span>
  );
}

/**
 * The vote floor on a funding bar: a 1px mark a little taller than the bar,
 * quiet until the bar reaches it. The parent is `relative`.
 */
export function VoteTick({ at, reached }: { at: number; reached: boolean }) {
  return (
    <span
      data-vote-tick
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute -inset-y-[2px] w-px rounded-full",
        reached ? "bg-white/30" : "bg-white/55",
      )}
      style={{ left: `${Math.max(0, Math.min(100, at))}%` }}
    />
  );
}

/**
 * The whole card or list row reveals its callout: a mouse on it, a tap on it (not
 * on a link or button inside, which keep their own job), or the keyboard inside
 * it. A tap elsewhere or Esc hides it again. Spread `handlers` on the card or row.
 */
export function useVoteReveal(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!enabled) return { open: false, handlers: {} };
  return {
    open,
    handlers: {
      ref: (el: HTMLElement | null) => {
        ref.current = el;
      },
      onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && setOpen(true),
      onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && setOpen(false),
      onClick: (e: React.MouseEvent) => {
        if ((e.target as Element).closest("a, button, input, [role=button]")) return;
        setOpen(true);
      },
      onFocus: () => setOpen(true),
      onBlur: (e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      },
    },
  };
}
