import { describe, expect, it } from "vitest";
import { chainTally } from "./chain";
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
    // Until S-Tier settles, first ballots run to its latest possible settlement.
    expect(s.registrationClosesAt).toBe(T + 6300);
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

  it("a first ballot during S-Tier's later windows counts and shrinks the shares; after it settles it doesn't", () => {
    const s = run([
      ...base(),
      // b's change empties S in window 1: S extends.
      r("b", T + 100, [X, 1]),
      // c's first ballot in window 2: the pool is split three ways from then on.
      r("c", T + W + 100, [1, X]),
      // Window 2 is quiet (still nothing funded), so S settles at its end; d is late.
      r("d", T + 5400 + 10, [1, X]),
    ], T + 6000);
    expect(s.tiers[0].status).toBe("settled");
    expect(s.tiers[0].status === "settled" && s.tiers[0].at).toBe(T + 5400);
    expect(s.accepted.has("c")).toBe(true);
    expect(s.share).toBe(66n);
    expect(s.rejected).toEqual([{ tokenId: "d", nonce: 0, reason: "registration_closed" }]);
    expect(s.registrationClosesAt).toBe(T + 5400);
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

  it("says each badge's share, and what each paid when a tier settled", () => {
    const s = run(base(), T + 3600);
    expect(s.share).toBe(100n);
    const S = s.tiers[0];
    expect(S.status === "settled" && [...S.shares.get(0)!]).toEqual([["a", 75n], ["b", 75n]]);
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

  it("each settlement keeps its inputs", () => {
    const st = run(base(), T + 14000);
    expect(st.tiers[0].status).toBe("settled");
    expect(st.tiers[1].status).toBe("settled");
    for (const t of [0, 1]) {
      const tier = st.tiers[t];
      const again = chainTally(st.settleInputs[t]!, t, t + 1)[0].order;
      expect(again).toEqual(tier.status === "settled" ? tier.funded : null);
    }
    expect(st.tiers[2].status).not.toBe("settled");
    expect(st.settleInputs[2]).toBeNull();
  });

  it("settle inputs are kept when the settlement comes from a snapshot", () => {
    const snapshot = {
      tier: "S" as const,
      at: T + 3600,
      forced: false,
      funded: [1],
      awards: new Map([[1, 99n]]),
      shares: new Map([[1, new Map([["a", 99n]])]]),
    };
    const st = run(base(), T + 3600, { snapshots: [snapshot] });
    const i = st.settleInputs[0]!;
    expect(i).not.toBeNull();
    expect(i.voters).toEqual(["a", "b"]);
    expect(i.spent).toBe(0n);
    expect(i.costs).toEqual([150n, 150n]);
  });

  it("kept settle needs pin the time once final", () => {
    const s = run(
      [...base(), r("b", T + 100, [X, 1]), r("a", T + 3700, [X, 1])],
      T + 3800,
      { settleNeeds: { S: { at: T + 3600, forced: false, needs: [150n, 150n], final: true } } },
    );
    expect(s.tiers[0]).toMatchObject({ status: "settled", at: T + 3600 });
    expect(s.rejected.map((x) => x.tokenId)).toEqual(["a"]);
  });

  it("before final, a late ballot still re-judges the window, but with the kept needs", () => {
    const kept = { at: T + 3600, forced: false, needs: [150n, 150n], final: false };
    // A ballot the RPC returned late changes S in window 1: S isn't settled after all.
    const late = run([...base(), r("b", T + 100, [X, 1])], T + 3700, { settleNeeds: { S: kept } });
    expect(late.tiers[0]).toMatchObject({ status: "settling", window: 2 });
    // Today's needs would make nothing fundable; the kept ones still settle S on 0.
    const donated = run(base(), T + 3700, { needs: [400n, 400n], settleNeeds: { S: kept } });
    expect(donated.tiers[0]).toMatchObject({ status: "settled", funded: [0] });
  });

  it("once B settles, the round is closed", () => {
    const s = run(base(), T + 20_000);
    expect(s.tiers.map((t) => t.status)).toEqual(["settled", "settled", "settled"]);
    expect(s.closed).toBe(true);
    expect(s.liveInputs).toBeNull();
  });

  it("chainTally on liveInputs reproduces the live tally", () => {
    // Both voters also back proposal 1 (needing 40) next, so A has one to fund.
    const both = () => [r("a", 1, [1, 2]), r("b", 2, [1, 2])];
    const check = (now: number) => {
      const st = run(both(), now, { needs: [150n, 40n] });
      const again = () => chainTally(st.liveInputs!, st.firstOpen);
      const stages = again();
      const tiers = new Map(
        stages.flatMap((s, k) =>
          s.order.map((c) => [c, (["S", "A", "B"] as const)[st.firstOpen + k]])
        ),
      );
      expect(stages.flatMap((s) => s.order)).toEqual(st.live.order);
      expect(tiers).toEqual(st.live.tiers);
      // It must not spend the inputs: a second call gives the same stages.
      expect(again()).toEqual(stages);
      return st.live.order;
    };
    expect(check(T + 50)).toEqual([0, 1]); // S settling: S funds 0, A funds 1
    expect(check(T + 6300 + 50)).toEqual([1]); // S settled, A settling
  });
});

describe("ballot rules in the replay", () => {
  /** Four unrelated projects asking 100 each; pool 200 unless the chain raised it. */
  type Pos = { block: number; logIndex: number };
  const rules = (
    over: { addedAt?: (Pos | null)[]; pool?: (Pos & { poolUsd: bigint })[] } = {},
  ) => ({
    round: {
      projects: [100n, 100n, 100n, 100n].map((askUsd) => ({ askUsd, rfp: false, groups: [] })),
      groupNames: [],
      poolUsd: 200n,
      independentTiers: 1,
    },
    addedAt: over.addedAt ?? [null, null, null, null],
    pool: over.pool ?? [],
  });
  const run4 = (receipts: Receipt[], r = rules()) =>
    replay(
      { schedule, m: 4, poolUsd: 200n, needs: [150n, 150n, 150n, 150n], receipts, rules: r },
      T - 1,
    );

  it("an invalid ballot is refused; the earlier one still counts", () => {
    const s = run4([r("a", 1, [1, 1, 1, X]), r("a", 2, [1, X, X, X])]);
    expect(s.rejected).toEqual([{ tokenId: "a", nonce: 0, reason: "invalid_ballot" }]);
    expect([...s.accepted.get("a")!]).toEqual([1, 1, 1, X]);
  });

  it("a first ballot that breaks a rule leaves the badge unvoted", () => {
    const s = run4([r("b", 1, [1, 1, X, X])]);
    expect(s.accepted.has("b")).toBe(false);
    expect(s.rejected).toEqual([{ tokenId: "b", nonce: 0, reason: "invalid_ballot" }]);
  });

  it("validity uses the pool at that receipt, by chain position (not time)", () => {
    const a = r("a", 3, [1, 1, 1, X]);
    const b = { ...r("b", 3, [1, 1, 1, X], true), logIndex: 2 }; // same block, a later log
    // The pool was raised between them, in the same block (log 1).
    const s = run4(
      [{ ...a, logIndex: 0 }, b],
      rules({ pool: [{ block: a.block, logIndex: 1, poolUsd: 1_000n }] }),
    );
    expect(s.accepted.has("a")).toBe(true); // 300 ≥ 1.5 × 200 when it landed
    expect(s.accepted.has("b")).toBe(false); // 300 < 1.5 × 1,000
  });

  it("a ballot recorded before a project was added reads it as unplaced", () => {
    const a = r("a", 5, [1, 1, 1]);
    const b = r("b", 5, [1, 1, 1, 1]);
    const s = run4(
      [a, b],
      rules({ addedAt: [null, null, null, { block: b.block + 1, logIndex: 0 }] }),
    );
    expect([...s.accepted.get("a")!]).toEqual([1, 1, 1, X]);
    // Four bytes when only three projects existed: unreadable.
    expect(s.rejected).toEqual([{ tokenId: "b", nonce: 0, reason: "invalid_ballot" }]);
  });
});
