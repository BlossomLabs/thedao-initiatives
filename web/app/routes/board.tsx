import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import PageMain from "~/components/layout/PageMain";
import SectionHeading from "~/components/layout/SectionHeading";
import Hero from "~/components/board/Hero";
import CommunityStrip from "~/components/board/CommunityStrip";
import AiSearch from "~/components/board/AiSearch";
import InitiativeCard from "~/components/board/InitiativeCard";
import SuggestCard from "~/components/board/SuggestCard";
import PledgeBand from "~/components/board/PledgeBand";
import Skeleton from "~/components/ui/Skeleton";
import { boardKey, useBoard } from "~/hooks/use-board";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({ url: "/" });
}

export default function Board() {
  const { data, isLoading, isError } = useBoard();
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
      {data && <CommunityStrip entries={data.community} />}
      <PageMain>
        <SectionHeading id="rfps">Security initiatives looking for funding</SectionHeading>
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
          <p className="text-muted">
            No initiatives published yet. <Link to="/submit">Suggest the first one.</Link>
          </p>
        )}
        {data && (
          <div className="grid grid-cols-2 gap-5 max-[860px]:grid-cols-1">
            {cards.map((c, i) => (
              <InitiativeCard
                key={c.initiative.id}
                card={c}
                tokensOk={data.flags.tokensOk}
                aiTop={Boolean(matches?.includes(c.initiative.id))}
                safeThreshold={data.flags.safeThreshold}
                onDonated={() => void qc.invalidateQueries({ queryKey: boardKey })}
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
            <SuggestCard style={{ animationDelay: `${cards.length * 60}ms` }} />
          </div>
        )}
        <PledgeBand />
      </PageMain>
    </>
  );
}
