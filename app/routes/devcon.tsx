import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hexToBytes } from "viem";
import BoardPage from "~/components/board/BoardPage";
import Hero from "~/components/board/Hero";
import { useBoard } from "~/hooks/use-board";
import { api } from "~/lib/api";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import { DEVCON } from "../../shared/devcon/manifest";
import { devconTally } from "../../shared/devcon/tally";

export function meta() {
  return [{ title: "Devcon demo vote · TheDAO" }, { name: "robots", content: "noindex" }];
}

const POLL_MS = 5_000;
const POOL = BigInt(DEVCON.poolUsd);
const POOL_USD = Number(POOL / 1_000_000n);
const IN_ROUND: ReadonlySet<string> = new Set(DEVCON.slugs);

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

/** The projector: the front page, limited to the round's initiatives, with what the
 * Devcon demo vote would fund if it closed right now: the hero's amount, and each
 * initiative's share drawn in gold after what it has raised. */
export default function Devcon() {
  const board = useBoard();
  const ballots = useQuery({
    queryKey: ["devcon-ballots"],
    queryFn: () => api<Ballots>("/api/devcon/ballots", { passive: true }),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const now = useNow();

  const cards = useMemo(
    () => (board.data?.cards ?? []).filter((c) => IN_ROUND.has(c.initiative.slug)),
    [board.data],
  );

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
  const ballotsText = n === 1 ? "1 ballot" : `${n} ballots`;

  const hero = (
    <Hero
      raised={tally ? tally.fundedUsd : undefined}
      kicker={<span className="text-vote">Devcon 8 · demo vote</span>}
      sub={isClosed
        ? (
          <>
            Voting closed. Final result: funded by {ballotsText} from the {usd(POOL_USD)}{" "}
            <span className="text-vote">demo pool</span>
          </>
        )
        : (
          <>
            would be funded by {ballotsText} from the {usd(POOL_USD)}{" "}
            <span className="text-vote">demo pool</span> · closes in {timeLeft(secsLeft)}
          </>
        )}
    >
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-white/55">
        <span className="flex items-center gap-2">
          <i className="inline-block h-[6px] w-6 rounded-full bg-gradient-to-r from-dao-green to-dao-bright" />
          already raised
        </span>
        <span className="flex items-center gap-2">
          <i className="inline-block h-[6px] w-6 rounded-full bg-vote" />
          from the Devcon vote
        </span>
        <span className={cn(ballots.isError && "text-amber-300")}>
          {ballots.dataUpdatedAt ? `Updated ${age}s ago` : "Loading ballots…"}
        </span>
      </div>
    </Hero>
  );

  return <BoardPage only={IN_ROUND} votePct={votePct} hero={hero} />;
}
