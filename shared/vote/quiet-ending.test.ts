import { describe, expect, it } from "vitest";
import { type Receipt, replay, type Schedule, windowEnds } from "./quiet-ending";

const T = 10_000;
const W = 3600;
const schedule: Schedule = {
  opensAt: 0,
  firstTallyAt: [T, T + 6300, T + 12600],
  initialWindow: W,
  maxWindows: 3,
};
const X = 255;
let block = 0;
const r = (
  tokenId: string,
  timestamp: number,
  ballot: number[] | null,
  sameBlock = false,
): Receipt => ({
  tokenId,
  nonce: 0,
  ballot: ballot && Uint8Array.from(ballot),
  block: sameBlock ? block : ++block,
  timestamp,
});
/** Two voters, pool 200 (100 each), two proposals needing 150: both on 0 funds it. */
const base = () => [r("a", 1, [1, X]), r("b", 2, [1, X])];
const run = (receipts: Receipt[], now: number, extra: Partial<Parameters<typeof replay>[0]> = {}) =>
  replay({ schedule, m: 2, poolUsd: 200n, needs: [150n, 150n], receipts, ...extra }, now);

describe("quiet-ending replay", () => {
  it("window ends halve from the tier's first tally", () => {
    expect(windowEnds(schedule, 0)).toEqual([T + 3600, T + 5400, T + 6300]);
    expect(windowEnds(schedule, 1)).toEqual([T + 9900, T + 11700, T + 12600]);
  });

  it("before the first tally every tier waits; the live tally is the whole result", () => {
    const s = run(base(), T - 1);
    expect(s.tiers.map((t) => t.status)).toEqual(["waiting", "waiting", "waiting"]);
    expect(s.live.order).toEqual([0]);
    expect(s.registrationClosesAt).toBe(T + W);
    expect(s.live.tiers.get(0)).toBe("S");
  });

  it("a quiet window settles S with its closing tally; A waits for its date", () => {
    const s = run(base(), T + 3600);
    const [S, A] = s.tiers;
    expect(S).toMatchObject({ status: "settled", at: T + 3600, forced: false, funded: [0] });
    expect(S.status === "settled" && S.awards.get(0)).toBe(150n);
    expect(A).toMatchObject({ status: "waiting", startsAt: T + 6300 });
  });

  it("a change in the window extends it", () => {
    const s = run([...base(), r("b", T + 100, [X, 1])], T + 3600);
    expect(s.tiers[0]).toMatchObject({ status: "settling", window: 2, windowEndsAt: T + 5400 });
  });

  it("while a window runs, it says whether it is still quiet", () => {
    expect(run(base(), T + 50).tiers[0]).toMatchObject({
      status: "settling",
      window: 1,
      quiet: true,
    });
    expect(run([...base(), r("b", T + 100, [X, 1])], T + 200).tiers[0])
      .toMatchObject({ status: "settling", window: 1, quiet: false, funded: [] });
  });

  it("funded for a moment and back: still extends", () => {
    const s = run([...base(), r("b", T + 100, [X, 1]), r("b", T + 200, [1, X])], T + 3600);
    expect(s.tiers[0]).toMatchObject({ status: "settling", window: 2 });
  });

  it("two changes in one block make one tally: back to the same result stays quiet", () => {
    const s = run([...base(), r("b", T + 100, [X, 1]), r("b", T + 100, [1, X], true)], T + 3600);
    expect(s.tiers[0]).toMatchObject({ status: "settled", funded: [0] });
  });

  it("changing S in every window settles it at the last cutoff anyway", () => {
    const s = run([
      ...base(),
      r("b", T + 100, [X, 1]),
      r("b", T + 3700, [1, X]),
      r("b", T + 5500, [X, 1]),
    ], T + 7000);
    expect(s.tiers[0]).toMatchObject({ status: "settled", at: T + 6300, forced: true, funded: [] });
  });

  it("a receipt exactly at the cutoff belongs to the next window", () => {
    const s = run([...base(), r("b", T + 3600, [X, 1])], T + 3601);
    expect(s.tiers[0]).toMatchObject({ status: "settled", at: T + 3600, funded: [0] });
    expect(s.rejected).toEqual([{ tokenId: "b", nonce: 0, reason: "tier_settled" }]);
  });

  it("after S settles, moving a proposal out of S is refused; changing A is not", () => {
    const s = run([
      ...base(),
      r("a", T + 4000, [X, 1]),
      r("b", T + 4100, [1, 2]),
    ], T + 4200);
    expect(s.rejected).toEqual([{ tokenId: "a", nonce: 0, reason: "tier_settled" }]);
    expect([...s.accepted.get("a")!]).toEqual([1, X]);
    expect([...s.accepted.get("b")!]).toEqual([1, 2]);
  });

  it("a first ballot after registration closes is refused", () => {
    const s = run([...base(), r("c", T + W, [1, X])], T + W + 1);
    expect(s.rejected).toEqual([{ tokenId: "c", nonce: 0, reason: "registration_closed" }]);
    expect(s.accepted.has("c")).toBe(false);
  });

  it("each badge gets the pool divided by the voters, rounded down; the rest is never spent", () => {
    const s = replay({
      schedule,
      m: 1,
      poolUsd: 301n,
      needs: [301n],
      receipts: [r("a", 1, [1]), r("b", 2, [1])],
    }, T - 1);
    expect(s.live.order).toEqual([]);
  });

  it("a burned badge's ballot no longer counts", () => {
    const s = run([...base(), r("b", 3, null)], T - 1);
    expect(s.accepted.has("b")).toBe(false);
    expect(s.live.order).toEqual([0]); // a alone now has the whole pool
  });

  it("a stored settlement wins over a fresh one (later donations don't move it)", () => {
    const snapshot = {
      tier: "S" as const,
      at: T + 3600,
      forced: false,
      funded: [1],
      awards: new Map([[1, 99n]]),
      shares: new Map([[1, new Map([["a", 99n]])]]),
    };
    const s = run(base(), T + 3600, { snapshots: [snapshot] });
    expect(s.tiers[0]).toMatchObject({ status: "settled", funded: [1] });
  });

  it("a settled tier uses the needs it settled with, not today's", () => {
    const s = run(base(), T + 3600, {
      needs: [10n, 10n],
      settleNeeds: { S: { at: T + 3600, forced: false, needs: [150n, 150n] } },
    });
    expect(s.tiers[0].status === "settled" && s.tiers[0].awards.get(0)).toBe(150n);
  });

  it("a stored settlement pins when S settled, whatever today's needs say about its windows", () => {
    // Without the snapshot, b's change at T+100 would extend S into window 2.
    const snapshot = {
      tier: "S" as const,
      at: T + 3600,
      forced: false,
      funded: [0],
      awards: new Map([[0, 150n]]),
      shares: new Map([[0, new Map([["a", 75n], ["b", 75n]])]]),
    };
    const s = run(
      [...base(), r("b", T + 100, [X, 1]), r("a", T + 3700, [X, 1])],
      T + 3800,
      { snapshots: [snapshot] },
    );
    expect(s.tiers[0]).toMatchObject({ status: "settled", at: T + 3600, funded: [0] });
    expect(s.rejected).toEqual([{ tokenId: "a", nonce: 0, reason: "tier_settled" }]);
  });

  it("kept settle needs pin it too, before the settlement is stored for good", () => {
    const s = run(
      [...base(), r("b", T + 100, [X, 1]), r("a", T + 3700, [X, 1])],
      T + 3800,
      { settleNeeds: { S: { at: T + 3600, forced: false, needs: [150n, 150n] } } },
    );
    expect(s.tiers[0]).toMatchObject({ status: "settled", at: T + 3600 });
    expect(s.rejected.map((x) => x.tokenId)).toEqual(["a"]);
  });

  it("once B settles, the round is closed", () => {
    const s = run(base(), T + 20_000);
    expect(s.tiers.map((t) => t.status)).toEqual(["settled", "settled", "settled"]);
    expect(s.closed).toBe(true);
  });
});
