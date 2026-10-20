import { useState } from "react";
import { Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRowMotion } from "~/components/board/Shuffle";
import { TypeBadge } from "~/components/ui/Badge";
import BackerLogo from "~/components/ui/BackerLogo";
import CardTitle from "~/components/board/CardTitle";
import CardLabel, { cardLabel } from "~/components/board/CardLabel";
import WatchlistButton from "~/components/board/WatchlistButton";
import RatingChip, { RatingForm } from "~/components/ratings/RatingChip";
import Reveal from "~/components/ui/Reveal";
import type { Ratings } from "~/lib/board-view";
import type { Card } from "~/lib/api-types";
import { pctText, plural, usd, usdShort } from "~/lib/format";
import { usePrefetchInitiative } from "~/hooks/use-initiative";
import { cn } from "~/lib/utils";
import { voteFloorPct, type VoteSettings } from "@shared/vote";
import {
  calloutText,
  useVoteReveal,
  VoteCallout,
  voteStanding,
  VoteTick,
} from "~/components/board/VoteMark";

type Watch = { has: (id: string) => boolean; toggle: (id: string) => void };

/**
 * The list's columns, shared by the header and every row (subgrid), so each
 * column lines up down the list: bookmark · type · title · (admins) rating · funded · backers
 * (the pledgers' logos, or the count when nobody pledged) ·
 * raised of goal. Each row carries its own funding bar, inset under the title
 * (not a divider: rounded, inside the content column, the real divider below
 * it). Compact (the list under 720px wide, as on phones, or in a narrow
 * window): bookmark | title, type and label, raised and the backers, then the bar with its %
 * at the end. The rows follow the list's own width (a container query), not
 * the window's.
 */
const COLUMNS =
  "grid grid-cols-[2rem_4.25rem_minmax(0,1fr)_4rem_5.5rem_11rem] gap-x-4 @max-[720px]/list:grid-cols-1";
/** With the admin ratings, once the list is 880px wide: a Rating column after the
 * title. Narrower, the column would squeeze the titles to a word a line, so
 * the star goes at the end of the title line instead (compact rows: after the amount). */
const RATED_COLUMNS =
  `${COLUMNS} @min-[880px]/list:grid-cols-[2rem_4.25rem_minmax(0,1fr)_6rem_4rem_5.5rem_11rem]`;
const ROW =
  "col-span-full grid grid-cols-subgrid items-center px-4 @max-[720px]/list:grid-cols-[auto_minmax(0,1fr)_auto] @max-[720px]/list:gap-x-3";
const NUM = "text-right tnum whitespace-nowrap";
/** The row's own funding bar: 3px, rounded, a faint track and the funded part in green. */
function FundingBar(
  { pct, tick, className, children }: {
    pct: number;
    tick?: number;
    className?: string;
    /** The vote callout, over the mark. */
    children?: React.ReactNode;
  },
) {
  return (
    <span className={cn("relative block", className)} aria-hidden="true">
      <span className="relative block h-[3px] overflow-hidden rounded-full bg-white/[.08]">
        {pct > 0 && (
          <i
            data-funding-fill
            className="absolute inset-y-0 left-0 min-w-[3px] rounded-full bg-gradient-to-r from-dao-green to-dao-bright shadow-bar"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        )}
      </span>
      {tick !== undefined && <VoteTick at={tick} reached={pct >= tick} />}
      {children}
    </span>
  );
}

