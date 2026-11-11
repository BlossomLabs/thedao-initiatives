import { useEffect, useMemo, useState } from "react";
import BoardPage from "~/components/board/BoardPage";
import Hero from "~/components/board/Hero";
import { LinkButton } from "~/components/ui/Button";
import { useBoard } from "~/hooks/use-board";
import { myCode } from "~/lib/vote-local";
import { dollars, splitResults } from "~/lib/vote-results";
import { useSession } from "~/context/session";
import { type NextTierEntry, type RoundView, useMyBadges, useVoteRound } from "~/hooks/use-vote";
import { usd, usdShort } from "~/lib/format";
import { ROUND } from "../../../shared/vote/manifest";
import { type Tier, tierName } from "../../../shared/vote/ballot";

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
const utc = (secs: number, withDay = true) =>
  `${
    new Intl.DateTimeFormat("en-GB", {
      ...(withDay ? { weekday: "long", day: "numeric", month: "long" } : {}),
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(secs * 1000)
  } UTC`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The hero's line for a round under way: settled tiers, the settling one's window,
 * and when the next one starts. */
function stageLine(rv: RoundView): string {
  const parts: string[] = [];
  let next = false;
  for (const t of rv.tiers) {
    if (t.status === "settled") {
      const sum = Object.values(t.awards).reduce((a, v) => a + dollars(v), 0);
      parts.push(
        `${tierName(t.tier)} settled: ${usd(sum)} to ${plural(t.funded.length, "initiative")}`,
      );
    } else if (t.status === "settling") {
      parts.push(
        `${tierName(t.tier)} settling, window ${t.window} ends ${utc(t.windowEndsAt, false)}`,
      );
      next = true;
    } else if (next || parts.length) {
      parts.push(`${tierName(t.tier)} starts ${utc(t.startsAt)}`);
      break;
    }
  }
  return parts.join(" · ");
}
/** Voters should expect Tier-B may be empty: it only funds what the pool has left. */
const tierBEmpty = (rv: RoundView) =>
  rv.tiers.find((t) => t.tier === "B")?.status !== "settled" &&
  !Object.values(rv.live.tiers ?? {}).includes("B");
const TIER_B_NOTE = " · Tier-B: nothing funded yet, the pool may not reach it.";
const POOL_NAME = REAL ? "pool" : "demo pool";

/** The vote results: the front page, limited to the round's initiatives, with what the
 * vote would fund if it closed right now: the hero's amount, and each initiative's
 * share drawn in gold after what it has raised. On `/` for the real vote, on `/vote`
 * (voters only) for a test vote. */
