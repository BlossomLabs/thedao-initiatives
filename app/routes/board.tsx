import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import PageMain from "~/components/layout/PageMain";
import SectionHeading from "~/components/layout/SectionHeading";
import Hero from "~/components/board/Hero";
import AiSearch from "~/components/board/AiSearch";
import InitiativeCard from "~/components/board/InitiativeCard";
import SuggestCard from "~/components/board/SuggestCard";
import PledgeBand from "~/components/board/PledgeBand";
import Skeleton from "~/components/ui/Skeleton";
import { boardKey, useBoard } from "~/hooks/use-board";
import { generateMeta } from "~/utils/meta";
import { LoaderCircle } from "lucide-react";

export function meta() {
  return generateMeta({ url: "/" });
}

const SUGGEST_LAST_FROM = 69;

export default function Board() {
  const { data, isLoading, isError, isUpdatingLedger } = useBoard();
  const qc = useQueryClient();
  const [matches, setMatches] = useState<string[] | null>(null);

  const cards = useMemo(() => {
    const list = data?.cards ?? [];
    if (!matches?.length) return list;
    const top = matches.map((id) => list.find((c) => c.initiative.id === id)).filter((
      c,
    ): c is NonNullable<typeof c> => Boolean(c));
    return [...top, ...list.filter((c) => !matches.includes(c.initiative.id))];
  }, [data, matches]);

  return (
    <>
      <Hero raised={data?.totals.raised ?? 0} loading={isLoading} />
      <PageMain>
        <SectionHeading id="rfps" className="max-[640px]:text-center">
          Security initiatives looking for funding
        </SectionHeading>
        {isUpdatingLedger && (
          <p className="m-0 mb-3 flex items-center gap-2 small dim" role="status">
            <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
            Updating donations…
          </p>
        )}
        {data?.flags.aiSearch && cards.length > 0 && <AiSearch onMatches={setMatches} />}
        {isError && (
          <p className="alert">The board could not be loaded. Please try again in a moment.</p>
        )}
        {isLoading && (
          <div className="grid grid-cols-2 gap-5 max-[860px]:grid-cols-1">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[230px] rounded-2xl" />)}
          </div>
        )}
        {data && !cards.length && (
          <p className="mb-[46px] text-muted">
            No initiatives published yet. <Link to="/submit">Suggest the first one.</Link>
          </p>
        )}
        {data && (
          <div className="grid grid-cols-2 gap-5 max-[860px]:grid-cols-1">
            {/* Under 69 approved initiatives the suggest card leads the grid (Griff, 20 -> 69 on 2026-09-16). */}
            {cards.length < SUGGEST_LAST_FROM && <SuggestCard />}
            {cards.map((c, i) => (
              <InitiativeCard
                key={c.initiative.id}
                card={c}
                tokensOk={data.flags.tokensOk}
                aiTop={Boolean(matches?.includes(c.initiative.id))}
                onDonated={() => void qc.invalidateQueries({ queryKey: boardKey })}
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
            {cards.length >= SUGGEST_LAST_FROM && (
              <SuggestCard style={{ animationDelay: `${cards.length * 60}ms` }} />
            )}
          </div>
        )}
        <PledgeBand />
      </PageMain>
    </>
  );
}
