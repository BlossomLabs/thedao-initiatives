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
import { usd, usdShortUp } from "~/lib/format";
import { lazyPart } from "~/lib/lazy-part";
import { cn } from "~/lib/utils";
import { dollars } from "~/lib/vote-results";
import type { AiSearchResult } from "../../../shared/ai-search";
import { type Tier, tierName } from "../../../shared/vote/ballot";

const { Component: DonateWidget } = lazyPart(
  () => import("~/components/donate/DonateWidget"),
  DonateStandIn,
);

export type GiveRow = {
  card: Card;
  /** The donation that gets it into the tier settling now. */
  entry: NextTierEntry;
  /** Where TheDAO's ballot has it now, if anywhere. */
  now?: Tier;
};

/** The gap in whole dollars; null when no donation alone gets it there. */
export const gapUsd = (e: NextTierEntry) => (e.gap === null ? null : dollars(e.gap));

/**
 * The vote results' call to action: every initiative not in the tier settling now, closest
 * first, with what a donation would take to bring it in (a red number: money missing).
 * Opening one shows the donate form, starting from that amount; what it would change is
 * previewed on TheDAO's ballot beside it. Those no donation alone gets in are counted at
 * the end, and can still be opened.
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
  },
) {
  const name = tierName(tier);
  const [showFar, setShowFar] = useState(false);
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
  const counts = useMemo(() => facetCounts(all.map((r) => r.card), shownView), [all, shownView]);
  const filtered = isFiltered(shownView);
  const found = all.filter((r) => matches(r.card, shownView));
  // Closest first; with the AI order on, the best matches first.
  const score = new Map(aiResult?.scores.map(({ id, score }) => [id, score]) ?? []);
  const of = (r: GiveRow) => score.get(r.card.initiative.id) ?? -1;
  const near = found.filter((r) => r.entry.gap !== null)
    .sort((a, b) => ai ? of(b) - of(a) : gapUsd(a.entry)! - gapUsd(b.entry)!);
  const far = found.filter((r) => r.entry.gap === null)
    .sort((a, b) =>
      ai ? of(b) - of(a) : a.card.initiative.title.localeCompare(b.card.initiative.title)
    );
  const shown = showFar || far.some((r) => r.card.initiative.slug === open)
    ? [...near, ...far]
    : near;

  return (
    <section aria-labelledby="give-heading" className="min-w-0">
      <h2
        id="give-heading"
        className="m-0 font-inter-tight text-[20px] font-semibold leading-tight tracking-[-.01em] text-white"
      >
        What it takes to get into {name}
      </h2>
      <p className="m-0 mt-1.5 text-[14px] leading-snug text-white/65">
        {name}{" "}
        is the tier settling now. Donations count in the next tally: the red number is what each
        initiative still misses to come in if it settled now.
      </p>
      {rows !== undefined && rows.length > 0 && (
        <div className="mt-4">
          <div className="mb-3 flex min-h-7 items-center gap-2 px-1">
            <span className="text-[12px] uppercase tracking-[.08em] text-white/55">
              Not in {name} yet
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
        ? <p className="mt-5 text-[14px] text-white/55">Every initiative left is in {name}.</p>
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
              const gap = gapUsd(r.entry);
              const cat = i.categories[0];
              const need = Math.max(0, i.goalUsd - r.card.summary.total);
              return (
                <li
                  key={i.slug}
                  data-give-row={i.slug}
                  className={cn(
                    "scroll-mt-6 rounded-xl border transition-colors",
                    isOpen ? "border-white/25 bg-white/[.07]" : "border-white/[.08] bg-white/[.04]",
                    gap === null && !isOpen && "opacity-70",
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
                      <span className="mt-0.5 block text-[12px] text-white/55 tnum">
                        Needs {usd(need)} ·{" "}
                        {r.now ? `now in ${tierName(r.now)}` : "not in TheDAO's ballot"}
                      </span>
                    </span>
                    {gap === null
                      ? (
                        <span className="flex-none text-[12.5px] text-white/60">
                          Out of reach for <span className="whitespace-nowrap">{name}</span>
                        </span>
                      )
                      : (
                        <span className="flex flex-none items-center gap-1.5 whitespace-nowrap">
                          <b className="rounded-md bg-[#c22d2b] px-2 py-[3px] font-inter-tight text-[15px] font-bold text-white tnum">
                            −{usdShortUp(gap)}
                          </b>
                          <small className="text-[12px] text-white/65">to {name}</small>
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
                        {gap === null
                          ? (
                            <>
                              No donation alone brings it into {name}{" "}
                              now. It still counts toward its goal.
                            </>
                          )
                          : (
                            <>
                              <b className="font-semibold text-white">{usd(gap)}</b>{" "}
                              more brings it into <span className="whitespace-nowrap">{name}</span>
                              {" "}
                              if it settled now.
                            </>
                          )}
                      </p>
                      {canDonate || example
                        ? (
                          isOpen && (
                            <Suspense fallback={<DonateStandIn />}>
                              <DonateWidget
                                initiativeId={i.id}
                                slug={i.slug}
                                safeAddress={i.safeAddress}
                                onConfirmed={onDonated}
                                suggested={gap === null
                                  ? undefined
                                  : { usd: gap, note: `brings it into ${name}` }}
                                onAmount={onAmount}
                                example={example}
                                accent="red"
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
          + {far.length} more out of reach for {name}
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
  const near = (rows ?? []).filter((r) => r.entry.gap !== null)
    .sort((a, b) => gapUsd(a.entry)! - gapUsd(b.entry)!);
  const within = near.filter((r) => gapUsd(r.entry)! <= NEAR_USD).length;
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
                        −{usdShortUp(gapUsd(r.entry)!)}
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
