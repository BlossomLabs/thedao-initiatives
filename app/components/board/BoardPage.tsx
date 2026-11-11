import type { AiSearchResult } from "../../../shared/ai-search";
import type { Card } from "~/lib/api-types";
import { type Tier, tierName, TIERS } from "@shared/vote/ballot";
import type { NextTierEntry } from "~/hooks/use-vote";
import type { ResultRow } from "~/lib/vote-results";
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { Frown, Heart, type LucideIcon, Smile, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import PageMain from "~/components/layout/PageMain";
import SectionHeading from "~/components/layout/SectionHeading";
import Hero from "~/components/board/Hero";
import { HERO_COUNT_FROM } from "~/lib/hero-count";
import BoardSearch from "~/components/board/BoardSearch";
import InitiativeCard from "~/components/board/InitiativeCard";
import { useWatchlist } from "~/hooks/use-watchlist";
import { useAdminRatings, useReviewIdentity } from "~/hooks/use-admin-ratings";
import { usd } from "~/lib/format";
import SuggestCard from "~/components/board/SuggestCard";
import { ShuffleItem } from "~/components/board/Shuffle";
import PledgeBand from "~/components/board/PledgeBand";
import Sponsors from "~/components/board/Sponsors";
import FilterBar, { preloadFilters, preloadSelects } from "~/components/board/FilterBar";
import { preloadDots } from "~/components/board/CardTitle";
import {
  FilterSheet,
  FilterSheetStandIn,
  preloadSheet,
} from "~/components/board/filters/SheetTrigger";
import CategoryDot from "~/components/ui/CategoryDot";
import { StarRow } from "~/components/ratings/Stars";
import {
  aiPicks,
  applyView,
  type BoardSort,
  type BoardView,
  facetCounts,
  featuredIds,
  groupByFunding,
  groupByPrimary,
  groupByRating,
  isFiltered,
  LAYOUT_KEY,
  readView,
  sortFor,
  STATUS_LABELS,
  writeView,
} from "~/lib/board-view";
import FundingGlyph from "~/components/board/filters/FundingGlyph";
import BoardSkeleton, { ListSkeleton, markBoardLayout } from "~/components/board/BoardSkeleton";
import { categoryOf } from "~/lib/categories";
import { cn } from "~/lib/utils";
import { afterLoad } from "~/lib/after-load";

import { boardKey, useBoard } from "~/hooks/use-board";

const SUGGEST_LAST_FROM = 69;
// The list layout (and its tooltip code) loads only when someone switches to it.
const BoardList = lazy(() => import("~/components/board/BoardList"));

/** "Top rated": an icon before each band's label (AVG_BANDS' keys). */
const BAND_ICONS: Record<string, { Icon: LucideIcon; color: string }> = {
  loved: { Icon: Heart, color: "text-dao-red" },
  liked: { Icon: ThumbsUp, color: "text-dao-green" },
  okay: { Icon: Smile, color: "text-dao-amber" },
  disliked: { Icon: Frown, color: "text-dao-sky" },
  "strongly-disliked": { Icon: ThumbsDown, color: "text-white/50" },
};
/** The front page's board. The vote results reuse it with `only` (the round's
 * slugs), `votePct` (each initiative's vote share, % of its goal, by id) and its own hero. */
export default function BoardPage(
  { only, votePct, votePendingPct, voteTiers, results, next, titles, hero, defaultSort }: {
    only?: ReadonlySet<string>;
    votePct?: ReadonlyMap<string, number>;
    /** The part of `votePct` the settling tier would add if it settled now. */
    votePendingPct?: ReadonlyMap<string, number>;
    /** Current result tiers, only for initiatives receiving a DAO vote award. */
    voteTiers?: ReadonlyMap<string, Tier>;
    /** The closed vote's final result: Funded and Not funded lists, no search or filters;
     * each card shows only its final amount. */
    results?: { funded: ResultRow[]; notFunded: ResultRow[] };
    /** The open vote's gap to each initiative's next tier, by id, drawn on the right of the
     * amount row; `titles` (slug → title) names the initiatives in its hover. */
    next?: ReadonlyMap<string, NextTierEntry>;
    titles?: ReadonlyMap<string, string>;
    hero?: React.ReactNode;
    /** The order a plain URL opens in (the front page's: By category). */
    defaultSort?: BoardSort;
  } = {},
) {
  const { data, isLoading, isError } = useBoard();
  const qc = useQueryClient();
  const [aiResult, setAiResult] = useState<AiSearchResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => readView(params, defaultSort), [params, defaultSort]);
  // The filters' and dots' code comes after the board's data, once the browser is
  // idle: on a slow link it shared the bandwidth with the data and delayed it.
  const hasData = Boolean(data);
  useEffect(() => {
    if (!hasData) return;
    return afterLoad(() => {
      void preloadFilters();
      void preloadDots();
      void preloadSheet();
      void preloadSelects();
    });
  }, [hasData]);
  const setView = (next: Partial<BoardView>) => {
    // The layout is also remembered on this device; everything else lives in the URL only.
    if (next.view) {
      markBoardLayout(next.view);
      try {
        localStorage.setItem(LAYOUT_KEY, next.view);
      } catch { /* storage off: the URL still carries it */ }
    }
    setParams(writeView({ ...view, ...next }, defaultSort), {
      replace: true,
      preventScrollReset: true,
    });
  };
  // A plain board URL opens in the layout this device used last.
  useEffect(() => {
    if (params.has("view")) return markBoardLayout(view.view);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LAYOUT_KEY);
    } catch { /* storage off */ }
    if (saved === "cards") setView({ view: "cards" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival

  const ai = Boolean(aiResult?.scores.length);
  // The cards come in one after another only the first time they show; after that
  // a filter's arrivals come in at once.
  const shownOnce = useRef(false);
  const firstShow = !shownOnce.current;
  useEffect(() => {
    if (data?.cards.length) shownOnce.current = true;
  }, [data]);
  // A manual sort hands the order back from the AI.
  const onSort = (sort: BoardSort) => {
    setAiResult(null);
    setView({ sort });
  };

  const watchlist = useWatchlist();
  // Public ratings enable the rating sorts; ownership separately controls reviewing.
  const ratings = useAdminRatings();
  const canRate = Boolean(useReviewIdentity()?.canReview);
  const all = useMemo(
    () => (data?.cards ?? []).filter((c) => !only || only.has(c.initiative.slug)),
    [data, only],
  );
  // Featured (pins first) exists only while the team pinned something;
  // otherwise the default order is closest to funded.
  const featuredSet = useMemo(() => featuredIds(all), [all]);
  const featured = featuredSet.size > 0;
  // While the AI order is on, the model ranked every initiative: the typed words
  // stop filtering (the qualifiers still do), and Esc brings them back.
  const shownView = useMemo(
    () => ({
      ...view,
      sort: sortFor(view.sort, featured, Boolean(ratings), canRate),
      ...(ai || (data?.flags.aiSearchAuto && asking) ? { q: "" } : {}),
    }),
    [view, featured, ratings, canRate, ai, data?.flags.aiSearchAuto, asking],
  );
  const counts = useMemo(() => facetCounts(all, shownView, watchlist.ids), [
    all,
    shownView,
    watchlist.ids,
  ]);
  const scores = useMemo(
    () => new Map(aiResult?.scores.map(({ id, score }) => [id, score])),
    [aiResult],
  );
  // Equal scores retain the ordinary order; new proposals follow scored ones.
  const cards = useMemo(() => {
    const list = applyView(all, shownView, watchlist.ids, ratings);
    if (!ai) return list;
    return list.sort((a, b) =>
      (scores.get(b.initiative.id) ?? -1) - (scores.get(a.initiative.id) ?? -1)
    );
  }, [all, shownView, watchlist.ids, ratings, ai, scores]);
  const picks = useMemo(
    () => ai && aiResult ? aiPicks(cards, scores, aiResult.pickThreshold) : [],
    [ai, aiResult, cards, scores],
  );
  const filtered = isFiltered(shownView);
  // "By category" and the rating sorts draw sections; the AI order wins over them while it is on.
  const sort = shownView.sort;
  const finals = useMemo(
    () =>
      results
        ? new Map(
          [...results.funded, ...results.notFunded].map((r) => [r.card.initiative.id, r.finalUsd]),
        )
        : undefined,
    [results],
  );
  const resultTiers = useMemo(
    () =>
      results
        ? new Map(
          results.funded.flatMap((r) => r.tier ? [[r.card.initiative.id, r.tier] as const] : []),
        )
        : undefined,
    [results],
  );
  // The final result: one section per tier (what it funded and how much the vote gave),
  // then the rest. A tier that funded nothing draws no section; the hero says so.
  const resultGroups = results
    ? [
      ...TIERS.map((t) => {
        const rows = results.funded.filter((r) => r.tier === t);
        const fromVote = rows.reduce((a, r) => a + r.finalUsd - r.card.summary.total, 0);
        return {
          key: `tier-${t}`,
          rows,
          heading: (
            <>
              {tierName(t)}
              <span className="small dim tnum">{rows.length}</span>
              <span className="small dim tnum">· {usd(fromVote)} from the vote</span>
            </>
          ),
        };
      }),
      {
        key: "not-funded",
        rows: results.notFunded,
        heading: (
          <>
            Not funded
            <span className="small dim tnum">{results.notFunded.length}</span>
          </>
        ),
      },
    ]
      .filter((g) => g.rows.length > 0)
      .map(({ key, rows, heading }) => ({ key, cards: rows.map((r) => r.card), heading }))
    : null;
  const groups: { key: string; cards: Card[]; heading?: React.ReactNode }[] = resultGroups ??
    (ai ? [{ key: "all", cards }] : sort === "category"
      ? groupByPrimary(cards).map((g) => ({
        key: g.slug ?? "untagged",
        cards: g.cards,
        heading: (
          <>
            {g.slug
              ? (
                <>
                  <CategoryDot slug={g.slug} className="size-2.5" />
                  {categoryOf(g.slug)?.label}
                </>
              )
              : "Untagged"}
            <span className="small dim tnum">{usd(g.raised)} raised</span>
          </>
        ),
      }))
      : sort === "closest"
      ? groupByFunding(cards, votePct, voteTiers).map((g) => ({
        key: g.key,
        cards: g.cards,
        heading: (
          <>
            <FundingGlyph status={g.key} />
            {STATUS_LABELS[g.key]}
            <span className="small dim tnum">{g.cards.length}</span>
          </>
        ),
      }))
      : ratings && (sort === "rating-avg" || sort === "rating-mine")
      ? groupByRating(cards, sort, ratings).map((g) => {
        const band = BAND_ICONS[g.key];
        return {
          key: g.key,
          cards: g.cards,
          heading: (
            <>
              {g.stars && <StarRow value={g.stars} />}
              {band && <band.Icon className={cn("size-4", band.color)} aria-hidden="true" />}
              {g.label}
              {g.hint && <span className="small dim">{g.hint}</span>}
            </>
          ),
        };
      })
      : [{ key: "all", cards }]);

  return (
    <>
      {hero ?? <Hero raised={data?.totals.raised} countFrom={HERO_COUNT_FROM} countEarly />}
      <Sponsors sponsors={data?.sponsors} loading={isLoading} />
      <PageMain>
        <SectionHeading id="rfps" className="max-[640px]:text-center">
          Security initiatives looking for funding
        </SectionHeading>
        {data && all.length > 0 && !results && (
          <BoardSearch
            view={view}
            onFilter={setView}
            aiEnabled={Boolean(data.flags.aiSearch)}
            aiAuto={Boolean(data.flags.aiSearchAuto)}
            active={ai}
            onResults={setAiResult}
            onAsking={setAsking}
          />
        )}
        {data && all.length > 0 && !results && (
          <>
            <FilterBar
              view={shownView}
              featured={featured}
              watchlistCount={watchlist.ids.length}
              onChange={setView}
              counts={counts}
              shown={cards.length}
              total={all.length}
              ai={ai}
              voteFilter={Boolean(data.flags.vote?.show)}
              rated={Boolean(ratings)}
              canRate={canRate}
              onSort={onSort}
              sheet={
                <Suspense
                  fallback={
                    <FilterSheetStandIn
                      cards={all}
                      view={shownView}
                      watched={watchlist.ids}
                      onApply={setView}
                    />
                  }
                >
                  <FilterSheet
                    cards={all}
                    view={shownView}
                    watched={watchlist.ids}
                    onApply={setView}
                  />
                </Suspense>
              }
            />
            <p
              className="m-0 mb-3 small text-dao-red empty:hidden"
              role="status"
              aria-live="polite"
            >
              {watchlist.error}
            </p>
          </>
        )}
        {isError && (
          <p className="alert">The board could not be loaded. Please try again in a moment.</p>
        )}
        {isLoading && <BoardSkeleton />}
        {data && !all.length && (
          <p className="mb-[46px] text-muted">
            No initiatives published yet. <Link to="/submit">Suggest the first one.</Link>
          </p>
        )}
        {data && all.length > 0 && !cards.length && asking && !results && (
          // A sentence for the AI rarely matches as keywords: not "nothing matches" while it thinks.
          <p className="mb-[46px] flex items-center gap-2.5 text-muted" role="status">
            <Sparkles className="size-4 animate-pulse text-dao-green" aria-hidden="true" />
            Asking AI for the best matches…
          </p>
        )}
        {data && all.length > 0 && !cards.length && !asking && !results && (
          <div className="mb-[46px] flex flex-wrap items-center gap-3 text-muted">
            No Initiatives match these filters.
            {view.q.trim() && data.flags.aiSearch && (
              <span>Press Enter in the search box to ask AI instead.</span>
            )}
          </div>
        )}
        {data && (all.length === 0 || cards.length > 0 || results) &&
          groups.map((g, gi) => (
            <Fragment key={g.key}>
              {g.heading && (
                <h3
                  className={cn(
                    "mb-4 flex items-center gap-2.5 font-inter-tight text-[20px] font-semibold leading-[26px] text-white",
                    // The first sits under the filter row's own margin.
                    gi > 0 && "mt-9",
                  )}
                >
                  {g.heading}
                </h3>
              )}
              {view.view === "list"
                ? (
                  <Suspense fallback={<ListSkeleton />}>
                    <BoardList
                      cards={g.cards}
                      aiTop={picks}
                      aiScores={scores}
                      featured={featuredSet}
                      watch={watchlist}
                      vote={results ? undefined : data.flags.vote}
                      ratings={ratings}
                      canRate={canRate}
                      votePct={votePct}
                      votePendingPct={votePendingPct}
                      voteTiers={resultTiers ?? voteTiers}
                      finals={finals}
                      next={next}
                      titles={titles}
                    />
                  </Suspense>
                )
                : (
                  // `relative`: cards leaving are taken out of the flow while they fade.
                  <div className="relative grid grid-cols-2 gap-5 max-[860px]:grid-cols-1">
                    <AnimatePresence mode="popLayout">
                      {
                        /* Under 69 approved initiatives the suggest card leads the grid (Griff, 20 -> 69 on
                  2026-09-16); while filters narrow the board it goes last. */
                      }
                      {gi === 0 && all.length < SUGGEST_LAST_FROM && !filtered && !g.heading && (
                        <ShuffleItem key="suggest-first" stagger={firstShow}>
                          <SuggestCard />
                        </ShuffleItem>
                      )}
                      {g.cards.map((c, i) => (
                        <ShuffleItem key={c.initiative.id} index={i + 1} stagger={firstShow}>
                          <InitiativeCard
                            card={c}
                            tokensOk={data.flags.tokensOk}
                            vote={results ? undefined : data.flags.vote}
                            aiTop={picks.includes(c.initiative.id)}
                            aiScore={scores.get(c.initiative.id)}
                            featured={featuredSet.has(c.initiative.id)}
                            onDonated={() =>
                              void qc.invalidateQueries({ queryKey: boardKey })}
                            watch={{
                              on: watchlist.has(c.initiative.id),
                              toggle: () =>
                                watchlist.toggle(c.initiative.id),
                            }}
                            rating={ratings && { summary: ratings[c.initiative.id], canRate }}
                            votePct={votePct?.get(c.initiative.id)}
                            votePendingPct={votePendingPct?.get(c.initiative.id)}
                            voteTier={(resultTiers ?? voteTiers)?.get(c.initiative.id)}
                            final={finals?.get(c.initiative.id)}
                            next={next?.get(c.initiative.id)}
                            titles={titles}
                          />
                        </ShuffleItem>
                      ))}
                      {gi === groups.length - 1 &&
                        (all.length >= SUGGEST_LAST_FROM || filtered || Boolean(g.heading)) && (
                        <ShuffleItem
                          key="suggest-last"
                          index={g.cards.length + 1}
                          stagger={firstShow}
                        >
                          <SuggestCard />
                        </ShuffleItem>
                      )}
                    </AnimatePresence>
                  </div>
                )}
            </Fragment>
          ))}
        <PledgeBand />
      </PageMain>
    </>
  );
}
