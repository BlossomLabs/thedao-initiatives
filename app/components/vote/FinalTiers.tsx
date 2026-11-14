import CategoryDot from "~/components/ui/CategoryDot";
import { cn } from "~/lib/utils";
import { type Tier, tierName, TIERS } from "../../../shared/vote/ballot";
import { type BallotItem, TIER_LABELS } from "./TierBallot";

export const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** After the close, a settled tier table, read-only: a badge's ballot, or the vote's
 * result. Each tier row has its grade, label and the amount in it; each initiative a
 * chip, gold with its amount when its tier funded it, dimmed when it didn't. The same
 * look as the ballot's settled tiers (TierBallot). */
export default function FinalTiers(
  {
    items,
    tiers,
    funded,
    amounts,
    amountWord,
    liveAmountWord = amountWord,
    showZero,
    footer,
    label,
    highlight,
    provisional,
    mirrored,
    linked,
    active,
    onHover,
    onTap,
    joining,
    leaving,
    moved,
    liveTone = "green",
  }: {
    items: BallotItem[];
    /** slug → tier: the ballot that counted, or the tier that funded it. */
    tiers: Partial<Record<string, Tier>>;
    /** What the vote funded (slugs). */
    funded: ReadonlySet<string>;
    /** USD per initiative: what this badge paid, or what the vote awarded. */
    amounts: ReadonlyMap<string, number>;
    /** How a chip's amount reads aloud: "your share paid", "awarded". */
    amountWord: string;
    /** The same for a `provisional` chip: "your share would pay". */
    liveAmountWord?: string;
    /** A funded chip with nothing in `amounts` says $0 (a badge's ballot: it ranked a
     * winner the other ballots paid for), rather than no amount. */
    showZero?: boolean;
    /** The line under the table (totals). */
    /** A line under the table; none when a header says the totals. */
    footer?: React.ReactNode;
    /** Which funded chips are gold (the result: only what was on this badge's ballot);
     * the rest stay plain, not dimmed. Without it every funded chip is gold. */
    highlight?: ReadonlySet<string>;
    /** Of what's funded, what only the live tally funds (an open tier, if it settled now):
     * green, where what a settled tier funded is gold. */
    provisional?: ReadonlySet<string>;
    /** The grade boxes on the right (the result, so arrows from the ballot beside it
     * reach the chips without crossing them). */
    mirrored?: boolean;
    /** Chips with an arrow to the other table (winners on this badge's ballot): they
     * answer hover, focus and tap. */
    linked?: ReadonlySet<string>;
    /** The chip whose arrow shows: ringed. */
    active?: string;
    onHover?: (slug: string | undefined) => void;
    onTap?: (slug: string) => void;
    /** Names the table for screen readers: "Your ballot", "TheDAO's result". */
    label: string;
    /** A donation's preview (the vote results): what comes into a tier with it, with the
     * dollars given (dashed green, "+$X yours"), what drops out (red, struck through,
     * "dropped out"), and what it moves to another tier (`moved`: the tier it came from;
     * yellow, an arrow and "from S-Tier"). */
    joining?: ReadonlyMap<string, number>;
    leaving?: ReadonlySet<string>;
    moved?: ReadonlyMap<string, Tier>;
    /** How a `provisional` chip looks: green (a ballot's own page), or neutral (the vote
     * results, where green is kept for a donation's preview). */
    liveTone?: "green" | "neutral";
  },
) {
  return (
    // Its rows (S, A, B, totals) are the parent's rows when it sits in a subgrid, so two
    // tables side by side line up row by row; on its own it is a plain grid.
    <div
      className={cn(
        "grid min-w-0 grid-cols-1 grid-rows-subgrid gap-y-2",
        footer ? "row-span-4" : "row-span-3",
      )}
      role="group"
      aria-label={label}
    >
      {TIER_LABELS.map((t) => {
        // In a donation's preview: those that stay first, then yours, those moved in, and
        // last, together, those dropping out. Otherwise as listed.
        const rank = (slug: string) =>
          leaving?.has(slug) ? 3 : joining?.has(slug) ? 1 : moved?.has(slug) ? 2 : 0;
        const inHere = items.filter((i) => tiers[i.slug] === t.tier)
          .sort((a, b) => rank(a.slug) - rank(b.slug));
        const tierPaid = inHere.reduce(
          (a, i) => a + (leaving?.has(i.slug) ? 0 : amounts.get(i.slug) ?? 0),
          0,
        );
        // An open tier's amount is the live tally's, not settled: green.
        const tierLive = inHere.some((i) => provisional?.has(i.slug));
        return (
          <section
            key={t.tier}
            aria-label={`${t.grade} · ${t.label}`}
            className={cn(
              "flex min-h-[76px] min-w-0 items-stretch gap-2 rounded-xl border border-white/10 bg-white/[.03] p-1.5",
              mirrored && "flex-row-reverse",
            )}
          >
            <div className="flex w-[76px] flex-none flex-col items-center justify-center gap-1 rounded-lg bg-white/[.06] py-1.5">
              <b className="font-inter-tight text-[26px] font-bold leading-none text-dao-green">
                {t.grade}
              </b>
              <span className="text-center text-[11px] leading-tight text-white/60">
                {t.label}
              </span>
              {tierPaid > 0 && (
                <span
                  className={cn(
                    "text-[11px] font-semibold leading-none tnum",
                    tierLive
                      ? liveTone === "neutral" ? "text-white/70" : "text-[#a7e3a5]"
                      : "text-vote",
                  )}
                >
                  {dollars(tierPaid)}
                </span>
              )}
            </div>
            {inHere.length === 0
              ? (
                <span className="flex min-w-0 flex-1 items-center justify-center text-[13px] text-white/35">
                  Nothing in this tier
                </span>
              )
              : (
                <ul className="m-0 flex min-w-0 flex-1 list-none flex-wrap content-start gap-1.5 p-0 py-0.5">
                  {inHere.map((i) => {
                    const isFunded = funded.has(i.slug);
                    const lit = isFunded && (!highlight || highlight.has(i.slug));
                    const live = Boolean(provisional?.has(i.slug));
                    const gold = lit && !live;
                    const green = lit && live && liveTone === "green";
                    const youPaid = amounts.get(i.slug) ?? (showZero && lit ? 0 : undefined);
                    const cat = i.card?.initiative.categories[0];
                    const fundedWord = live ? "funded if it ended now" : "funded";
                    const given = joining?.get(i.slug);
                    const gone = Boolean(leaving?.has(i.slug));
                    const from = moved?.get(i.slug);
                    const up = from !== undefined &&
                      TIERS.indexOf(t.tier) < TIERS.indexOf(from);
                    const label = given !== undefined
                      ? `${i.title}, comes in with your ${dollars(given)}`
                      : gone
                      ? `${i.title}, drops out`
                      : from
                      ? `${i.title}, moves ${up ? "up" : "down"} from ${tierName(from)}`
                      : isFunded
                      ? youPaid !== undefined
                        ? `${i.title}, ${fundedWord}: ${live ? liveAmountWord : amountWord} ${
                          dollars(youPaid)
                        }`
                        : `${i.title}, ${fundedWord}`
                      : `${i.title}, not funded`;
                    return (
                      <li
                        key={i.slug}
                        title={label}
                        aria-label={label}
                        data-final-chip={i.slug}
                        data-gold={gold || undefined}
                        data-live={green || undefined}
                        data-active={active === i.slug || undefined}
                        {...(linked?.has(i.slug)
                          ? {
                            tabIndex: 0,
                            onPointerEnter: (e: React.PointerEvent) =>
                              e.pointerType === "mouse" && onHover?.(i.slug),
                            onPointerLeave: (e: React.PointerEvent) =>
                              e.pointerType === "mouse" && onHover?.(undefined),
                            onFocus: () => onHover?.(i.slug),
                            onBlur: () => onHover?.(undefined),
                            onClick: () => onTap?.(i.slug),
                          }
                          : {})}
                        className={cn(
                          "flex h-8 max-w-full items-center gap-1.5 overflow-hidden rounded-lg border px-2 outline-none transition-shadow",
                          // The chip an arrow starts or ends at: ringed in its own colour.
                          active === i.slug && (live
                            ? "shadow-[0_0_0_2px_rgba(92,183,90,.6)]"
                            : "shadow-[0_0_0_2px_rgba(233,185,73,.6)]"),
                          given !== undefined
                            ? "border-dashed border-dao-green bg-dao-green/[.14]"
                            : gone
                            ? "border-dashed border-[#ff8a88] bg-[#c22d2b]/[.22]"
                            : from
                            ? "border-dashed border-vote-pale/70 bg-vote/[.12]"
                            : gold
                            ? "border-vote/50 bg-vote/[.12]"
                            : green
                            ? "border-dao-green/50 bg-dao-green/[.12]"
                            : isFunded
                            ? "border-white/15 bg-white/[.07]"
                            : "border-white/15 bg-white/[.07] opacity-55",
                        )}
                      >
                        {cat ? <CategoryDot slug={cat} className="size-[7px] flex-none" /> : (
                          <span
                            className="size-[7px] flex-none rounded-full bg-white/30"
                            aria-hidden="true"
                          />
                        )}
                        {(gone || from) && (
                          <b
                            aria-hidden="true"
                            className={cn(
                              "flex-none text-[13px] leading-none",
                              gone ? "text-[#ff8a88]" : "text-vote-pale",
                            )}
                          >
                            {gone || !up ? "↓" : "↑"}
                          </b>
                        )}
                        <span
                          className={cn(
                            "min-w-0 truncate text-[12.5px] leading-none text-white/85",
                            gone && "line-through",
                          )}
                        >
                          {i.title}
                        </span>
                        {gone
                          ? (
                            <span className="ml-1 flex-none text-[11.5px] font-semibold leading-none text-[#ff8a88]">
                              dropped out
                            </span>
                          )
                          : from
                          ? (
                            <span className="ml-1 flex-none text-[11.5px] font-semibold leading-none text-vote-pale">
                              from {tierName(from)}
                            </span>
                          )
                          : given !== undefined
                          ? (
                            <span className="ml-1 flex-none text-[11.5px] font-semibold leading-none text-[#a7e3a5] tnum">
                              +{dollars(given)} yours
                            </span>
                          )
                          : youPaid !== undefined
                          ? (
                            <span
                              className={cn(
                                "ml-1 flex-none text-[11.5px] font-semibold leading-none tnum",
                                gold ? "text-vote" : green ? "text-[#a7e3a5]" : "text-white/70",
                              )}
                            >
                              {dollars(youPaid)}
                            </span>
                          )
                          : null}
                      </li>
                    );
                  })}
                </ul>
              )}
          </section>
        );
      })}
      {footer && <p className="m-0 pt-1 text-[13.5px] text-white/65 tnum">{footer}</p>}
    </div>
  );
}

