import { expect, it } from "vitest";
import type { Card } from "~/lib/api-types";
import type { RoundTier } from "~/hooks/use-vote";
import { splitResults } from "./vote-results";

const card = (slug: string, total: number, pct: number, title = slug) =>
  ({ initiative: { slug, title }, summary: { total }, pct }) as unknown as Card;
const settled = (
  tier: "S" | "A" | "B",
  funded: string[],
  awards: Record<string, string>,
): RoundTier => ({ tier, status: "settled", at: 0, forced: false, funded, awards });

const cards = [
  card("a", 1000, 10),
  card("b", 0, 50),
  card("c", 200, 20),
  card("d", 0, 50, "aaa"),
  card("e", 5, 90),
];

it("funded first by tier, then in the order the tally funded them", () => {
  const tiers = [
    settled("A", ["e", "a"], { e: "1000000", a: "1000000" }),
    settled("S", ["c"], { c: "1000000" }),
  ];
  const { funded } = splitResults(cards, tiers);
  expect(funded.map((r) => r.card.initiative.slug)).toEqual(["c", "e", "a"]);
  expect(funded.map((r) => r.tier)).toEqual(["S", "A", "A"]);
});

it("the final amount is raised plus the award", () => {
  const { funded } = splitResults(cards, [settled("B", ["a"], { a: "2500000000" })]);
  expect(funded[0].finalUsd).toBe(3500);
});

it("not funded by how far they got", () => {
  const { notFunded } = splitResults(cards, [settled("S", ["c"], { c: "1000000" })]);
  expect(notFunded.map((r) => r.card.initiative.slug)).toEqual(["e", "d", "b", "a"]);
  expect(notFunded[0].finalUsd).toBe(5);
});
