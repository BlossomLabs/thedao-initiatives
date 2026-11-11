import { useEffect, useMemo, useState } from "react";
import { hexToBytes } from "viem";
import BoardPage from "~/components/board/BoardPage";
import Hero from "~/components/board/Hero";
import { LinkButton } from "~/components/ui/Button";
import { useBoard } from "~/hooks/use-board";
import { myCode } from "~/lib/vote-local";
import { useSession } from "~/context/session";
import { useMyBadges, useVoteBallots } from "~/hooks/use-vote";
import { usd } from "~/lib/format";
import { ROUND } from "../../../shared/vote/manifest";
import { voteTally } from "../../../shared/vote/tally";
import type { Tier } from "../../../shared/vote/ballot";

const POLL_MS = 5_000;
const POOL = BigInt(ROUND.poolUsd);
const POOL_USD = Number(POOL / 1_000_000n);
const IN_ROUND: ReadonlySet<string> = new Set(ROUND.slugs);

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

const REAL = ROUND.kind === "real";
const POOL_NAME = REAL ? "pool" : "demo pool";

/** The vote results: the front page, limited to the round's initiatives, with what the
 * vote would fund if it closed right now: the hero's amount, and each initiative's
 * share drawn in gold after what it has raised. On `/` for the real vote, on `/vote`
 * (voters only) for a test vote. */
export default function VoteResults() {
  const board = useBoard();
  const ballots = useVoteBallots(POLL_MS);
  const now = useNow();
  // The way back to your ballot: by the code this browser opened it with, else by the
  // signed-in account's badge (found on-chain).
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => setCode(myCode()), []);
  const { session } = useSession();
  const badges = useMyBadges(session?.address ?? null, !code);
  const mine = code ? `/vote/${code}` : badges.data?.length ? "/vote/ballot" : null;

  const cards = useMemo(
    () => (board.data?.cards ?? []).filter((c) => IN_ROUND.has(c.initiative.slug)),
    [board.data],
  );

  const tally = useMemo(() => {
    if (!ballots.data) return null;
    return voteTally(
      cards.map((c) => ({
        slug: c.initiative.slug,
        goalUsd: c.initiative.goalUsd,
        total: c.summary.total,
      })),
      ballots.data.ballots.map((b) => hexToBytes(b.ballot)),
      ROUND.slugs,
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

  const voteTiers = useMemo(() => {
    const tiers = new Map<string, Tier>();
    for (const c of cards) {
      const tier = tally?.tierBySlug.get(c.initiative.slug);
      if (tier) tiers.set(c.initiative.id, tier);
    }
    return tiers;
  }, [tally, cards]);

  const secsLeft = ROUND.closesAt - Math.floor(now / 1000);
  const isClosed = secsLeft <= 0;
  const n = tally?.ballots ?? 0;
  const ballotsText = n === 1 ? "1 ballot" : `${n} ballots`;

  const hero = (
    <Hero
      raised={tally ? tally.fundedUsd : undefined}
      kicker={<span className="text-vote">{REAL ? "TheDAO vote" : "Test vote"}</span>}
      sub={isClosed
        ? (
          <>
            Voting closed. Final result: funded by {ballotsText} from the {usd(POOL_USD)}{" "}
            <span className="text-vote">{POOL_NAME}</span>
          </>
        )
        : (
          <>
            would be funded by {ballotsText} from the {usd(POOL_USD)}{" "}
            <span className="text-vote">{POOL_NAME}</span> · closes in {timeLeft(secsLeft)}
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
          from the vote
        </span>
      </div>
      {mine && (
        <div className="mt-5 flex justify-center">
          <LinkButton variant="primary" to={mine}>
            {isClosed ? "See your ballot" : "See or change your ballot"}
          </LinkButton>
        </div>
      )}
    </Hero>
  );

  return (
    <BoardPage
      only={IN_ROUND}
      votePct={votePct}
      voteTiers={voteTiers}
      hero={hero}
      defaultSort="closest"
    />
  );
}
