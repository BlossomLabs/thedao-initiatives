import { useRef } from "react";
import { bytesToHex } from "viem";
import type { RoundTier, RoundView } from "~/hooks/use-vote";
import type { Card } from "~/lib/api-types";
import { encodeBallot, type Tier, TIERS } from "../../../shared/vote/ballot";
import { type ChainInputs, type ChainStage, chainTally } from "../../../shared/vote/chain";
import { liveInputsFrom, liveInputsJson } from "../../../shared/vote/live-inputs";
import { giftGapsAsync, liveLeadsAsync } from "../../../shared/vote/next-tier";
import { effectiveRanks } from "../../../vote/shared/ranks";
import type { VoteManifest } from "../../../shared/vote/manifest";

/** Examples of the ballot through the vote, public at `/vote/mock/<kind>` (and in dev at
 * `?mock=<kind>`): the real round's dates and the board's real proposals, with a made-up
 * pool, voters and ballot. Nothing is sent from them. In the order they happen. */
export const MOCKS = [
  "started",
  "prefilled",
  "s-settling",
  "s-extended",
  "s-last",
  "spent",
  "b-settling",
  "missed",
  "finished",
] as const;
export type MockKind = (typeof MOCKS)[number];
export const MOCK_LABELS: Record<MockKind, string> = {
  started: "Just opened",
  prefilled: "Prefilled from ratings",
  "s-settling": "S-Tier settling",
  "s-extended": "S-Tier extended",
  "s-last": "S-Tier last window",
  spent: "S-Tier settled",
  "b-settling": "B-Tier settling",
  missed: "Badge that never voted",
  finished: "Finished",
};
export const isMockKind = (s: string | null): s is MockKind =>
  (MOCKS as readonly string[]).includes(s ?? "");

export type Mock = {
  round: VoteManifest;
  view: RoundView;
  /** The badge's own star ratings, by slug: what a fresh ballot starts from. */
  ratings?: Record<string, number>;
  /** What this badge skipped (its 1–2★), when the ballot was already sent. */
  skipped?: string[];
  /** The ballot the badge sent, for a finished round. */
  sent?: Partial<Record<string, Tier>>;
};

const H = 3600;
const D = 24 * H;
const VOTERS = 40;
const POOL_USD = 1_000_000;
/* The real round's dates (docs/factsheet.md): voting opens Tue Nov 17 (its hour is still
 * to be set), S-Tier first tallies Thu Dec 3, A-Tier Mon Dec 7, B-Tier Wed Dec 9, each at
 * 21:00 UTC; 9 windows of 24h, 12h, 6h… halving (the last 5m 37s), as deployed. */
const at = (iso: string) => Date.parse(iso) / 1000;
const OPENS = at("2026-11-17T17:00:00Z");
const FIRST: [number, number, number] = [
  at("2026-12-03T21:00:00Z"),
  at("2026-12-07T21:00:00Z"),
  at("2026-12-09T21:00:00Z"),
];
const WINDOW = D;
const MAX_WINDOWS = 9;
/** The longest a tier can take: 47h 54m 22s. */
const LONGEST = Array.from({ length: MAX_WINDOWS }, (_, k) => WINDOW >> k).reduce((a, b) => a + b);

/** Each state's moment in the real round: the vote page runs its clock from it while the
 * mock is shown (When.tsx), so countdowns and phases read as they will on the day. */
export const MOCK_NOW: Record<MockKind, number> = {
  // Voting opened five hours ago.
  started: OPENS + 5 * H,
  prefilled: OPENS + 5 * H,
  // S-Tier 12h into its first window, nothing changed yet.
  "s-settling": FIRST[0] + 12 * H,
  // S-Tier changed in its first window: 6h into the 12h second one (Sat Dec 5, 03:00 UTC).
  "s-extended": FIRST[0] + WINDOW + 6 * H,
  // S-Tier changed in every window: three minutes left of its last one.
  "s-last": FIRST[0] + Array.from({ length: 9 }, (_, k) => D >> k).reduce((a, b) => a + b) -
    3 * 60,
  // A-Tier and S-Tier settled; B-Tier 10h into its first window.
  "b-settling": FIRST[2] + 10 * H,
  // S-Tier settled (Fri Dec 4) before this badge sent a first ballot.
  missed: FIRST[1] + 20 * H,
  // S-Tier settled in its first window (Fri Dec 4); A-Tier is 20h into its first.
  spent: FIRST[1] + 20 * H,
  // Every tier settled in its first window; B-Tier on Thu Dec 10. Now: Sat Dec 12.
  finished: FIRST[2] + 2 * D + 15 * H,
};

