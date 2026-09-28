import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import PageMain from "~/components/layout/PageMain";
import SectionHeading from "~/components/layout/SectionHeading";
import Hero from "~/components/board/Hero";
import AiSearch from "~/components/board/AiSearch";
import InitiativeCard from "~/components/board/InitiativeCard";
import SuggestCard from "~/components/board/SuggestCard";
import PledgeBand from "~/components/board/PledgeBand";
import FilterBar from "~/components/board/FilterBar";
import { CategoryTag } from "~/components/ui/CategoryTag";
import { Button } from "~/components/ui/Button";
import {
  applyView,
  type BoardView,
  facetCounts,
  groupByPrimary,
  isFiltered,
  readView,
  writeView,
} from "~/lib/board-view";
import Skeleton from "~/components/ui/Skeleton";
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
  const setView = (next: Partial<BoardView>) =>
    setParams(writeView({ ...view, ...next }), { replace: true, preventScrollReset: true });

  const all = data?.cards ?? [];
  const counts = useMemo(() => facetCounts(all, view), [all, view]);
  // Filters and sort first; the AI picks then move to the front of what is left.
  const cards = useMemo(() => {
    const list = applyView(all, view);
    if (!matches?.length) return list;
    const top = matches.map((id) => list.find((c) => c.initiative.id === id)).filter((
      c,
    ): c is NonNullable<typeof c> => Boolean(c));
    return [...top, ...list.filter((c) => !matches.includes(c.initiative.id))];
  }, [all, view, matches]);
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
        {data?.flags.aiSearch && all.length > 0 && <AiSearch onMatches={setMatches} />}
        {data && all.length > 0 && (
          <FilterBar
            view={view}
            onChange={setView}
            counts={counts}
            shown={cards.length}
            total={all.length}
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
              onClick={() => setView({ type: "all", status: "all", cats: [], q: "" })}
            >
              Clear filters
            </Button>
          </div>
        )}
        {data && (all.length === 0 || cards.length > 0) &&
          groups.map((g, gi) => (
            <Fragment key={g.slug ?? "all"}>
              {!("flat" in g) && (
                <h3 className="mb-3 mt-6 flex items-center gap-2.5 first:mt-0">
                  {g.slug
                    ? <CategoryTag slug={g.slug} />
                    : <span className="small dim">Untagged</span>}
                  <span className="small dim">{g.cards.length}</span>
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
