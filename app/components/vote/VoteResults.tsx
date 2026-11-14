import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import RoundBox from "./RoundBox";
import DaoBallot, { daoResult, type SettledTier } from "./DaoBallot";
import GiveList, { ClosestBox, gapUsd, type GiveRow, knockOnVerb } from "./GiveList";
import MockNav from "./MockNav";
import type { BallotItem } from "./TierBallot";
import BoardPage from "~/components/board/BoardPage";
import Hero from "~/components/board/Hero";
import PledgeBand from "~/components/board/PledgeBand";
import PageMain from "~/components/layout/PageMain";
import { Button, LinkButton } from "~/components/ui/Button";
import { boardKey, useBoard } from "~/hooks/use-board";
import { myCode } from "~/lib/vote-local";
import { dollars, splitResults } from "~/lib/vote-results";
import { useSession } from "~/context/session";
import { type NextTierEntry, type RoundView, useMyBadges, useVoteRound } from "~/hooks/use-vote";
import { usd, usdShort } from "~/lib/format";
import { ROUND, type VoteManifest } from "../../../shared/vote/manifest";
import { type Tier, tierName, TIERS } from "../../../shared/vote/ballot";
import { chainTally } from "../../../shared/vote/chain";
import { liveInputsFrom } from "../../../shared/vote/live-inputs";
import { giftEffect, giftGapTo, liveTiers } from "../../../shared/vote/next-tier";

const POLL_MS = 5_000;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Voters should expect B-Tier may be empty: it only funds what the pool has left. */
const tierBEmpty = (rv: RoundView) =>
  rv.tiers.find((t) => t.tier === "B")?.status !== "settled" &&
  !Object.values(rv.live.tiers ?? {}).includes("B");
const TIER_B_NOTE = " · B-Tier: nothing funded yet, the pool may not reach it.";

/** The vote results. The real vote's are the front page, a test vote's are on `/vote`
 * (voters only), and examples of them at `/vote/results/<moment>` (`example`: a fictional
 * round at one moment, nothing donated from it).
 *
 * While the vote is open: TheDAO's ballot (what the vote would fund if it ended now) beside
 * every open initiative: what a donation takes to move it up a tier (or, in the tier
 * settling now, how far ahead it is), with the donate form, whose donation is previewed on
 * TheDAO's ballot. Once closed: the board, limited to the
 * round's initiatives, as the final result. */
/** What a donation does to the open tiers, if the vote ended now: where the initiative
 * lands (null: not funded), and who else comes in, drops out or moves. */
type Change = {
  was: Tier | null;
  tier: Tier | null;
  comesIn: { slug: string; tier: Tier }[];
  dropsOut: { slug: string; tier: Tier }[];
  moves: { slug: string; from: Tier; to: Tier }[];
};

