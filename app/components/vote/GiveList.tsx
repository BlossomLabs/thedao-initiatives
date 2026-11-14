import { Suspense, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import BoardSearch from "~/components/board/BoardSearch";
import CategoryFilter from "~/components/board/filters/CategoryFilter";
import { DonateStandIn } from "~/components/board/InitiativeCard";
import { type BoardView, DEFAULT_VIEW, facetCounts, isFiltered, matches } from "~/lib/board-view";
import CategoryDot from "~/components/ui/CategoryDot";
import Reveal from "~/components/ui/Reveal";
import type { NextTierEntry } from "~/hooks/use-vote";
import type { Card } from "~/lib/api-types";
import { usd, usd2, usdShortUp } from "~/lib/format";
import { lazyPart } from "~/lib/lazy-part";
import { cn } from "~/lib/utils";
import { dollars } from "~/lib/vote-results";
import type { AiSearchResult } from "../../../shared/ai-search";
import { type Tier, tierName, TIERS } from "../../../shared/vote/ballot";

const { Component: DonateWidget } = lazyPart(
  () => import("~/components/donate/DonateWidget"),
  DonateStandIn,
);

export type GiveRow = {
  card: Card;
  /** Below the tier settling now: the donation that moves it up a tier. */
  entry?: NextTierEntry;
  /** In the tier settling now: how far ahead it is, in whole dollars (0: barely). */
  lead?: number;
  /** Where TheDAO's ballot has it now, if anywhere. */
  now?: Tier;
};

/** The gap in whole dollars; null when no donation alone gets it there. */
export const gapUsd = (e: NextTierEntry) => (e.gap === null ? null : dollars(e.gap));
/** A row's gap in whole dollars; null for a row ahead in its tier, or out of reach. */
const rowGap = (r: GiveRow) => (r.entry ? gapUsd(r.entry) : null);

/** What a donation does to the others, in one word, when it does one thing to all of
 * them: only pushes them out ("drops", red), only brings them in ("brings in", green);
 * otherwise, any moved or a mix, it "moves" them (yellow). */
export function knockOnVerb(
  e: { comesIn: unknown[]; moves: unknown[]; dropsOut: unknown[] },
): { verb: string; tone: string } {
  if (!e.moves.length && !e.comesIn.length) return { verb: "drops", tone: "text-[#ff8a88]" };
  if (!e.moves.length && !e.dropsOut.length) {
    return { verb: "brings in", tone: "text-[#a7e3a5]" };
  }
  return { verb: "moves", tone: "text-vote-pale" };
}

/** Who else a donation moves: who comes in (green), moves to another tier (yellow, up or
 * down) or drops out (red). */
function knockOnLines(entry: NextTierEntry) {
  return [
    ...entry.comesIn.map((o) => ({
      slug: o.slug,
      mark: "+",
      tone: "text-[#a7e3a5]",
      what: `comes into ${tierName(o.tier)}`,
    })),
    ...entry.moves.map((o) => ({
      slug: o.slug,
      mark: TIERS.indexOf(o.to) < TIERS.indexOf(o.from) ? "↑" : "↓",
      tone: "text-vote-pale",
      what: `${tierName(o.from)} → ${tierName(o.to)}`,
    })),
    ...entry.dropsOut.map((o) => ({
      slug: o.slug,
      mark: "↓",
      tone: "text-[#ff8a88]",
      what: `drops out of ${tierName(o.tier)}`,
    })),
  ];
}

/** The list the row's "moves N other initiatives" opens. */
function KnockOnList(
  { lines, titleOf }: {
    lines: ReturnType<typeof knockOnLines>;
    titleOf: (slug: string) => string;
  },
) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 rounded-[10px] bg-black/[.16] px-3 py-2.5">
      {lines.map((l) => (
        <li key={l.slug} className="flex items-center gap-2 text-[13px] leading-snug">
          <b aria-hidden="true" className={cn("w-4 flex-none text-center", l.tone)}>
            {l.mark}
          </b>
          <i className="min-w-0 flex-1 truncate text-white">{titleOf(l.slug)}</i>
          <span className="flex-none text-white/65">{l.what}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The vote results' call to action: every open initiative. Those in the tier settling now
 * first, furthest ahead first, with how far ahead they are (green); then the rest,
 * closest first, with what a donation would take to move each up a tier, into B-Tier
 * when it isn't funded (a red number: money missing). Opening one shows the donate form, starting from that amount;
 * what it would change is previewed on TheDAO's ballot beside it. Those no donation alone
 * moves up are counted at the end, and can still be opened.
 */
export default function GiveList(
  {
    tier,
    rows,
    open,
    onOpen,
    onAmount,
    effect,
    canDonate,
    example,
    onDonated,
    search = {},
    steps,
  }: {
    /** The tier settling now. */
    tier: Tier;
    /** In any order: sorted here. Undefined while the figures are worked out. */
    rows: GiveRow[] | undefined;
    open?: string;
    onOpen: (slug: string | undefined) => void;
    onAmount: (usd: number) => void;
    /** What the amount picked would do, under the form. */
    effect?: React.ReactNode;
    /** Donations are on (the board's flags). */
    canDonate: boolean;
    /** An example page: the donate form shows, but nothing is donated from it. */
    example?: boolean;
    onDonated?: () => void;
    /** The board's AI search flags: the box offers AI only while it is on. */
    search?: { ai?: boolean; aiAuto?: boolean };
    /** For the open row, when the page could work them out: the donation that gets it
     * into each tier above it, lowest first. The donate form suggests them all. */
    steps?: { usd: number; tier: Tier }[];
  },
) {
  const name = tierName(tier);
  const [showFar, setShowFar] = useState(false);
  /** The row whose "moves N other initiatives" list is open. */
  const [knock, setKnock] = useState<string>();
  // The ballot editor's search (keywords, or AI) and category filter, over the list.
  const [view, setView] = useState<BoardView>({ ...DEFAULT_VIEW });
  const [aiResult, setAiResult] = useState<AiSearchResult | null>(null);
  const [asking, setAsking] = useState(false);
  const ai = Boolean(aiResult?.scores.length);
  // While the AI order is on, the model ranked everything: the words stop filtering.
  const shownView = useMemo(
    () => (ai || (search.aiAuto && asking) ? { ...view, q: "" } : view),
    [view, ai, asking, search.aiAuto],
  );
  const all = useMemo(() => rows ?? [], [rows]);
  const titles = useMemo(
    () => new Map(all.map((r) => [r.card.initiative.slug, r.card.initiative.title])),
    [all],
  );
  const titleOf = (slug: string) => titles.get(slug) ?? slug;
  const counts = useMemo(() => facetCounts(all.map((r) => r.card), shownView), [all, shownView]);
  const filtered = isFiltered(shownView);
  const found = all.filter((r) => matches(r.card, shownView));
  // Closest first; with the AI order on, the best matches first.
  const score = new Map(aiResult?.scores.map(({ id, score }) => [id, score]) ?? []);
  const of = (r: GiveRow) => score.get(r.card.initiative.id) ?? -1;
  // In the tier settling now: the furthest ahead first, down to the closest to dropping
  // out, then (below them) those closest to coming in.
  const ahead = found.filter((r) => !r.entry)
    .sort((a, b) => ai ? of(b) - of(a) : (b.lead ?? 0) - (a.lead ?? 0));
  const near = found.filter((r) => rowGap(r) !== null)
    .sort((a, b) => ai ? of(b) - of(a) : rowGap(a)! - rowGap(b)!);
  const far = found.filter((r) => r.entry && r.entry.gap === null)
    .sort((a, b) =>
      ai ? of(b) - of(a) : a.card.initiative.title.localeCompare(b.card.initiative.title)
    );
  const shown = showFar || far.some((r) => r.card.initiative.slug === open)
    ? [...ahead, ...near, ...far]
    : [...ahead, ...near];

  return (
    <section aria-labelledby="give-heading" className="min-w-0">
      <h2
        id="give-heading"
        className="m-0 font-inter-tight text-[20px] font-semibold leading-tight tracking-[-.01em] text-white"
      >
        What it takes to move up
      </h2>
      <p className="m-0 mt-1.5 text-[14px] leading-snug text-white/65">
        {name}{" "}
        is the tier settling now. Donations count in the next tally: the red number is what each
        initiative still misses to move up a tier if the vote ended now; the green one, how far
        ahead those in {name} are.
      </p>
      {rows !== undefined && rows.length > 0 && (
        <div className="mt-4">
          <div className="mb-3 flex min-h-7 items-center gap-2 px-1">
            <span className="text-[12px] uppercase tracking-[.08em] text-white/55">
              Open initiatives
            </span>
            <span className="whitespace-nowrap text-[12px] text-white/40 tnum">
              {filtered || ai ? `${found.length} of ` : ""}
              {all.length} {all.length === 1 ? "initiative" : "initiatives"}
            </span>
            <div className="ml-auto shrink-0">
              <CategoryFilter
                value={view.cats}
                counts={counts.cats}
                onChange={(cats) => setView((v) => ({ ...v, cats }))}
                align="end"
                className="max-[641px]:h-7 max-[641px]:gap-1.5 max-[641px]:pl-2 max-[641px]:pr-1.5 max-[641px]:text-[12px]"
              />
            </div>
          </div>
          <BoardSearch
            compact
            view={view}
            onFilter={(next) => setView((v) => ({ ...v, ...next }))}
            aiEnabled={Boolean(search.ai)}
            aiAuto={Boolean(search.aiAuto)}
            active={ai}
            onResults={setAiResult}
            onAsking={setAsking}
          />
        </div>
      )}
      {rows === undefined
        ? <p className="mt-5 text-[14px] text-white/55">Working out what each initiative needs…</p>
        : rows.length === 0
        ? <p className="mt-5 text-[14px] text-white/55">No initiative is left open.</p>
        : found.length === 0
        ? (
          <p className="px-1 py-6 text-center text-[13px] text-white/45">
            {asking ? "Asking AI for the best matches…" : "No initiatives match"}
          </p>
        )
        : (
          <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
            {shown.map((r) => {
              const i = r.card.initiative;
              const isOpen = open === i.slug;
              const gap = rowGap(r);
              const to = r.entry && tierName(r.entry.tier);
              const lines = r.entry && gap !== null ? knockOnLines(r.entry) : [];
              const knockOpen = knock === i.slug && isOpen;
              // What it does to the others: drops them (red), brings them in (green) or
              // moves them (yellow).
              const knockKind = r.entry ? knockOnVerb(r.entry) : undefined;
              const cat = i.categories[0];
              const need = Math.max(0, i.goalUsd - r.card.summary.total);
              return (
                <li
                  key={i.slug}
                  data-give-row={i.slug}
                  className={cn(
                    "scroll-mt-6 rounded-xl border transition-colors",
                    isOpen ? "border-white/25 bg-white/[.07]" : "border-white/[.08] bg-white/[.04]",
                    r.entry && gap === null && !isOpen && "opacity-70",
                  )}
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`give-${i.slug}`}
                    onClick={() => onOpen(isOpen ? undefined : i.slug)}
                    className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl px-3.5 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-dao-red"
                  >
                    {cat ? <CategoryDot slug={cat} className="flex-none" /> : (
                      <span
                        className="size-2 flex-none rounded-full bg-white/30"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-white">{i.title}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-white/55 tnum">
                        Needs {usd(need)} · {r.now ? `now in ${tierName(r.now)}` : "not included"}
                      </span>
                    </span>
                    {!r.entry
                      ? (
                        <span className="flex flex-none items-center gap-1.5 whitespace-nowrap">
                          {r.lead
                            ? (
                              <b className="rounded-md bg-dao-green px-2 py-[3px] font-inter-tight text-[15px] font-bold text-[#0f2a17] tnum">
                                {usd2(r.lead, false)}
                              </b>
                            )
                            : null}
                          {
                            // The words after the pill keep one width, so every pill lines up.
                          }
                          <small className="w-[46px] text-[12px] text-[#a7e3a5]">
                            {r.lead ? "ahead" : `In ${name}`}
                          </small>
                        </span>
                      )
                      : gap === null
                      ? (
                        <span className="flex-none text-[12.5px] text-white/60">
                          Out of reach for <span className="whitespace-nowrap">{to}</span>
                        </span>
                      )
                      : (
                        <span className="flex flex-none items-center gap-1.5 whitespace-nowrap">
                          <b className="rounded-md bg-[#c22d2b] px-2 py-[3px] font-inter-tight text-[15px] font-bold text-white tnum">
                            −{usd2(gap, true)}
                          </b>
                          <small className="w-[46px] text-[12px] text-white/65">to {to}</small>
                        </span>
                      )}
                    <ChevronDown
                      className={cn(
                        "size-4 flex-none text-white/50 transition-transform",
                        isOpen && "rotate-180",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                  <Reveal show={isOpen} id={`give-${i.slug}`}>
                    <div className="flex flex-col gap-3 px-3.5 pb-4">
                      <p className="m-0 text-[13.5px] leading-snug text-white/75">
                        {!r.entry
                          ? (
                            <>
                              {r.lead
                                ? (
                                  <>
                                    <b className="font-semibold text-white">{usd(r.lead)}</b>{" "}
                                    ahead in{" "}
                                    <span className="whitespace-nowrap">{name}</span>: it would stay
                                    funded there if it settled now, even with that much less
                                    backing.
                                  </>
                                )
                                : <>In {name} if it settled now, with little to spare.</>}{" "}
                              A donation lowers what it asks of the pool.
                            </>
                          )
                          : gap === null
                          ? (
                            <>
                              No donation alone brings it into {to}{" "}
                              now. It still counts toward its goal.
                            </>
                          )
                          : (
                            <>
                              <b className="font-semibold text-white">
                                {usd(steps?.length ? steps[0].usd : gap)}
                              </b>{" "}
                              more brings it into{" "}
                              <span className="whitespace-nowrap">
                                {steps?.length ? tierName(steps[0].tier) : to}
                              </span>{" "}
                              if the vote ended now{lines.length === 0 ? "." : (
                                <>
                                  , and{" "}
                                  <span className="whitespace-nowrap">
                                    <button
                                      type="button"
                                      aria-expanded={knockOpen}
                                      aria-controls={`knock-${i.slug}`}
                                      onClick={() => setKnock(knockOpen ? undefined : i.slug)}
                                      className={cn(
                                        "cursor-pointer underline decoration-dotted underline-offset-2 hover:text-white",
                                        knockKind?.tone,
                                      )}
                                    >
                                      {knockKind?.verb} {lines.length === 1
                                        ? "another initiative"
                                        : `${lines.length} other initiatives`}
                                    </button>.
                                  </span>
                                </>
                              )}
                            </>
                          )}
                      </p>
                      {lines.length > 0 && (
                        <Reveal show={knockOpen} id={`knock-${i.slug}`}>
                          <KnockOnList lines={lines} titleOf={titleOf} />
                        </Reveal>
                      )}
                      {canDonate || example
                        ? (
                          isOpen && (
                            <Suspense fallback={<DonateStandIn />}>
                              <DonateWidget
                                initiativeId={i.id}
                                slug={i.slug}
                                safeAddress={i.safeAddress}
                                onConfirmed={onDonated}
                                suggested={steps?.length
                                  ? steps.map((x) => ({
                                    usd: x.usd,
                                    note: `brings it into ${tierName(x.tier)}`,
                                    label: `to ${tierName(x.tier)}`,
                                  }))
                                  : gap === null
                                  ? undefined
                                  : { usd: gap, note: `brings it into ${to}`, label: `to ${to}` }}
                                onAmount={onAmount}
                                example={example}
                                accent={r.entry ? "red" : "green"}
                              />
                            </Suspense>
                          )
                        )
                        : (
                          <p className="m-0 text-[13px] text-white/60">
                            Donations are paused right now.
                          </p>
                        )}
                      {isOpen && effect}
                    </div>
                  </Reveal>
                </li>
              );
            })}
          </ul>
        )}
      {far.length > 0 && !shown.includes(far[0]) && (
        <button
          type="button"
          onClick={() => setShowFar(true)}
          className="mt-2 cursor-pointer text-[13px] text-white/55 underline-offset-2 hover:text-white hover:underline"
        >
          + {far.length} more out of reach
        </button>
      )}
    </section>
  );
}

/** How close counts as "within reach" in the box's summary line. */
const NEAR_USD = 10_000;

/**
 * Beside the round box on the vote results: the call to action at a glance. The three
 * initiatives closest to the tier settling now, each with what it misses (picking one opens
 * it in the list, with the donate form), how many are within $10K of it, and a way down to
 * the whole list.
 */
export function ClosestBox(
  { tier, rows, onPick }: {
    tier: Tier;
    rows: GiveRow[] | undefined;
    onPick: (slug: string) => void;
  },
) {
  const name = tierName(tier);
  // Only those one step below it: a donation moves the others up to a lower tier first.
  const near = (rows ?? []).filter((r) => r.entry?.tier === tier && rowGap(r) !== null)
    .sort((a, b) => rowGap(a)! - rowGap(b)!);
  const within = near.filter((r) => rowGap(r)! <= NEAR_USD).length;
  return (
    <section
      aria-labelledby="closest-heading"
      className="flex flex-col rounded-xl border border-white/15 bg-white/[.04] p-4 text-left"
    >
      <h2
        id="closest-heading"
        className="m-0 font-inter-tight text-[17px] font-semibold tracking-[-.01em] text-white"
      >
        Closest to <span className="whitespace-nowrap">{name}</span>
      </h2>
      {rows === undefined
        ? <p className="m-0 mt-2 text-[13.5px] text-white/55">Working out what each needs…</p>
        : near.length === 0
        ? (
          <p className="m-0 mt-2 text-[13.5px] text-white/55">
            No donation alone brings another initiative into {name} now.
          </p>
        )
        : (
          <>
            <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
              {near.slice(0, 3).map((r) => {
                const i = r.card.initiative;
                const cat = i.categories[0];
                return (
                  <li key={i.slug}>
                    <button
                      type="button"
                      onClick={() => onPick(i.slug)}
                      className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-white/[.08] bg-white/[.04] px-3 py-2 text-left transition-colors hover:border-white/25 hover:bg-white/[.08] focus-visible:outline-2 focus-visible:outline-dao-red"
                    >
                      {cat ? <CategoryDot slug={cat} className="flex-none" /> : (
                        <span
                          className="size-2 flex-none rounded-full bg-white/30"
                          aria-hidden="true"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-white">
                        {i.title}
                      </span>
                      <b className="flex-none rounded-md bg-[#c22d2b] px-1.5 py-[2px] font-inter-tight text-[13.5px] font-bold text-white tnum">
                        −{usd2(rowGap(r)!, true)}
                      </b>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="m-0 mt-3 text-[13px] leading-snug text-white/65">
              {within === 0 ? <>None is within {usdShortUp(NEAR_USD)} of {name} yet.</> : (
                <>
                  <b className="font-semibold text-white">
                    {within} {within === 1 ? "initiative is" : "initiatives are"}
                  </b>{" "}
                  within {usdShortUp(NEAR_USD)} of{" "}
                  <span className="whitespace-nowrap">{name}</span>.
                </>
              )}
            </p>
          </>
        )}
      <a
        href="#give-heading"
        className="mt-auto pt-3 text-[13px] text-white/70 underline-offset-2 hover:text-white hover:underline"
      >
        See all {rows ? rows.length : ""} ↓
      </a>
    </section>
  );
}
