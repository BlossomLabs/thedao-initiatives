import { useEffect, useMemo, useState } from "react";
import RoundBox from "./RoundBox";
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

const REAL = ROUND.kind === "real";
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

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

  // The gaps and Tier-S leads by initiative id (live while the round is open, frozen at
  // each settlement once it is closed), and the titles the hover names.
  const { next, lead, titles } = useMemo(() => {
    const next = new Map<string, NextTierEntry>();
    const lead = new Map<string, string>();
    const titles = new Map<string, string>();
    const src = rv ? (rv.closed ? rv.final : rv.live) : undefined;
    for (const c of cards) {
      const slug = c.initiative.slug;
      titles.set(slug, c.initiative.title);
      const e = src?.next?.[slug];
      if (e) next.set(c.initiative.id, e);
      const l = src?.lead?.[slug];
      if (l) lead.set(c.initiative.id, l);
    }
    return { next, lead, titles };
  }, [rv, cards]);

  const raised = money
    ? [...money.settled.values(), ...money.pending.values()].reduce((a, b) => a + b, 0)
    : undefined;
  const n = rv ? Object.keys(rv.accepted).length : 0;
  const ballotsText = plural(n, "ballot");
  const isClosed = Boolean(rv?.closed);
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
        : (
          // Where the round is: the round box below.
          <>
            would be funded by {ballotsText} from the {usd(POOL_USD)}{" "}
            <span className="text-vote">{POOL_NAME}</span>
            {rv && tierBEmpty(rv) && TIER_B_NOTE}
          </>
        )}
    >
      {!isClosed && ROUND.schedule && (
        <div className="mx-auto mt-6 max-w-[640px]">
          <RoundBox schedule={ROUND.schedule} rv={rv} large />
        </div>
      )}
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
      lead={lead}
      titles={titles}
      hero={hero}
      heading={isClosed ? "The vote's final result" : "If the vote ended now"}
      defaultSort="closest"
    />
  );
}
