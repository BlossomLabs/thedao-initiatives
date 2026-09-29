import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import PageMain from "~/components/layout/PageMain";
import SectionHeading from "~/components/layout/SectionHeading";
import Hero from "~/components/board/Hero";
import AiSearch from "~/components/board/AiSearch";
import InitiativeCard from "~/components/board/InitiativeCard";
import SuggestCard from "~/components/board/SuggestCard";
import PledgeBand from "~/components/board/PledgeBand";
import FilterBar, { preloadFilters } from "~/components/board/FilterBar";
import { preloadDots } from "~/components/board/CardTitle";
import {
  FilterSheet,
  FilterSheetStandIn,
  preloadSheet,
} from "~/components/board/filters/SheetTrigger";
import CategoryDot from "~/components/ui/CategoryDot";
import { Button } from "~/components/ui/Button";
import {
  applyView,
  type BoardSort,
  type BoardView,
  CLEARED,
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
  return generateMeta({ url: "/" });
}

const SUGGEST_LAST_FROM = 69;

export default function Board() {
  const { data, isLoading, isError } = useBoard();
  const qc = useQueryClient();
  const [matches, setMatches] = useState<string[] | null>(null);
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => readView(params), [params]);
  useEffect(() => {
    void preloadFilters();
    void preloadDots();
    void preloadSheet();
  }, []);
  const setView = (next: Partial<BoardView>) =>
    setParams(writeView({ ...view, ...next }), { replace: true, preventScrollReset: true });

  const ai = Boolean(matches?.length);
  // A manual sort hands the order back from the AI.
  const onSort = (sort: BoardSort) => {
    setMatches(null);
    setView({ sort });
  };

  const all = data?.cards ?? [];
  // Featured (pins first) exists only while the team pinned something;
  // otherwise the default order is closest to funded.
  const featuredSet = useMemo(() => featuredIds(all), [all]);
  const featured = featuredSet.size > 0;
  const shownView = useMemo(
    () => ({ ...view, sort: sortFor(view.sort, featured) }),
    [view, featured],
  );
  const counts = useMemo(() => facetCounts(all, view), [all, view]);
  // Filters and sort first; the AI picks then move to the front of what is left.
  const cards = useMemo(() => {
    const list = applyView(all, shownView);
    if (!matches?.length) return list;
    const top = matches.map((id) => list.find((c) => c.initiative.id === id)).filter((
      c,
    ): c is NonNullable<typeof c> => Boolean(c));
    return [...top, ...list.filter((c) => !matches.includes(c.initiative.id))];
  }, [all, shownView, matches]);
  const filtered = isFiltered(view);
  // "By category" draws sections; the AI order wins over them while it is on.
  const groups = view.sort === "category" && !matches?.length
    ? groupByPrimary(cards)
    : [{ slug: null, cards, flat: true }];

  return (
    <>
      <Hero raised={data?.totals.raised} />
      <PageMain>
        <SectionHeading id="rfps" className="max-[640px]:text-center">
          Security initiatives looking for funding
        </SectionHeading>
        {data?.flags.aiSearch && all.length > 0 && <AiSearch active={ai} onMatches={setMatches} />}
        {data && all.length > 0 && (
          <FilterBar
            view={shownView}
            featured={featured}
            onChange={setView}
            counts={counts}
            shown={cards.length}
            total={all.length}
            ai={ai}
            onSort={onSort}
            sheet={
              <Suspense
                fallback={<FilterSheetStandIn cards={all} view={view} onApply={setView} />}
              >
                <FilterSheet cards={all} view={view} onApply={setView} />
              </Suspense>
            }
          />
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
        {data && all.length > 0 && !cards.length && (
          <div className="mb-[46px] flex flex-wrap items-center gap-3 text-muted">
            No Initiatives match these filters.
            <Button
              sm
              variant="ghost"
              onClick={() => setView({ ...CLEARED })}
            >
              Clear filters
            </Button>
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
              <div className="grid grid-cols-2 gap-5 max-[860px]:grid-cols-1">
                {
                  /* Under 69 approved initiatives the suggest card leads the grid (Griff, 20 -> 69 on
                  2026-09-16); while filters narrow the board it goes last. */
                }
                {gi === 0 && all.length < SUGGEST_LAST_FROM && !filtered && "flat" in g && (
                  <SuggestCard />
                )}
                {g.cards.map((c, i) => (
                  <InitiativeCard
                    key={c.initiative.id}
                    card={c}
                    tokensOk={data.flags.tokensOk}
                    aiTop={Boolean(matches?.includes(c.initiative.id))}
                    featured={featuredSet.has(c.initiative.id)}
                    onDonated={() => void qc.invalidateQueries({ queryKey: boardKey })}
                    style={{ animationDelay: `${i * 60}ms` }}
                  />
                ))}
                {gi === groups.length - 1 &&
                  (all.length >= SUGGEST_LAST_FROM || filtered || !("flat" in g)) && (
                  <SuggestCard style={{ animationDelay: `${g.cards.length * 60}ms` }} />
                )}
              </div>
            </Fragment>
          ))}
        <PledgeBand />
      </PageMain>
    </>
  );
}