export default function VoteResults() {
  const board = useBoard();
  const now = useNow();
  const round = useVoteRound(POLL_MS);
  const rv = round.data;
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

  /** USD per slug: what settled tiers fund, and what the open ones would if they settled now. */
  const money = useMemo(() => {
    const settled = new Map<string, number>();
    const pending = new Map<string, number>();
    const tiers = new Map<string, Tier>();
    if (!rv) return null;
    for (const t of rv.tiers) {
      if (t.status !== "settled") continue;
      for (const [slug, v] of Object.entries(t.awards)) {
        settled.set(slug, dollars(v));
        tiers.set(slug, t.tier);
      }
    }
    for (const [slug, v] of Object.entries(rv.live.awards)) {
      pending.set(slug, dollars(v));
      const t = rv.live.tiers?.[slug];
      if (t) tiers.set(slug, t);
    }
    return { settled, pending, tiers };
  }, [rv]);

  const { votePct, votePendingPct, voteTiers } = useMemo(() => {
    const total = new Map<string, number>();
    const pend = new Map<string, number>();
    const tiers = new Map<string, Tier>();
    for (const c of cards) {
      const goal = c.initiative.goalUsd;
      if (!money || goal <= 0) continue;
      const s = money.settled.get(c.initiative.slug) ?? 0;
      const p = money.pending.get(c.initiative.slug) ?? 0;
      if (s + p > 0) total.set(c.initiative.id, ((s + p) / goal) * 100);
      if (p > 0) pend.set(c.initiative.id, (p / goal) * 100);
      const t = money.tiers.get(c.initiative.slug);
      if (t) tiers.set(c.initiative.id, t);
    }
    return { votePct: total, votePendingPct: pend, voteTiers: tiers };
  }, [money, cards]);

  // The gaps (open round only), by initiative id, and the titles the hover names.
  const { next, titles } = useMemo(() => {
    const next = new Map<string, NextTierEntry>();
    const titles = new Map<string, string>();
    for (const c of cards) {
      titles.set(c.initiative.slug, c.initiative.title);
      const e = rv && !rv.closed ? rv.live.next?.[c.initiative.slug] : undefined;
      if (e) next.set(c.initiative.id, e);
    }
    return { next, titles };
  }, [rv, cards]);

  const raised = money
    ? [...money.settled.values(), ...money.pending.values()].reduce((a, b) => a + b, 0)
    : undefined;
  const n = rv ? Object.keys(rv.accepted).length : 0;
  const ballotsText = plural(n, "ballot");
  const isClosed = Boolean(rv?.closed);
  const started = rv?.tiers.some((t) => t.status !== "waiting");
  const sTally = ROUND.schedule?.firstTallyAt[0] ?? ROUND.closesAt;
  const pool = dollars(rv?.poolUsd ?? ROUND.poolUsd);
  // Once closed, the two lists; the cards carry only their final amount.
  const results = useMemo(
    () => rv?.closed ? splitResults(cards, rv.tiers) : undefined,
    [rv, cards],
  );
  /** The list has a section per tier with what it funded; a tier that funded nothing has
   * no section, so the hero says so. */
  const tierLines = isClosed && rv
    ? rv.tiers.filter((t) => t.status === "waiting" || !t.funded.length).map((t) => (
      <p key={t.tier} className="m-0">{tierName(t.tier)}: no initiatives funded</p>
    ))
    : null;

  const hero = (
    <Hero
      raised={raised}
      kicker={<span className="text-vote">{REAL ? "TheDAO vote" : "Test vote"}</span>}
      sub={isClosed
        ? (
          <>
            {usdShort(raised ?? 0)} of {usdShort(pool)}{" "}
            <span className="text-vote">{POOL_NAME}</span> spent
          </>
        )
        : started && rv
        ? <>{stageLine(rv)}{tierBEmpty(rv) && TIER_B_NOTE}</>
        : (
          <>
            would be funded by {ballotsText} from the {usd(POOL_USD)}{" "}
            <span className="text-vote">{POOL_NAME}</span> · Tier-S starts settling in{" "}
            {timeLeft(sTally - Math.floor(now / 1000))}
            {rv && tierBEmpty(rv) && TIER_B_NOTE}
          </>
        )}
    >
      {tierLines && <div className="mt-3 space-y-1 text-[14px] text-white/60">{tierLines}</div>}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-white/55">
        <span className="flex items-center gap-2">
          <i className="inline-block h-[6px] w-6 rounded-full bg-gradient-to-r from-dao-green to-dao-bright" />
          already raised
        </span>
        <span className="flex items-center gap-2">
          <i className="inline-block h-[6px] w-6 rounded-full bg-vote" />
          from the vote
        </span>
        {votePendingPct.size > 0 && (
          <span className="flex items-center gap-2">
            <i className="inline-block h-[6px] w-6 rounded-full bg-vote/45" />
            if it settled now
          </span>
        )}
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
      votePendingPct={votePendingPct}
      voteTiers={voteTiers}
      results={results}
      next={next}
      titles={titles}
      hero={hero}
      heading={isClosed ? "The vote's final result" : "If the vote ended now"}
      defaultSort="closest"
    />
  );
}
