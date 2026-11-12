import { type Tier, tierName } from "@shared/vote/ballot";
import type { NextTierEntry } from "~/hooks/use-vote";
import { Callout } from "~/components/board/VoteMark";
import { usdShort, usdShortUp } from "~/lib/format";
import { dollars } from "~/lib/vote-results";

/**
 * What the vote results say about one initiative: a Tier-S initiative how far ahead
 * it is (`amount`, dollars), any other how much more backing takes it to the next tier
 * (`next`, whose gap is null when no amount alone gets it there).
 */
export type WhatIf =
  | { kind: "lead"; amount: number }
  | { kind: "gap"; next: NextTierEntry };

/** The initiative's what-if, or null when the round has nothing for it. A Tier-S lead
 * under one $1K step says nothing, and Tier-S has no tier above to reach. */
export function whatIf(
  { tier, next, lead }: { tier?: Tier; next?: NextTierEntry; lead?: string },
): WhatIf | null {
  if (tier === "S") {
    const amount = lead ? dollars(lead) : 0;
    return amount >= 1000 ? { kind: "lead", amount } : null;
  }
  return next ? { kind: "gap", next } : null;
}

/** Where the tick goes, % of the bar (the ask): what donors and pledgers raised plus the
 * gap, capped at the bar's end. Undefined (no tick) for a lead, for a gap no amount
 * closes, and without an ask to measure against. */
export function whatIfTick(w: WhatIf | null, raised: number, goal: number): number | undefined {
  if (w?.kind !== "gap" || w.next.gap === null || goal <= 0) return undefined;
  return Math.min(100, ((raised + dollars(w.next.gap)) / goal) * 100);
}

/** The value and its words: "$23k" and "to Tier-S", "$46k" and "ahead", or no value and
 * "Out of reach for Tier-B". Gaps round up, so they never read as less than they are. */
function parts(w: WhatIf): { value?: string; words: React.ReactNode; text: string } {
  if (w.kind === "lead") return { value: usdShort(w.amount), words: "ahead", text: "ahead" };
  const name = tierName(w.next.tier);
  // A tier's name never breaks inside "Tier-S".
  const tier = <span className="whitespace-nowrap">{name}</span>;
  if (w.next.gap === null) {
    return { words: <>Out of reach for {tier}</>, text: `Out of reach for ${name}` };
  }
  return { value: usdShortUp(dollars(w.next.gap)), words: <>to {tier}</>, text: `to ${name}` };
}

/** The knock-on lines: who comes into or drops out of the target tier (after the vote,
 * where lower tiers were decided later), or who comes in, drops out or moves anywhere
 * (during it). Empty when nothing else changes. */
function knockOn(
  next: NextTierEntry,
  titles: ReadonlyMap<string, string> | undefined,
  final: boolean,
): { label: string; items: string[] }[] {
  const title = (slug: string) => titles?.get(slug) ?? slug;
  const name = tierName(next.tier);
  const named = (e: { slug: string; tier: Tier }) =>
    final ? title(e.slug) : `${title(e.slug)} (${tierName(e.tier)})`;
  return [
    { label: final ? `Comes into ${name}` : "Comes in", items: next.comesIn.map(named) },
    { label: final ? `Drops out of ${name}` : "Drops out", items: next.dropsOut.map(named) },
    {
      label: "Moves",
      items: next.moves.map((e) => `${title(e.slug)} ${tierName(e.from)} → ${tierName(e.to)}`),
    },
  ].filter((l) => l.items.length > 0);
}

const LEAD_NOTE =
  "Its backers could give this much less between them and it would still be funded in";

/**
 * The figure as plain text, the value big and the words small: "$23k to Tier-S",
 * "$46k ahead", "Out of reach for Tier-B". On a card it sits in the amount row; the
 * details are in the bar's callout.
 */
export function WhatIfFigure({ w }: { w: WhatIf }) {
  const { value, words } = parts(w);
  return (
    <span data-what-if-figure className="whitespace-nowrap px-1 leading-none">
      {value && <b className="font-inter-tight text-[15px] font-semibold text-vote">{value}</b>}
      {value && " "}
      <small className="text-[11.5px] text-white/55">{words}</small>
    </span>
  );
}

/** The same, said in one go, for screen readers (the bar and its callout are hidden from them). */
export function whatIfText(
  w: WhatIf,
  titles: ReadonlyMap<string, string> | undefined,
  final: boolean,
): string {
  const { value, text } = parts(w);
  const head = value ? `${value} ${text}.` : `${text}.`;
  if (w.kind === "lead") return `${head} ${LEAD_NOTE} Tier-S.`;
  if (w.next.gap === null) return head;
  const lines = knockOn(w.next, titles, final);
  return lines.length
    ? `${head} ${lines.map((l) => `${l.label}: ${l.items.join(", ")}.`).join(" ")}`
    : `${head} Nothing else changes.`;
}

/**
 * The bar's callout for a what-if, in the look of the "qualify" callout: its arrow on
 * the tick, or at the bar's end when there is no tick (Tier-S, out of reach). The value
 * big, the words small, then the knock-on lines (or "Nothing else changes."), or for
 * Tier-S what the lead means. A tick past the bar's middle anchors it on the right, so
 * it opens towards the bar and stays in the row.
 */
export function WhatIfCallout(
  { w, at, side, titles, final = false }: {
    w: WhatIf;
    /** The tick, % of the bar; undefined puts the callout at the bar's end. */
    at?: number;
    side: "top" | "bottom";
    titles?: ReadonlyMap<string, string>;
    final?: boolean;
  },
) {
  const { value, words } = parts(w);
  const pos = at ?? 100;
  const lines = w.kind === "gap" && w.next.gap !== null ? knockOn(w.next, titles, final) : null;
  return (
    <Callout
      at={pos}
      side={side}
      align={pos > 50 ? "end" : "start"}
      className="w-60 whitespace-normal px-2.5 py-2 text-[12px] font-normal leading-snug text-white/70"
    >
      <span className="block whitespace-nowrap text-white">
        {value && <b className="font-inter-tight text-[16px] font-semibold text-vote">{value}</b>}
        {value && " "}
        <small className="text-[12px] text-white/70">{words}</small>
      </span>
      {w.kind === "lead" && (
        <span className="mt-1 block">
          {LEAD_NOTE} <span className="whitespace-nowrap">Tier-S</span>.
        </span>
      )}
      {lines && lines.length === 0 && <span className="mt-1 block">Nothing else changes.</span>}
      {lines?.map((l) => (
        <span key={l.label} className="mt-1 block">
          <b className="font-semibold text-white">{l.label}:</b> {l.items.join(", ")}
        </span>
      ))}
    </Callout>
  );
}
