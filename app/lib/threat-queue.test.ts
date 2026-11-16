import { describe, expect, it } from "vitest";
import type { LiveInputsJson } from "../../shared/vote/live-inputs";
import type { jumpsAsync, threatOfAsync } from "../../shared/vote/threat";
import { type QueueEvent, ThreatQueue } from "./threat-queue";

const M = 1_000_000n;

/** A round's figures: five initiatives, each asking $50k. Only `costs` matters to the fakes. */
const FIGURES: LiveInputsJson = {
  first: 0,
  costs: Array.from({ length: 5 }, () => String(50_000n * M)),
  voters: [],
  weights: [],
  ballots: [],
  poolUsd: "0",
  spent: "0",
  done: [],
  withdrawn: [],
};

type Call = {
  kind: "jumps" | "typed";
  x: number;
  /** The row's ask as the job saw it, micro-USD (a typed gift lowers it). */
  cost: bigint;
  signal: AbortSignal;
  finish: (usd?: number) => void;
};

/** Fake work: each call waits until the test finishes it; aborting rejects at once. */
function fakeWork() {
  const calls: Call[] = [];
  const add = (kind: Call["kind"], inp: { costs: bigint[] }, x: number, signal?: AbortSignal) =>
    new Promise<unknown>((resolve, reject) => {
      signal!.addEventListener("abort", () => reject(signal!.reason));
      calls.push({
        kind,
        x,
        cost: inp.costs[x],
        signal: signal!,
        finish: (usd = 1000) =>
          resolve(kind === "jumps" ? [{ usd: BigInt(usd) * M, threat: null }] : BigInt(usd) * M),
      });
    });
  const work = {
    jumps: ((inp, _first, x, opts) => add("jumps", inp, x, opts?.signal)) as typeof jumpsAsync,
    threatOf:
      ((inp, _first, x, opts) => add("typed", inp, x, opts?.signal)) as typeof threatOfAsync,
  };
  return { calls, work };
}

