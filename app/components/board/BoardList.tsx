import { Popover } from "@base-ui/react/popover";
import { AnimatePresence, motion } from "motion/react";
import { useRowMotion } from "~/components/board/Shuffle";
import { TypeBadge } from "~/components/ui/Badge";
import CardTitle from "~/components/board/CardTitle";
import CardLabel, { cardLabel } from "~/components/board/CardLabel";
import WatchlistButton from "~/components/board/WatchlistButton";
import type { Card } from "~/lib/api-types";
import { pctText, plural, usd, usdShort } from "~/lib/format";
import { usePrefetchInitiative } from "~/hooks/use-initiative";
import { usePhone } from "~/hooks/use-media";
import { cn } from "~/lib/utils";
import type { VoteSettings } from "@shared/vote";
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
 * column lines up down the list: bookmark · type · title · funded · backers ·
 * raised of goal (phones: the backers on a tap of the amount). Each row carries its own funding bar, inset under the title
 * (not a divider: rounded, inside the content column, the real divider below
 * it). Phones: bookmark | title, type and label, raised, then the
 * bar with its % at the end.
 */
const COLUMNS =
  "grid grid-cols-[2rem_4.25rem_minmax(0,1fr)_4rem_4.5rem_11rem] gap-x-4 max-[640px]:grid-cols-1";
const ROW =
  "col-span-full grid grid-cols-subgrid items-center px-4 max-[640px]:grid-cols-[auto_minmax(0,1fr)_auto] max-[640px]:gap-x-3";
const NUM = "text-right tnum whitespace-nowrap";

/**
 * Phones: "4 backers" over the amount, in the site's tooltip style (as on the
 * category icon). A popover, not a tooltip, so a tap opens it. Desktop has the
 * Backers column instead, so the amount stays plain there.
 */
