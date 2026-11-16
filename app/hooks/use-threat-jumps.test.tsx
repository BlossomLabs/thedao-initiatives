import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { effectiveRanks } from "../../vote/shared/ranks";
import type { ChainInputs } from "../../shared/vote/chain";
import { liveInputsJson } from "../../shared/vote/live-inputs";
import { useThreatJumps } from "./use-threat-jumps";

const K = 1_000_000_000n; // $1k in micro-USD

/** A small made-up round: three initiatives, two voters placing all three in S-Tier, a $60k
 * pool. Only initiative 2 is green with a number ($10k); its jumps are $1k and $5k. */
function round(): ChainInputs {
  const costsK = [40, 40, 30];
  const ballots = [[1, 1, 1], [1, 1, 1]];
  return {
    m: 3,
    costs: costsK.map((c) => BigInt(c) * K),
    voters: ["v0", "v1"],
    weights: [25n * K, 25n * K],
    ranks: ballots.map((b) => effectiveRanks(b, 3)),
    ballots,
    poolUsd: 60n * K,
    spent: 0n,
    done: new Set(),
    withdrawn: new Set(),
  };
}

const INPUTS = liveInputsJson(round(), 0);
const JUMPS = [{ usd: 1000, threat: 11_000 }, { usd: 5000, threat: null }];

let hidden = false;
Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
const setHidden = (h: boolean) =>
  act(() => {
    hidden = h;
    document.dispatchEvent(new Event("visibilitychange"));
  });

// Deno has a `Worker` of its own; jsdom has none, as the page fallback expects.
beforeEach(() => {
  vi.stubGlobal("Worker", undefined);
});
afterEach(() => {
  hidden = false;
  vi.unstubAllGlobals();
});

describe("useThreatJumps (on the page's thread: no Worker in jsdom)", () => {
  it("the hook returns the open row's jumps for the current figures", async () => {
    expect(typeof Worker).toBe("undefined");
    const { result, rerender } = renderHook(
      (p: { key: string }) =>
        useThreatJumps({ key: p.key, inputs: INPUTS, open: 2, visible: [], rest: [] }),
      {
        initialProps: { key: "a" },
      },
    );
    await waitFor(() => expect(result.current.jumps.get(2)).toEqual(JUMPS));
    // New figures: the old key's results are not shown as the new one's.
    rerender({ key: "b" });
    expect(result.current.jumps.size).toBe(0);
    await waitFor(() => expect(result.current.jumps.get(2)).toEqual(JUMPS));
  });

  it("figures arriving after their key are still worked out", async () => {
    const { result, rerender } = renderHook(
      (p: { inputs?: typeof INPUTS }) =>
        useThreatJumps({ key: "a", inputs: p.inputs, open: 2, visible: [], rest: [] }),
      {
        initialProps: {},
      },
    );
    rerender({ inputs: INPUTS });
    await waitFor(() => expect(result.current.jumps.get(2)).toEqual(JUMPS));
  });

  it("new figures work the typed amount out again", async () => {
    const { result, rerender } = renderHook(
      (p: { key: string }) =>
        useThreatJumps({
          key: p.key,
          inputs: INPUTS,
          visible: [],
          rest: [],
          typed: { c: 2, given: 5000 },
        }),
      {
        initialProps: { key: "a" },
      },
    );
    await waitFor(() => expect(result.current.typed).toEqual({ c: 2, given: 5000, threat: null }));
    rerender({ key: "b" });
    expect(result.current.typed).toBeUndefined();
    await waitFor(() => expect(result.current.typed).toEqual({ c: 2, given: 5000, threat: null }));
  });

  it("works out a typed amount's number", async () => {
    const { result } = renderHook(() =>
      useThreatJumps({
        key: "a",
        inputs: INPUTS,
        visible: [],
        rest: [],
        typed: { c: 2, given: 5000 },
      })
    );
    await waitFor(() => expect(result.current.typed).toEqual({ c: 2, given: 5000, threat: null }));
  });

  it("a hidden tab pauses the work", async () => {
    const wait = () => act(() => new Promise((r) => setTimeout(r, 100)));
    // Hidden from the start.
    hidden = true;
    const { result, rerender } = renderHook(
      (p: { key: string }) =>
        useThreatJumps({ key: p.key, inputs: INPUTS, open: 2, visible: [], rest: [] }),
      {
        initialProps: { key: "a" },
      },
    );
    await wait();
    expect(result.current.jumps.size).toBe(0);
    setHidden(false);
    await waitFor(() => expect(result.current.jumps.get(2)).toEqual(JUMPS));
    // Hidden again, then new figures: nothing until it shows.
    setHidden(true);
    rerender({ key: "b" });
    await wait();
    expect(result.current.jumps.size).toBe(0);
    setHidden(false);
    await waitFor(() => expect(result.current.jumps.get(2)).toEqual(JUMPS));
  });
});

describe("useThreatJumps with a worker that fails to load", () => {
  it("falls back to the page's thread and still returns jumps", async () => {
    class BrokenWorker {
      onmessage: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor() {
        setTimeout(() => this.onerror?.(new Event("error")), 0);
      }
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal("Worker", BrokenWorker);
    const { result } = renderHook(() =>
      useThreatJumps({ key: "a", inputs: INPUTS, open: 2, visible: [], rest: [] })
    );
    await waitFor(() => expect(result.current.jumps.get(2)).toEqual(JUMPS));
  });

  it("makes no worker until there are figures", () => {
    let made = 0;
    class CountingWorker {
      onmessage: unknown = null;
      constructor() {
        made++;
      }
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal("Worker", CountingWorker);
    const { rerender } = renderHook(
      (p: { inputs?: typeof INPUTS }) =>
        useThreatJumps({ key: "a", inputs: p.inputs, open: 2, visible: [], rest: [] }),
      { initialProps: {} },
    );
    expect(made).toBe(0);
    rerender({ inputs: INPUTS });
    expect(made).toBe(1);
  });
});
