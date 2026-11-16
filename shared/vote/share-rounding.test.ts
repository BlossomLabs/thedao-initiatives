import { expect, it } from "vitest";
import { type ChainState, replay, type Schedule } from "./quiet-ending";

const schedule: Schedule = {
  opensAt: 0,
  firstTallyAt: [100, 200, 300],
  initialWindow: 10,
  maxWindows: 1,
};
const state = (at: number, pool: bigint): ChainState => ({
  block: at,
  timestamp: at,
  asks: [51n, 55n],
  poolUsd: pool,
  withdrawn: [],
  event: at !== 0,
});
const receipts = ["1", "2"].map((tokenId, i) => ({
  tokenId,
  nonce: 1,
  block: i + 1,
  timestamp: i + 1,
  ballot: Uint8Array.from([1, 2]),
}));

it("pool increases release cumulative rounding remainders without repricing S-Tier", () => {
  const before = replay({ schedule, m: 2, states: [state(0, 101n)], receipts }, 120);
  const after = replay(
    { schedule, m: 2, states: [state(0, 101n), state(150, 102n)], receipts },
    160,
  );
  expect(after.tiers[0]).toEqual(before.tiers[0]);
  expect(before.share).toBe(50n);
  expect(after.share).toBe(51n);
  expect(after.liveInputs!.weights).toEqual([26n, 25n]);
});

it("fragmenting a pool increase between settlements gives identical entitlements and charges", () => {
  const run = (extra: ChainState[]) =>
    replay({ schedule, m: 2, states: [state(0, 101n), ...extra], receipts }, 400);
  const once = run([state(160, 106n)]);
  const fragmented = run([102n, 103n, 104n, 105n, 106n].map((pool, i) => state(150 + i, pool)));
  expect(fragmented).toEqual(once);
});

it("payment rounding follows decimal token ID strings in lexicographic order", () => {
  const st = replay({
    schedule,
    m: 1,
    states: [{ ...state(0, 3n), asks: [1n] }],
    receipts: ["2", "10", "1"].map((tokenId, i) => ({
      tokenId,
      nonce: 1,
      block: i + 1,
      timestamp: i + 1,
      ballot: Uint8Array.from([1]),
    })),
  }, 120);
  const tier = st.tiers[0];
  expect(tier.status).toBe("settled");
  if (tier.status === "settled") {
    expect([...tier.shares.get(0)!]).toEqual([["1", 0n], ["10", 0n], ["2", 1n]]);
  }
});

it("an empty accepted roll allocates nothing", () => {
  const st = replay({ schedule, m: 2, states: [state(0, 101n)], receipts: [] }, 400);
  expect(st.share).toBe(0n);
  expect(st.tiers.flatMap((t) => t.status === "settled" ? t.funded : [])).toEqual([]);
});