const micro = (usd: number) => String(Math.round(usd * 1_000_000));

/** The fictional round: the board's proposals, oldest first, each asking what it still needs. */
function fictionalRound(cards: Card[], opensAt: number, firstTally: [number, number, number]) {
  const list = [...cards]
    .filter((c) => c.initiative.goalUsd > 0)
    .sort((a, b) => a.initiative.createdAt - b.initiative.createdAt);
  const round: VoteManifest = {
    kind: "real",
    chainId: 1,
    contract: "0x00000000000000000000000000000000000d0e70",
    deployBlock: 0,
    opensAt,
    closesAt: firstTally[2] + LONGEST,
    schedule: { opensAt, firstTallyAt: firstTally, initialWindow: WINDOW, maxWindows: MAX_WINDOWS },
    poolUsd: micro(POOL_USD),
    badge: "0x00000000000000000000000000000000000ba06e",
    slugs: list.map((c) => c.initiative.slug),
    projects: list.map((c) => ({
      askUsd: micro(Math.max(1, c.initiative.goalUsd - (c.summary?.total ?? 0))),
      rfp: c.initiative.type === "rfp",
      groups: [],
    })),
    groups: [],
    independentTiers: 1,
    ballotRules: true,
  };
  return {
    round,
    ask: (slug: string) => Number(BigInt(round.projects[round.slugs.indexOf(slug)].askUsd)) / 1e6,
  };
}

/** The badge's ballot in every state: 3 in S-Tier, 4 in A-Tier, and B-Tier from 6 on
 * until the ballot asks for 1.5× the pool (the ballot rules). */
function sampleBallot(round: VoteManifest) {
  const { slugs } = round;
  const ask = (i: number) => BigInt(round.projects[i].askUsd);
  const needed = (BigInt(round.poolUsd) * 3n) / 2n;
  let total = 0n;
  for (let i = 0; i < 13 && i < slugs.length; i++) total += ask(i);
  let end = Math.min(13, slugs.length);
  while (total < needed && end < slugs.length) total += ask(end++);
  const s = slugs.slice(0, 3);
  const a = slugs.slice(3, 7);
  const b = slugs.slice(7, end);
  const ballot: Partial<Record<string, Tier>> = {};
  for (const x of s) ballot[x] = "S";
  for (const x of a) ballot[x] = "A";
  for (const x of b) ballot[x] = "B";
  return { ballot, s, a, b };
}

/** A small seeded random generator: the same made-up ballots on every page load. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The example's 40 ballots, by badge: badge `n`'s is its sample ballot; the other 39
 * lean the same way (a few favourites per tier, as the sample ballot's own S-Tier and
 * A-Tier picks and one of its B-Tier picks), each with picks of its own. `withOwn`
 * false: badge `n` never voted. */
