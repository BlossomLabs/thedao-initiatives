import { useId, useState } from "react";
import { type Tier, tierName } from "@shared/vote/ballot";
import type { NextTierEntry } from "~/hooks/use-vote";
import { usdShortUp } from "~/lib/format";
import { dollars } from "~/lib/vote-results";

/** In a list cell the figure wraps (two lines at most in its column) instead of spilling
 * into the neighbours: right-aligned, tight leading, never wider than its cell. */
const WRAP = "block max-w-full whitespace-normal text-right text-[12px] leading-tight";

/** One line of the hover: who comes in, drops out or moves, if anyone does. */
function Line({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <p className="m-0 mt-1">
      <b className="font-semibold text-white">{label}:</b> {items.join(", ")}
    </p>
  );
}

/**
 * How much more backing moves an initiative up a tier, and what that would change.
 * The detail opens on hover, on focus and on a tap (touch has no hover), and closes
 * on Escape, on blur or when the pointer leaves. Without an amount that gets it
 * there, it is only a sentence. `now` is its tier in the live tally, if it is funded.
 */
export function NextTierFigure(
  { next, now, titles }: {
    next: NextTierEntry;
    now?: Tier;
    titles: ReadonlyMap<string, string>;
  },
) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const name = tierName(next.tier);
  if (next.gap === null) {
    return <span className={`${WRAP} text-white/40`}>Out of reach for {name}</span>;
  }
  const title = (slug: string) => titles.get(slug) ?? slug;
  const gap = usdShortUp(dollars(next.gap));
  const lines = {
    comesIn: next.comesIn.map((e) => `${title(e.slug)} (${tierName(e.tier)})`),
    dropsOut: next.dropsOut.map((e) => `${title(e.slug)} (${tierName(e.tier)})`),
    moves: next.moves.map((e) => `${title(e.slug)} ${tierName(e.from)} → ${tierName(e.to)}`),
  };
  const none = !lines.comesIn.length && !lines.dropsOut.length && !lines.moves.length;
  return (
    <span className={`relative ${WRAP}`}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className={`cursor-help rounded border-0 bg-transparent p-0 font-[inherit] ${WRAP} text-vote underline decoration-dotted underline-offset-2`}
      >
        {gap} to {name}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full right-0 z-20 mb-2 block w-64 rounded-lg border border-white/30 bg-panel p-2.5 text-left text-[12px] font-normal leading-snug text-white/70 shadow-[0_2px_6px_rgba(0,0,0,.3)]"
        >
          <p className="m-0 mb-1">{now ? `Now ${tierName(now)}.` : "Now not funded."}</p>
          {/* The search backs it first of all, so this is the least it could take. */}
          <b className="font-semibold text-white">With {gap} more backing:</b>
          {none ? <p className="m-0 mt-1">Nothing else changes.</p> : (
            <>
              <Line label="Comes in" items={lines.comesIn} />
              <Line label="Drops out" items={lines.dropsOut} />
              <Line label="Moves" items={lines.moves} />
            </>
          )}
        </span>
      )}
    </span>
  );
}
