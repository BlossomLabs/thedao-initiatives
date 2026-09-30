import { Suspense, useState } from "react";
import BackerLogo from "~/components/ui/BackerLogo";
import { ArrowRight, Landmark, Wallet } from "lucide-react";
import { Link } from "react-router";
import { FundedChip, TypeBadge } from "~/components/ui/Badge";
import CardTitle from "./CardTitle";
import WatchlistButton from "~/components/board/WatchlistButton";
import CardLabel, { cardLabel } from "~/components/board/CardLabel";
import Bar from "~/components/ui/Bar";
import {
  calloutText,
  useVoteReveal,
  VoteCallout,
  voteCallout,
  voteStanding,
} from "~/components/board/VoteMark";
import type { VoteSettings } from "@shared/vote";
import Money from "~/components/ui/Money";
import { Button, LinkButton } from "~/components/ui/Button";
import { lazyPart } from "~/lib/lazy-part";
import Reveal from "~/components/ui/Reveal";
import type { Card } from "~/lib/api-types";
import { pctText, plural, usd } from "~/lib/format";
import { usePrefetchInitiative } from "~/hooks/use-initiative";
import { cn } from "~/lib/utils";

/**
 * Figma card: 16px radius, 24px padding, white/5 fill, white/10 border; Inter
 * Tight 16px medium title, 13px/1.6 white/55 summary, then a bottom block
 * pinned to the card's end (6px bar, 13px numbers, then one row: 38px buttons
 * on the left, "Pledged by" 40px chips on the right). Cards in a row share a
 * height, so the block sits at the same level across the row. "N backers" is
 * pledgers and donors together; the chips are the pledgers alone, as `logos` lists them.
 */
/**
 * The Donate panel carries the wallet stack, so it loads only once a card's
 * Donate button is hovered or pressed. Until it is in, and if its chunk fails,
 * this look-alike takes its place: the same layout, every control disabled.
 */
export function DonateStandIn() {
  const chip =
    "rounded-full border border-edge2 bg-white/5 px-4 py-2 font-inter-tight text-[13px] text-soft max-[760px]:px-4 max-[760px]:py-[11px]";
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2.5 pb-2.5">
        <div className="flex flex-wrap gap-2">
          {["50", "500", "5000", "50000"].map((c) => (
            <button key={c} type="button" className={chip} disabled>
              ${Number(c).toLocaleString("en-US")}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-0.5 rounded-xl border border-edge2 bg-card pl-3.5">
            <span className="flex-none font-inter-tight text-[14px] font-light text-muted">$</span>
            <input
              className="min-w-0 flex-1 bg-transparent py-2.5 pl-1 pr-3.5 font-inter-tight text-[14px] font-light text-white outline-none placeholder:text-white/35"
              placeholder="Custom amount ($1 minimum)"
              aria-label="Amount in US dollars"
              disabled
            />
          </label>
          <div className="w-[110px] flex-none rounded-xl border border-edge2 bg-card py-2.5 pl-3 pr-2 font-inter-tight text-[14px] text-white/60">
            USDC
          </div>
        </div>
      </div>
      <label className="my-0.5 flex items-center gap-2 small text-soft">
        <input type="checkbox" className="size-4" disabled />
        <span>
          I agree to these{" "}
          <Link to="/donation-terms" target="_blank" rel="noopener" className="underline">
            Donation Terms
          </Link>.
        </span>
      </label>
      <div className="flex gap-1.5 rounded-[14px] border border-edge bg-white/[.03] p-1">
        {[
          { label: "Wallet", icon: <Wallet className="size-[15px]" /> },
          { label: "Exchange", icon: <Landmark className="size-[15px]" /> },
        ].map((m, i) => (
          <button
            key={m.label}
            type="button"
            disabled
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border border-transparent px-1.5 py-2 font-inter-tight text-[12.5px] font-medium text-muted max-[760px]:py-3",
              i === 0 && "border-edge2 bg-card text-white",
            )}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>
      <Button variant="primary" disabled>Donate</Button>
    </div>
  );
}

const { Component: DonateWidget, preload: preloadDonate } = lazyPart(
  () => import("~/components/donate/DonateWidget"),
  DonateStandIn,
);

export default function InitiativeCard({
  card,
  tokensOk,
  aiTop,
  featured,
  onDonated,
  style,
  watch,
  vote,
}: {
  card: Card;
  /** The vote floor on the bar, while the display is on. */
  vote?: VoteSettings;
  /** Watchlist state in this browser; omitted = no button. */
  watch?: { on: boolean; toggle: () => void };
  tokensOk: boolean;
  aiTop?: boolean;
  /** Pinned by the team at the top (see featuredIds): shows the Featured label. */
  featured?: boolean;
  onDonated?: () => void;
  style?: React.CSSProperties;
}) {
  const { initiative: r, summary, pct, backers, logos, funded, donationsEnabled } = card;
  const [open, setOpen] = useState(false);
  const prefetch = usePrefetchInitiative(r.slug);
  const zero = !summary.total;
  // With the vote display on, the % turns green at the vote floor, where the tick is.
  const pctOn = vote?.show ? pct >= vote.floorPct : !zero;
  // Near the floor or past it: always shown. Otherwise the card shows it on hover or tap.
  const callout = voteCallout(summary.total, r.goalUsd, vote);
  const reveal = useVoteReveal(Boolean(vote?.show) && !callout);
  const shown = callout ??
    (reveal.open && vote ? voteStanding(summary.total, r.goalUsd, vote) : null);
  // One label on the top edge, by priority: AI pick, then Featured, then New.
  const label = cardLabel({ aiTop, featured, approvedAt: r.approvedAt });
  const canDonate = tokensOk && donationsEnabled;
  return (
    <div
      {...reveal.handlers}
      style={style}
      className={cn(
        "card card-hover flex flex-col motion-safe:animate-fade-in-up",
        aiTop &&
          "border-[rgba(92,183,90,.5)] shadow-[0_0_0_1px_rgba(92,183,90,.25),0_14px_30px_rgba(0,0,0,.35)]",
      )}
      data-initiative-id={r.id}
    >
      {label && (
        <span className="absolute -top-2.5 left-3.5 flex">
          <CardLabel kind={label} />
        </span>
      )}
      <TypeBadge type={r.type} />
      <CardTitle
        title={r.title}
        href={`/initiative/${r.slug}`}
        categories={r.categories}
        onPrefetch={prefetch}
      />
      <p className="mb-5 mt-2.5 line-clamp-3 min-h-[42px] text-[13px] leading-[1.6] text-white/55">
        {r.summary}
      </p>
      {vote?.show
        ? (
          // Room above the bar for the callout.
          <div className={cn("mt-auto", callout && "pt-9")}>
            <Bar
              pct={pct}
              tick={vote.floorPct}
              label={`${pctText(pct)} funded. ${
                calloutText(voteStanding(summary.total, r.goalUsd, vote))
              }`}
            >
              {shown && <VoteCallout state={shown} at={vote.floorPct} side="top" />}
            </Bar>
          </div>
        )
        : <Bar pct={pct} className="mt-auto" />}
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
            <Money value={summary.total} />
          </b>{" "}
          of {usd(r.goalUsd)}
          {backers > 0 && (
            <span className="text-[12px] text-white/30">· {plural(backers, "backer")}</span>
          )}
        </span>
        {funded ? <FundedChip /> : (
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
              setOpen((o) => !o);
            }}
          >
            {open ? "Close" : "Donate"}
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
        {watch && <WatchlistButton on={watch.on} onToggle={watch.toggle} title={r.title} />}
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
      <Reveal show={canDonate && open}>
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
    </div>
  );
}
