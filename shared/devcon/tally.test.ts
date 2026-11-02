import { describe, expect, test } from "vitest";
import { pbearTranscript } from "../../vote/shared/pbear";
import { encodeBallot } from "./ballot.ts";
import { devconTally } from "./tally.ts";

const slugs = ["a", "b", "c"];
const POOL = 100_000_000_000n; // $100,000
const cards = [
  { slug: "a", goalUsd: 60_000, total: 10_000 }, // needs 50k
  { slug: "b", goalUsd: 30_000, total: 0 }, // needs 30k
  { slug: "c", goalUsd: 80_000, total: 0 }, // needs 80k
];

describe("devconTally", () => {
  test("no ballots fund nothing", () => {
    const t = devconTally(cards, [], slugs, POOL);
    expect(t.fundedUsd).toBe(0);
    expect(t.ballots).toBe(0);
    expect([...t.bySlug.values()].every((v) => v === 0)).toBe(true);
  });

  test("one ballot holds the whole pool and funds what it puts first, at the remaining cost", () => {
    const t = devconTally(cards, [encodeBallot(slugs, { a: "S" })], slugs, POOL);
    expect(t.bySlug.get("a")).toBe(50_000);
    expect(t.bySlug.get("b")).toBe(0);
    expect(t.fundedUsd).toBe(50_000);
    expect(t.ballots).toBe(1);
  });

  test("an initiative its donations already cover takes nothing from the pool", () => {
    const funded = cards.map((c) => (c.slug === "a" ? { ...c, total: 60_000 } : c));
    const t = devconTally(funded, [encodeBallot(slugs, { a: "S", b: "A" })], slugs, POOL);
    expect(t.bySlug.get("a")).toBe(0);
    expect(t.bySlug.get("b")).toBe(30_000);
  });

  test("matches pbearTranscript on three ballots", () => {
    const ballots = [
      encodeBallot(slugs, { c: "S", b: "A" }),
      encodeBallot(slugs, { c: "S" }),
      encodeBallot(slugs, { a: "S", b: "S" }),
    ];
    const t = devconTally(cards, ballots, slugs, POOL);
    const weight = POOL / 3n;
    const ref = pbearTranscript(
      [50_000_000_000n, 30_000_000_000n, 80_000_000_000n],
      ballots.map((b) => ({ weight, ballot: [...b] })),
      [],
      POOL,
    );
    const costs = { a: 50_000, b: 30_000, c: 80_000 } as Record<string, number>;
    for (const s of slugs) {
      expect(t.bySlug.get(s)).toBe(ref.funded.includes(slugs.indexOf(s)) ? costs[s] : 0);
    }
  });

  test("slugs missing from the board count as fully needed nothing (cost 0, share 0)", () => {
    const t = devconTally(cards.slice(0, 2), [encodeBallot(slugs, { c: "S" })], slugs, POOL);
    expect(t.bySlug.get("c")).toBe(0);
  });
});
