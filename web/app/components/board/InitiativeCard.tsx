import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { FundedChip, TypeBadge } from "~/components/ui/Badge";
import Bar from "~/components/ui/Bar";
import { Button, LinkButton } from "~/components/ui/Button";
import DonateWidget from "~/components/donate/DonateWidget";
import type { Card } from "~/lib/api-types";
import { pctText, plural, usd } from "~/lib/format";
import { usePrefetchInitiative } from "~/hooks/use-initiative";
import { cn } from "~/lib/utils";

/**
 * Figma card: 16px radius, 24px padding, white/5 fill, white/10 border; Inter
 * Tight 16px medium title, 13px/1.6 white/55 summary, then a bottom block
 * pinned to the card's end (6px bar, 13px numbers, "Sponsored by" 40px chips,
 * 38px buttons). Cards in a row share a height, so the block sits at the same
 * level across the row.
 */
export default function InitiativeCard({
  card,
  tokensOk,
  aiTop,
  safeThreshold,
  onDonated,
  style,
}: {
  card: Card;
  tokensOk: boolean;
  aiTop?: boolean;
  safeThreshold?: number;
  onDonated?: () => void;
  style?: React.CSSProperties;
}) {
  const { initiative: r, summary, pct, backers, logos, funded, donationsEnabled } = card;
  const [open, setOpen] = useState(false);
  const prefetch = usePrefetchInitiative(r.slug);
  const zero = !summary.total;
  const canDonate = tokensOk && donationsEnabled;
  return (
    <div
      style={style}
      className={cn(
        "card card-hover flex flex-col motion-safe:animate-fade-in-up",
        aiTop &&
          "border-[rgba(92,183,90,.5)] shadow-[0_0_0_1px_rgba(92,183,90,.25),0_14px_30px_rgba(0,0,0,.35)]",
      )}
      data-initiative-id={r.id}
    >
      {aiTop && (
        <span className="absolute -top-2.5 left-3.5 rounded-full bg-dao-green px-2.5 py-[3px] font-inter-tight text-[11px] font-bold uppercase tracking-[.4px] text-[#08321c]">
          AI pick
        </span>
      )}
      <TypeBadge type={r.type} />
      <Link
        to={`/initiative/${r.slug}`}
        prefetch="intent"
        onMouseEnter={prefetch}
        onFocus={prefetch}
        className="block pr-[72px] font-inter-tight text-[16px] font-medium leading-[1.35] text-white no-underline hover:text-dao-green hover:no-underline"
      >
        {r.title}
      </Link>
      <p className="mb-5 mt-2.5 line-clamp-3 min-h-[42px] text-[13px] leading-[1.6] text-white/55">
        {r.summary}
      </p>
      <Bar pct={pct} className="mt-auto" />
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
            {usd(summary.total)}
          </b>{" "}
          of {usd(r.goalUsd)}
          {backers > 0 && (
            <span className="text-[12px] text-white/30">· {plural(backers, "sponsor")}</span>
          )}
        </span>
        {funded
          ? <FundedChip />
          : (
            <span className={cn("text-[12px]", zero ? "text-white/25" : "text-dao-green")}>
              {pctText(pct)}
            </span>
          )}
      </div>
      {(logos.length > 0 || backers > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-0.5 font-inter-tight text-[12px] text-white/30">Sponsored by</span>
          {logos.length
            ? logos.map((l) => (
              <img
                key={l.logoUrl}
                src={l.logoUrl}
                alt={l.company}
                title={l.company}
                className="size-10 rounded-full border border-white/15 bg-white object-contain p-1.5"
              />
            ))
            : Array.from({ length: Math.min(backers, 4) }, (_, i) => (
              <span
                key={i}
                className="flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/[.06] text-white/40"
                aria-hidden="true"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
                </svg>
              </span>
            ))}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {canDonate && (
          <Button variant="primary" sm onClick={() => setOpen((o) => !o)}>
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
      </div>
      {canDonate && open && (
        <div className="mt-3.5 border-t border-edge pt-3.5">
          <DonateWidget
            slug={r.slug}
            safeAddress={r.safeAddress}
            onramp={card.onramp}
            safeThreshold={safeThreshold}
            onConfirmed={onDonated}
          />
        </div>
      )}
    </div>
  );
}
