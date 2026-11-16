import { describe, expect, it } from "vitest";
import { chainTally } from "./chain";
import {
  type ChainState,
  type Receipt,
  refusal,
  replay,
  type Schedule,
  windowEnds,
} from "./quiet-ending";

const T = 10_000;
const W = 3600;
const schedule: Schedule = {
  opensAt: 0,
  firstTallyAt: [T, T + 6300, T + 12600],
  initialWindow: W,
  maxWindows: 3,
};
const X = 255;
/** One block a second: a receipt's block is its timestamp. */
const r = (tokenId: string, timestamp: number, ballot: number[] | null): Receipt => ({
  tokenId,
  nonce: 0,
  ballot: ballot && Uint8Array.from(ballot),
  block: timestamp,
  timestamp,
});
/** The asks and pool from block `at` on; `event` when the block holds a donation, a
 * pledge or a pool change. */
const at = (time: number, asks: bigint[], poolUsd: bigint, event = true): ChainState => ({
  block: time,
  timestamp: time,
  asks,
  poolUsd,
  withdrawn: [],
  event,
});
/** One state for the whole round, as at block 0. */
const flat = (needs: bigint[], poolUsd: bigint): ChainState[] => [at(0, needs, poolUsd, false)];
/** Two voters, pool 200 (100 each), two proposals needing 150: both on 0 funds it. */
const base = () => [r("a", 1, [1, X]), r("b", 2, [1, X])];
const run = (receipts: Receipt[], now: number, extra: Partial<Parameters<typeof replay>[0]> = {}) =>
  replay({ schedule, m: 2, states: flat([150n, 150n], 200n), receipts, ...extra }, now);