function crowd(
  round: VoteManifest,
  sample: ReturnType<typeof sampleBallot>,
  n: number,
  withOwn = true,
) {
  const { slugs } = round;
  const { s, a, b } = sample;
  const rand = seeded(1729);
  const pick = <T>(xs: T[], k: number) => [...xs].sort(() => rand() - 0.5).slice(0, k);
  // The favourites: in S-Tier the first two of the sample's and its first B-Tier pick;
  // in A-Tier its first and third; in B-Tier its second B-Tier pick.
  const favS = [s[0], s[1], b[0]];
  const favA = [a[0], a[2]];
  const favB = [b[1]];
  const ballots = new Map<string, Uint8Array>();
  if (withOwn) ballots.set(String(n), encodeBallot(slugs, sample.ballot));
  for (let v = 1; v <= VOTERS; v++) {
    const id = String(v);
    if (id === String(n)) continue;
    const tiers: Partial<Record<string, Tier>> = {};
    const put = (x: string | undefined, t: Tier, p: number) => {
      if (x && !tiers[x] && rand() < p) tiers[x] = t;
    };
    for (const x of favS) put(x, "S", 0.8);
    for (const x of favA) put(x, "A", 0.7);
    for (const x of favB) put(x, "B", 0.7);
    const rest = slugs.filter((x) => !tiers[x]);
    for (const x of pick(rest, 1)) put(x, "S", 1);
    for (const x of pick(rest, 3)) put(x, "A", 1);
    for (const x of pick(rest, 6)) put(x, "B", 1);
    ballots.set(id, encodeBallot(slugs, tiers));
  }
  return ballots;
}

/** The example's tally at a moment: the ballots counted tier by tier, `settledCount`
 * tiers settled (each as it would have in its first window), then the live tally of the
 * open ones, with its inputs. As the server's replay does, with the made-up ballots. */
function tallied(round: VoteManifest, ballots: Map<string, Uint8Array>, settledCount: number) {
  const { slugs } = round;
  const m = slugs.length;
  const voters = [...ballots.keys()].sort();
  const rows = voters.map((v) => [...ballots.get(v)!]);
  const pool = BigInt(round.poolUsd);
  const each = voters.length ? pool / BigInt(voters.length) : 0n;
  const inp: ChainInputs = {
    m,
    costs: round.projects.map((p) => BigInt(p.askUsd)),
    voters,
    weights: voters.map(() => each),
    ranks: rows.map((b) => effectiveRanks(b, m)),
    ballots: rows,
    poolUsd: pool,
    spent: 0n,
    done: new Set(),
  };
  const settledTiers: { tier: Tier; stage: ChainStage }[] = [];
  for (let t = 0; t < settledCount; t++) {
    const stage = chainTally(inp, t, t + 1)[0];
    settledTiers.push({ tier: TIERS[t], stage });
    const done = new Set(inp.done);
    for (const c of stage.order) {
      done.add(c);
      for (const [v, paid] of stage.shares.get(c)!) {
        const i = voters.indexOf(v);
        inp.weights[i] -= paid;
        inp.spent += paid;
      }
    }
    inp.done = done;
  }
  const live = settledCount < TIERS.length ? chainTally(inp, settledCount) : [];
  return {
    inp,
    settledTiers,
    live,
    voters,
    accepted: Object.fromEntries(voters.map((v) => [v, bytesToHex(ballots.get(v)!)])),
  };
}

/** A stage's awards (micro-USD strings, by slug) and what each badge paid (by token). */
function stageJson(slugs: string[], stage: ChainStage) {
  const awards: Record<string, string> = {};
  const paid: Record<string, Record<string, string>> = {};
  for (const c of stage.order) {
    let sum = 0n;
    for (const [v, p] of stage.shares.get(c)!) {
      sum += p;
      if (p > 0n) (paid[v] ??= {})[slugs[c]] = String(p);
    }
    awards[slugs[c]] = String(sum);
  }
  return { funded: stage.order.map((c) => slugs[c]), awards, paid };
}

/** A tier the example's tally settled in its first window. */
function settledTier(slugs: string[], tier: Tier, at: number, stage: ChainStage): RoundTier {
  return { tier, status: "settled", at, forced: false, ...stageJson(slugs, stage) };
}

/** The live tally as the round's JSON has it, with its inputs (the preview re-runs it). */
function liveJson(
  round: VoteManifest,
  t: ReturnType<typeof tallied>,
  first: number,
): RoundView["live"] {
  const out: RoundView["live"] = { funded: [], awards: {}, tiers: {}, paid: {} };
  t.live.forEach((stage, k) => {
    const j = stageJson(round.slugs, stage);
    out.funded.push(...j.funded);
    Object.assign(out.awards, j.awards);
    for (const x of j.funded) out.tiers![x] = TIERS[first + k];
    for (const [v, p] of Object.entries(j.paid)) Object.assign(out.paid![v] ??= {}, p);
  });
  if (first < TIERS.length) out.inputs = liveInputsJson(t.inp, first);
  return out;
}

