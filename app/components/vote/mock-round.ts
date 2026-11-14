import { bytesToHex } from "viem";
import type { RoundTier, RoundView } from "~/hooks/use-vote";
import type { Card } from "~/lib/api-types";
import { encodeBallot, type Tier, TIERS } from "../../../shared/vote/ballot";
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

/** The example's one outcome, the same at every moment: what each tier funds (for good
 * once settled; before, as the live tally, which counts every open tier at once), and
 * what this badge pays for each (a part of its share). The final result is what each
 * moment showed coming. */
function outcome(
  round: VoteManifest,
  ask: (slug: string) => number,
  { ballot, s, a, b }: ReturnType<typeof sampleBallot>,
) {
  // b[0] is in this badge's B-Tier, but other ballots put it in S-Tier: it wins there.
  const S = [s[0], s[1], b[0]];
  const A = [a[0], a[2]];
  // B-Tier: b[1] from this ballot, and one it didn't rank that the other ballots fund,
  // the cheapest the pool still pays for.
  const left = POOL_USD - [...S, ...A, b[1]].reduce((x, slug) => x + ask(slug), 0);
  const theirs = round.slugs
    .filter((x) => !ballot[x] && ask(x) <= left)
    .sort((x, y) => ask(x) - ask(y))[0];
  const B = theirs ? [b[1], theirs] : [b[1]];
  const paid: Record<string, number> = {
    [s[0]]: 0.28,
    [s[1]]: 0.14,
    [a[0]]: 0.2,
    [a[2]]: 0.1,
    [b[1]]: 0.15,
  };
  return { S, A, B, paid };
}
type Outcome = ReturnType<typeof outcome>;

/** Tier `tier` of the outcome, settled in its first window at `at`; `voted`: whether
 * badge `n` paid its part. */
function settledAs(
  o: Outcome,
  tier: Tier,
  at: number,
  ask: (slug: string) => number,
  n: number,
  voted = true,
): RoundTier {
  const share = POOL_USD / VOTERS;
  return settled(
    tier,
    at,
    o[tier].map((slug) => ({
      slug,
      award: ask(slug),
      paid: voted ? share * (o.paid[slug] ?? 0) : 0,
    })),
    n,
  );
}

/** The live tally from tier `from` on: the outcome's winners in every open tier, and
 * (`voted`) what badge `n` would pay for each. */