function Backers({ count, children }: { count: number; children: React.ReactElement }) {
  const phone = usePhone();
  if (!count || !phone) return children;
  return (
    <Popover.Root>
      <Popover.Trigger
        render={children}
        nativeButton={false}
        openOnHover
        delay={200}
        className="rounded underline decoration-white/30 decoration-dotted underline-offset-4 outline-none hover:decoration-white/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dao-bright"
      />
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} className="z-[210]">
          <Popover.Popup className="rounded-[14px] border border-edge2 bg-panel px-2.5 py-1.5 font-inter-tight text-[12px] text-white shadow-menu outline-none">
            {plural(count, "backer")}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

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
  { card, label, watch, vote }: {
    card: Card;
    label: ReturnType<typeof cardLabel>;
    watch?: Watch;
    vote?: VoteSettings;
  },
) {
  const { initiative: r, summary, pct, backers } = card;
  // With the vote display on, the % turns green at the vote floor, where the tick is.
  const pctOn = vote?.show ? pct >= vote.floorPct : pct >= 1;
  const standing = vote?.show ? voteStanding(summary.total, r.goalUsd, vote) : null;
  // Hovering or tapping the row shows its vote callout under the bar.
  const reveal = useVoteReveal(Boolean(standing));
  // Rows come and go with the filters: a fade, and a glide when others move.
  const rowMotion = useRowMotion();
  const prefetch = usePrefetchInitiative(r.slug);
  return (
    <motion.li
      {...rowMotion}
      {...reveal.handlers}
      className={cn(
        ROW,
        // Open, the row stacks above the rows after it, so the callout is never under them.
        reveal.open && "relative z-10",
        "gap-y-1.5 border-b border-white/[.07] pb-2.5 pt-2 last:border-b-0 max-[640px]:gap-y-1 max-[640px]:py-2.5",
      )}
    >
      <span className="-ml-1.5 max-[640px]:row-span-3 max-[640px]:self-start">
        {watch && (
          <WatchlistButton
            on={watch.has(r.id)}
            onToggle={() => watch.toggle(r.id)}
            title={r.title}
          />
        )}
      </span>
      <TypeBadge type={r.type} inline className="justify-self-start max-[640px]:hidden" />
      <div className="flex min-w-0 items-center gap-2.5 max-[640px]:col-start-2 max-[640px]:row-start-1">
        {/* The same title as the cards: the primary category's icon names them all. */}
        <CardTitle
          title={r.title}
          href={`/initiative/${r.slug}`}
          categories={r.categories}
          onPrefetch={prefetch}
          className="min-w-0 pr-0 text-[14px] leading-[1.3]"
        />
        {label.map((k) => <CardLabel key={k} kind={k} className="flex-none max-[640px]:hidden" />)}
      </div>
      <span
        className={cn(
          NUM,
          "text-[12.5px] font-medium max-[640px]:hidden",
          pctOn ? "text-dao-green" : "text-white/40",
        )}
      >
        {pctText(pct)}
        <span className="sr-only">funded{standing && `. ${calloutText(standing)}`}</span>
      </span>
      {/* Desktop: the Backers column. */}
      <span className={cn(NUM, "text-[12.5px] text-white/60 max-[640px]:hidden")}>
        {backers > 0
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
      <div className="contents max-[640px]:col-span-2 max-[640px]:col-start-2 max-[640px]:row-start-2 max-[640px]:flex max-[640px]:flex-nowrap max-[640px]:items-center max-[640px]:gap-x-2">
        <TypeBadge
          type={r.type}
          inline
          className="hidden flex-none px-2 py-[2px] text-[10px] max-[640px]:inline-flex"
        />
        {label.map((k) => (
          <CardLabel
            key={k}
            kind={k}
            className="hidden flex-none px-2 py-[2px] text-[10px] max-[640px]:inline-flex"
          />
        ))}
        <Backers count={backers}>
          <span
            className={cn(
              NUM,
              "text-[12.5px] text-white/50 max-[640px]:ml-1 max-[640px]:text-left max-[640px]:text-[12px]",
            )}
          >
            <span className="max-[640px]:hidden">
              <b className="font-medium text-white/90">{usd(summary.total)}</b> of {usd(r.goalUsd)}
            </span>
            {/* Phones: the short form. */}
            <span className="hidden max-[640px]:inline" aria-hidden="true">
              <b className="font-medium text-white/90">{usdShort(summary.total)}</b> of{" "}
              {usdShort(r.goalUsd)}
            </span>
            {backers > 0 && <span className="sr-only">, {plural(backers, "backer")}</span>}
          </span>
        </Backers>
      </div>
      {/* The row's own bar: under the title on desktop, the last line on phones (with its %). */}
      <div className="col-start-3 flex items-center gap-2.5 max-[640px]:col-span-2 max-[640px]:col-start-2 max-[640px]:row-start-3">
        {vote?.show && standing
          ? (
            <FundingBar pct={pct} tick={vote.floorPct} className="flex-1">
              {reveal.open && <VoteCallout state={standing} at={vote.floorPct} side="bottom" />}
            </FundingBar>
          )
          : <FundingBar pct={pct} className="flex-1" />}
        <span
          className={cn(
            NUM,
            "hidden w-12 text-[12.5px] font-semibold max-[640px]:inline-block",
            pctOn ? "text-dao-green" : "text-white/40",
          )}
          aria-hidden="true"
        >
          {pctText(pct)}
        </span>
      </div>
    </motion.li>
  );
}

/** Compact rows: every initiative at a glance, the numbers in aligned columns. */
export default function BoardList(
  { cards, aiTop = [], featured, watch, vote }: {
    cards: Card[];
    /** Initiatives the AI search put first. */
    aiTop?: string[];
    /** Pinned by the team. */
    featured?: Set<string>;
    watch?: Watch;
    /** The vote floor on each bar, while the display is on. */
    vote?: VoteSettings;
  },
) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.04]">
      <div className={COLUMNS}>
        <div
          className={cn(
            ROW,
            "border-b border-white/10 py-1.5 font-inter-tight text-[10.5px] font-medium uppercase tracking-[.1em] text-muted max-[640px]:hidden",
          )}
          aria-hidden="true"
        >
          <span />
          <span>Type</span>
          <span>Initiative</span>
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
                label={cardLabel({
                  aiTop: aiTop.includes(c.initiative.id),
                  featured: featured?.has(c.initiative.id),
                  approvedAt: c.initiative.approvedAt,
                })}
                watch={watch}
                vote={vote}
              />
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}