/** The board's cards as they first came, for a mock to be built from. The board polls,
 * and its totals are Safe balances priced live, so they move by cents every few minutes:
 * each move changed every ask and rebuilt the whole made-up tally, and the example
 * re-rendered under the reader. A reload picks up the board as it is then. */
export function useMockCards(cards: Card[] | undefined): Card[] | undefined {
  const first = useRef<Card[]>(undefined);
  if (!first.current && cards) first.current = cards;
  return first.current;
}

/** Badge `n` in the fictional round, in state `kind`, over the board's `cards`. The
 * tiers and the live result come from the real tally over 40 made-up ballots. */
export function mockRound(kind: MockKind, cards: Card[], n: number): Mock {
  const share = POOL_USD / VOTERS;
  const base = { closed: false, share: micro(share), rejected: [], poolUsd: micro(POOL_USD) };
  const first = FIRST;
  const { round } = fictionalRound(cards, OPENS, first);
  const sample = sampleBallot(round);
  const skipped = round.slugs.filter((x) => !sample.ballot[x]).slice(0, 6);

  if (kind === "started" || kind === "prefilled") {
    const { s, a, b } = sample;
    const view: RoundView = {
      ...base,
      registrationClosesAt: first[0] + WINDOW,
      tiers: (["S", "A", "B"] as const).map((tier, i) => ({
        tier,
        status: "waiting",
        startsAt: first[i],
      })),
      accepted: {},
      live: { funded: [], awards: {} },
    };
    if (kind === "started") return { round, view };
    // What this badge rated on the board: 5★ S-Tier, 4★ A-Tier, 3★ B-Tier, the rest stay out.
    const ratings: Record<string, number> = {};
    for (const x of s) ratings[x] = 5;
    for (const x of a) ratings[x] = 4;
    for (const x of b) ratings[x] = 3;
    const rest = round.slugs.filter((x) => !ratings[x]);
    for (const x of rest.slice(0, 4)) ratings[x] = 2;
    for (const x of rest.slice(4, 6)) ratings[x] = 1;
    return { round, view, ratings };
  }

  // How many tiers have settled at this moment, and whether badge n voted.
  const settledCount = kind === "finished"
    ? 3
    : kind === "b-settling"
    ? 2
    : kind === "spent" || kind === "missed"
    ? 1
    : 0;
  const t = tallied(round, crowd(round, sample, n, kind !== "missed"), settledCount);
  const settledTiers = t.settledTiers.map(({ tier, stage }, i) =>
    settledTier(round.slugs, tier, first[i] + WINDOW, stage)
  );
  const live = liveJson(round, t, settledCount);
  // The tier settling now: in its first window, quiet; or, while S-Tier settles, changed
  // in its first (in its second now), or in its last, where it settles whatever happens.
  const settlingNow = (tier: Tier): RoundTier => {
    const i = TIERS.indexOf(tier);
    const window = kind === "s-extended" ? 2 : kind === "s-last" ? MAX_WINDOWS : 1;
    const endsAt = first[i] +
      Array.from({ length: window }, (_, k) => WINDOW >> k).reduce((x, y) => x + y);
    return {
      tier,
      status: "settling",
      window,
      windowEndsAt: endsAt,
      latestEndAt: first[i] + LONGEST,
      quiet: kind !== "s-extended" && kind !== "s-last",
      funded: Object.entries(live.tiers ?? {}).filter(([, x]) => x === tier).map(([slug]) => slug),
    };
  };
  const waiting = (tier: Tier): RoundTier => ({
    tier,
    status: "waiting",
    startsAt: first[TIERS.indexOf(tier)],
  });
  const tiers: RoundTier[] = TIERS.map((tier, i) =>
    i < settledCount ? settledTiers[i] : i === settledCount ? settlingNow(tier) : waiting(tier)
  );
  const view: RoundView = {
    ...base,
    closed: kind === "finished",
    registrationClosesAt: settledCount ? first[0] + WINDOW : first[0] + LONGEST,
    tiers,
    accepted: t.accepted,
    live: kind === "finished"
      ? (() => {
        const all = settledTiers.flatMap((x) => (x.status === "settled" ? x.funded : []));
        const awards = Object.assign(
          {},
          ...settledTiers.map((x) => (x.status === "settled" ? x.awards : {})),
        );
        const tierOf = Object.fromEntries(
          settledTiers.flatMap((x) =>
            x.status === "settled" ? x.funded.map((s) => [s, x.tier]) : []
          ),
        );
        return { funded: all, awards, tiers: tierOf };
      })()
      : live,
  };
  if (kind === "missed") return { round, view };
  if (kind === "finished") {
    return { round: { ...round, closesAt: first[2] + WINDOW }, view, sent: sample.ballot };
  }
  return { round, view, skipped };
}