function liveFrom(
  o: Outcome,
  from: Tier,
  ask: (slug: string) => number,
  n: number,
  voted = true,
): RoundView["live"] {
  const share = POOL_USD / VOTERS;
  const open = TIERS.slice(TIERS.indexOf(from));
  const funded = open.flatMap((t) => o[t]);
  return {
    funded,
    awards: Object.fromEntries(funded.map((x) => [x, micro(ask(x))])),
    tiers: Object.fromEntries(open.flatMap((t) => o[t].map((x) => [x, t]))),
    ...(voted
      ? {
        paid: livePaid(
          n,
          funded.filter((x) => o.paid[x]).map((x) => [x, share * o.paid[x]] as [string, number]),
        ),
      }
      : {}),
  };
}

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
    const sample = sampleBallot(round);
    const o = outcome(round, ask, sample);
    const window = kind === "s-settling" ? 1 : kind === "s-extended" ? 2 : MAX_WINDOWS;
    const endsAt = first[0] +
      Array.from({ length: window }, (_, k) => WINDOW >> k).reduce((x, y) => x + y);
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
          funded: o.S,
        },
        { tier: "A", status: "waiting", startsAt: first[1] },
        { tier: "B", status: "waiting", startsAt: first[2] },
      ],
      accepted: { [String(n)]: bytesToHex(encodeBallot(round.slugs, sample.ballot)) },
      live: liveFrom(o, "S", ask, n),
    };
    return {
      round,
      view,
      skipped: round.slugs.filter((x) => !sample.ballot[x]).slice(0, 6),
    };
  }

  // S-Tier and A-Tier settled in their first windows; B-Tier in its first, quiet.
  if (kind === "b-settling") {
    const first = FIRST;
    const { round, ask } = fictionalRound(cards, OPENS, first);
    const sample = sampleBallot(round);
    const o = outcome(round, ask, sample);
    const view: RoundView = {
      ...base,
      registrationClosesAt: first[0] + WINDOW,
      tiers: [
        settledAs(o, "S", first[0] + WINDOW, ask, n),
        settledAs(o, "A", first[1] + WINDOW, ask, n),
        {
          tier: "B",
          status: "settling",
          window: 1,
          windowEndsAt: first[2] + WINDOW,
          latestEndAt: first[2] + LONGEST,
          quiet: true,
          funded: o.B,
        },
      ],
      accepted: { [String(n)]: bytesToHex(encodeBallot(round.slugs, sample.ballot)) },
      live: liveFrom(o, "B", ask, n),
    };
    return {
      round,
      view,
      skipped: round.slugs.filter((x) => !sample.ballot[x]).slice(0, 6),
    };
  }

  // A badge that never sent a ballot: S-Tier settled without it, so it can't vote now.
  if (kind === "missed") {
    const first = FIRST;
    const { round, ask } = fictionalRound(cards, OPENS, first);
    const o = outcome(round, ask, sampleBallot(round));
    const view: RoundView = {
      ...base,
      registrationClosesAt: first[0] + WINDOW,
      tiers: [
        settledAs(o, "S", first[0] + WINDOW, ask, n, false),
        {
          tier: "A",
          status: "settling",
          window: 1,
          windowEndsAt: first[1] + WINDOW,
          latestEndAt: first[1] + LONGEST,
          quiet: true,
          funded: o.A,
        },
        { tier: "B", status: "waiting", startsAt: first[2] },
      ],
      accepted: {},
      live: liveFrom(o, "A", ask, n, false),
    };
    return { round, view };
  }

  if (kind === "spent") {
    // S-Tier settled quietly after its first window; A-Tier is in its first window now.
    const first = FIRST;
    const aFirst = first[1];
    const { round, ask } = fictionalRound(cards, OPENS, first);
    const sample = sampleBallot(round);
    const o = outcome(round, ask, sample);
    const view: RoundView = {
      ...base,
      registrationClosesAt: first[0] + WINDOW,
      tiers: [
        settledAs(o, "S", first[0] + WINDOW, ask, n),
        {
          tier: "A",
          status: "settling",
          window: 1,
          windowEndsAt: aFirst + WINDOW,
          latestEndAt: aFirst + LONGEST,
          quiet: true,
          funded: o.A,
        },
        { tier: "B", status: "waiting", startsAt: first[2] },
      ],
      accepted: { [String(n)]: bytesToHex(encodeBallot(round.slugs, sample.ballot)) },
      live: liveFrom(o, "A", ask, n),
    };
    // Like the prefilled state: six it rated 1–2★, skipped.
    return {
      round,
      view,
      skipped: round.slugs.filter((x) => !sample.ballot[x]).slice(0, 6),
    };
  }

  // Finished: every tier settled in its first window, as each moment before showed.
  const first = FIRST;
  const { round, ask } = fictionalRound(cards, OPENS, first);
  const sample = sampleBallot(round);
  const o = outcome(round, ask, sample);
  const tiers = TIERS.map((t, i) => settledAs(o, t, first[i] + WINDOW, ask, n));
  const all = TIERS.flatMap((t) => o[t]);
  const view: RoundView = {
    ...base,
    closed: true,
    registrationClosesAt: first[0] + WINDOW,
    tiers,
    accepted: { [String(n)]: bytesToHex(encodeBallot(round.slugs, sample.ballot)) },
    live: {
      funded: all,
      awards: Object.fromEntries(all.map((x) => [x, micro(ask(x))])),
      tiers: Object.fromEntries(TIERS.flatMap((t) => o[t].map((x) => [x, t]))),
    },
  };
  return { round: { ...round, closesAt: first[2] + WINDOW }, view, sent: sample.ballot };
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