const RING = 64;
const STROKE = 4;
const R = (RING - STROKE) / 2;
const C = 2 * Math.PI * R;

/** An avatar in a ring filled (in gold) `frac` of the way round from the top: on the
 * closed page, how much of a share or of the pool went to what was funded. */
export function AvatarRing(
  { frac, label, children }: { frac: number; label: string; children: React.ReactNode },
) {
  const f = Math.min(1, Math.max(0, frac));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(f * 100)}
      className="relative grid flex-none place-items-center"
      style={{ width: RING, height: RING }}
    >
      <svg width={RING} height={RING} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle
          cx={RING / 2}
          cy={RING / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-white/15"
        />
        {f > 0 && (
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${C * f} ${C}`}
            className="stroke-vote"
          />
        )}
      </svg>
      <div className="grid size-[48px] place-items-center overflow-hidden rounded-full [&_img]:!size-full">
        {children}
      </div>
    </div>
  );
}

/** A closed-page card's header: the avatar in its ring, the title, one line of totals, and
 * an optional action at the end. Both cards use it, so they line up. */
export function CardHeader(
  { avatar, title, line, action }: {
    avatar: React.ReactNode;
    title: string;
    line: React.ReactNode;
    action?: React.ReactNode;
  },
) {
  return (
    <div className="mb-2 flex items-center gap-4">
      {avatar}
      <div className="min-w-0 flex-1 space-y-0.5">
        <h2 className="m-0 font-inter-tight text-[20px] font-semibold leading-tight tracking-[-.01em] text-white">
          {title}
        </h2>
        <p className="m-0 text-[14px] leading-snug text-white/65 tnum">{line}</p>
      </div>
      {action}
    </div>
  );
}