/** Examples of the vote results, public at `/vote/results/<id>`: the round at each moment
 * the ballot's examples show (a variant, prefilled or never voted, shows the same round).
 * `s-settled` is the first name of `spent`'s, kept so links to it still work. */
export const RESULT_MOCKS = {
  started: "started",
  "s-settling": "s-settling",
  "s-extended": "s-extended",
  "s-last": "s-last",
  spent: "spent",
  "s-settled": "spent",
  "b-settling": "b-settling",
  finished: "finished",
} as const satisfies Record<string, MockKind>;
export type ResultMockId = keyof typeof RESULT_MOCKS;
export const isResultMockId = (s: string | undefined): s is ResultMockId =>
  Object.hasOwn(RESULT_MOCKS, s ?? "");

/** The moments of the round the examples show, in order, each in a step of the round
 * (0 Voting, 1 S-Tier, 2 A-Tier, 3 B-Tier, 4 Result), and the ballot's variants at it. */
export const MOMENTS: { kind: MockKind; step: number; variants?: MockKind[] }[] = [
  { kind: "started", step: 0, variants: ["prefilled"] },
  { kind: "s-settling", step: 1 },
  { kind: "s-extended", step: 1 },
  { kind: "s-last", step: 1 },
  { kind: "spent", step: 2, variants: ["missed"] },
  { kind: "b-settling", step: 3 },
  { kind: "finished", step: 4 },
];
/** The moment a ballot example shows: a variant's is the one it varies. */
export const momentOf = (k: MockKind): MockKind =>
  MOMENTS.find((m) => m.kind === k || m.variants?.includes(k))?.kind ?? k;

/** `view` as the results page shows it: the figures the server works out, worked out
 * here by the same searches over the example's tally inputs: for each open initiative
 * below the tier settling now, the donation that moves it up a tier (`live.give`), and
 * how far ahead those in it are (`live.lead`). Yields between tallies. A round with no
 * inputs (nothing counted yet, or closed) comes back as it is. */
export async function withFigures(view: RoundView, round: VoteManifest): Promise<RoundView> {
  const json = view.live.inputs;
  if (!json) return view;
  const { inp, first } = liveInputsFrom(json);
  const { slugs } = round;
  // In slices of 10 ms: the page stays responsive, the search doesn't crawl.
  const gifts = await giftGapsAsync(inp, first, chainTally, 10);
  const leads = await liveLeadsAsync(inp, first, chainTally, 10);
  const give: NonNullable<RoundView["live"]["give"]> = Object.fromEntries(
    [...gifts].map(([c, g]) => [slugs[c], {
      tier: g.tier,
      gap: g.gap === null ? null : String(g.gap),
      comesIn: g.comesIn.map(([o, tier]) => ({ slug: slugs[o], tier })),
      dropsOut: g.dropsOut.map(([o, tier]) => ({ slug: slugs[o], tier })),
      moves: g.moves.map(([o, from, to]) => ({ slug: slugs[o], from, to })),
    }]),
  );
  // As the server sends them: any lead above nothing.
  const lead = Object.fromEntries(
    [...leads].filter(([, v]) => v > 0n).map(([c, v]) => [slugs[c], String(v)]),
  );
  return { ...view, live: { ...view.live, give, lead } };
}