/** `view` as the results page shows it: every voter's ballot counted, and made-up donation
 * figures. For each open initiative below the tier settling now (`live.give`), a donation
 * that moves it up a tier (into B-Tier when it isn't funded), in $1K steps, smaller than
 * what it needs; those needing more than $150K are out of reach. Some moving into the tier
 * settling now knock one of its live winners out, so the preview has something to show.
 * For those in the tier settling now (`live.lead`), how far ahead they are. */
export function withGive(view: RoundView, round: VoteManifest, cards: Card[]): RoundView {
  const settling = view.tiers.find((t) => t.status !== "settled")?.tier ?? "S";
  const done = new Set(view.tiers.flatMap((t) => (t.status === "settled" ? t.funded : [])));
  const liveTier = (slug: string) => (done.has(slug) ? undefined : view.live.tiers?.[slug]);
  const bySlug = new Map(cards.map((c) => [c.initiative.slug, c]));
  const give: NonNullable<RoundView["live"]["give"]> = {};
  const lead: NonNullable<RoundView["live"]["lead"]> = {};
  // What's left of the pool, if the vote ended now: what the settled tiers awarded and the
  // live tally would award taken out.
  const usdOf = (v: string) => Number(BigInt(v) / 1_000_000n);
  const left = POOL_USD -
    view.tiers.flatMap((t) => (t.status === "settled" ? Object.values(t.awards) : []))
      .reduce((a, v) => a + usdOf(v), 0) -
    Object.entries(view.live.awards)
      .filter(([x]) => !done.has(x))
      .reduce((a, [, v]) => a + usdOf(v), 0);
  round.slugs.forEach((slug, i) => {
    if (done.has(slug)) return;
    const now = liveTier(slug);
    if (now === settling) {
      // Ahead by $1K–$12K; one barely in (under $1K: no figure).
      if (i % 5 !== 3) lead[slug] = micro((1 + ((i * 5) % 12)) * 1000);
      return;
    }
    const c = bySlug.get(slug);
    if (!c) return;
    const target = now ? TIERS[TIERS.indexOf(now) - 1] : "B";
    const need = Math.max(0, c.initiative.goalUsd - c.summary.total);
    const far = need > 150_000;
    // Each tier its own figures: higher tiers are harder to reach.
    const shift = (2 - TIERS.indexOf(target)) * 11;
    const k = Math.min(Math.floor(need / 1000), 3 + shift + ((i * 7 + shift) % 29));
    // Made-up knock-ons that follow the money. One already funded that moves up uses less
    // of the pool (the donation pays part of it), so it only pushes one of the target
    // tier's winners down a tier, still funded with the same money; nobody drops out. One
    // not funded that comes into B-Tier adds what it still asks of the pool: B-Tier's last
    // winners drop out only as far as that doesn't fit in what is left.
    const gift = far || k < 1 ? 0 : k * 1000;
    const winners = (t: Tier) => round.slugs.filter((x) => x !== slug && liveTier(x) === t);
    const below = TIERS[TIERS.indexOf(target) + 1];
    const pushed = now ? winners(target).at(-1) : undefined;
    const moves = gift && i % 3 === 0 && pushed && below
      ? [{ slug: pushed, from: target, to: below }]
      : [];
    const dropsOut: { slug: string; tier: Tier }[] = [];
    if (gift && !now) {
      let short = need - gift - left;
      for (const x of winners("B").reverse()) {
        if (short <= 0) break;
        dropsOut.push({ slug: x, tier: "B" });
        short -= usdOf(view.live.awards[x] ?? "0");
      }
    }
    give[slug] = {
      tier: target,
      gap: far || k < 1 ? null : micro(k * 1000),
      comesIn: [],
      dropsOut,
      moves,
    };
  });
  // Once ballots count, the example's 40 voters have all sent one (only badge 1's is
  // known: the rest count too). Before, none has.
  const sent = Object.values(view.accepted)[0];
  const accepted = sent
    ? Object.fromEntries(
      Array.from(
        { length: VOTERS },
        (_, i) => [String(i + 1), view.accepted[String(i + 1)] ?? sent],
      ),
    )
    : view.accepted;
  return { ...view, accepted, live: { ...view.live, give, lead } };
}
