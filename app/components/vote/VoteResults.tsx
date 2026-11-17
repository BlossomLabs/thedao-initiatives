import { useRound, useVoteBase } from "~/lib/vote-round";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import RoundBox from "./RoundBox";
import ValuationNotes from "./ValuationNotes";
import DaoBallot, { daoResult, type SettledTier } from "./DaoBallot";
import GiveList, { ClosestBox, gapUsd, type GiveRow, knockOnVerb } from "./GiveList";
import MockNav from "./MockNav";
import type { BallotItem } from "./TierBallot";
import BoardPage from "~/components/board/BoardPage";
import Hero from "~/components/board/Hero";
import PledgeBand from "~/components/board/PledgeBand";
import PageMain from "~/components/layout/PageMain";
import StickyAside from "~/components/layout/StickyAside";
import { Button, LinkButton } from "~/components/ui/Button";
import { boardKey, useBoard } from "~/hooks/use-board";
import { useThreatJumps } from "~/hooks/use-threat-jumps";
import {
  askOf,
  coveredProjects,
  dollars,
  servedAsks,
  splitResults,
  withdrawnProjects,
} from "~/lib/vote-results";
import { useSession } from "~/context/session";
import { type NextTierEntry, type RoundView, useMyBadges, useVoteRound } from "~/hooks/use-vote";
import { usd, usdShort } from "~/lib/format";
import { changeCause, changeEffect, changeHeadline, changeMoves } from "~/lib/vote-change";
import { When } from "./When";
import type { LastChangeJson } from "../../../shared/vote/replay-round";
import { type VoteManifest } from "../../../shared/vote/manifest";
import { poolEstimated, poolName, poolNoteText } from "~/components/vote/pool";
import { dollars as dollarsFull } from "~/components/vote/FinalTiers";
import { type Tier, tierName, TIERS } from "../../../shared/vote/ballot";
import { chainTally } from "../../../shared/vote/chain";
import { liveInputsFrom, type LiveInputsJson } from "../../../shared/vote/live-inputs";
import { FINE, giftEffect, giftGapTo, liveTiers } from "../../../shared/vote/next-tier";

const POLL_MS = 5_000;

/** What caused the last change to TheDAO's ballot, and what it did; each move in the
 * hover title. */
function LastChangeNote(
  { change, titleOf }: { change: LastChangeJson; titleOf: (slug: string) => string },
) {
  const effect = changeEffect(change);
  return (
    <p
      className="m-0 mt-2 text-[13px] leading-snug text-white/60"
      title={changeMoves(change, titleOf) || undefined}
      data-testid="last-change"
    >
      Last change, <When at={change.at} />: {changeCause(change, titleOf)}
      {effect && `, which ${effect}`}.
    </p>
  );
}

/** A change to the result while the page is open, said for a few seconds (#126): what
 * caused it, then what moved ("A donation to Foo: Foo is now included in A-Tier and Bar was
 * pushed out."). Your own donation and anyone else's ballot or donation alike. */
