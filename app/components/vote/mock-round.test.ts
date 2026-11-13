import { hexToBytes } from "viem";
import type { Card } from "~/lib/api-types";
import { prefillFromRatings } from "~/lib/vote-prefill";
import { decodeBallot, encodeBallot } from "../../../shared/vote/ballot";
import { rulesRound } from "../../../shared/vote/manifest";
import { checkBallot } from "../../../shared/vote/rules";
import { MOCK_NOW, mockRound, MOCKS, RESULT_MOCKS, withGive } from "./mock-round";

const NOW = 1_800_000_000;
const cards = Array.from({ length: 30 }, (_, i) => ({
  initiative: {
    slug: `p${i}`,
    goalUsd: 100_000 + i * 1_000, // small asks: B-Tier grows until the ballot asks 1.5× the pool
    createdAt: NOW - 1000 + i,
    type: "grant",
  },
  summary: { total: 20_000 },
})) as unknown as Card[];

describe("dev mocks", () => {
  it.each(MOCKS)(
    "%s: a fictional round over the board, with a ballot that keeps the rules",
    (kind) => {
      const m = mockRound(kind, cards, 1);
      expect(m.round.slugs).toEqual(cards.map((c) => c.initiative.slug));
      expect(m.round.kind).toBe("real");
      const hex = m.view.accepted["1"];
      const tiers = m.ratings ? prefillFromRatings(m.ratings, m.round.slugs) : undefined;
      const bytes = hex
        ? hexToBytes(hex as `0x${string}`)
        : encodeBallot(m.round.slugs, tiers ?? {});
      // No ballot yet, or never one (the badge that missed registration).
      if (kind === "started" || kind === "missed") return expect(hex).toBeUndefined();
      expect(checkBallot(bytes, rulesRound(m.round)).errors).toEqual([]);
    },
  );

  it("puts each state where it says", () => {
    const at = (k: (typeof MOCKS)[number]) => mockRound(k, cards, 1);
    expect(at("started").view.tiers.map((t) => t.status)).toEqual([
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(MOCK_NOW.started).toBeGreaterThan(at("started").round.opensAt);
    expect(MOCK_NOW.started).toBeLessThan(at("started").round.schedule.firstTallyAt[0]);
    expect(at("spent").view.tiers.map((t) => t.status)).toEqual(["settled", "settling", "waiting"]);
    // S-Tier settled, the ballot already sent: its 1–2★ are skipped, none of them ranked.
    const spent = at("spent");
    expect(spent.skipped).toHaveLength(6);
    const counted = new Set(
      [...hexToBytes(spent.view.accepted["1"] as `0x${string}`)].flatMap((b, i) =>
        b === 255 ? [] : [spent.round.slugs[i]]
      ),
    );
    expect(spent.skipped!.some((x) => counted.has(x))).toBe(false);
    expect(at("finished").view.closed).toBe(true);
    expect(MOCK_NOW.finished).toBeGreaterThan(at("finished").round.closesAt);
    // A-Tier in its first window at the spent mock's moment.
    const a = at("spent").view.tiers[1];
    expect(a.status === "settling" && MOCK_NOW.spent < a.windowEndsAt).toBe(true);
    expect(MOCK_NOW.spent).toBeGreaterThan(at("spent").round.schedule.firstTallyAt[1]);
    expect(at("finished").sent).toBeDefined();
  });

  it.each(MOCKS)(
    "%s: the real round's dates (docs/factsheet.md), 9 windows from 24h",
    (kind) => {
      const { schedule, closesAt } = mockRound(kind, cards, 1).round;
      const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16);
      expect(iso(schedule.opensAt).slice(0, 10)).toBe("2026-11-17");
      expect(schedule.firstTallyAt.map(iso)).toEqual([
        "2026-12-03T21:00",
        "2026-12-07T21:00",
        "2026-12-09T21:00",
      ]);
      const b = schedule.firstTallyAt[2];
      expect(schedule.initialWindow).toBe(86400);
      if (kind !== "finished") expect(closesAt - b).toBe(48 * 3600 - 338);
    },
  );

  it("the finished round funds winners beyond this badge's ballot, within the pool", () => {
    const m = mockRound("finished", cards, 1);
    const settled = m.view.tiers.flatMap((t) => (t.status === "settled" ? [t] : []));
    const won = settled.flatMap((t) => t.funded);
    expect(won.some((slug) => !m.sent?.[slug])).toBe(true);
    // This badge paid only for what was on its ballot.
    for (const t of settled) {
      for (const slug of Object.keys(t.paid?.["1"] ?? {})) expect(m.sent?.[slug]).toBeDefined();
    }
    const total = settled.flatMap((t) => Object.values(t.awards)).reduce(
      (a, v) => a + Number(v) / 1e6,
      0,
    );
    expect(total).toBeLessThanOrEqual(1_000_000);
  });
});

describe("example vote results", () => {
  // Every open moment (the finished vote has no tier settling).
  it.each(Object.entries(RESULT_MOCKS).filter(([, k]) => k !== "finished"))(
    "%s: figures to the tier settling now, for what is neither settled nor in it",
    (_, kind) => {
      const { round, view } = mockRound(kind, cards, 1);
      const live = withGive(view, round, cards).live;
      const settling = view.tiers.find((t) => t.status !== "settled")!.tier;
      const settled = new Set(view.tiers.flatMap((t) => (t.status === "settled" ? t.funded : [])));
      const entries = Object.entries(live.give!);
      expect(entries.length).toBeGreaterThan(0);
      for (const [slug, g] of entries) {
        expect(g.tier).toBe(settling);
        expect(settled.has(slug)).toBe(false);
        expect(view.live.tiers?.[slug]).not.toBe(settling);
        // A figure in $1K steps, never more than what it needs.
        if (g.gap !== null) {
          const usd = Number(BigInt(g.gap) / 1_000_000n);
          expect(usd % 1000).toBe(0);
          const c = cards.find((x) => x.initiative.slug === slug)!;
          expect(usd).toBeLessThanOrEqual(c.initiative.goalUsd - c.summary.total);
        }
      }
    },
  );
});

it("b-settling: TheDAO's ballot funds one this badge didn't put on its ballot", () => {
  const m = mockRound("b-settling", cards, 1);
  const mine = decodeBallot(hexToBytes(m.view.accepted["1"] as `0x${string}`), m.round.slugs);
  const theirs = m.view.live.funded.filter((slug) => !mine[slug]);
  expect(theirs).toHaveLength(1);
  expect(m.view.live.tiers?.[theirs[0]]).toBe("B");
  // Within the pool, with what the settled tiers took.
  const total = [
    ...m.view.tiers.flatMap((t) => (t.status === "settled" ? Object.values(t.awards) : [])),
    ...Object.values(m.view.live.awards),
  ].reduce((a, v) => a + BigInt(v), 0n);
  expect(total).toBeLessThanOrEqual(BigInt(m.round.poolUsd));
});