function Row(
  { card, label, watch, vote, aiScore, ratings }: {
    card: Card;
    label: ReturnType<typeof cardLabel>;
    aiScore?: number;
    watch?: Watch;
    /** Admins only: the rating chip after the title. */
    ratings?: Ratings;
    vote?: VoteSettings;
  },
) {
  const { initiative: r, summary, pct, backers, logos } = card;
  // With the vote display on, the % turns green at the vote floor, where the tick is.
  const standing = vote?.show ? voteStanding(summary.total, r.goalUsd, vote) : null;
  // The Backers column: every logo when they are all the backers, else three and "+N" for the rest.
  const shownLogos = backers > logos.length ? logos.slice(0, 3) : logos;
  const more = backers - shownLogos.length;
  const pctOn = standing ? standing.kind === "eligible" : pct >= 1;
  const tick = vote ? voteFloorPct(r.goalUsd, vote) : 0;
  // Hovering or tapping the row shows its vote callout under the bar.
  const reveal = useVoteReveal(Boolean(standing));
  // Rows come and go with the filters: a fade, and a glide when others move.
  const rowMotion = useRowMotion();
  const prefetch = usePrefetchInitiative(r.slug);
  const [rating, setRating] = useState(false);
  // Small and overlapping, so four fit the column (smaller still on the compact
  // line). Without a logo, the silhouette.
  const logoStack = (small = false) => (
    <>
      {shownLogos.map((l, i) => (
        <span key={i} className={cn("flex first:ml-0", small ? "-ml-1" : "-ml-1.5")}>
          <BackerLogo
            logoUrl={l.logoUrl}
            company={l.company}
            url={l.url}
            className={cn(
              "p-0.5 ring-2 ring-panel",
              small ? "size-[18px] [&>svg]:size-2.5" : "size-6 [&>svg]:size-3",
            )}
          />
        </span>
      ))}
      {more > 0 && <span className="ml-1.5 text-white/50" aria-hidden="true">+{more}</span>}
    </>
  );
  const chip = ratings && (
    <RatingChip
      summary={ratings[r.id]}
      open={rating}
      onToggle={() => setRating((o) => !o)}
      controls={`rate-${r.id}`}
    />
  );
  return (
    <motion.li
      {...rowMotion}
      {...reveal.handlers}
      className={cn(
        ROW,
        // Open, the row stacks above the rows after it, so the callout is never under them.
        reveal.open && "relative z-10",
        "gap-y-1.5 border-b border-white/[.07] pb-2.5 pt-2 last:border-b-0 @max-[720px]/list:gap-y-1 @max-[720px]/list:py-2.5",
      )}
    >
      <span className="-ml-1.5 @max-[720px]/list:row-span-3 @max-[720px]/list:self-start">
        {watch && (
          <WatchlistButton
            on={watch.has(r.id)}
            onToggle={() => watch.toggle(r.id)}
            title={r.title}
          />
        )}
      </span>
      <TypeBadge type={r.type} inline className="justify-self-start @max-[720px]/list:hidden" />
      <div className="flex min-w-0 items-center gap-2.5 @max-[720px]/list:col-start-2 @max-[720px]/list:row-start-1">
        {/* The same title as the cards: the primary category's icon names them all. */}
        <CardTitle
          title={r.title}
          href={`/initiative/${r.slug}`}
          categories={r.categories}
          onPrefetch={prefetch}
          className="min-w-0 pr-0 text-[14px] leading-[1.3]"
        />
        {label.map((k) => (
          <CardLabel
            key={k}
            kind={k}
            aiScore={aiScore}
            className="flex-none @max-[720px]/list:hidden"
          />
        ))}
        {ratings && (
          // 720 to 880px: at the end of the title line (no room for the column).
          <span className="-mr-1 ml-auto hidden flex-none @min-[720px]/list:block @min-[880px]/list:hidden">
            {chip}
          </span>
        )}
      </div>
      {ratings && (
        // The Rating column (from 880px; narrower, at the end of the title line).
        <span className="-ml-1 hidden justify-self-start @min-[880px]/list:block">{chip}</span>
      )}
      <span
        className={cn(
          NUM,
          "text-[12.5px] font-medium @max-[720px]/list:hidden",
          pctOn ? "text-dao-green" : "text-white/40",
        )}
      >
        {pctText(pct)}
        <span className="sr-only">funded{standing && `. ${calloutText(standing)}`}</span>
      </span>
      {/* Desktop: the Backers column, the pledgers' logos when there are any. */}
      <span className={cn(NUM, "text-[12.5px] text-white/60 @max-[720px]/list:hidden")}>
        {logos.length > 0
          ? (
            <span className="flex items-center justify-end">
              {logoStack()}
              <span className="sr-only">{plural(backers, "backer")}</span>
            </span>
          )
          : backers > 0
          ? (
            <>
              {backers}
              <span className="sr-only">{backers === 1 ? " backer" : " backers"}</span>
            </>
          )
          : (
            <>
              <span className="text-white/25" aria-hidden="true">–</span>
              <span className="sr-only">No backers yet</span>
            </>
          )}
      </span>
      {
        /* Desktop: the Raised cell. Phones: one line under the title, the chips then the
          amount at the right; it never wraps, so the amount stays beside the chips. */
      }
      <div className="contents @max-[720px]/list:col-span-2 @max-[720px]/list:col-start-2 @max-[720px]/list:row-start-2 @max-[720px]/list:flex @max-[720px]/list:flex-nowrap @max-[720px]/list:items-center @max-[720px]/list:gap-x-2">
        <TypeBadge
          type={r.type}
          inline
          className="hidden flex-none px-2 py-[2px] text-[10px] @max-[720px]/list:inline-flex"
        />
        {label.map((k) => (
          <CardLabel
            key={k}
            kind={k}
            aiScore={aiScore}
            className="hidden flex-none px-2 py-[2px] text-[10px] @max-[720px]/list:inline-flex"
          />
        ))}
        <span
          className={cn(
            NUM,
            "text-[12.5px] text-white/50 @max-[720px]/list:ml-1 @max-[720px]/list:text-left @max-[720px]/list:text-[12px]",
          )}
        >
          <span className="@max-[720px]/list:hidden">
            <b className="font-medium text-white/90">{usd(summary.total)}</b> of {usd(r.goalUsd)}
          </span>
          {/* Phones: the short form. */}
          <span className="hidden @max-[720px]/list:inline" aria-hidden="true">
            <b className="font-medium text-white/90">{usdShort(summary.total)}</b> of{" "}
            {usdShort(r.goalUsd)}
          </span>
          {backers > 0 && <span className="sr-only">, {plural(backers, "backer")}</span>}
        </span>
        {ratings && (
          // Compact: after the amount.
          <span className="-ml-1 hidden flex-none @max-[720px]/list:inline-flex">{chip}</span>
        )}
        {backers > 0 && (
          // Compact: the backers last, the pledgers' logos and +N for the rest, or just how
          // many when nobody pledged (screen readers have it with the amount).
          <span
            className="hidden flex-none items-center text-[12px] @max-[720px]/list:flex"
            aria-hidden="true"
          >
            {logos.length > 0
              ? logoStack(true)
              : (
                <span className="flex items-center gap-1 text-white/50 tnum">
                  <Users className="size-3" />
                  {backers}
                </span>
              )}
          </span>
        )}
      </div>
      {/* The row's own bar: under the title on desktop, the last line on phones (with its %). */}
      <div className="col-start-3 flex items-center gap-2.5 @max-[720px]/list:col-span-2 @max-[720px]/list:col-start-2 @max-[720px]/list:row-start-3">
        {vote?.show && standing
          ? (
            <FundingBar pct={pct} tick={tick} className="flex-1">
              {reveal.open && <VoteCallout state={standing} at={tick} side="bottom" />}
            </FundingBar>
          )
          : <FundingBar pct={pct} className="flex-1" />}
        <span
          className={cn(
            NUM,
            "hidden w-12 text-[12.5px] font-semibold @max-[720px]/list:inline-block",
            pctOn ? "text-dao-green" : "text-white/40",
          )}
          aria-hidden="true"
        >
          {pctText(pct)}
        </span>
      </div>
      {ratings && (
        // Under the row, from the title column on (the full row on phones).
        <Reveal
          show={rating}
          id={`rate-${r.id}`}
          className="col-start-3 col-end-[-1] @max-[720px]/list:col-span-2 @max-[720px]/list:col-start-2"
        >
          <div className="pb-1 pt-2">
            <RatingForm
              initiativeId={r.id}
              summary={ratings[r.id]}
              onClose={() => setRating(false)}
            />
          </div>
        </Reveal>
      )}
    </motion.li>
  );
}

