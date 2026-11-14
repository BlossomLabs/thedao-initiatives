import { Suspense, useState } from "react";
import type { Tier } from "@shared/vote/ballot";
import BackerLogo from "~/components/ui/BackerLogo";
import { ArrowRight } from "lucide-react";
import { TypeBadge } from "~/components/ui/Badge";
import { fullyFunded } from "~/lib/board-view";
import CardTitle from "./CardTitle";
import WatchlistButton from "~/components/board/WatchlistButton";
import FundingStatus from "~/components/board/FundingStatus";
import { whatIf, WhatIfCallout, WhatIfFigure, whatIfTick } from "~/components/vote/NextTier";
import type { NextTierEntry } from "~/hooks/use-vote";
import CardLabel, { cardLabel } from "~/components/board/CardLabel";
import Bar from "~/components/ui/Bar";
import {
  calloutText,
  useVoteReveal,
  VoteCallout,
  voteCallout,
  voteStanding,
} from "~/components/board/VoteMark";
import { voteFloorPct, type VoteSettings } from "@shared/vote";
import Money from "~/components/ui/Money";
import { Button, LinkButton } from "~/components/ui/Button";
import { DonateStandIn, DonateWidget, preloadDonate } from "~/components/donate/LazyDonate";
import Reveal from "~/components/ui/Reveal";
import type { Card } from "~/lib/api-types";
import { pctText, plural, usd, usdShort } from "~/lib/format";
import { usePrefetchInitiative } from "~/hooks/use-initiative";
import { cn } from "~/lib/utils";
import RatingChip, { RatingForm } from "~/components/ratings/RatingChip";
import type { RatingSummary } from "@shared/ratings";

/**
 * Figma card: 16px radius, 24px padding, white/5 fill, white/10 border; Inter
 * Tight 16px medium title, 13px/1.6 white/55 summary, then a bottom block
 * pinned to the card's end (6px bar, 13px numbers, then one row: 38px buttons
 * on the left, "Pledged by" 40px chips on the right). Cards in a row share a
 * height, so the block sits at the same level across the row. "N backers" is
 * pledgers and donors together; the chips are the pledgers alone, as `logos` lists them.
 */
export { DonateStandIn };

