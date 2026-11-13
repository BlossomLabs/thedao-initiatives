import type { RoundTier } from "~/hooks/use-vote";
import { dayTime, shortDay, usdShort } from "~/lib/format";
import { tierName } from "../../../shared/vote/ballot";
import type { Tier } from "../../../shared/vote/ballot";
import { type Schedule, windowEnds } from "../../../shared/vote/quiet-ending";

/** Where the round is, for the round box's stepper (Voting → S-Tier → A-Tier → B-Tier →
 * Result) and its detail. Times are unix seconds. */

export type StepKind = "done" | "current" | "next" | "up";
export type Step = { name: string; kind: StepKind; sub: string };
/** A settling tier's window: past windows all changed (that's why the next one ran);
 * "coming" will run because the current one already changed; "maybe" only if it does. */
export type Win = { from: number; to: number; kind: "past" | "current" | "coming" | "maybe" };
export type Phase =
  | { kind: "before"; opensAt: number; sStarts: number }
  | { kind: "open"; sStarts: number }
  | {
    kind: "settling";
    tier: Tier;
    window: number;
    maxWindows: number;
    endsAt: number;
    latestEndAt: number;
    quiet: boolean;
    /** This is the tier's last window: it settles at its end, changed or not. */
    last: boolean;
    windows: Win[];
  }
  | {
    kind: "between";
    settled: Tier;
    funded: string[];
    fundedUsd: number;
    next: Tier;
    nextStarts: number;
  }
  | { kind: "closed" };

const TIERS: Tier[] = ["S", "A", "B"];

const usdOf = (awards: Record<string, string>) =>
  Object.values(awards).reduce((a, v) => a + Number(BigInt(v) / 10_000n) / 100, 0);

export function roundSteps(
  { schedule, tiers, now, closed = false }: {
    schedule: Schedule;
    /** The round view's tiers; undefined until it loads (the schedule alone then). */
    tiers: RoundTier[] | undefined;
    now: number;
    closed?: boolean;
  },
): { phase: Phase; steps: Step[]; at: number } {
  const ts: RoundTier[] = tiers ??
    TIERS.map((tier, t) => ({ tier, status: "waiting", startsAt: schedule.firstTallyAt[t] }));
  const lastEnd = windowEnds(schedule, 2).at(-1)!;
  const settling = ts.findIndex((t) => t.status === "settling");
  const settledCount = ts.filter((t) => t.status === "settled").length;
  const sStarts = schedule.firstTallyAt[0];

  let phase: Phase;
  if (closed || settledCount === TIERS.length) phase = { kind: "closed" };
  else if (settling >= 0) {
    const t = ts[settling] as Extract<RoundTier, { status: "settling" }>;
    const ends = windowEnds(schedule, settling);
    const n = schedule.maxWindows;
    const last = t.window >= n;
    phase = {
      kind: "settling",
      tier: t.tier,
      window: t.window,
      maxWindows: n,
      endsAt: t.windowEndsAt,
      latestEndAt: t.latestEndAt,
      quiet: t.quiet,
      last,
      windows: ends.map((to, i) => ({
        from: i === 0 ? schedule.firstTallyAt[settling] : ends[i - 1],
        to,
        kind: i < t.window - 1
          ? "past"
          : i === t.window - 1
          ? "current"
          : i === t.window && !t.quiet && !last
          ? "coming"
          : "maybe",
      })),
    };
  } else if (settledCount > 0) {
    const s = ts[settledCount - 1] as Extract<RoundTier, { status: "settled" }>;
    phase = {
      kind: "between",
      settled: s.tier,
      funded: s.funded,
      fundedUsd: usdOf(s.awards),
      next: TIERS[settledCount],
      nextStarts: schedule.firstTallyAt[settledCount],
    };
  } else if (now < schedule.opensAt) phase = { kind: "before", opensAt: schedule.opensAt, sStarts };
  else phase = { kind: "open", sStarts };

  const voting: Step = {
    name: "Voting",
    kind: phase.kind === "before" || phase.kind === "open" ? "current" : "done",
    sub: phase.kind === "before"
      ? dayTime(schedule.opensAt)
      : phase.kind === "open"
      ? `Open since ${shortDay(schedule.opensAt)}`
      : `Opened ${shortDay(schedule.opensAt)}`,
  };
  const tierSteps: Step[] = ts.map((t, i) => {
    const name = tierName(t.tier);
    if (t.status === "settled") {
      return {
        name,
        kind: "done",
        sub: `${t.funded.length} funded · ${usdShort(usdOf(t.awards))}`,
      };
    }
    if (t.status === "settling") {
      return {
        name,
        kind: "current",
        sub: t.window >= schedule.maxWindows
          ? "Last window"
          : `Window ${t.window} of ${schedule.maxWindows}`,
      };
    }
    const isNext = phase.kind === "between" && phase.next === t.tier;
    return { name, kind: isNext ? "next" : "up", sub: shortDay(schedule.firstTallyAt[i]) };
  });
  const result: Step = {
    name: "Result",
    kind: phase.kind === "closed" ? "done" : "up",
    sub: phase.kind === "closed" ? "Final" : shortDay(lastEnd),
  };
  const steps = [voting, ...tierSteps, result];
  const at = phase.kind === "closed"
    ? 4
    : phase.kind === "settling"
    ? settling + 1
    : phase.kind === "between"
    ? settledCount + 0.5
    : 0;
  return { phase, steps, at };
}