/** Compact rows: every initiative at a glance, the numbers in aligned columns. */
export default function BoardList(
  { cards, aiTop = [], aiScores, featured, watch, vote, ratings }: {
    cards: Card[];
    /** Initiatives the AI search put first. */
    aiTop?: string[];
    aiScores?: ReadonlyMap<string, number>;
    /** Pinned by the team. */
    featured?: Set<string>;
    watch?: Watch;
    /** The vote floor on each bar, while the display is on. */
    vote?: VoteSettings;
    /** Admins only: each row's rating chip. */
    ratings?: Ratings;
  },
) {
  return (
    // No overflow clip: the last row's vote callout hangs below the panel.
    <div className="@container/list rounded-2xl border border-white/10 bg-white/[.04]">
      <div className={ratings ? RATED_COLUMNS : COLUMNS}>
        <div
          className={cn(
            ROW,
            "border-b border-white/10 py-1.5 font-inter-tight text-[10.5px] font-medium uppercase tracking-[.1em] text-muted @max-[720px]/list:hidden",
          )}
          aria-hidden="true"
        >
          <span />
          <span>Type</span>
          <span>Initiative</span>
          {ratings && <span className="hidden @min-[880px]/list:block">Rating</span>}
          <span className="text-right">Funded</span>
          <span className="text-right">Backers</span>
          <span className="text-right">Raised</span>
        </div>
        <ul className="col-span-full m-0 grid list-none grid-cols-subgrid p-0">
          <AnimatePresence>
            {cards.map((c) => (
              <Row
                key={c.initiative.id}
                card={c}
                aiScore={aiScores?.get(c.initiative.id)}
                label={cardLabel({
                  aiTop: aiTop.includes(c.initiative.id),
                  featured: featured?.has(c.initiative.id),
                  approvedAt: c.initiative.approvedAt,
                })}
                watch={watch}
                vote={vote}
                ratings={ratings}
              />
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}
