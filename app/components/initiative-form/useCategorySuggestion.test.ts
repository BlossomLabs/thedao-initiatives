import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCategorySuggestion } from "./useCategorySuggestion";

const api = vi.fn();
vi.mock("~/lib/api", async (original) => ({
  ...(await original<typeof import("~/lib/api")>()),
  api: (...a: unknown[]) => api(...a),
}));

const TITLE = "Fuzzing for rollup bridges";
const SUMMARY = "A fuzzer that finds bugs in rollup bridge contracts.";

beforeEach(() => {
  vi.useFakeTimers();
  api.mockReset();
});
afterEach(() => vi.useRealTimers());

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it("offers a suggestion after the pause, never before", async () => {
  api.mockResolvedValue({ categories: ["fuzzing-testing", "nope", "defi"] });
  const { result } = renderHook(() =>
    useCategorySuggestion({ title: TITLE, summary: SUMMARY, enabled: true })
  );
  expect(result.current).toBeNull();
  await wait(1200);
  expect(result.current).toEqual(["fuzzing-testing", "defi"]);
});

it("ignores a stale response once the text changed", async () => {
  const first = deferred<{ categories: string[] }>();
  api.mockReturnValueOnce(first.promise).mockResolvedValue({ categories: ["opsec"] });
  const { result, rerender } = renderHook((p) => useCategorySuggestion(p), {
    initialProps: { title: TITLE, summary: SUMMARY, enabled: true },
  });
  await wait(1200);
  rerender({ title: TITLE + " v2", summary: SUMMARY, enabled: true });
  await act(async () => {
    first.resolve({ categories: ["defi"] });
    await first.promise;
  });
  expect(result.current).toBeNull();
  await wait(1200);
  expect(result.current).toEqual(["opsec"]);
});

it("a change to the source text withdraws a shown suggestion", async () => {
  api.mockResolvedValue({ categories: ["defi"] });
  const { result, rerender } = renderHook((p) => useCategorySuggestion(p), {
    initialProps: { title: TITLE, summary: SUMMARY, enabled: true },
  });
  await wait(1200);
  expect(result.current).toEqual(["defi"]);
  rerender({ title: TITLE, summary: SUMMARY + " More.", enabled: true });
  expect(result.current).toBeNull();
});

it("asks nothing while disabled or while the text is short", async () => {
  renderHook(() => useCategorySuggestion({ title: TITLE, summary: SUMMARY, enabled: false }));
  renderHook(() => useCategorySuggestion({ title: "Short", summary: SUMMARY, enabled: true }));
  await wait(2000);
  expect(api).not.toHaveBeenCalled();
});

it("does not ask twice for the same text", async () => {
  api.mockResolvedValue({ categories: ["defi"] });
  const { rerender } = renderHook((p) => useCategorySuggestion(p), {
    initialProps: { title: TITLE, summary: SUMMARY, enabled: true },
  });
  await wait(1200);
  rerender({ title: TITLE, summary: SUMMARY, enabled: false });
  rerender({ title: TITLE, summary: SUMMARY, enabled: true });
  await wait(1200);
  expect(api).toHaveBeenCalledTimes(1);
});