describe("quiet-ending replay", () => {
  it("chain states out of block order, or two for one block, are refused", () => {
    const states = [at(0, [150n, 150n], 200n, false), at(5, [150n, 150n], 200n)];
    expect(() => run(base(), T, { states: [states[1], states[0]] })).toThrow(/ascending/);
    const later = { ...states[1], block: 4 };
    expect(() => run(base(), T, { states: [states[0], states[1], later] })).toThrow(/ascending/);
    const twice = { ...states[1], timestamp: 6 };
    expect(() => run(base(), T, { states: [states[0], states[1], twice] })).toThrow(/ascending/);
  });

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
    const s = run([...base(), r("b", T + 100, [X, 1]), r("b", T + 100, [1, X])], T + 3600);
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
      states: flat([301n], 301n),
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

  it("an incorrect stored settlement cannot override chain replay", () => {
    const snapshot = {
      tier: "S" as const,
      at: T + 3600,
      forced: false,
      funded: [1],
      awards: new Map([[1, 99n]]),
      shares: new Map([[1, new Map([["a", 99n]])]]),
      covered: [],
      withdrawn: [],
    };
    const s = run(base(), T + 3600, { m: 2, ...{ snapshots: [snapshot] } });
    expect(s.tiers[0]).toMatchObject({
      status: "settled",
      funded: [0],
      awards: new Map([[0, 150n]]),
    });
  });

  it("a settled tier uses the asks at its cutoff, not later ones", () => {
    const s = run(base(), T + 3800, {
      states: [...flat([150n, 150n], 200n), at(T + 3700, [10n, 10n], 200n)],
    });
    expect(s.tiers[0].status === "settled" && s.tiers[0].awards.get(0)).toBe(150n);
  });

  it("an incorrect cached cutoff cannot settle a tier or reject a revision", () => {
    // Without the snapshot, b's change at T+100 would extend S into window 2.
    const snapshot = {
      tier: "S" as const,
      at: T + 3600,
      forced: false,
      funded: [0],
      awards: new Map([[0, 150n]]),
      shares: new Map([[0, new Map([["a", 75n], ["b", 75n]])]]),
      covered: [],
      withdrawn: [],
    };
    const s = run(
      [...base(), r("b", T + 100, [X, 1]), r("a", T + 3700, [X, 1])],
      T + 3800,
      { m: 2, ...{ snapshots: [snapshot] } },
    );
    expect(s.tiers[0]).toMatchObject({ status: "settling", window: 2, funded: [1] });
    expect(s.rejected).toEqual([]);
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

  it("settlement inputs are derived despite an obsolete snapshot argument", () => {
    const snapshot = {
      tier: "S" as const,
      at: T + 3600,
      forced: false,
      funded: [1],
      awards: new Map([[1, 99n]]),
      shares: new Map([[1, new Map([["a", 99n]])]]),
      covered: [],
      withdrawn: [],
    };
    const st = run(base(), T + 3600, { m: 2, ...{ snapshots: [snapshot] } });
    const i = st.settleInputs[0]!;
    expect(i).not.toBeNull();
    expect(i.voters).toEqual(["a", "b"]);
    expect(i.spent).toBe(0n);
    expect(i.costs).toEqual([150n, 150n]);
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
      const st = run(both(), now, { states: flat([150n, 40n], 200n) });
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

describe("chain states in the replay", () => {
  // The design's example: S-Tier funds [3, 2]; lower project 0 to 40 and it funds [3, 0].
  // Its ballots [2,2,3,1] and [1,2,1,2] as the chain records them (competition ranks).
  const asks = [62n, 12n, 42n, 32n];
  const ballots = () => [r("a", 1, [2, 2, 4, 1]), r("b", 2, [1, 3, 1, 3])];
  const run4 = (
    states: ChainState[],
    now: number,
    extra: Partial<Parameters<typeof replay>[0]> = {},
  ) => replay({ schedule, m: 4, states, receipts: ballots(), ...extra }, now);
  const settled = (s: ReturnType<typeof replay>, t: number) => {
    const x = s.tiers[t];
    if (x.status !== "settled") throw new Error(`tier ${t} is ${x.status}`);
    return x;
  };

  it("a donation inside the S-Tier window is a tally event and extends it", () => {
    const quiet = run4(flat(asks, 152n), T + 3600);
    expect(settled(quiet, 0)).toMatchObject({ at: T + 3600, funded: [3, 2] });
    const donated = [...flat(asks, 152n), at(T + 50, [40n, 12n, 42n, 32n], 152n)];
    expect(run4(donated, T + 3600).tiers[0])
      .toMatchObject({ status: "settling", window: 2, windowEndsAt: T + 5400 });
    expect(settled(run4(donated, T + 5400), 0)).toMatchObject({ at: T + 5400, funded: [3, 0] });
  });

  it("the same donation after S-Tier settled changes nothing", () => {
    const donated = [...flat(asks, 152n), at(T + 3700, [40n, 12n, 42n, 32n], 152n)];
    const s = run4(donated, T + 3800);
    expect(settled(s, 0)).toMatchObject({ at: T + 3600, funded: [3, 2] });
    expect(settled(s, 0).awards).toEqual(settled(run4(flat(asks, 152n), T + 3800), 0).awards);
  });

  it("a tally uses the pool at its own block", () => {
    // Halving the pool leaves 50 a badge: nothing at 150 fits, so S-Tier changed.
    const s = run(base(), T + 3600, {
      states: [...flat([150n, 150n], 200n), at(T + 50, [150n, 150n], 100n)],
    });
    expect(s.tiers[0]).toMatchObject({ status: "settling", window: 2, funded: [] });
    expect(s.share).toBe(50n);
    // Doubled instead: each badge pays half as much of its share, and S-Tier still funds 0.
    const more = run(base(), T + 3600, {
      states: [...flat([150n, 150n], 200n), at(T + 50, [150n, 150n], 400n)],
    });
    expect(settled(more, 0)).toMatchObject({ funded: [0] });
    expect(more.settleInputs[0]!.poolUsd).toBe(400n);
  });

  it("a covered project is not funded and is recorded as covered", () => {
    const s = replay({
      schedule,
      m: 3,
      states: flat([100n, 100n, 0n], 300n),
      receipts: [r("a", 1, [1, 2, X]), r("b", 2, [1, 2, X])],
    }, T + 20_000);
    expect(s.closed).toBe(true);
    expect([0, 1, 2].map((t) => settled(s, t).covered)).toEqual([[2], [], []]);
    expect([0, 1, 2].flatMap((t) => settled(s, t).funded)).not.toContain(2);
  });

  it("crossing $0 alone does not extend the window", () => {
    // 1 is funded at 5 and covered at 0; nothing else moves.
    const states = [...flat([100n, 5n], 200n), at(T + 50, [100n, 0n], 200n)];
    const both = () => [r("a", 1, [1, 1]), r("b", 2, [1, 1])];
    const during = replay({ schedule, m: 2, states, receipts: both() }, T + 100);
    expect(during.tiers[0]).toMatchObject({
      status: "settling",
      quiet: true,
      funded: [0],
      covered: [1],
    });
    expect(during.live.covered).toEqual([1]);
    const s = replay({ schedule, m: 2, states, receipts: both() }, T + 3600);
    expect(settled(s, 0)).toMatchObject({ at: T + 3600, funded: [0], covered: [1] });
  });

  it("covering a funded project extends the window only if it frees money for another", () => {
    const both = (m: number) => [r("a", 1, Array(m).fill(1)), r("b", 2, Array(m).fill(1))];
    // 1 is funded already: covering 0 frees nothing.
    const none = replay({
      schedule,
      m: 2,
      states: [...flat([130n, 90n], 200n), at(T + 50, [0n, 90n], 200n)],
      receipts: both(2),
    }, T + 3600);
    expect(settled(none, 0)).toMatchObject({ at: T + 3600, funded: [1], covered: [0] });
    // Covering 0, funded, frees the money that brings 1 in.
    const frees = (now: number) =>
      replay({
        schedule,
        m: 4,
        states: [...flat([90n, 90n, 60n, 50n], 200n), at(T + 50, [0n, 90n, 60n, 50n], 200n)],
        receipts: both(4),
      }, now);
    expect(frees(T + 3600).tiers[0]).toMatchObject({ status: "settling", window: 2 });
    expect(settled(frees(T + 5400), 0)).toMatchObject({ funded: [3, 2, 1], covered: [0] });
  });

  it("a project covered at settlement never returns", () => {
    // 1 is covered when S-Tier settles; its ask is back before A-Tier, but that is final.
    const s = replay({
      schedule,
      m: 4,
      states: [...flat([60n, 0n, 60n, 60n], 200n), at(T + 4000, [60n, 10n, 60n, 60n], 200n)],
      receipts: [r("a", 1, [1, 1, 3, X]), r("b", 2, [1, 1, 3, X])],
    }, T + 20_000);
    expect(settled(s, 0)).toMatchObject({ funded: [0], covered: [1] });
    expect([0, 1, 2].flatMap((t) => settled(s, t).funded)).not.toContain(1);
    expect([0, 1, 2].flatMap((t) => settled(s, t).covered)).toEqual([1]);
  });

  it("a funded project whose ask is later covered keeps its award", () => {
    const s = replay({
      schedule,
      m: 4,
      states: [...flat([60n, 0n, 60n, 60n], 200n), at(T + 4000, [0n, 0n, 60n, 60n], 200n)],
      receipts: [r("a", 1, [1, 1, 3, X]), r("b", 2, [1, 1, 3, X])],
    }, T + 20_000);
    expect([...settled(s, 0).shares.get(0)!]).toEqual([["a", 30n], ["b", 30n]]);
    expect([0, 1, 2].flatMap((t) => settled(s, t).covered)).toEqual([1]);
  });

  it("a project covered mid-window but not at the cutoff is an ordinary candidate", () => {
    const s = run(base(), T + 3600, {
      states: [
        ...flat([150n, 150n], 200n),
        at(T + 50, [0n, 150n], 200n),
        at(T + 100, [150n, 150n], 200n),
      ],
    });
    expect(settled(s, 0)).toMatchObject({ at: T + 3600, funded: [0], covered: [] });
  });

  it("a project missing from an early state is not a candidate there", () => {
    // Project 2 joins at T−100 (asks 40); before, the state has two asks.
    const states = [...flat([150n, 150n], 200n), at(T - 100, [150n, 150n, 40n], 200n, false)];
    const go = (st: ChainState[], now: number) =>
      replay(
        { schedule, m: 3, states: st, receipts: [r("a", 1, [1, X, 1]), r("b", 2, [1, X, 1])] },
        now,
      );
    expect(go(states, T - 200).live).toMatchObject({ order: [0], covered: [] });
    expect(go(states, T - 1).live.order).toContain(2);
    // Missing at the cutoff: not funded and not covered either.
    expect(settled(go(flat([150n, 150n], 200n), T + 3600), 0)).toMatchObject({
      funded: [0],
      covered: [],
    });
  });

  it("a receipt's tally uses the asks at its block; a state that is no event is no tally", () => {
    // For ten blocks project 0 asks 250, out of reach; no ask event is recorded there.
    const states = [
      ...flat([150n, 150n], 200n),
      at(T + 50, [250n, 150n], 200n, false),
      at(T + 60, [150n, 150n], 200n, false),
    ];
    expect(settled(run(base(), T + 3600, { states }), 0)).toMatchObject({ at: T + 3600 });
    // b sends the same ballot again in that block: its tally funds nothing.
    const s = run([...base(), r("b", T + 50, [1, X])], T + 3600, { states });
    expect(s.tiers[0]).toMatchObject({ status: "settling", window: 2 });
  });

  it("is the same with and without snapshots", () => {
    const donated = [...flat(asks, 152n), at(T + 50, [40n, 12n, 42n, 32n], 152n)];
    for (const now of [T + 5400, T + 9000, T + 20_000]) {
      const fresh = run4(donated, now);
      const snapshots = fresh.tiers.flatMap((x) => x.status === "settled" ? [x] : []);
      expect(run4(donated, now, { m: 4, ...{ snapshots } })).toEqual(fresh);
    }
  });

  it("throws without a chain state before the first tally", () => {
    expect(() => run(base(), T + 3600, { states: [at(T + 10, [150n, 150n], 200n)] }))
      .toThrow("no chain state");
  });
});

describe("withdrawn projects in the replay", () => {
  /** The asks and pool from block `time` on, with `out` withdrawn; a tally event. */
  const wd = (time: number, asks: bigint[], poolUsd: bigint, out: number[]): ChainState => ({
    ...at(time, asks, poolUsd),
    withdrawn: asks.map((_, c) => out.includes(c)),
  });
  const go = (m: number, states: ChainState[], receipts: Receipt[], now: number) =>
    replay({ schedule, m, states, receipts }, now);
  const settled = (s: ReturnType<typeof replay>, t: number) => {
    const x = s.tiers[t];
    if (x.status !== "settled") throw new Error(`tier ${t} is ${x.status}`);
    return x;
  };

  it("funded project withdrawn mid-window, freed money funds nobody new: S-Tier settles on time, quiet", () => {
    const states = [...flat([150n, 150n], 200n), wd(T + 50, [150n, 150n], 200n, [0])];
    const during = go(2, states, base(), T + 100);
    expect(during.tiers[0]).toMatchObject({
      status: "settling",
      window: 1,
      quiet: true,
      funded: [],
      covered: [],
      withdrawn: [0],
    });
    expect(during.live).toMatchObject({ order: [], covered: [], withdrawn: [0] });
    // The live inputs keep the real ask and carry the withdrawn set apart.
    expect(during.liveInputs!.costs[0]).toBe(150n);
    expect([...during.liveInputs!.withdrawn]).toEqual([0]);
    const s = go(2, states, base(), T + 3600);
    expect(settled(s, 0)).toMatchObject({
      at: T + 3600,
      forced: false,
      funded: [],
      covered: [],
      withdrawn: [0],
    });
    expect(settled(s, 0).awards.size).toBe(0);
  });

  it("funded project withdrawn mid-window, freed money brings another in: S-Tier window extends", () => {
    const both = [r("a", 1, [1, 1, 1, 1]), r("b", 2, [1, 1, 1, 1])];
    const asks = [90n, 90n, 60n, 50n];
    const states = [...flat(asks, 200n), wd(T + 50, asks, 200n, [0])];
    expect(settled(go(4, flat(asks, 200n), both, T + 3600), 0).funded).toContain(0);
    expect(go(4, states, both, T + 3600).tiers[0]).toMatchObject({ status: "settling", window: 2 });
    expect(settled(go(4, states, both, T + 5400), 0)).toMatchObject({
      funded: [3, 2, 1],
      covered: [],
      withdrawn: [0],
    });
  });

  it("withdraw then undo inside one window, nothing else changes: quiet", () => {
    const states = [
      ...flat([150n, 150n], 200n),
      wd(T + 50, [150n, 150n], 200n, [0]),
      wd(T + 100, [150n, 150n], 200n, []),
    ];
    expect(settled(go(2, states, base(), T + 3600), 0)).toMatchObject({
      at: T + 3600,
      funded: [0],
      withdrawn: [],
    });
  });

  it("withdrawn at S-Tier's settlement, undone during A-Tier: competes in A-Tier", () => {
    const ballots = [r("a", 1, [1, 2]), r("b", 2, [1, 2])];
    const states = [
      ...flat([150n, 150n], 200n),
      wd(T - 100, [150n, 150n], 200n, [0]),
      wd(T + 7000, [150n, 150n], 200n, []),
    ];
    const s = go(2, states, ballots, T + 20_000);
    expect(settled(s, 0)).toMatchObject({ funded: [], withdrawn: [0] });
    expect(settled(s, 1)).toMatchObject({ funded: [0], withdrawn: [] });
    expect(settled(s, 1).awards.get(0)).toBe(150n);
    // A cached settlement gives the same.
    const snapshots = s.tiers.flatMap((x) => x.status === "settled" ? [x] : []);
    expect(replay({ schedule, m: 2, states, receipts: ballots, ...{ snapshots } }, T + 20_000))
      .toEqual(s);
  });

  it("withdrawn in the block S-Tier settles with: in withdrawn, not funded", () => {
    const states = [...flat([150n, 150n], 200n), wd(T + 3599, [150n, 150n], 200n, [0])];
    const s = go(2, states, base(), T + 3600);
    expect(settled(s, 0)).toMatchObject({ at: T + 3600, funded: [], withdrawn: [0] });
  });

  it("withdrawn and asking $0: listed withdrawn, not covered", () => {
    const states = [wd(0, [100n, 100n, 0n], 300n, [2])];
    const receipts = [r("a", 1, [1, 2, X]), r("b", 2, [1, 2, X])];
    const open = go(3, states, receipts, T - 1);
    expect(open.live).toMatchObject({ covered: [], withdrawn: [2] });
    const s = go(3, states, receipts, T + 20_000);
    expect([0, 1, 2].map((t) => settled(s, t).covered)).toEqual([[], [], []]);
    expect([0, 1, 2].map((t) => settled(s, t).withdrawn)).toEqual([[2], [2], [2]]);
    expect([0, 1, 2].flatMap((t) => settled(s, t).funded)).not.toContain(2);
  });

  it("withdrawal after the project was funded in S-Tier: ignored, award unchanged", () => {
    const states = [...flat([150n, 150n], 200n), wd(T + 4000, [150n, 150n], 200n, [0])];
    const s = go(2, states, base(), T + 20_000);
    expect(settled(s, 0)).toMatchObject({ funded: [0], withdrawn: [] });
    expect(settled(s, 0).awards.get(0)).toBe(150n);
    expect([1, 2].map((t) => settled(s, t).withdrawn)).toEqual([[], []]);
    expect(go(2, states, base(), T + 7000).live.withdrawn).toEqual([]);
  });

  it("withdrawal one second after S-Tier's cutoff: S-Tier settled without it in withdrawn", () => {
    // S-Tier funds 1 (150); A-Tier would fund 0 (50) with what is left.
    const ballots = [r("a", 1, [2, 1]), r("b", 2, [2, 1])];
    const plain = go(2, flat([50n, 150n], 200n), ballots, T + 20_000);
    expect(settled(plain, 1).funded).toEqual([0]);
    for (const when of [T + 3600, T + 3601]) {
      const states = [...flat([50n, 150n], 200n), wd(when, [50n, 150n], 200n, [0])];
      const s = go(2, states, ballots, T + 20_000);
      expect(settled(s, 0)).toMatchObject({ at: T + 3600, funded: [1], withdrawn: [] });
      expect(settled(s, 1)).toMatchObject({ funded: [], withdrawn: [0] });
    }
  });

  it("ballot keeps a withdrawn project: voter not charged for it, money goes to their other choices", () => {
    // Without the withdrawal S-Tier funds 0 (75 each) and 1 (100) can't be paid in A-Tier.
    const ballots = [r("a", 1, [1, 2]), r("b", 2, [1, 2])];
    const plain = go(2, flat([150n, 100n], 200n), ballots, T + 20_000);
    expect([settled(plain, 0).funded, settled(plain, 1).funded]).toEqual([[0], []]);
    const s = go(2, [wd(0, [150n, 100n], 200n, [0])], ballots, T + 20_000);
    expect(settled(s, 0)).toMatchObject({ funded: [], withdrawn: [0] });
    expect(settled(s, 0).shares.size).toBe(0);
    expect(settled(s, 1).funded).toEqual([1]);
    expect([...settled(s, 1).shares.get(1)!]).toEqual([["a", 50n], ["b", 50n]]);
  });

  it("voter keeps a withdrawn project in their settled S-Tier and changes B-Tier: accepted", () => {
    const states = [wd(0, [150n, 50n, 50n], 200n, [0])];
    const ballots = [r("a", 1, [1, 2, 3]), r("b", 2, [1, 2, 3])];
    const s = go(3, states, [...ballots, r("a", T + 4000, [1, 2, X])], T + 4100);
    expect(settled(s, 0)).toMatchObject({ funded: [], withdrawn: [0] });
    expect(s.rejected).toEqual([]);
    expect([...s.accepted.get("a")!]).toEqual([1, 2, X]);
    // The supporter lock is as it was: taking the withdrawn project out of S-Tier is refused.
    expect(refusal(s, "a", Uint8Array.from([1, 2, 3]), T + 4100, 3)).toBe(null);
    expect(refusal(s, "a", Uint8Array.from([X, 1, 2]), T + 4100, 3))
      .toEqual({ code: "tier_settled", tier: "S" });
  });
});

describe("ballot shape in the replay", () => {
  const run4 = (receipts: Receipt[]) =>
    replay({ schedule, m: 4, states: flat([150n, 150n, 150n, 150n], 200n), receipts }, T - 1);

  it("a ballot the replay can't read is refused; the earlier one still counts", () => {
    const s = run4([r("a", 1, [1, 1, 1, X]), r("a", 2, [1, 3, X, X])]);
    expect(s.rejected).toEqual([{ tokenId: "a", nonce: 0, reason: "invalid_ballot" }]);
    expect([...s.accepted.get("a")!]).toEqual([1, 1, 1, X]);
  });

  it("a ballot longer than the projects is refused", () => {
    const s = run4([r("b", 1, [1, 1, 1, 1, 1])]);
    expect(s.accepted.has("b")).toBe(false);
    expect(s.rejected).toEqual([{ tokenId: "b", nonce: 0, reason: "invalid_ballot" }]);
  });

  it("a recorded ballot is not re-judged on size", () => {
    // Two projects needing 150, under 1.5 × the pool of 200: the contract recorded it.
    const s = run4([r("c", 1, [1, 1, X, X])]);
    expect(s.rejected).toEqual([]);
    expect([...s.accepted.get("c")!]).toEqual([1, 1, X, X]);
  });

  it("a ballot signed before a project was added reads it as unplaced", () => {
    const s = run4([r("d", 1, [1, 1, 1])]);
    expect([...s.accepted.get("d")!]).toEqual([1, 1, 1, X]);
  });
});
