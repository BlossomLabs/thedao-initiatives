import { useId, useState } from "react";
import { type Tier, tierName } from "@shared/vote/ballot";
import type { NextTierEntry } from "~/hooks/use-vote";
import { usdShort, usdShortUp } from "~/lib/format";
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

const TIP =
  "absolute bottom-full right-0 z-20 mb-2 block w-64 rounded-lg border border-white/30 bg-panel p-2.5 text-left text-[12px] font-normal leading-snug text-white/70 shadow-[0_2px_6px_rgba(0,0,0,.3)]";

/** A trigger with a small tooltip: opens on hover, on focus and on a tap (touch has no
 * hover), closes on Escape, on blur or when the pointer leaves. */
function HoverTip(
  { trigger, className, children }: {
    trigger: React.ReactNode;
    className: string;
    children: React.ReactNode;
  },
) {
  const [open, setOpen] = useState(false);
  const id = useId();
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
        className={`cursor-help rounded border-0 bg-transparent p-0 font-[inherit] ${WRAP} underline decoration-dotted underline-offset-2 ${className}`}
      >
        {trigger}
      </button>
      {open && <span id={id} role="tooltip" className={TIP}>{children}</span>}
    </span>
  );
}

/** How far ahead a Tier-S initiative is: how much less its backers could give, between
 * them, and it would still be funded in Tier-S. `lead` is micro-USD; under one $1K step
 * there is nothing to say. */
export function LeadFigure({ lead }: { lead: string }) {
  const amount = dollars(lead);
  if (amount < 1000) return null;
  return (
    <HoverTip trigger={<>{usdShort(amount)} ahead</>} className="text-vote">
      Its backers could give this much less between them and it would still be funded in{" "}
      <span className="whitespace-nowrap">Tier-S</span>.
    </HoverTip>
  );
}

/**
 * How much more backing moves an initiative up a tier, and what that would change.
 * The detail opens on hover, on focus and on a tap (touch has no hover), and closes
 * on Escape, on blur or when the pointer leaves. Without an amount that gets it
 * there, it is only a sentence. `now` is its tier in the live tally, if it is funded.
 */
export function NextTierFigure(
  { next, now, titles, label, final }: {
    next: NextTierEntry;
    now?: Tier;
    titles: ReadonlyMap<string, string>;
    /** Replaces the trigger text ("needed $X" on a row the vote did not fund). */
    label?: string;
    /** After the vote: the knock-on lists name only the target tier, and there is no "Now"
     * line (the row already says where the initiative finished). */
    final?: boolean;
  },
) {
  const name = tierName(next.tier);
  if (next.gap === null) {
    return (
      <span className={`${WRAP} text-white/40`}>
        Out of reach for <span className="whitespace-nowrap">{name}</span>
      </span>
    );
  }
  const title = (slug: string) => titles.get(slug) ?? slug;
  const gap = usdShortUp(dollars(next.gap));
  const named = (e: { slug: string; tier: Tier }) =>
    final ? title(e.slug) : `${title(e.slug)} (${tierName(e.tier)})`;
  const lines = {
    comesIn: next.comesIn.map(named),
    dropsOut: next.dropsOut.map(named),
    moves: next.moves.map((e) => `${title(e.slug)} ${tierName(e.from)} → ${tierName(e.to)}`),
  };
  const none = !lines.comesIn.length && !lines.dropsOut.length && !lines.moves.length;
  return (
    <HoverTip
      className={label ? "text-white/45" : "text-vote"}
      trigger={label ?? (
        // In a narrow column it wraps before the tier, never inside "Tier-S".
        <>
          {gap} to <span className="whitespace-nowrap">{name}</span>
        </>
      )}
    >
      {!final && <p className="m-0 mb-1">{now ? `Now ${tierName(now)}.` : "Now not funded."}</p>}
      {/* The search backs it first of all, so this is the least it could take. */}
      <b className="font-semibold text-white">
        {final
          ? (
            <>
              With {gap} more backing it would have made{" "}
              <span className="whitespace-nowrap">{name}</span>:
            </>
          )
          : <>With {gap} more backing:</>}
      </b>
      {none ? <p className="m-0 mt-1">Nothing else changes.</p> : (
        <>
          <Line label={final ? `Comes into ${name}` : "Comes in"} items={lines.comesIn} />
          <Line label={final ? `Drops out of ${name}` : "Drops out"} items={lines.dropsOut} />
          <Line label="Moves" items={lines.moves} />
        </>
      )}
    </HoverTip>
  );
}

/** What a row of the closed vote shows in place of its tier chip or "needed $X", or null
 * when the round has nothing for it: Tier-S rows their lead, Tier-A/B rows the gap to the
 * tier above, and a row the vote did not fund its "needed $X" as the trigger of what
 * would have happened. `needed` is that text. */
export function finalFigure(
  { tier, next, lead, titles, needed }: {
    tier?: Tier;
    next?: NextTierEntry;
    lead?: string;
    titles?: ReadonlyMap<string, string>;
    needed: string;
  },
): React.ReactNode | null {
  if (tier === "S") return lead ? <LeadFigure lead={lead} /> : null;
  if (!next || !titles) return null;
  if (tier) return <NextTierFigure next={next} titles={titles} final />;
  return next.gap === null
    ? null
    : <NextTierFigure next={next} titles={titles} final label={needed} />;
}
