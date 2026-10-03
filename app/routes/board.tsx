import type { AiSearchResult } from "../../shared/ai-search";
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import PageMain from "~/components/layout/PageMain";
import SectionHeading from "~/components/layout/SectionHeading";
import Hero from "~/components/board/Hero";
import BoardSearch from "~/components/board/BoardSearch";
import InitiativeCard from "~/components/board/InitiativeCard";
import { useWatchlist } from "~/hooks/use-watchlist";
import SuggestCard from "~/components/board/SuggestCard";
import { ShuffleItem } from "~/components/board/Shuffle";
import PledgeBand from "~/components/board/PledgeBand";
import FilterBar, { preloadFilters } from "~/components/board/FilterBar";
import { preloadDots } from "~/components/board/CardTitle";
import {
  FilterSheet,
  FilterSheetStandIn,
  preloadSheet,
} from "~/components/board/filters/SheetTrigger";
import CategoryDot from "~/components/ui/CategoryDot";
import {
  applyView,
  type BoardSort,
  type BoardView,
  facetCounts,
  featuredIds,
  groupByPrimary,
  isFiltered,
  readView,
  sortFor,
  writeView,
} from "~/lib/board-view";
import Skeleton from "~/components/ui/Skeleton";
import { categoryOf } from "~/lib/categories";
import { boardKey, useBoard } from "~/hooks/use-board";
import { generateMeta } from "~/utils/meta";

export function meta() {
  // Agents find the index from the page head; relative so a preview host serves its own.
  return [
    ...generateMeta({ url: "/" }),
    { tagName: "link", rel: "alternate", type: "text/plain", title: "llms.txt", href: "/llms.txt" },
  ];
}

const SUGGEST_LAST_FROM = 69;
// The list layout (and its tooltip code) loads only when someone switches to it.
const BoardList = lazy(() => import("~/components/board/BoardList"));
/** The device's last layout (cards or list), used when the URL does not say. */
const LAYOUT_KEY = "thedao:board-layout";

export default function Board() {
  const { data, isLoading, isError } = useBoard();
  const qc = useQueryClient();
  const [aiResult, setAiResult] = useState<AiSearchResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => readView(params), [params]);
  useEffect(() => {
    void preloadFilters();
    void preloadDots();
    void preloadSheet();
  }, []);
  const setView = (next: Partial<BoardView>) => {
    // The layout is also remembered on this device; everything else lives in the URL only.
    if (next.view) {
      try {
        localStorage.setItem(LAYOUT_KEY, next.view);
      } catch { /* storage off: the URL still carries it */ }
    }
    setParams(writeView({ ...view, ...next }), { replace: true, preventScrollReset: true });
  };
  // A plain board URL opens in the layout this device used last.
  useEffect(() => {
    if (params.has("view")) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LAYOUT_KEY);
    } catch { /* storage off */ }
    if (saved === "list") setView({ view: "list" });
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
  const all = data?.cards ?? [];
  // Featured (pins first) exists only while the team pinned something;
  // otherwise the default order is closest to funded.
  const featuredSet = useMemo(() => featuredIds(all), [all]);
  const featured = featuredSet.size > 0;
  // While the AI order is on, the model ranked every initiative: the typed words
  // stop filtering (the qualifiers still do), and Esc brings them back.
  const shownView = useMemo(
    () => ({
      ...view,
      sort: sortFor(view.sort, featured),
      ...(ai || (data?.flags.aiSearchAuto && asking) ? { q: "" } : {}),
    }),
    [view, featured, ai, data?.flags.aiSearchAuto, asking],
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
    const list = applyView(all, shownView, watchlist.ids);
    if (!ai) return list;
    return list.sort((a, b) =>
      (scores.get(b.initiative.id) ?? -1) - (scores.get(a.initiative.id) ?? -1)
    );
  }, [all, shownView, watchlist.ids, ai, scores]);
  const picks = useMemo(
    () =>
      ai
        ? cards.filter((card) => scores.has(card.initiative.id)).slice(0, 3).map((card) =>
          card.initiative.id
        )
        : [],
    [ai, cards, scores],
  );
  const filtered = isFiltered(view);
  // "By category" draws sections; the AI order wins over them while it is on.
  const groups = view.sort === "category" && !ai
    ? groupByPrimary(cards)
    : [{ slug: null, cards, flat: true }];

  return (
    <>
      <Hero raised={data?.totals.raised} />
      <PageMain>
        <SectionHeading id="rfps" className="max-[640px]:text-center">
          Security initiatives looking for funding
        </SectionHeading>
        {data && all.length > 0 && (
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
        {data && all.length > 0 && (
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
              onSort={onSort}
              sheet={
                <Suspense
                  fallback={
                    <FilterSheetStandIn
                      cards={all}
                      view={view}
                      watched={watchlist.ids}
                      onApply={setView}
                    />
                  }
                >
                  <FilterSheet
                    cards={all}
                    view={view}
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
        {isLoading && (
          <div className="grid grid-cols-2 gap-5 max-[860px]:grid-cols-1">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[230px] rounded-2xl" />)}
          </div>
        )}
        {data && !all.length && (
          <p className="mb-[46px] text-muted">
            No initiatives published yet. <Link to="/submit">Suggest the first one.</Link>
          </p>
        )}
        {data && all.length > 0 && !cards.length && asking && (
          // A sentence for the AI rarely matches as keywords: not "nothing matches" while it thinks.
          <p className="mb-[46px] flex items-center gap-2.5 text-muted" role="status">
            <Sparkles className="size-4 animate-pulse text-dao-green" aria-hidden="true" />
            Asking AI for the best matches…
          </p>
        )}
        {data && all.length > 0 && !cards.length && !asking && (
          <div className="mb-[46px] flex flex-wrap items-center gap-3 text-muted">
            No Initiatives match these filters.
            {view.q.trim() && data.flags.aiSearch && (
              <span>Press Enter in the search box to ask AI instead.</span>
            )}
          </div>
        )}
        {data && (all.length === 0 || cards.length > 0) &&
          groups.map((g, gi) => (
            <Fragment key={g.slug ?? "all"}>
              {!("flat" in g) && (
                <h3 className="mb-3 mt-6 flex items-center gap-2 font-inter-tight text-[14px] font-medium text-white first:mt-0">
                  {g.slug
                    ? (
                      <>
                        <CategoryDot slug={g.slug} />
                        {categoryOf(g.slug)?.label}
                      </>
                    )
                    : "Untagged"}
                  <span className="small dim tnum">{g.cards.length}</span>
                </h3>
              )}
              {view.view === "list"
                ? (
                  <Suspense fallback={<Skeleton className="h-[480px] rounded-2xl" />}>
                    <BoardList
                      cards={g.cards}
                      aiTop={picks}
                      aiScores={scores}
                      featured={featuredSet}
                      watch={watchlist}
                      vote={data.flags.vote}
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
                      {gi === 0 && all.length < SUGGEST_LAST_FROM && !filtered && "flat" in g && (
                        <ShuffleItem key="suggest-first" stagger={firstShow}>
                          <SuggestCard />
                        </ShuffleItem>
                      )}
                      {g.cards.map((c, i) => (
                        <ShuffleItem key={c.initiative.id} index={i + 1} stagger={firstShow}>
                          <InitiativeCard
                            card={c}
                            tokensOk={data.flags.tokensOk}
                            vote={data.flags.vote}
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
                          />
                        </ShuffleItem>
                      ))}
                      {gi === groups.length - 1 &&
                        (all.length >= SUGGEST_LAST_FROM || filtered || !("flat" in g)) && (
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
