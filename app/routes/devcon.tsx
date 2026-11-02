import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hexToBytes } from "viem";
import BoardList from "~/components/board/BoardList";
import CategoryDot from "~/components/ui/CategoryDot";
import { useBoard } from "~/hooks/use-board";
import { api } from "~/lib/api";
import { applyView, DEFAULT_VIEW, groupByPrimary } from "~/lib/board-view";
import { categoryOf } from "~/lib/categories";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import { DEVCON } from "../../shared/devcon/manifest";
import { devconTally } from "../../shared/devcon/tally";

export function meta() {
  return [{ title: "Devcon is voting · TheDAO" }, { name: "robots", content: "noindex" }];
}

const POLL_MS = 5_000;
const POOL = BigInt(DEVCON.poolUsd);
const POOL_USD = Number(POOL / 1_000_000n);

type Ballots = { at: number; ballots: { tokenId: string; ballot: `0x${string}` }[] };

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function timeLeft(secs: number): string {
  if (secs <= 0) return "closed";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m`;
}

/** The projector: the homepage list, with the share the Devcon vote would give each
 * initiative if voting closed right now drawn in gold after what it has raised. */
export default function Devcon() {
  const board = useBoard();
  const ballots = useQuery({
    queryKey: ["devcon-ballots"],
    queryFn: () => api<Ballots>("/api/devcon/ballots", { passive: true }),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const now = useNow();

  const cards = useMemo(() => {
    const inRound = new Set(DEVCON.slugs);
    return applyView(
      (board.data?.cards ?? []).filter((c) => inRound.has(c.initiative.slug)),
      DEFAULT_VIEW,
    );
  }, [board.data]);

  const tally = useMemo(() => {
    if (!ballots.data) return null;
    return devconTally(
      cards.map((c) => ({
        slug: c.initiative.slug,
        goalUsd: c.initiative.goalUsd,
        total: c.summary.total,
      })),
      ballots.data.ballots.map((b) => hexToBytes(b.ballot)),
      DEVCON.slugs,
      POOL,
    );
  }, [ballots.data, cards]);

  const votePct = useMemo(() => {
    const m = new Map<string, number>();
    if (!tally) return m;
    for (const c of cards) {
      const share = tally.bySlug.get(c.initiative.slug) ?? 0;
      if (share > 0 && c.initiative.goalUsd > 0) {
        m.set(c.initiative.id, (share / c.initiative.goalUsd) * 100);
      }
    }
    return m;
  }, [tally, cards]);

  const secsLeft = DEVCON.closesAt - Math.floor(now / 1000);
  const isClosed = secsLeft <= 0;
  const age = ballots.dataUpdatedAt
    ? Math.max(0, Math.round((now - ballots.dataUpdatedAt) / 1000))
    : 0;
  const n = tally?.ballots ?? 0;

  return (
    <main className="mx-auto max-w-[1400px] px-6 pb-20 pt-6 text-[1.15em]">
      <header className="mb-8">
        <p className="mb-2 font-inter-tight text-[14px] font-semibold uppercase tracking-[.14em] text-vote">
          Badge holder for a day · Devcon 8
        </p>
        <h1 className="font-inter-tight text-[44px] font-semibold leading-[1.1] text-white">
          {isClosed ? "Voting closed. Final result." : "Devcon is voting. Live."}
        </h1>
        <p className="mt-3 max-w-[900px] text-[20px] leading-snug text-white/75">
          {isClosed
            ? "Badge holders fund "
            : "If voting closed right now, badge holders would fund "}
          <b className="text-vote">{usd(tally?.fundedUsd ?? 0)}</b> of the {usd(POOL_USD)}{" "}
          pool, with {n === 1 ? "1 ballot" : `${n} ballots`} so far.
          {!isClosed && <>{" "}Closes in {timeLeft(secsLeft)}.</>}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px] text-white/60">
          <span className="flex items-center gap-2">
            <i className="inline-block h-[6px] w-6 rounded-full bg-gradient-to-r from-dao-green to-dao-bright" />
            already raised
          </span>
          <span className="flex items-center gap-2">
            <i className="inline-block h-[6px] w-6 rounded-full bg-vote" />
            from the Devcon vote
          </span>
          <span className={cn("ml-auto", ballots.isError && "text-amber-300")}>
            {ballots.dataUpdatedAt ? `Updated ${age}s ago` : "Loading ballots…"}
          </span>
        </div>
      </header>
      {groupByPrimary(cards).map((g, gi) => (
        <Fragment key={g.slug ?? "untagged"}>
          <h3
            className={cn(
              "mb-4 flex items-center gap-2.5 font-inter-tight text-[20px] font-semibold leading-[26px] text-white",
              gi > 0 && "mt-9",
            )}
          >
            {g.slug
              ? (
                <>
                  <CategoryDot slug={g.slug} className="size-2.5" />
                  {categoryOf(g.slug)?.label}
                </>
              )
              : "Untagged"}
          </h3>
          <BoardList cards={g.cards} votePct={votePct} />
        </Fragment>
      ))}
    </main>
  );
}
