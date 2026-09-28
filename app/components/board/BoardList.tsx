import { Link } from "react-router";
import type { VoteSettings } from "@shared/vote";
import { TypeBadge } from "~/components/ui/Badge";
import { CategoryLink } from "~/components/ui/CategoryTag";
import Bar from "~/components/ui/Bar";
import VoteChip from "~/components/board/VoteChip";
import type { Card } from "~/lib/api-types";
import { pctText, plural, usd } from "~/lib/format";
import { usePrefetchInitiative } from "~/hooks/use-initiative";

function Row({ card, vote }: { card: Card; vote?: VoteSettings }) {
  const { initiative: r, summary, pct, backers } = card;
  const prefetch = usePrefetchInitiative(r.slug);
  const [primary, ...rest] = r.categories;
  return (
    <li className="grid min-h-[56px] grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3.5 gap-y-1.5 border-b border-white/[.07] px-4 py-2.5 last:border-b-0 max-[860px]:grid-cols-[auto_minmax(0,1fr)] max-[860px]:py-3">
      <TypeBadge type={r.type} inline />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <Link
          to={`/initiative/${r.slug}`}
          prefetch="intent"
          onMouseEnter={prefetch}
          onFocus={prefetch}
          className="min-w-0 truncate font-inter-tight text-[14.5px] font-medium text-white no-underline hover:text-dao-green"
          title={r.title}
        >
          {r.title}
        </Link>
        <span className="flex flex-none items-center gap-1">
          {primary && <CategoryLink slug={primary} sm />}
          {rest.map((slug) => <CategoryLink key={slug} slug={slug} iconOnly />)}
        </span>
      </div>
      <div className="flex items-center gap-2.5 max-[860px]:col-start-2">
        <Bar pct={pct} className="w-16" tick={vote?.show ? vote.floorPct : undefined} />
        <span className="w-[42px] text-right text-[12px] text-dao-green">{pctText(pct)}</span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1 text-[12.5px] text-white/60 [&>*]:whitespace-nowrap max-[860px]:col-start-2 max-[860px]:justify-start">
        <span>
          <b className="font-normal text-white/85">{usd(summary.total)}</b> of {usd(r.goalUsd)}
        </span>
        {backers > 0 && <span className="text-white/40">{plural(backers, "backer")}</span>}
        {vote?.show && <VoteChip raised={summary.total} goal={r.goalUsd} vote={vote} />}
      </div>
    </li>
  );
}

/** Compact rows: every initiative at a glance (curators found the cards too dense). */
export default function BoardList({ cards, vote }: { cards: Card[]; vote?: VoteSettings }) {
  return (
    <ul className="m-0 list-none overflow-hidden rounded-2xl border border-white/10 bg-white/[.04] p-0">
      {cards.map((c) => <Row key={c.initiative.id} card={c} vote={vote} />)}
    </ul>
  );
}