function ChangeToast(
  { ready, change, titleOf }: {
    /** The round's figures have come: the change they bring is the starting point. */
    ready: boolean;
    change: LastChangeJson | undefined;
    titleOf: (slug: string) => string;
  },
) {
  const [shown, setShown] = useState<{ at: number; text: string }>();
  /** The change already on screen when the figures first came: never a toast. */
  const seen = useRef<number | null>(null);
  const at = change?.at ?? 0;
  useEffect(() => {
    if (!ready) return;
    const before = seen.current;
    seen.current = at;
    if (before === null || before === at || !change) return;
    const head = changeHeadline(change, titleOf);
    if (!head) return;
    const cause = changeCause(change, titleOf);
    setShown({ at, text: `${cause[0].toUpperCase()}${cause.slice(1)}: ${head}` });
    // Only a new change matters; titleOf is a new closure on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, at]);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [shown]);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[150] flex justify-center px-4"
    >
      {shown && (
        <div
          key={shown.at}
          data-testid="change-toast"
          className="pointer-events-auto flex max-w-[560px] items-start gap-3 rounded-[14px] border border-edge2 bg-panel px-4 py-3 font-inter-tight text-[14px] leading-snug text-white shadow-menu motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3"
        >
          <p className="m-0 flex-1">{shown.text}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setShown(undefined)}
            className="-my-0.5 -mr-1 cursor-pointer rounded-md p-0.5 text-white/55 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
/** How long a change's toast stays, ms. */
const TOAST_MS = 9_000;

/** How long typing pauses before a typed amount's number is worked out, ms. */
const TYPED_PAUSE_MS = 400;

/** A short name for the live tally's inputs: any change in them changes it (FNV-1a over
 * their JSON, with its length). */
function inputsKey(inputs: LiveInputsJson): string {
  const s = JSON.stringify(inputs);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `${s.length}:${(h >>> 0).toString(36)}`;
}
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Voters should expect B-Tier may be empty: it only funds what the pool has left. Said
 * once something above it is funded: before that, nothing anywhere is. */
export const tierBEmpty = (rv: RoundView) => {
  const live = Object.values(rv.live.tiers ?? {});
  const fundedAbove = live.length > 0 ||
    rv.tiers.some((t) => t.status === "settled" && t.funded.length > 0);
  return fundedAbove && rv.tiers.find((t) => t.tier === "B")?.status !== "settled" &&
    !live.includes("B");
};
const TIER_B_NOTE = " · B-Tier: nothing funded yet, the pool may not reach it.";

/** The vote results. The real vote's are the front page, a test vote's are on `/vote-test`
 * (voters only), and examples of them at `/vote-test/results/<moment>` (`example`: a fictional
 * round at one moment, nothing donated from it).
 *
 * While the vote is open: TheDAO's ballot (what the vote would fund if it ended now) beside
 * every open initiative: what a donation takes to move it up a tier (or, in the tier
 * settling now, what a donation elsewhere takes to push it out), with the donate form,
 * whose donation is previewed on TheDAO's ballot. Once closed: the board, limited to the
 * round's initiatives, as the final result. */
/** What a donation does to the open tiers, if the vote ended now: where the initiative
 * lands (null: not funded), and who else comes in, drops out or moves. */
type Change = {
  was: Tier | null;
  tier: Tier | null;
  /** It gives the initiative its whole ask: covered by donations, in no tier. */
  covered?: boolean;
  comesIn: { slug: string; tier: Tier }[];
  dropsOut: { slug: string; tier: Tier }[];
  moves: { slug: string; from: Tier; to: Tier }[];
};

/** Projects apart from the tiers, nothing from the pool and in no tier: covered by
 * donations, or withdrawn by an admin. */
function Covered({ label, titles }: { label: string; titles: string[] }) {
  if (!titles.length) return null;
  return (
    <section
      aria-label={label}
      className="rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-[13.5px] leading-snug"
    >
      <b className="text-[12px] font-semibold uppercase tracking-wide text-white/60">{label}</b>
      <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-white/80">
        {titles.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </section>
  );
}

export default function VoteResults(
  { example }: { example?: { round: VoteManifest; view: RoundView } } = {},
) {
  const ROUND = useRound();
  const voteBase = useVoteBase();
  const R = example?.round ?? ROUND;
  const REAL = R.kind === "real";
  const POOL_NAME = REAL ? "pool" : "demo pool";
  const board = useBoard();
  const qc = useQueryClient();
  const round = useVoteRound(POLL_MS, !example);
  const rv = example?.view ?? round.data;
  // The way back to your ballot: by the signed-in account's badge (found on-chain). Not
  // on an example.
  const { session } = useSession();
  const badges = useMyBadges(session?.address ?? null, !example);
  // A test round's gas top-up for donating goes by the voter's badge.
  const myBadge = badges.data?.[0];
  const mine = example ? null : badges.data?.length ? `${voteBase}/ballot` : null;

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
  // The vote finishing while the page is open (not a page opened on a finished vote): the
  // final result lights up in gold (no confetti: that's for donations).
  const wasClosed = useRef<boolean>(undefined);
  const [justFinished, setJustFinished] = useState(false);
  useEffect(() => {
    if (!rv) return;
    const was = wasClosed.current;
    wasClosed.current = isClosed;
    if (was === false && isClosed) {
      setJustFinished(true);
    }
  }, [rv, isClosed]);
  const pool = dollars(rv?.poolUsd ?? R.poolUsd);

  /** The tier settling now (or next to): the first one not settled. */
  const tier: Tier = rv?.tiers.find((t) => t.status !== "settled")?.tier ?? "S";
  const give = rv?.live.give;
  const covered = useMemo(() => coveredProjects(rv?.tiers ?? [], rv?.live.covered), [rv]);
  const withdrawn = useMemo(() => withdrawnProjects(rv?.tiers ?? [], rv?.live.withdrawn), [rv]);
  // In the tier settling now: what one donation elsewhere takes to push each out of it.
  const threat = rv?.live.threat;
  // Each initiative's ask is the chain's, served with the round (none while it's unknown,
  // or served short).
  const asks = servedAsks(R, rv?.asks);
  // Every open initiative: below the tier settling now, the donation that moves it up a
  // tier; in it, what a donation to another initiative takes to push it out.
  const rows = useMemo<GiveRow[] | undefined>(() => {
    if (!give) return undefined;
    const bySlug = new Map(cards.map((c) => [c.initiative.slug, c]));
    // Covered by donations or withdrawn now: in no tier, whatever older gaps say.
    const coveredNow = new Set([...covered.now, ...withdrawn]);
    const below = Object.entries(give).flatMap(([slug, entry]) => {
      const card = bySlug.get(slug);
      return card && !coveredNow.has(slug)
        ? [{ card, askUsd: askOf(R, asks, slug), entry, now: result.tiers[slug] }]
        : [];
    });
    const ahead = [...result.provisional].flatMap((slug) => {
      const card = bySlug.get(slug);
      if (!card || give[slug] || coveredNow.has(slug) || result.tiers[slug] !== tier) return [];
      const t = threat?.[slug];
      return [{
        card,
        askUsd: askOf(R, asks, slug),
        threat: t === undefined ? undefined : t === null ? null : dollars(t),
        now: tier,
      }];
    });
    return [...ahead, ...below];
  }, [give, threat, cards, result, tier, R, asks, covered, withdrawn]);

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
  // A cleared or mistyped amount (NaN from the form) gives nothing.
  const given = Number.isFinite(amount) ? amount : 0;
  const needFor = (slug: string) => askOf(R, asks, slug) ?? 0;
  // What this visitor gave each initiative from here, kept in this browser per round
  // (#100): its chip on TheDAO's ballot says "+$X yours", its row "yours so far".
  const yoursKey = `thedao:vote-given:${R.chainId}:${R.contract.toLowerCase()}`;
  const [yours, setYours] = useState<Record<string, number>>({});
  // Read after mounting (the first render matches a prerendered page).
  useEffect(() => setYours(readYours(yoursKey)), [yoursKey]);
  const yoursMap = useMemo(() => new Map(Object.entries(yours)), [yours]);
  // The last donation until the round's figures count it (its ask drops by it): its
  // preview is held, solid, so it doesn't fall back for the few seconds that takes.
  const [held, setHeld] = useState<{ slug: string; usd: number; askAt: number }>();
  const heldAsk = held && askOf(R, asks, held.slug);
  useEffect(() => {
    if (!held) return;
    // Counted: the ask dropped by it (or to nothing).
    if (heldAsk !== undefined && heldAsk <= Math.max(0, held.askAt - held.usd) + 1) {
      return setHeld(undefined);
    }
    // Never held for long: past two minutes the figures are what they are.
    const t = setTimeout(() => setHeld(undefined), HOLD_MS);
    return () => clearTimeout(t);
  }, [held, heldAsk]);
  const onDonated = (slug: string, usd: number) => {
    setYours((y) => {
      const next = { ...y, [slug]: (y[slug] ?? 0) + usd };
      writeYours(yoursKey, next);
      return next;
    });
    setHeld((h) =>
      h?.slug === slug ? { ...h, usd: h.usd + usd } : { slug, usd, askAt: needFor(slug) }
    );
    setAmount(0);
    void qc.invalidateQueries({ queryKey: boardKey });
  };
  // What the preview is of: the open row, or the held donation while no other row is open.
  // A held donation counts in its own initiative's previews until the figures have it.
  const heldOn = held && (!open || open === held.slug) ? held : undefined;
  const subject = open ?? heldOn?.slug;
  const previewUsd = (heldOn ? heldOn.usd : 0) + (subject === open ? given : 0);
  const entry: NextTierEntry | undefined = subject ? give?.[subject] : undefined;
  const gap = entry ? gapUsd(entry) : null;
  const titleOf = (slug: string) =>
    cards.find((x) => x.initiative.slug === slug)?.initiative.title ?? slug;
  /** An initiative named in running text: set apart from the words around it. The one your
   * donation brings in is green, as its chip; all are in italics. */
  const named = (slug: string) => (
    <i className={slug === subject ? "text-[#a7e3a5]" : "text-white"}>{titleOf(slug)}</i>
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
      // In $10 steps, as the server's figures: an amount below a suggestion really
      // doesn't get it there.
      const g = giftGapTo(liveRun.inp, liveRun.first, c, t, chainTally, liveRun.base, FINE);
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
    if (!subject || previewUsd <= 0) return undefined;
    if (liveRun) {
      const c = R.slugs.indexOf(subject);
      if (c < 0) return undefined;
      const micro = BigInt(Math.round(previewUsd)) * 1_000_000n;
      const e = giftEffect(liveRun.inp, liveRun.first, c, micro, chainTally, liveRun.base);
      return {
        was: e.was,
        tier: e.tier,
        covered: e.covered,
        comesIn: e.comesIn.map(([o, tier]) => ({ slug: R.slugs[o], tier })),
        dropsOut: e.dropsOut.map(([o, tier]) => ({ slug: R.slugs[o], tier })),
        moves: e.moves.map(([o, from, to]) => ({ slug: R.slugs[o], from, to })),
      };
    }
    if (!entry || gap === null || previewUsd < gap) return undefined;
    return { was: result.tiers[subject] ?? null, ...entry };
  }, [subject, previewUsd, liveRun, R, entry, gap, result]);
  // Who else it moves is on TheDAO's ballot and in the row's "What else changes": here,
  // only how many.
  const others = change
    ? new Set([...change.comesIn, ...change.moves, ...change.dropsOut].map((o) => o.slug)).size
    : 0;
  const movesUp = Boolean(change?.tier && change.tier !== change.was);
  /** With the donation, if it changes anything: TheDAO's ballot as the tally would have it. */
  const rowOpen = open;
  const preview = subject && change && (movesUp || others > 0 || change.covered)
    ? (() => {
      const open = subject;
      const tiers = { ...result.tiers };
      const funded = new Set(result.funded);
      const provisional = new Set(result.provisional);
      const awards = new Map(result.awards);
      if (change.tier) {
        tiers[open] = change.tier;
        funded.add(open);
        provisional.add(open);
        // The donation pays that much of its need: the pool is asked for the rest.
        awards.set(open, Math.max(0, needFor(open) - previewUsd));
      } else if (change.covered) {
        // Its whole ask given: covered by donations, in no tier, nothing from the pool.
        delete tiers[open];
        funded.delete(open);
        provisional.delete(open);
        awards.delete(open);
      }
      // Others it moves to another tier, and those it brings in.
      for (const o of change.moves) tiers[o.slug] = o.to;
      for (const o of change.comesIn) {
        tiers[o.slug] = o.tier;
        funded.add(o.slug);
        provisional.add(o.slug);
        awards.set(o.slug, needFor(o.slug));
      }
      return {
        result: { tiers, funded, provisional, awards },
        // Dashed "+$X if you give" only for an amount typed now; what was given is solid.
        joining: change.tier && given > 0 && subject === rowOpen
          ? new Map([[open, given]])
          : undefined,
        leaving: new Set(change.dropsOut.map((o) => o.slug)),
        moved: new Map(change.moves.map((o) => [o.slug, o.from] as const)),
        arrived: new Set(change.comesIn.map((o) => o.slug)),
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
  const said = subject && change && (
    change.covered
      ? <>With your {usd(previewUsd)}, {named(subject)} is covered by donations</>
      : movesUp
      ? (
        <>
          With your {usd(previewUsd)}, the initiative {named(subject)} comes into{" "}
          <span className="whitespace-nowrap">{tierName(change.tier!)}</span>
        </>
      )
      : <>With your {usd(previewUsd)}, {named(subject)} asks the pool for less</>
  );
  // An open green row: the donations at which its number jumps, worked out ahead of a
  // click (the green rows shown first, in the order the list reports), and a typed
  // amount's number once typing pauses. Rows with no threat found have no suggestions.
  const [greenOrder, setGreenOrder] = useState<{ visible: string[]; rest: string[] }>({
    visible: [],
    rest: [],
  });
  const onGreenOrder = useCallback(
    (visible: string[], rest: string[]) => setGreenOrder({ visible, rest }),
    [],
  );
  const figures = useMemo(() => liveInputs && inputsKey(liveInputs), [liveInputs]);
  const rowOf = (slug: string) => rows?.find((r) => r.card.initiative.slug === slug);
  const workable = (slug: string) => {
    const r = rowOf(slug);
    return r !== undefined && !r.entry && r.threat !== null;
  };
  const indices = (slugs: string[]) =>
    slugs.filter(workable).map((s) => R.slugs.indexOf(s)).filter((c) => c >= 0);
  const openGreen = open !== undefined && rowOf(open) !== undefined && !rowOf(open)!.entry;
  const openC = openGreen ? R.slugs.indexOf(open!) : -1;
  // The amount in whole dollars, below the row's whole ask (all of it: covered, no number).
  const whole = Math.round(given);
  const typedNow = openGreen && liveRun && openC >= 0 && whole > 0 &&
      BigInt(whole) * 1_000_000n < liveRun.inp.costs[openC]
    ? { c: openC, given: whole }
    : undefined;
  // Sent once typing pauses; a new amount stops the work on the last one at once.
  const [typedSent, setTypedSent] = useState<{ c: number; given: number }>();
  useEffect(() => {
    setTypedSent(undefined);
    if (!typedNow) return;
    const t = setTimeout(() => setTypedSent(typedNow), TYPED_PAUSE_MS);
    return () => clearTimeout(t);
  }, [typedNow?.c, typedNow?.given]); // eslint-disable-line react-hooks/exhaustive-deps
  const worked = useThreatJumps({
    key: figures,
    inputs: liveInputs,
    open: openGreen && workable(open!) && openC >= 0 ? openC : undefined,
    visible: indices(greenOrder.visible),
    rest: indices(greenOrder.rest),
    typed: typedSent,
  });
  // Typed numbers worked out on these figures, kept: an amount typed again (cleared, then
  // the same) shows its line at once, though the work isn't done again.
  const typedSeen = useRef({ key: figures, at: new Map<string, number | null | undefined>() });
  if (typedSeen.current.key !== figures) typedSeen.current = { key: figures, at: new Map() };
  if (worked.typed) {
    typedSeen.current.at.set(`${worked.typed.c}:${worked.typed.given}`, worked.typed.threat);
  }
  const typedKey = typedNow && `${typedNow.c}:${typedNow.given}`;
  const typedKnown = typedKey !== undefined && typedSeen.current.at.has(typedKey);
  const typedThreat = typedKnown ? typedSeen.current.at.get(typedKey!) : undefined;
  const jumpsBySlug = useMemo(
    () =>
      liveInputs
        ? new Map([...worked.jumps].map(([c, js]) => [R.slugs[c], js] as const))
        : undefined,
    [worked.jumps, liveInputs, R],
  );
  /** On an open green row, under the form: what the amount does to its number (none when
   * the row isn't green after it, or the asks are unknown). */
  const greenLine = open && typedNow && askOf(R, asks, open) !== undefined &&
    !(typedKnown && typedThreat === undefined) && (
    <p className="m-0 rounded-lg bg-white/[.07] px-3 py-2 text-[13px] leading-snug text-white/80">
      {!typedKnown ? "Working out what it does…" : typedThreat === null
        ? (
          <>
            It asks the pool for {usd(given)}{" "}
            less. None of the donations to other initiatives we checked would move it out of{" "}
            {tierName(tier)} after this donation. Other amounts may still do so.
          </>
        )
        : (
          <>
            It asks the pool for {usd(given)} less. A donation of {usd(typedThreat!)}{" "}
            elsewhere could then move it out of {tierName(tier)}.
          </>
        )}
    </p>
  );
  // Under the form only when the amount changes nothing on TheDAO's ballot: what it does
  // is said above the tier table, beside its preview. On a green row, its number is said
  // here either way.
  const effect = open && given > 0 && (
    greenLine
      ? greenLine
      : preview
      ? null
      : entry && gap !== null && given < gap
      ? (
        <p className="m-0 rounded-lg bg-white/[.07] px-3 py-2 text-[13px] leading-snug text-white/80">
          Not enough alone for {tierName(entry.tier)}: {usd(gap - given)}{" "}
          would still be missing. It still counts, and others can add the rest.
        </p>
      )
      : (
        // Without the chain's asks, no amount: it would read as $0.
        <p className="m-0 rounded-lg bg-white/[.07] px-3 py-2 text-[13px] leading-snug text-white/80">
          {askOf(R, asks, open) === undefined ? "What it saves the pool is being worked out." : (
            <>
              It asks the pool for {usd(Math.min(given, needFor(open)))} less. Nothing else changes.
            </>
          )}
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
    () =>
      cards.map((card) => ({
        slug: card.initiative.slug,
        title: card.initiative.title,
        card,
        askUsd: askOf(R, asks, card.initiative.slug),
      })),
    [cards, R, asks],
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
        justFinished={justFinished}
      />
    );
  }

  /** Projects donations cover whole, in the tier that covers them on TheDAO's ballot: a
   * settled tier's, final (gold); the tier settling now, for now, with the one a donation
   * being previewed would cover. */
  const coveredIn = (() => {
    const tiers: Partial<Record<string, Tier>> = {};
    const kind = new Map<string, "final" | "now">();
    for (const t of rv?.tiers ?? []) {
      if (t.status !== "settled") continue;
      for (const slug of t.covered ?? []) {
        tiers[slug] = t.tier;
        kind.set(slug, "final");
      }
    }
    const now = [...covered.now, ...(change?.covered && subject && preview ? [subject] : [])];
    for (const slug of now) {
      if (kind.has(slug)) continue;
      tiers[slug] = tier;
      kind.set(slug, "now");
    }
    return { tiers, kind };
  })();

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
            would be funded by {plural(n, "ballot")} from the{" "}
            {poolEstimated(R) ? `${R.pool!.eth.toLocaleString("en-US")} ETH` : usd(pool)}{" "}
            <span className="text-vote">{POOL_NAME}</span>
            {poolEstimated(R) && (
              <span title={poolNoteText(R) ?? undefined}>{` (about ${usdShort(pool)})`}</span>
            )}
            {rv && tierBEmpty(rv) && TIER_B_NOTE}
          </>

      }
    >
      {mine && (
        // A badge holder's way in, right under what the ballots fund (#123): the editor.
        <div className="mt-5 flex justify-center">
          <LinkButton variant="primary" to={`${mine}/edit`}>Vote</LinkButton>
        </div>
      )}
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
      {rv && <ValuationNotes view={rv} round={R} />}
      {/* Pledging, up top and short, above the results (#127). */}
      <div className="mx-auto mt-6 max-w-[1052px] text-left">
        <PledgeBand compact />
      </div>
      {!example && (
        <ChangeToast ready={Boolean(rv)} change={rv?.live.lastChange} titleOf={titleOf} />
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
          {
            /* Stays in view beside the long list, so a donation's preview shows by its form.
              No scroll of its own (#121): taller than the screen, it follows the page's scroll
              until its bottom or its top shows. */
          }
          <StickyAside
            narrow="(max-width: 1023.98px)"
            className="card grid min-w-0 grid-cols-1 gap-y-2 text-[15px] leading-relaxed text-white/80 max-lg:static"
          >
            <DaoBallot
              items={items}
              result={preview?.result ?? result}
              poolUsd={pool}
              poolLabel={poolName(R, pool, dollarsFull)}
              live
              // Green is a donation's preview here: what the live tally adds stays neutral.
              liveTone="neutral"
              label={preview ? "TheDAO's ballot, with your donation" : "TheDAO's ballot"}
              // What moved the ballot last (#118); a donation's preview says its own.
              note={!preview && rv?.live.lastChange && (
                <LastChangeNote change={rv.live.lastChange} titleOf={titleOf} />
              )}
              // Its ring: the tier settling now and the later ones in two neutrals; green is
              // only a donation's preview here (a ballot's picks are green on its own page).
              settling={tier}
              table={{
                // Covered by donations: a chip in the tier that covers it, not a box apart.
                tiers: { ...(preview?.result ?? result).tiers, ...coveredIn.tiers },
                covered: coveredIn.kind,
                mirrored: false,
                // A tier settling while you watch: what it funds turns gold, glowing.
                celebrate: true,
                // What the live tally moves, moving there; a donation's preview (on or off)
                // only marks its changes.
                moves: !preview,
                joining: preview?.joining,
                yours: yoursMap,
                leaving: preview?.leaving,
                moved: preview?.moved,
                arrived: preview?.arrived,
              }}
            />
            {
              // What the donation does, under the tier table it previews on.
              preview && open && (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-dao-green/70 bg-dao-green/[.12] px-3 py-2">
                  <p className="m-0 flex-1 text-[13.5px] leading-snug text-white">
                    {said}.{knockOn}
                  </p>
                  <Button sm className="flex-none" onClick={() => setOpen(undefined)}>
                    Clear
                  </Button>
                </div>
              )
            }
            <Covered label="Withdrawn" titles={withdrawn.map(titleOf)} />
            <Legend show={legendFor(preview?.result ?? result, tier, coveredIn.kind, preview)} />
          </StickyAside>
          <GiveList
            tier={tier}
            rows={rows}
            open={open}
            onOpen={openRow}
            onAmount={setAmount}
            effect={effect}
            canDonate={Boolean(board.data?.flags.tokensOk)}
            example={Boolean(example)}
            test={REAL ? undefined : { badge: myBadge }}
            stale={Boolean(rv?.live.aheadStale)}
            onDonated={onDonated}
            yours={yoursMap}
            search={{
              ai: board.data?.flags.aiSearch,
              aiAuto: board.data?.flags.aiSearchAuto,
            }}
            steps={steps}
            onGreenOrder={onGreenOrder}
            jumps={jumpsBySlug}
            amount={given}
          />
        </div>
      </PageMain>
    </>
  );
}

/** Which of the legend's entries TheDAO's ballot shows now. */
function legendFor(
  r: ReturnType<typeof daoResult>,
  settlingTier: Tier,
  covered: ReadonlyMap<string, "final" | "now">,
  preview?: {
    joining?: ReadonlyMap<string, number>;
    moved?: ReadonlyMap<string, Tier>;
    arrived?: ReadonlySet<string>;
    leaving?: ReadonlySet<string>;
  },
) {
  const live = [...r.provisional];
  return {
    settled: [...r.funded].some((s) => !r.provisional.has(s)) ||
      [...covered.values()].includes("final"),
    settling: live.some((s) => r.tiers[s] === settlingTier) ||
      [...covered.values()].includes("now"),
    later: live.some((s) => r.tiers[s] !== settlingTier),
    joining: Boolean(preview?.joining?.size),
    moved: Boolean(preview?.moved?.size),
    arrived: Boolean(preview?.arrived?.size),
    leaving: Boolean(preview?.leaving?.size),
  };
}

/** What the ballot's colours and marks mean: only those it shows now (no "settled: funded"
 * before a tier settles, no preview marks the preview doesn't use). */
function Legend({ show }: {
  show: {
    settled: boolean;
    settling: boolean;
    later: boolean;
    joining: boolean;
    moved: boolean;
    arrived: boolean;
    leaving: boolean;
  };
}) {
  if (!Object.values(show).some(Boolean)) return null;
  const item = (swatch: string, text: string) => (
    <span className="flex items-center gap-2">
      <i className={`inline-block h-[6px] w-6 rounded-full ${swatch}`} aria-hidden="true" />
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 text-[13px] text-white/60">
      {show.settled && item("bg-vote", "settled: funded")}
      {show.settling && item("bg-white/75", "settling now")}
      {show.later && item("bg-white/30", "later tiers, as they stand")}
      {show.joining &&
        item("border border-dashed border-dao-green bg-dao-green/30", "with your donation")}
      {show.moved && (
        <span className="flex items-center gap-1.5">
          <b className="text-vote-pale" aria-hidden="true">↑↓</b>moves with it
        </span>
      )}
      {show.arrived && (
        <span className="flex items-center gap-1.5 text-[#a7e3a5]">
          <b aria-hidden="true">↑</b>came in
        </span>
      )}
      {show.leaving && (
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
  { R, rv, cards, raised, mine, example, justFinished }: {
    /** An example page: the examples' picker over the hero. */
    example?: boolean;
    /** The vote finished while the page was open: the hero glows gold, a gold light runs
     * across its amount and fills the line under it, and the funded cards glow tier by
     * tier. */
    justFinished?: boolean;
    R: VoteManifest;
    rv: RoundView;
    cards: NonNullable<ReturnType<typeof useBoard>["data"]>["cards"];
    raised?: number;
    mine: string | null;
  },
) {
  const REAL = R.kind === "real";
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

  // Covered by donations when a tier settled: not funded, and not "not funded" either.
  const covered = useMemo(() => coveredProjects(rv.tiers, undefined).final, [rv]);
  // Withdrawn by an admin: apart too (one funded before stays funded).
  const withdrawn = useMemo(() => withdrawnProjects(rv.tiers, rv.live.withdrawn), [rv]);
  const listed = useMemo(
    () => new Set(R.slugs.filter((s) => !covered.includes(s) && !withdrawn.includes(s))),
    [R, covered, withdrawn],
  );
  const results = useMemo(
    () => splitResults(cards.filter((c) => listed.has(c.initiative.slug)), rv.tiers),
    [rv, cards, listed],
  );
  /** The list has a section per tier with what it funded; a tier that funded nothing has
   * no section, so the hero says so. */
  const tierLines = rv.tiers.filter((t) => t.status === "waiting" || !t.funded.length).map((t) => (
    <p key={t.tier} className="m-0">{tierName(t.tier)}: no initiatives funded</p>
  ));

  const hero = (
    <Hero
      raised={raised}
      finished={justFinished}
      kicker={<span className="text-vote">{REAL ? "TheDAO vote" : "Test vote"}</span>}
      sub={
        <>
          {usdShort(raised ?? 0)} spent of the {poolEstimated(R)
            ? (
              <span title={poolNoteText(R) ?? undefined}>
                {R.pool!.eth.toLocaleString("en-US")} ETH{" "}
                <span className="text-vote">{REAL ? "pool" : "demo pool"}</span>
                {` (about ${usdShort(pool)})`}
              </span>
            )
            : (
              <>
                {usdShort(pool)} <span className="text-vote">{REAL ? "pool" : "demo pool"}</span>
              </>
            )}
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
      {(covered.length > 0 || withdrawn.length > 0) && (
        <div className="mx-auto mt-4 max-w-md space-y-2 text-left">
          <Covered
            label="Covered by donations"
            titles={covered.map((s) => titles.get(s) ?? s)}
          />
          <Covered label="Withdrawn" titles={withdrawn.map((s) => titles.get(s) ?? s)} />
        </div>
      )}
      {rv && <ValuationNotes view={rv} round={R} />}
      {mine && (
        <div className="mt-5 flex justify-center">
          <LinkButton variant="primary" to={mine}>See your ballot</LinkButton>
        </div>
      )}
    </Hero>
  );

  const halo = (h: React.ReactNode) =>
    justFinished ? <div data-finished="" className="animate-gold-halo">{h}</div> : h;

  return (
    <BoardPage
      only={listed}
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
            {halo(hero)}
          </>
        )
        : halo(hero)}
      heading="The vote's final result"
      finished={justFinished}
      defaultSort="closest"
    />
  );
}

/** How long a donation's preview is held, at most, waiting for the figures to count it. */
const HOLD_MS = 120_000;

/** What this visitor gave from the vote page, per initiative: this browser only. */
function readYours(key: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(v).filter((e): e is [string, number] =>
        typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] > 0
      ),
    );
  } catch {
    return {};
  }
}
function writeYours(key: string, v: Record<string, number>) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch { /* storage unavailable: kept for this visit only */ }
}
