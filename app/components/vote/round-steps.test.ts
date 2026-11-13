import { describe, expect, it } from "vitest";
import type { RoundTier } from "~/hooks/use-vote";
import { roundSteps } from "./round-steps";

const H = 3600;
const T = 1_000_000;
// 24h windows, at most 4 (24, 12, 6, 3 hours): a tier runs 45h at most.
const schedule = {
  opensAt: T - 72 * H,
  firstTallyAt: [T, T + 48 * H, T + 96 * H] as [number, number, number],
  initialWindow: 24 * H,
  maxWindows: 4,
};
const waiting = (tier: "S" | "A" | "B", startsAt: number): RoundTier => ({
  tier,
  status: "waiting",
  startsAt,
});
const allWaiting = [
  waiting("S", T),
  waiting("A", T + 48 * H),
  waiting("B", T + 96 * H),
];
const settledS: RoundTier = {
  tier: "S",
  status: "settled",
  at: T + 24 * H,
  forced: false,
  funded: ["a", "b"],
  awards: { a: "300000000000", b: "220000000000" },
};
const kinds = (r: ReturnType<typeof roundSteps>) => r.steps.map((s) => s.kind);

describe("roundSteps", () => {
  it("before voting opens: the vote step is current", () => {
    const r = roundSteps({ schedule, tiers: allWaiting, now: T - 80 * H });
    expect(r.phase).toEqual({ kind: "before", opensAt: T - 72 * H, sStarts: T });
    expect(kinds(r)).toEqual(["current", "up", "up", "up", "up"]);
    expect(r.at).toBe(0);
  });

  it("open, before S-Tier's first tally: still the vote step", () => {
    const r = roundSteps({ schedule, tiers: allWaiting, now: T - H });
    expect(r.phase).toEqual({ kind: "open", sStarts: T });
    expect(kinds(r)).toEqual(["current", "up", "up", "up", "up"]);
  });

  it("without a round view yet, the schedule alone says where it is", () => {
    expect(roundSteps({ schedule, tiers: undefined, now: T - H }).phase.kind).toBe("open");
  });

  it("S-Tier settling in window 2, quiet: window 1 done, 2 now, 3 and 4 only if it changes", () => {
    const r = roundSteps({
      schedule,
      tiers: [
        {
          tier: "S",
          status: "settling",
          window: 2,
          windowEndsAt: T + 36 * H,
          latestEndAt: T + 45 * H,
          quiet: true,
          funded: [],
        },
        waiting("A", T + 48 * H),
        waiting("B", T + 96 * H),
      ],
      now: T + 30 * H,
    });
    expect(kinds(r)).toEqual(["done", "current", "up", "up", "up"]);
    expect(r.at).toBe(1);
    const p = r.phase;
    expect(p.kind).toBe("settling");
    if (p.kind !== "settling") return;
    expect(p.tier).toBe("S");
    expect(p.windows.map((w) => w.kind)).toEqual(["past", "current", "maybe", "maybe"]);
    expect(p.windows.map((w) => [w.from - T, w.to - T].map((s) => s / H))).toEqual([
      [0, 24],
      [24, 36],
      [36, 42],
      [42, 45],
    ]);
    expect(p.last).toBe(false);
  });

  it("a change in the current window: the next one will follow", () => {
    const r = roundSteps({
      schedule,
      tiers: [
        {
          tier: "S",
          status: "settling",
          window: 2,
          windowEndsAt: T + 36 * H,
          latestEndAt: T + 45 * H,
          quiet: false,
          funded: [],
        },
        waiting("A", T + 48 * H),
        waiting("B", T + 96 * H),
      ],
      now: T + 30 * H,
    });
    const p = r.phase;
    expect(p.kind === "settling" && p.windows.map((w) => w.kind)).toEqual([
      "past",
      "current",
      "coming",
      "maybe",
    ]);
  });

  it("the last window changing: nothing follows, it settles anyway", () => {
    const r = roundSteps({
      schedule,
      tiers: [
        settledS,
        {
          tier: "A",
          status: "settling",
          window: 4,
          windowEndsAt: T + 93 * H,
          latestEndAt: T + 93 * H,
          quiet: false,
          funded: [],
        },
        waiting("B", T + 96 * H),
      ],
      now: T + 92 * H,
    });
    const p = r.phase;
    expect(p.kind === "settling" && p.windows.map((w) => w.kind)).toEqual([
      "past",
      "past",
      "past",
      "current",
    ]);
    expect(p.kind === "settling" && p.last).toBe(true);
    expect(kinds(r)).toEqual(["done", "done", "current", "up", "up"]);
  });

  it("between tiers: the settled one is done with what it funded, the next is marked", () => {
    const r = roundSteps({
      schedule,
      tiers: [settledS, waiting("A", T + 48 * H), waiting("B", T + 96 * H)],
      now: T + 30 * H,
    });
    expect(r.phase).toEqual({
      kind: "between",
      settled: "S",
      funded: ["a", "b"],
      fundedUsd: 520_000,
      next: "A",
      nextStarts: T + 48 * H,
    });
    expect(kinds(r)).toEqual(["done", "done", "next", "up", "up"]);
    expect(r.steps[1].sub).toBe("2 funded · $520k");
    expect(r.at).toBe(1.5);
  });

  it("closed: every step done", () => {
    const r = roundSteps({
      schedule,
      tiers: [settledS, { ...settledS, tier: "A" }, { ...settledS, tier: "B" }],
      now: T + 200 * H,
      closed: true,
    });
    expect(r.phase).toEqual({ kind: "closed" });
    expect(kinds(r)).toEqual(["done", "done", "done", "done", "done"]);
  });
});
