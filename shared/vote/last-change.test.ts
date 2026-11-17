import { describe, expect, it } from "vitest";
import { type ChainState, type Receipt, replay, type Schedule } from "./quiet-ending";
import { lastChange } from "./last-change";

const T = 10_000;
const schedule: Schedule = {
  opensAt: 0,
  firstTallyAt: [T, T + 6300, T + 12600],
  initialWindow: 3600,
  maxWindows: 3,
};
const X = 255;
const r = (tokenId: string, timestamp: number, ballot: number[] | null, nonce = 1): Receipt => ({
  tokenId,
  nonce,
  ballot: ballot && Uint8Array.from(ballot),
  block: timestamp,
  timestamp,
});
const at = (time: number, asks: bigint[], poolUsd: bigint, event = true): ChainState => ({
  block: time,
  timestamp: time,
  asks,
  poolUsd,
  poolInitialized: true,
  withdrawn: [],
  event,
});
const first = (): Receipt[] => [r("a", 1, [1, X]), r("b", 2, [1, X])];
const run = (receipts: Receipt[], states: ChainState[], now: number) => {
  const input = { schedule, m: 2, states, receipts };
  return lastChange(input, now, replay(input, now));
};
const flat = [at(0, [150n, 150n], 200n, false)];

describe("lastChange", () => {
  it("names the revised ballot that moved an initiative, and what moved", () => {
    // Both on 0; "a" moving to 1 drops 0 (100 of 150), "b" following funds 1.
    const ballots = [...first(), r("a", T + 100, [X, 1], 2), r("b", T + 200, [X, 1], 2)];
    const c = run(ballots, flat, T + 300);
    expect(c).toMatchObject({
      at: T + 200,
      causes: [{ kind: "ballot", tokenId: "b", first: false }],
    });
    expect(c!.moved).toEqual([{ project: 1, from: null, to: "S" }]);
  });

  it("skips inputs that changed nothing", () => {
    // After "b" moved, "b" sends the same ballot again: nothing changes.
    const ballots = [...first(), r("a", T + 100, [X, 1], 2), r("b", T + 200, [X, 1], 2)];
    const same = r("b", T + 250, [X, 1], 3);
    const c = run([...ballots, same], flat, T + 300);
    expect(c!.at).toBe(T + 200);
  });

  it("names a donation that lowered an ask", () => {
    // Only "a" backs 1 (100 of 150); a donation of 50 covers the rest.
    const ballots = [r("a", 1, [X, 1]), r("b", 2, [1, X])];
    const states = [at(0, [150n, 150n], 200n, false), at(T + 50, [150n, 100n], 200n)];
    const c = run(ballots, states, T + 100);
    expect(c).toMatchObject({
      at: T + 50,
      causes: [{ kind: "ask", project: 1, from: 150n, to: 100n }],
      moved: [{ project: 1, from: null, to: "S" }],
    });
  });

  it("names a pool change", () => {
    const ballots = [r("a", 1, [X, 1]), r("b", 2, [1, X])];
    const states = [at(0, [150n, 150n], 200n, false), at(T + 50, [150n, 150n], 300n)];
    const c = run(ballots, states, T + 100);
    expect(c!.causes).toEqual([{ kind: "pool", from: 200n, to: 300n }]);
  });

  it("a first ballot is a new voter", () => {
    // "a" alone funds 0; "b" halves its share and backs 1: 0 drops out.
    const c = run([r("a", 1, [1, X]), r("b", 5, [X, 1])], flat, 10);
    expect(c).toMatchObject({ at: 5, causes: [{ kind: "ballot", tokenId: "b", first: true }] });
  });

  it("none when nothing ever changed the ballot", () => {
    expect(run([], flat, 10)).toBeNull();
  });
});