export default function VoteResults(
  { example }: { example?: { round: VoteManifest; view: RoundView } } = {},
) {
  const R = example?.round ?? ROUND;
  const REAL = R.kind === "real";
  const POOL_NAME = REAL ? "pool" : "demo pool";
  const board = useBoard();
  const qc = useQueryClient();
  const round = useVoteRound(POLL_MS, !example);
  const rv = example?.view ?? round.data;
  // The way back to your ballot: by the code this browser opened it with, else by the
  // signed-in account's badge (found on-chain). Not on an example.
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => setCode(myCode()), []);
  const { session } = useSession();
  const badges = useMyBadges(session?.address ?? null, !code && !example);
  const mine = example
    ? null
    : code
    ? `/vote/${code}`
    : badges.data?.length
    ? "/vote/ballot"
    : null;

  const inRound = useMemo(() => new Set(R.slugs), [R]);
  const cards = useMemo(
    () => (board.data?.cards ?? []).filter((c) => inRound.has(c.initiative.slug)),
    [board.data, inRound],
  );

  const settled = useMemo<SettledTier[] | undefined>(
    () =>
      rv?.tiers.flatMap((t) =>
        t.status === "settled"
          ? [{
            tier: t.tier,
            funded: t.funded,
            awards: Object.fromEntries(Object.entries(t.awards).map(([s, v]) => [s, dollars(v)])),
          }]
          : []
      ),
    [rv],
  );
  const tally = useMemo(() =>
    rv && {
      tiers: rv.live.tiers ?? {},
      awards: Object.fromEntries(Object.entries(rv.live.awards).map(([s, v]) => [s, dollars(v)])),
    }, [rv]);
  const result = useMemo(() => daoResult(settled, tally), [settled, tally]);
  const raised = rv ? [...result.awards.values()].reduce((a, b) => a + b, 0) : undefined;
  const n = rv ? Object.keys(rv.accepted).length : 0;
  const isClosed = Boolean(rv?.closed);
  const pool = dollars(rv?.poolUsd ?? R.poolUsd);

  /** The tier settling now (or next to): the first one not settled. */
  const tier: Tier = rv?.tiers.find((t) => t.status !== "settled")?.tier ?? "S";
  const give = rv?.live.give;
  const lead = rv?.live.lead;
  // Every open initiative: below the tier settling now, the donation that moves it up a
  // tier; in it, how far ahead it is.
  const rows = useMemo<GiveRow[] | undefined>(() => {
    if (!give) return undefined;
    const bySlug = new Map(cards.map((c) => [c.initiative.slug, c]));
    const below = Object.entries(give).flatMap(([slug, entry]) => {
      const card = bySlug.get(slug);
      return card ? [{ card, entry, now: result.tiers[slug] }] : [];
    });
    const ahead = [...result.provisional].flatMap((slug) => {
      const card = bySlug.get(slug);
      if (!card || give[slug] || result.tiers[slug] !== tier) return [];
      const l = lead?.[slug];
      return [{ card, lead: l ? dollars(l) : 0, now: tier }];
    });
    return [...ahead, ...below];
  }, [give, lead, cards, result, tier]);

  // The initiative open in the list, and the amount in its donate form.
  const [open, setOpen] = useState<string>();
  const [amount, setAmount] = useState(0);
  // The live tally's inputs, read once per round: a donation's preview re-runs it.
  const liveInputs = rv?.live.inputs;
  const liveRun = useMemo(() => {
    if (!liveInputs) return undefined;
    const { inp, first } = liveInputsFrom(liveInputs);
    return { inp, first, base: liveTiers(inp, first) };
  }, [liveInputs]);
  const entry: NextTierEntry | undefined = open ? give?.[open] : undefined;
  const gap = entry ? gapUsd(entry) : null;
  const given = amount;
  const needOf = (slug: string) => {
    const c = cards.find((x) => x.initiative.slug === slug);
    return c ? Math.max(0, c.initiative.goalUsd - c.summary.total) : 0;
  };
  const titleOf = (slug: string) =>
    cards.find((x) => x.initiative.slug === slug)?.initiative.title ?? slug;
  /** An initiative named in running text: set apart from the words around it. The one your
   * donation brings in is green, as its chip; all are in italics. */
  const named = (slug: string) => (
    <i className={slug === open ? "text-[#a7e3a5]" : "text-white"}>{titleOf(slug)}</i>
  );
  /** With the tally's inputs: the donation that gets the open initiative into each open
   * tier above where it is now, lowest first (a few tallies each, worked out as it opens).
   * Two tiers one amount reaches show once, as the higher. */
  const steps = useMemo(() => {
    if (!liveRun || !open) return undefined;
    const c = R.slugs.indexOf(open);
    if (c < 0) return undefined;
    const now = liveRun.base.get(c) ?? TIERS.length;
    const out: { usd: number; tier: Tier }[] = [];
    for (let t = now - 1; t >= liveRun.first; t--) {
      const g = giftGapTo(liveRun.inp, liveRun.first, c, t, chainTally, liveRun.base);
      if (g === null) continue;
      const usd = dollars(g.toString());
      if (out.at(-1)?.usd === usd) out.pop();
      out.push({ usd, tier: TIERS[t] });
    }
    return out;
  }, [liveRun, open, R]);
  /** What the amount typed does, if the vote ended now: with the tally's inputs, re-run
   * here at every amount (a part of the gap can still free money that brings others
   * in); without them (the examples, an older server), only at the gap, as the server
   * worked it out. */
  const change = useMemo((): Change | undefined => {
    if (!open || given <= 0) return undefined;
    if (liveRun) {
      const c = R.slugs.indexOf(open);
      if (c < 0) return undefined;
      const micro = BigInt(Math.round(given)) * 1_000_000n;
      const e = giftEffect(liveRun.inp, liveRun.first, c, micro, chainTally, liveRun.base);
      return {
        was: e.was,
        tier: e.tier,
        comesIn: e.comesIn.map(([o, tier]) => ({ slug: R.slugs[o], tier })),
        dropsOut: e.dropsOut.map(([o, tier]) => ({ slug: R.slugs[o], tier })),
        moves: e.moves.map(([o, from, to]) => ({ slug: R.slugs[o], from, to })),
      };
    }
    if (!entry || gap === null || given < gap) return undefined;
    return { was: result.tiers[open] ?? null, ...entry };
  }, [open, given, liveRun, R, entry, gap, result]);
  // Who else it moves is on TheDAO's ballot and in the row's "What else changes": here,
  // only how many.
  const others = change
    ? new Set([...change.comesIn, ...change.moves, ...change.dropsOut].map((o) => o.slug)).size
    : 0;
  const movesUp = Boolean(change?.tier && change.tier !== change.was);
  /** With the donation, if it changes anything: TheDAO's ballot as the tally would have it. */
  const preview = open && change && (movesUp || others > 0)
    ? (() => {
      const tiers = { ...result.tiers };
      const funded = new Set(result.funded);
      const provisional = new Set(result.provisional);
      const awards = new Map(result.awards);
      if (change.tier) {
        tiers[open] = change.tier;
        funded.add(open);
        provisional.add(open);
        // The donation pays that much of its need: the pool is asked for the rest.
        awards.set(open, Math.max(0, needOf(open) - given));
      }
      // Others it moves to another tier, and those it brings in.
      for (const o of change.moves) tiers[o.slug] = o.to;
      for (const o of change.comesIn) {
        tiers[o.slug] = o.tier;
        funded.add(o.slug);
        provisional.add(o.slug);
        awards.set(o.slug, needOf(o.slug));
      }
      return {
        result: { tiers, funded, provisional, awards },
        joining: change.tier ? new Map([[open, given]]) : undefined,
        leaving: new Set(change.dropsOut.map((o) => o.slug)),
        moved: new Map(change.moves.map((o) => [o.slug, o.from] as const)),
      };
    })()
    : undefined;
  const knockOn = preview && others > 0 && (
    <>
      {" "}
      {
        // All pushed out: they drop out; all brought in: they come in; else they change places.
        (() => {
          const verb = change ? knockOnVerb(change).verb : "moves";
          const one = others === 1;
          const who = one ? "1 other initiative" : `${others} other initiatives`;
          return verb === "drops"
            ? `${who} ${one ? "drops" : "drop"} out.`
            : verb === "brings in"
            ? `${who} ${one ? "comes" : "come"} in.`
            : `${who} ${one ? "changes place" : "change places"}.`;
        })()
      }
    </>
  );
  /** The donation's effect in a few words: it comes in, or (already in) it frees money. */
  const said = open && change && (
    movesUp
      ? (
        <>
          With your {usd(given)}, the initiative {named(open)} comes into{" "}
          <span className="whitespace-nowrap">{tierName(change.tier!)}</span>
        </>
      )
      : <>With your {usd(given)}, {named(open)} asks the pool for less</>
  );
  // Under the form only when the amount changes nothing on TheDAO's ballot: what it does
  // is said above the tier table, beside its preview.
  const effect = open && given > 0 && (
    preview
      ? null
      : entry && gap !== null && given < gap
      ? (
        <p className="m-0 rounded-lg bg-white/[.07] px-3 py-2 text-[13px] leading-snug text-white/80">
          Not enough alone for {tierName(entry.tier)}: {usd(gap - given)}{" "}
          would still be missing. It still counts, and others can add the rest.
        </p>
      )
      : (
        <p className="m-0 rounded-lg bg-white/[.07] px-3 py-2 text-[13px] leading-snug text-white/80">
          It asks the pool for {usd(Math.min(given, needOf(open)))} less. Nothing else changes.
        </p>
      )
  );

  /** Opens an initiative in the list, its form starting at what brings it in. */
  const openRow = (slug: string | undefined) => {
    setOpen(slug);
    setAmount(slug && give?.[slug] ? gapUsd(give[slug]) ?? 0 : 0);
  };
  /** The same from the box above the list, which also scrolls down to it. */
  const pick = (slug: string) => {
    openRow(slug);
    requestAnimationFrame(() =>
      document.querySelector(`[data-give-row="${CSS.escape(slug)}"]`)?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      })
    );
  };

  const items = useMemo<BallotItem[]>(
    () => cards.map((card) => ({ slug: card.initiative.slug, title: card.initiative.title, card })),
    [cards],
  );

  if (isClosed && rv) {
    return (
      <ClosedResults
        R={R}
        rv={rv}
        cards={cards}
        raised={raised}
        mine={mine}
        example={Boolean(example)}
      />
    );
  }

  const hero = (
    <Hero
      raised={raised}
      kicker={
        <span className="text-vote">
          {REAL ? "TheDAO vote" : "Test vote"}
        </span>
      }
      sub={
        // Where the round is: the round box below.


          <>
            would be funded by {plural(n, "ballot")} from the {usd(pool)}{" "}
            <span className="text-vote">{POOL_NAME}</span>
            {rv && tierBEmpty(rv) && TIER_B_NOTE}
          </>

      }
    >
      {R.schedule && (
        // Where the round is (two thirds), and beside it the initiatives closest to the tier
        // settling now (a third); stacked on a phone.
        <div className="mx-auto mt-6 grid max-w-[1052px] grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 [&>section]:h-full">
            <RoundBox schedule={R.schedule} rv={rv} large />
          </div>
          <ClosestBox tier={tier} rows={rows} onPick={pick} />
        </div>
      )}
      {mine && (
        <div className="mt-5 flex justify-center">
          <LinkButton variant="primary" to={mine}>See or change your ballot</LinkButton>
        </div>
      )}
    </Hero>
  );

  return (
    <>
      {example && (
        <div className="px-6 pt-8">
          <MockNav />
        </div>
      )}
      {hero}
      <PageMain className="pt-8">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {/* Stays in view beside the long list, so a donation's preview shows by its form. */}
          <div className="card grid min-w-0 grid-cols-1 gap-y-2 text-[15px] leading-relaxed text-white/80 lg:sticky lg:top-[86px]">
            <DaoBallot
              items={items}
              result={preview?.result ?? result}
              poolUsd={pool}
              live
              // Green is a donation's preview here: what the live tally adds stays neutral.
              liveTone="neutral"
              label={preview ? "TheDAO's ballot, with your donation" : "TheDAO's ballot"}
              note={preview && open && (
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-dashed border-dao-green/70 bg-dao-green/[.12] px-3 py-2">
                  <p className="m-0 flex-1 text-[13.5px] leading-snug text-white">
                    {said}.{knockOn}
                  </p>
                  <Button sm className="flex-none" onClick={() => setOpen(undefined)}>
                    Clear
                  </Button>
                </div>
              )}
              table={{
                mirrored: false,
                joining: preview?.joining,
                leaving: preview?.leaving,
                moved: preview?.moved,
              }}
            />
            <Legend preview={Boolean(preview)} />
          </div>
          <GiveList
            tier={tier}
            rows={rows}
            open={open}
            onOpen={openRow}
            onAmount={setAmount}
            effect={effect}
            canDonate={Boolean(board.data?.flags.tokensOk)}
            example={Boolean(example)}
            onDonated={() => void qc.invalidateQueries({ queryKey: boardKey })}
            search={{
              ai: board.data?.flags.aiSearch,
              aiAuto: board.data?.flags.aiSearchAuto,
            }}
            steps={steps}
          />
        </div>
        <PledgeBand />
      </PageMain>
    </>
  );
}

