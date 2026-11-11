import { describe, expect, test } from "vitest";
import { pbearTranscript } from "../../vote/shared/pbear";
import { encodeBallot } from "./ballot.ts";
import { voteTally } from "./tally.ts";

const slugs = ["a", "b", "c"];
const POOL = 100_000_000_000n; // $100,000
const cards = [
  { slug: "a", goalUsd: 60_000, total: 10_000 }, // needs 50k
  { slug: "b", goalUsd: 30_000, total: 0 }, // needs 30k
  { slug: "c", goalUsd: 80_000, total: 0 }, // needs 80k
];

describe("voteTally", () => {
  test("no ballots fund nothing", () => {
    const t = voteTally(cards, [], slugs, POOL);
    expect(t.fundedUsd).toBe(0);
    expect(t.ballots).toBe(0);
    expect([...t.bySlug.values()].every((v) => v === 0)).toBe(true);
    expect(t.tierBySlug.size).toBe(0);
  });

  test("one ballot holds the whole pool and funds what it puts first, at the remaining cost", () => {
    const t = voteTally(cards, [encodeBallot(slugs, { a: "S" })], slugs, POOL);
    expect(t.bySlug.get("a")).toBe(50_000);
    expect(t.bySlug.get("b")).toBe(0);
    expect([...t.tierBySlug]).toEqual([["a", "S"]]);
    expect(t.fundedUsd).toBe(50_000);
    expect(t.ballots).toBe(1);
  });

  test("an initiative its donations already cover takes nothing from the pool", () => {
    const funded = cards.map((c) => (c.slug === "a" ? { ...c, total: 60_000 } : c));
    const t = voteTally(funded, [encodeBallot(slugs, { a: "S", b: "A" })], slugs, POOL);
    expect(t.bySlug.get("a")).toBe(0);
    expect(t.tierBySlug.has("a")).toBe(false);
    expect(t.bySlug.get("b")).toBe(30_000);
  });

  test("matches pbearTranscript on three ballots", () => {
    const ballots = [
      encodeBallot(slugs, { c: "S", b: "A" }),
      encodeBallot(slugs, { c: "S" }),
      encodeBallot(slugs, { a: "S", b: "S" }),
    ];
    const t = voteTally(cards, ballots, slugs, POOL);
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
    const t = voteTally(cards.slice(0, 2), [encodeBallot(slugs, { c: "S" })], slugs, POOL);
    expect(t.bySlug.get("c")).toBe(0);
    expect(t.tierBySlug.has("c")).toBe(false);
  });

  test("result tiers follow competition-rank stage boundaries, not levels 1/2/3", () => {
    const slugs = ["s1", "s2", "s3", "a", "b", "unfunded"];
    const cards = slugs.map((slug) => ({ slug, goalUsd: 10, total: 0 }));
    const ballot = encodeBallot(slugs, { s1: "S", s2: "S", s3: "S", a: "A", b: "B" });
    expect([...ballot]).toEqual([1, 1, 1, 4, 5, 255]);
    const tally = voteTally(cards, [ballot], slugs, 50_000_000n);
    expect([...tally.tierBySlug]).toEqual([
      ["s1", "S"],
      ["s2", "S"],
      ["s3", "S"],
      ["a", "A"],
      ["b", "B"],
    ]);
    expect(tally.bySlug.get("unfunded")).toBe(0);
    expect(tally.fundedUsd).toBe(50);
  });

  test("A finishes only after every ballot's second tier has opened", () => {
    const slugs = ["a", "b", "c", "d", "e"];
    const cards = slugs.map((slug) => ({ slug, goalUsd: 20, total: 0 }));
    const ballots = [
      encodeBallot(slugs, { a: "S", b: "S", c: "S", d: "A", e: "B" }),
      encodeBallot(slugs, { a: "S", d: "A", e: "B" }),
    ];
    const tally = voteTally(cards, ballots, slugs, 100_000_000n);
    expect(tally.tierBySlug.get("d")).toBe("A");
    // The short ballot can fund e at level 3, before the long ballot's A opens at 4.
    expect(tally.tierBySlug.get("e")).toBe("A");
    expect(tally.fundedUsd).toBe(100);
  });

  test("withheld proposals get no award or tier even when budget remains", () => {
    const tally = voteTally(cards, [encodeBallot(slugs, {})], slugs, POOL);
    expect(tally.fundedUsd).toBe(0);
    expect(tally.tierBySlug.size).toBe(0);
  });
});