export default function InitiativeCard({
  card,
  tokensOk,
  aiTop,
  aiScore,
  featured,
  onDonated,
  style,
  watch,
  rating,
  vote,
  votePct,
  votePendingPct,
  voteTier,
  final,
  next,
  lead,
  titles,
}: {
  card: Card;
  /** S-Tier's lead, micro-USD. */
  lead?: string;
  /** The open vote's gap to this initiative's next tier, drawn in place of the %. */
  next?: NextTierEntry;
  /** Slug → title, for the names in the gap's hover. */
  titles?: ReadonlyMap<string, string>;
  /** The closed vote's final amount: shown alone, with no goal and no type. */
  final?: number;
  /** The vote results: this initiative's vote share, % of its goal (gold on the bar). */
  votePct?: number;
  /** The part of it the settling tier would add if it settled now (lighter gold). */
  votePendingPct?: number;
  voteTier?: Tier;
  /** The vote floor on the bar, while the display is on. */
  vote?: VoteSettings;
  /** Watchlist state in this browser; omitted = no button. */
  watch?: { on: boolean; toggle: () => void };
  /** Public rating; canRate separately controls reviewing (omitted = no chip). */
  rating?: { summary?: RatingSummary; canRate?: boolean };
  tokensOk: boolean;
  aiTop?: boolean;
  aiScore?: number;
  /** Pinned by the team at the top (see featuredIds): shows the Featured label. */
  featured?: boolean;
  onDonated?: () => void;
  style?: React.CSSProperties;
}) {
  const { initiative: r, summary, pct, backers, logos, funded, donationsEnabled } = card;
  // One panel under the actions at a time: Donate, or (admins) the rating form.
  const [panel, setPanel] = useState<"donate" | "rate" | null>(null);
  const toggle = (p: "donate" | "rate") => setPanel((o) => o === p ? null : p);
  const prefetch = usePrefetchInitiative(r.slug);
  // A result card shows only its final amount, so that is what reads as nothing raised.
  const zero = final === undefined ? !summary.total : !final;
  // With the vote display on, the % turns green at the vote floor, where the tick is.
  const pctOn = vote?.show
    ? voteStanding(summary.total, r.goalUsd, vote).kind === "eligible"
    : !zero;
  // The vote results' what-if: S-Tier's lead, or the gap to the next tier (to B-Tier for
  // one the vote didn't fund). Its tick and callout sit on the bar; the figure stays in
  // the amount row.
  const w = whatIf({ tier: voteTier, next, lead });
  const wTick = whatIfTick(w, summary.total, r.goalUsd);
  const tick = vote ? voteFloorPct(r.goalUsd, vote) : 0;
  // Near the floor or past it: always shown. Otherwise the card shows it on hover or tap.
  const callout = voteCallout(summary.total, r.goalUsd, vote);
  const reveal = useVoteReveal(Boolean(w) || (Boolean(vote?.show) && !callout));
  const shown = callout ??
    (reveal.open && vote ? voteStanding(summary.total, r.goalUsd, vote) : null);
  // The top edge: AI pick or New, then the Featured pin.
  const label = cardLabel({ aiTop, featured, approvedAt: r.approvedAt });
  const canDonate = tokensOk && donationsEnabled;
  return (
    <div
      {...reveal.handlers}
      style={style}
      className={cn(
        "card card-hover flex flex-col",
        aiTop &&
          "border-[rgba(92,183,90,.5)] shadow-[0_0_0_1px_rgba(92,183,90,.25),0_14px_30px_rgba(0,0,0,.35)]",
      )}
      data-initiative-id={r.id}
    >
      {label.length > 0 && (
        <span className="absolute -top-2.5 left-3.5 flex items-center gap-1.5">
          {label.map((k) => <CardLabel key={k} kind={k} aiScore={aiScore} />)}
        </span>
      )}
      {final === undefined && <TypeBadge type={r.type} />}
      <CardTitle
        title={r.title}
        href={`/initiative/${r.slug}`}
        categories={r.categories}
        onPrefetch={prefetch}
      />
      <p className="mb-5 mt-2.5 line-clamp-3 min-h-[42px] text-[13px] leading-[1.6] text-white/55">
        {r.summary}
      </p>
      {w
        ? (
          <Bar
            pct={pct}
            votePct={votePct}
            votePendingPct={votePendingPct}
            tick={wTick}
            whatIf
            className="mt-auto"
          >
            {reveal.open && (
              <WhatIfCallout
                w={w}
                at={wTick}
                side="top"
                titles={titles}
                final={final !== undefined}
              />
            )}
          </Bar>
        )
        : vote?.show
        ? (
          // Room above the bar for the callout.
          <div className={cn("mt-auto", callout && "pt-9")}>
            <Bar
              pct={pct}
              votePct={votePct}
              votePendingPct={votePendingPct}
              tick={tick}
              label={`${pctText(pct)} funded. ${
                calloutText(voteStanding(summary.total, r.goalUsd, vote))
              }`}
            >
              {shown && <VoteCallout state={shown} at={tick} side="top" />}
            </Bar>
          </div>
        )
        : <Bar pct={pct} votePct={votePct} votePendingPct={votePendingPct} className="mt-auto" />}
      <div
        className={cn(
          "mt-2 flex justify-between gap-2.5 text-[13px]",
          zero ? "text-white/40" : "text-dao-green",
        )}
      >
        <span className="whitespace-nowrap">
          <b
            className={cn(
              "font-inter-tight font-normal",
              zero ? "text-white/40" : "text-dao-green",
            )}
          >
            {final === undefined ? <Money value={summary.total} /> : usdShort(final)}
          </b>
          {final === undefined && <>{" "}of {usd(r.goalUsd)}</>}
          {backers > 0 && (
            <span className="text-[12px] text-white/30">· {plural(backers, "backer")}</span>
          )}
        </span>
        {w && final !== undefined
          // After the vote the figure takes the place of the tier chip (the section names it).
          ? <WhatIfFigure w={w} />
          : w
          ? (
            // During the vote its tier stays in sight beside the figure.
            <span className="flex min-w-0 items-center gap-3">
              {voteTier && <FundingStatus tier={voteTier} byVote />}
              <WhatIfFigure w={w} />
            </span>
          )
          : funded || fullyFunded(card, votePct) || (final !== undefined && voteTier)
          ? <FundingStatus tier={voteTier} byVote={(votePct ?? 0) > 0 || final !== undefined} />
          : final !== undefined
          // Not funded and nothing computed for it yet: the final amount says it all.
          ? null
          : (
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "text-[12px]",
                  pctOn ? "text-dao-green" : zero ? "text-white/25" : "text-white/45",
                )}
              >
                {pctText(pct)}
              </span>
            </span>
          )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canDonate && (
          <Button
            variant="primary"
            sm
            onPointerEnter={preloadDonate}
            onFocus={preloadDonate}
            onClick={() => {
              preloadDonate();
              toggle("donate");
            }}
          >
            {panel === "donate" ? "Close" : "Donate"}
          </Button>
        )}
        <LinkButton
          variant="ghost"
          sm
          to={`/initiative/${r.slug}`}
          prefetch="intent"
          onMouseEnter={prefetch}
          onFocus={prefetch}
        >
          Details <ArrowRight className="size-3.5" />
        </LinkButton>
        {watch && (
          <WatchlistButton
            on={watch.on}
            onToggle={watch.toggle}
            title={r.title}
            // As big as the rating star beside it.
            iconSize="size-3.5"
          />
        )}
        {watch && rating && <span className="h-4 w-px flex-none bg-white/15" aria-hidden="true" />}
        {rating && (
          <RatingChip
            canRate={rating.canRate}
            summary={rating.summary}
            open={panel === "rate"}
            onToggle={() => toggle("rate")}
            controls={`rate-${r.id}`}
          />
        )}
        {logos.length > 0 && (
          // Right of the buttons; on a card too narrow for both, its own line, still right-aligned.
          <div className="ml-auto flex items-center gap-2">
            <span className="mr-0.5 font-inter-tight text-[12px] text-white/30">Pledged by</span>
            {/* Without a logo the URL is empty, and BackerLogo draws the silhouette. */}
            {logos.map((l, i) => (
              <BackerLogo key={i} logoUrl={l.logoUrl} company={l.company} url={l.url} />
            ))}
          </div>
        )}
      </div>
      <Reveal show={canDonate && panel === "donate"}>
        <div className="mt-3.5 border-t border-edge pt-3.5">
          <Suspense fallback={<DonateStandIn />}>
            <DonateWidget
              initiativeId={r.id}
              slug={r.slug}
              safeAddress={r.safeAddress}
              onConfirmed={onDonated}
            />
          </Suspense>
        </div>
      </Reveal>
      {rating?.canRate && (
        <Reveal show={panel === "rate"} id={`rate-${r.id}`}>
          <div className="mt-3.5 border-t border-edge pt-3.5">
            <RatingForm
              initiativeId={r.id}
              summary={rating.summary}
              onClose={() => setPanel(null)}
              card
            />
          </div>
        </Reveal>
      )}
    </div>
  );
}