function Legend({ preview }: { preview: boolean }) {
  const item = (swatch: string, text: string) => (
    <span className="flex items-center gap-2">
      <i className={`inline-block h-[6px] w-6 rounded-full ${swatch}`} aria-hidden="true" />
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 text-[13px] text-white/60">
      {item("bg-vote", "settled: funded")}
      {item("bg-white/55", "funded if its tier settled now")}
      {preview &&
        item("border border-dashed border-dao-green bg-dao-green/30", "with your donation")}
      {preview && (
        <span className="flex items-center gap-1.5">
          <b className="text-vote-pale" aria-hidden="true">↑↓</b>moves with it
        </span>
      )}
      {preview && (
        <span className="flex items-center gap-1.5 text-[#ff8a88]">
          <b aria-hidden="true">↓</b>dropped out
        </span>
      )}
    </div>
  );
}

/** Once the vote is closed: the board, limited to the round's initiatives, in a Funded and
 * a Not funded list, each card with its final amount and its gap judged at its settlement. */
function ClosedResults(
  { R, rv, cards, raised, mine, example }: {
    /** An example page: the examples' picker over the hero. */
    example?: boolean;
    R: VoteManifest;
    rv: RoundView;
    cards: NonNullable<ReturnType<typeof useBoard>["data"]>["cards"];
    raised?: number;
    mine: string | null;
  },
) {
  const REAL = R.kind === "real";
  const inRound = useMemo(() => new Set(R.slugs), [R]);
  const pool = dollars(rv.poolUsd ?? R.poolUsd);

  const { votePct, voteTiers } = useMemo(() => {
    const total = new Map<string, number>();
    const tiers = new Map<string, Tier>();
    for (const t of rv.tiers) {
      if (t.status !== "settled") continue;
      for (const [slug, v] of Object.entries(t.awards)) {
        const c = cards.find((x) => x.initiative.slug === slug);
        if (!c || c.initiative.goalUsd <= 0) continue;
        total.set(c.initiative.id, (dollars(v) / c.initiative.goalUsd) * 100);
        tiers.set(c.initiative.id, t.tier);
      }
    }
    return { votePct: total, voteTiers: tiers };
  }, [rv, cards]);

  // The gaps and S-Tier leads by initiative id, frozen at each settlement, and the titles
  // the hover names.
  const { next, lead, titles } = useMemo(() => {
    const next = new Map<string, NextTierEntry>();
    const lead = new Map<string, string>();
    const titles = new Map<string, string>();
    for (const c of cards) {
      const slug = c.initiative.slug;
      titles.set(slug, c.initiative.title);
      const e = rv.final?.next?.[slug];
      if (e) next.set(c.initiative.id, e);
      const l = rv.final?.lead?.[slug];
      if (l) lead.set(c.initiative.id, l);
    }
    return { next, lead, titles };
  }, [rv, cards]);

  const results = useMemo(() => splitResults(cards, rv.tiers), [rv, cards]);
  /** The list has a section per tier with what it funded; a tier that funded nothing has
   * no section, so the hero says so. */
  const tierLines = rv.tiers.filter((t) => t.status === "waiting" || !t.funded.length).map((t) => (
    <p key={t.tier} className="m-0">{tierName(t.tier)}: no initiatives funded</p>
  ));

  const hero = (
    <Hero
      raised={raised}
      kicker={<span className="text-vote">{REAL ? "TheDAO vote" : "Test vote"}</span>}
      sub={
        <>
          {usdShort(raised ?? 0)} of {usdShort(pool)}{" "}
          <span className="text-vote">{REAL ? "pool" : "demo pool"}</span> spent
        </>
      }
    >
      {tierLines.length > 0 && (
        <div className="mt-3 space-y-1 text-[14px] text-white/60">{tierLines}</div>
      )}
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
          <LinkButton variant="primary" to={mine}>See your ballot</LinkButton>
        </div>
      )}
    </Hero>
  );

  return (
    <BoardPage
      only={inRound}
      votePct={votePct}
      voteTiers={voteTiers}
      results={results}
      next={next}
      lead={lead}
      titles={titles}
      hero={example
        ? (
          <>
            <div className="px-6 pt-8">
              <MockNav />
            </div>
            {hero}
          </>
        )
        : hero}
      heading="The vote's final result"
      defaultSort="closest"
    />
  );
}
