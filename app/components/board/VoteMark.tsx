import { type VoteSettings, voteState } from "@shared/vote";
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { usdShortUp } from "~/lib/format";

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
  state.kind === "eligible" ? "Qualified for the vote" : `${usdShortUp(state.missing)} to qualify`;

/** The callout's words for screen readers. */
export const calloutText = (state: CalloutState): string =>
  state.kind === "eligible"
    ? "Qualified for TheDAO's vote"
    : `${usdShortUp(state.missing)} to qualify for TheDAO's vote`;

/**
 * A small callout over a mark on the bar, its arrow on the mark: a panel with a
 * border and a tight shadow. `side` is where it sits (above on cards, below in list
 * rows, where the title fills the space above). `align` "start" anchors the arrow 14px
 * in from the panel's left, so it grows rightwards from the mark; "end" anchors it 14px
 * in from the right, for a mark near the bar's end, so it never leaves the row.
 * `className` sets the panel's layout and type. The parent is `relative`, as for VoteTick.
 */
export function Callout(
  { at, side, align = "start", edge = "border-white/30", className, children }: {
    at: number;
    side: "top" | "bottom";
    align?: "start" | "end";
    /** The border's colour, on the panel and its arrow alike. */
    edge?: string;
    className?: string;
    children: React.ReactNode;
  },
) {
  const pos = Math.max(0, Math.min(100, at));
  return (
    <span
      data-vote-callout
      className={cn(
        "pointer-events-none absolute z-[1]",
        // ~3px between the arrow's tip and the tick (which stands 2px off the bar).
        side === "top" ? "bottom-full mb-[13px]" : "top-full mt-[13px]",
      )}
      style={align === "end"
        ? { right: `calc(${100 - pos}% - 14px)` }
        : { left: `calc(${pos}% - 14px)` }}
    >
      <span
        className={cn(
          // A tight shadow: a soft wide one dims the text around it, as if it showed through.
          "relative block rounded-lg border bg-panel px-2 py-[3px] font-inter-tight text-[11px] font-semibold leading-none text-white shadow-[0_2px_6px_rgba(0,0,0,.3)]",
          edge,
          className,
        )}
      >
        {children}
        {/* The arrow: a square turned 45°, its two outer edges bordered, pointing at the mark. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute size-[9px] rotate-45 bg-panel",
            align === "end" ? "right-[14px] translate-x-1/2" : "left-[14px] -translate-x-1/2",
            edge,
            side === "top" ? "-bottom-[5.5px] border-b border-r" : "-top-[5.5px] border-l border-t",
          )}
        />
      </span>
    </span>
  );
}

/**
 * "$2k to qualify" (or "Qualified for the vote"): the callout over the vote floor's
 * mark, for initiatives close to the floor. The floor sits on the left of the bar, so
 * it grows rightwards from the mark.
 */
export function VoteCallout(
  { state, at, side }: { state: CalloutState; at: number; side: "top" | "bottom" },
) {
  const ok = state.kind === "eligible";
  return (
    <Callout
      at={at}
      side={side}
      edge={ok ? "border-[rgba(92,183,90,.6)]" : "border-white/30"}
      className="flex items-center gap-1 whitespace-nowrap"
    >
      {ok && <Check className="size-3 text-dao-green" strokeWidth={3} aria-hidden="true" />}
      {calloutLabel(state)}
    </Callout>
  );
}

/**
 * A mark on a funding bar, 1px and a little taller than the bar: the vote floor,
 * quiet once the bar reaches it, or (`whatIf`) where the vote results' next tier is
 * reached. The parent is `relative`.
 */
export function VoteTick(
  { at, reached, whatIf = false }: { at: number; reached: boolean; whatIf?: boolean },
) {
  return (
    <span
      data-vote-tick
      data-what-if={whatIf || undefined}
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
