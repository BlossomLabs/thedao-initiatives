import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  __resetCache,
  ASK_KEY,
  clearLocal,
  LOCAL_KEY,
  readAsk,
  readLocal,
  useAsk,
  useLocalWatchlist,
  writeAsk,
  writeLocal,
} from "./watchlist-local";

afterEach(() => {
  __resetCache();
  localStorage.clear();
  vi.restoreAllMocks();
});

it("reads, writes and clears the browser list; junk reads as empty", () => {
  expect(readLocal()).toEqual([]);
  writeLocal(["a", "b"]);
  expect(JSON.parse(localStorage.getItem(LOCAL_KEY)!)).toEqual(["a", "b"]);
  expect(readLocal()).toEqual(["a", "b"]);
  localStorage.setItem(LOCAL_KEY, '{"x":1}');
  expect(readLocal()).toEqual([]);
  localStorage.setItem(LOCAL_KEY, '["a", 2]');
  expect(readLocal()).toEqual(["a"]);
  clearLocal();
  expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
});

it("every hook in the tab sees a write at once, and a write from another tab", () => {
  const one = renderHook(() => useLocalWatchlist());
  const two = renderHook(() => useLocalWatchlist());
  act(() => writeLocal(["a"]));
  expect(one.result.current).toEqual(["a"]);
  expect(two.result.current).toEqual(["a"]);
  act(() => {
    localStorage.setItem(LOCAL_KEY, '["a","b"]');
    dispatchEvent(new StorageEvent("storage", { key: LOCAL_KEY }));
  });
  expect(one.result.current).toEqual(["a", "b"]);
});

it("the ask state is kept per account: always, never, or later for one sign-in", () => {
  const ask = renderHook(() => useAsk("0xabc"));
  expect(ask.result.current).toBeNull();
  act(() => writeAsk("0xABC", "later:123"));
  expect(readAsk("0xabc")).toBe("later:123");
  expect(ask.result.current).toBe("later:123");
  act(() => writeAsk("0xdef", "never"));
  expect(readAsk("0xabc")).toBe("later:123");
  act(() => writeAsk("0xabc", "always"));
  expect(JSON.parse(localStorage.getItem(ASK_KEY)!)).toEqual({
    "0xabc": "always",
    "0xdef": "never",
  });
  localStorage.setItem(ASK_KEY, "not json");
  expect(readAsk("0xabc")).toBeNull();
});

it("storage off: reads are empty and writes do not throw", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readLocal()).toEqual([]);
  expect(readAsk("0xabc")).toBeNull();
  expect(() => writeLocal(["a"])).not.toThrow();
  expect(() => writeAsk("0xabc", "never")).not.toThrow();
  expect(() => clearLocal()).not.toThrow();
});

it("storage blocked: in-memory cache keeps the watchlist and ask state for the page view", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const hook = renderHook(() => useLocalWatchlist());
  const askHook = renderHook(() => useAsk("0xabc"));
  act(() => writeLocal(["a"]));
  expect(hook.result.current).toEqual(["a"]);
  act(() => writeAsk("0xabc", "never"));
  expect(askHook.result.current).toBe("never");
  expect(readAsk("0xabc")).toBe("never");
});