/** Lets the queue react to a finished or aborted job. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const events: QueueEvent[] = [];
  const { calls, work } = fakeWork();
  const q = new ThreatQueue((e) => events.push(e), work);
  return { q, events, calls };
}

const started = (calls: Call[]) => calls.map((c) => `${c.kind}:${c.x}`);

describe("ThreatQueue", () => {
  it("works out the open row, then the two visible rows, then the rest", async () => {
    const { q, events, calls } = setup();
    q.setOrder(3, [1, 4], [0, 2]);
    q.setInputs("a", FIGURES);
    for (let i = 0; i < 5; i++) {
      expect(calls).toHaveLength(i + 1);
      calls[i].finish();
      await settle();
    }
    expect(started(calls)).toEqual(["jumps:3", "jumps:1", "jumps:4", "jumps:0", "jumps:2"]);
    expect(events.map((e) => e.kind === "jumps" && e.c)).toEqual([3, 1, 4, 0, 2]);
    expect(events[0]).toEqual({
      kind: "jumps",
      key: "a",
      c: 3,
      jumps: [{ usd: 1000, threat: null }],
    });
  });

  it("opening a row puts it first, and the job it interrupts is done again later", async () => {
    const { q, events, calls } = setup();
    q.setInputs("a", FIGURES);
    q.setOrder(undefined, [0, 1], [2]);
    expect(started(calls)).toEqual(["jumps:0"]);
    q.setOrder(2, [0, 1], []);
    expect(calls[0].signal.aborted).toBe(true);
    await settle();
    expect(started(calls)).toEqual(["jumps:0", "jumps:2"]);
    calls[1].finish();
    await settle();
    // The interrupted row comes back.
    expect(started(calls)).toEqual(["jumps:0", "jumps:2", "jumps:0"]);
    calls[2].finish();
    await settle();
    expect(events.map((e) => e.c)).toEqual([2, 0]);
  });

  it("new figures start over: old results are dropped and never emitted with the new key", async () => {
    const { q, events, calls } = setup();
    q.setOrder(0, [1], []);
    q.setInputs("a", FIGURES);
    calls[0].finish();
    await settle();
    expect(events).toHaveLength(1);
    // Row 1 begun under "a"; the figures change before it ends.
    const old = calls[1];
    q.setInputs("b", FIGURES);
    expect(old.signal.aborted).toBe(true);
    old.finish();
    await settle();
    expect(events).toHaveLength(1);
    // Row 0 is worked out again for "b", from the top.
    expect(started(calls).slice(2)).toEqual(["jumps:0"]);
    calls[2].finish();
    await settle();
    expect(events.slice(1).map((e) => [e.key, e.c])).toEqual([["b", 0]]);
  });

  it("a typed amount goes before everything; clearing it cancels it", async () => {
    const { q, events, calls } = setup();
    q.setInputs("a", FIGURES);
    q.setOrder(0, [1], []);
    q.typed(1, 2000);
    expect(calls[0].signal.aborted).toBe(true);
    await settle();
    expect(calls[1]).toMatchObject({ kind: "typed", x: 1, cost: 48_000n * M });
    calls[1].finish(7000);
    await settle();
    expect(events[0]).toEqual({ kind: "typed", key: "a", c: 1, given: 2000, threat: 7000 });
    // Back to the rows; a new amount interrupts again, and clearing it cancels it.
    expect(started(calls)[2]).toBe("jumps:0");
    q.typed(1, 3000);
    await settle();
    const typed = calls[3];
    expect(typed).toMatchObject({ kind: "typed", cost: 47_000n * M });
    q.typed(1, undefined);
    expect(typed.signal.aborted).toBe(true);
    await settle();
    expect(started(calls)[4]).toBe("jumps:0");
    expect(events.filter((e) => e.kind === "typed")).toHaveLength(1);
  });

  it("new figures work the typed amount out again", async () => {
    const { q, events, calls } = setup();
    q.setInputs("a", FIGURES);
    q.typed(1, 2000);
    calls[0].finish(7000);
    await settle();
    q.setInputs("b", FIGURES);
    expect(started(calls)).toEqual(["typed:1", "typed:1"]);
    calls[1].finish(8000);
    await settle();
    expect(events.map((e) => [e.kind, e.key])).toEqual([["typed", "a"], ["typed", "b"]]);
  });

  it("the same amount sent again once worked out is not redone and interrupts nothing", async () => {
    const { q, calls } = setup();
    q.setInputs("a", FIGURES);
    q.setOrder(0, [], []);
    q.typed(1, 2000);
    await settle();
    calls[1].finish();
    await settle();
    expect(started(calls)).toEqual(["jumps:0", "typed:1", "jumps:0"]);
    q.typed(1, 2000);
    await settle();
    expect(calls[2].signal.aborted).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it("an amount covering the row's whole ask is not worked out", async () => {
    const { q, calls } = setup();
    q.setInputs("a", FIGURES);
    q.setOrder(undefined, [], []);
    q.typed(2, 50_000);
    await settle();
    expect(calls).toHaveLength(0);
  });

  it("paused: nothing starts until it resumes", async () => {
    const { q, events, calls } = setup();
    q.pause();
    q.setInputs("a", FIGURES);
    q.setOrder(0, [1], []);
    q.typed(1, 1000);
    await settle();
    expect(calls).toHaveLength(0);
    q.resume();
    expect(started(calls)).toEqual(["typed:1"]);
    // Pausing mid-job stops it; it is done again on resuming.
    q.pause();
    expect(calls[0].signal.aborted).toBe(true);
    await settle();
    expect(calls).toHaveLength(1);
    q.resume();
    expect(started(calls)).toEqual(["typed:1", "typed:1"]);
    expect(events).toHaveLength(0);
  });

  it("a row done for these figures is not worked out again", async () => {
    const { q, calls } = setup();
    q.setInputs("a", FIGURES);
    q.setOrder(0, [1], []);
    calls[0].finish();
    await settle();
    calls[1].finish();
    await settle();
    q.setOrder(1, [0], [2]);
    await settle();
    expect(started(calls)).toEqual(["jumps:0", "jumps:1", "jumps:2"]);
  });

  it("stop aborts the job in progress", async () => {
    const { q, events, calls } = setup();
    q.setInputs("a", FIGURES);
    q.setOrder(0, [1], []);
    q.stop();
    expect(calls[0].signal.aborted).toBe(true);
    await settle();
    expect(calls).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  it("a job that fails (not aborted) emits an empty result so the page stops waiting", async () => {
    const events: QueueEvent[] = [];
    const err = console.error;
    console.error = () => {};
    try {
      const work = {
        jumps: (() => Promise.reject(new Error("boom"))) as typeof jumpsAsync,
        threatOf: (() => Promise.reject(new Error("boom"))) as typeof threatOfAsync,
      };
      const q = new ThreatQueue((e) => events.push(e), work);
      q.setOrder(1, [], []);
      q.setInputs("a", FIGURES);
      await settle();
      expect(events[0]).toEqual({ kind: "jumps", key: "a", c: 1, jumps: [] });
      q.typed(2, 5000);
      await settle();
      expect(events).toContainEqual({
        kind: "typed",
        key: "a",
        c: 2,
        given: 5000,
        threat: undefined,
      });
    } finally {
      console.error = err;
    }
  });
});
