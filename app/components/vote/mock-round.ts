import { bytesToHex } from "viem";
import type { RoundTier, RoundView } from "~/hooks/use-vote";
import type { Card } from "~/lib/api-types";
import { encodeBallot, type Tier } from "../../../shared/vote/ballot";
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

/** A tier settled in its first window, funding `funded` (what the badge paid for each). */
function settled(
  tier: Tier,
  at: number,
  funded: { slug: string; award: number; paid: number }[],
  n: number,
): RoundTier {
  return {
    tier,
    status: "settled",
    at,
    forced: false,
    funded: funded.map((f) => f.slug),
    awards: Object.fromEntries(funded.map((f) => [f.slug, micro(f.award)])),
    // Only what this badge paid: the other winners were funded by other ballots.
    paid: {
      [String(n)]: Object.fromEntries(
        funded.filter((f) => f.paid > 0).map((f) => [f.slug, micro(f.paid)]),
      ),
    },
  };
}

/** What badge `n` would pay for each live winner (USD), if the open tiers settled now. */
const livePaid = (n: number, paid: [string, number][]) => ({
  [String(n)]: Object.fromEntries(paid.map(([slug, usd]) => [slug, micro(usd)])),
});

/** Badge `n` in the fictional round, in state `kind`, over the board's `cards`. */
export function mockRound(kind: MockKind, cards: Card[], n: number): Mock {
  const share = POOL_USD / VOTERS;
  const base = { closed: false, share: micro(share), rejected: [], poolUsd: micro(POOL_USD) };
  const empty = { funded: [], awards: {} };

  if (kind === "started" || kind === "prefilled") {
    const first = FIRST;
    const { round } = fictionalRound(cards, OPENS, first);
    const { s, a, b } = sampleBallot(round);
    const view: RoundView = {
      ...base,
      registrationClosesAt: first[0] + WINDOW,
      tiers: (["S", "A", "B"] as const).map((tier, i) => ({
        tier,
        status: "waiting",
        startsAt: first[i],
      })),
      accepted: {},
      live: empty,
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

  // S-Tier settling: in its first window, quiet; changed, in its second; or in its last,
  // where it settles whatever happens. The badge has voted.
  if (kind === "s-settling" || kind === "s-extended" || kind === "s-last") {
    const first = FIRST;
    const { round, ask } = fictionalRound(cards, OPENS, first);
    const { ballot, s, a, b } = sampleBallot(round);
    const window = kind === "s-settling" ? 1 : kind === "s-extended" ? 2 : MAX_WINDOWS;
    const endsAt = first[0] +
      Array.from({ length: window }, (_, k) => WINDOW >> k).reduce((x, y) => x + y);
    // b[0] is in this badge's B-Tier, but other ballots put it in S-Tier: it wins there.
    const live = [s[0], s[1], b[0], a[0]];
    const view: RoundView = {
      ...base,
      registrationClosesAt: first[0] + LONGEST,
      tiers: [
        {
          tier: "S",
          status: "settling",
          window,
          windowEndsAt: endsAt,
          latestEndAt: first[0] + LONGEST,
          quiet: kind === "s-settling",
          funded: [s[0], s[1], b[0]],
        },
        { tier: "A", status: "waiting", startsAt: first[1] },
        { tier: "B", status: "waiting", startsAt: first[2] },
      ],
      accepted: { [String(n)]: bytesToHex(encodeBallot(round.slugs, ballot)) },
      live: {
        funded: live,
        awards: Object.fromEntries(live.map((x) => [x, micro(ask(x))])),
        tiers: { [s[0]]: "S", [s[1]]: "S", [b[0]]: "S", [a[0]]: "A" },
        paid: livePaid(n, [[s[0], share * 0.28], [s[1], share * 0.14], [a[0], share * 0.2]]),
      },
    };
    return { round, view, skipped: round.slugs.filter((x) => !ballot[x]).slice(0, 6) };
  }

  // S-Tier and A-Tier settled in their first windows; B-Tier in its first, quiet.
  if (kind === "b-settling") {
    const first = FIRST;
    const { round, ask } = fictionalRound(cards, OPENS, first);
    const { ballot, s, a, b } = sampleBallot(round);
    const view: RoundView = {
      ...base,
      registrationClosesAt: first[0] + WINDOW,
      tiers: [
        settled("S", first[0] + WINDOW, [
          { slug: s[0], award: ask(s[0]), paid: share * 0.28 },
          { slug: s[1], award: ask(s[1]), paid: share * 0.14 },
          // On this badge's ballot in B-Tier; other ballots funded it in S-Tier.
          { slug: b[0], award: ask(b[0]), paid: 0 },
        ], n),
        settled("A", first[1] + WINDOW, [
          { slug: a[0], award: ask(a[0]), paid: share * 0.2 },
          { slug: a[2], award: ask(a[2]), paid: share * 0.1 },
        ], n),
        {
          tier: "B",
          status: "settling",
          window: 1,
          windowEndsAt: first[2] + WINDOW,
          latestEndAt: first[2] + LONGEST,
          quiet: true,
          funded: [b[1]],
        },
      ],
      accepted: { [String(n)]: bytesToHex(encodeBallot(round.slugs, ballot)) },
      live: {
        funded: [b[1]],
        awards: { [b[1]]: micro(ask(b[1])) },
        tiers: { [b[1]]: "B" },
        paid: livePaid(n, [[b[1], share * 0.1]]),
      },
    };
    return { round, view, skipped: round.slugs.filter((x) => !ballot[x]).slice(0, 6) };
  }

  // A badge that never sent a ballot: S-Tier settled without it, so it can't vote now.
  if (kind === "missed") {
    const first = FIRST;
    const { round, ask } = fictionalRound(cards, OPENS, first);
    const { s, a, b } = sampleBallot(round);
    const view: RoundView = {
      ...base,
      registrationClosesAt: first[0] + WINDOW,
      tiers: [
        settled("S", first[0] + WINDOW, [
          { slug: s[0], award: ask(s[0]), paid: 0 },
          { slug: s[1], award: ask(s[1]), paid: 0 },
          { slug: b[0], award: ask(b[0]), paid: 0 },
        ], n),
        {
          tier: "A",
          status: "settling",
          window: 1,
          windowEndsAt: first[1] + WINDOW,
          latestEndAt: first[1] + LONGEST,
          quiet: true,
          funded: [a[0]],
        },
        { tier: "B", status: "waiting", startsAt: first[2] },
      ],
      accepted: {},
      live: { funded: [a[0]], awards: { [a[0]]: micro(ask(a[0])) }, tiers: { [a[0]]: "A" } },
    };
    return { round, view };
  }

  if (kind === "spent") {
    // S-Tier settled quietly after its first window; A-Tier is in its first window now.
    const first = FIRST;
    const aFirst = first[1];
    const { round, ask } = fictionalRound(cards, OPENS, first);
    const { ballot, s, a, b } = sampleBallot(round);
    const view: RoundView = {
      ...base,
      registrationClosesAt: first[0] + WINDOW,
      tiers: [
        settled("S", first[0] + WINDOW, [
          { slug: s[0], award: ask(s[0]), paid: share * 0.28 },
          { slug: s[1], award: ask(s[1]), paid: share * 0.14 },
          // On this badge's ballot in B-Tier; other ballots funded it in S-Tier.
          { slug: b[0], award: ask(b[0]), paid: 0 },
        ], n),
        {
          tier: "A",
          status: "settling",
          window: 1,
          windowEndsAt: aFirst + WINDOW,
          latestEndAt: aFirst + LONGEST,
          quiet: true,
          funded: [a[0]],
        },
        { tier: "B", status: "waiting", startsAt: first[2] },
      ],
      accepted: { [String(n)]: bytesToHex(encodeBallot(round.slugs, ballot)) },
      live: {
        funded: [a[0]],
        awards: { [a[0]]: micro(ask(a[0])) },
        tiers: { [a[0]]: "A" },
        paid: livePaid(n, [[a[0], share * 0.2]]),
      },
    };
    // Like the prefilled state: six it rated 1–2★, skipped.
    return { round, view, skipped: round.slugs.filter((x) => !ballot[x]).slice(0, 6) };
  }

  // Finished: every tier settled in its first window.
  const first = FIRST;
  const { round, ask } = fictionalRound(cards, OPENS, first);
  const { ballot, s, a, b } = sampleBallot(round);
  const funded = (slug: string, paid: number) => ({ slug, award: ask(slug), paid: share * paid });
  const mine = {
    // b[0]: this badge's B-Tier, funded in S-Tier by the other ballots.
    S: [funded(s[0], 0.28), funded(s[1], 0.14), funded(b[0], 0)],
    A: [funded(a[0], 0.2), funded(a[2], 0.1)],
    B: [funded(b[1], 0.15)],
  };
  // Winners this badge didn't rank, funded by the other ballots: each tier gets a few,
  // as long as the whole result stays within the pool.
  let spent = Object.values(mine).flat().reduce((x, f) => x + f.award, 0);
  const others = round.slugs.filter((slug) => !ballot[slug]);
  const more = (count: number) => {
    const out: ReturnType<typeof funded>[] = [];
    while (out.length < count && others.length) {
      const slug = others.shift()!;
      if (spent + ask(slug) > POOL_USD) continue;
      spent += ask(slug);
      out.push(funded(slug, 0));
    }
    return out;
  };
  const tiers = [
    settled("S", first[0] + WINDOW, [...mine.S, ...more(2)], n),
    settled("A", first[1] + WINDOW, [...mine.A, ...more(3)], n),
    settled("B", first[2] + WINDOW, [...mine.B, ...more(3)], n),
  ];
  const all = tiers.flatMap((t) => (t.status === "settled" ? t.funded : []));
  const tierOf = Object.fromEntries(
    tiers.flatMap((t) => t.status === "settled" ? t.funded.map((x) => [x, t.tier]) : []),
  );
  const view: RoundView = {
    ...base,
    closed: true,
    registrationClosesAt: first[0] + WINDOW,
    tiers,
    accepted: { [String(n)]: bytesToHex(encodeBallot(round.slugs, ballot)) },
    live: {
      funded: all,
      awards: Object.fromEntries(all.map((x) => [x, micro(ask(x))])),
      tiers: tierOf,
    },
  };
  return { round: { ...round, closesAt: first[2] + WINDOW }, view, sent: ballot };
}
