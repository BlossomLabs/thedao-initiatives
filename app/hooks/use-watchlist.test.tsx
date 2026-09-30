import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWatchlist, watchlistKey } from "./use-watchlist";
import { readLocal, writeLocal } from "~/lib/watchlist-local";
import { ApiError } from "~/lib/api";
import { clearPrivateQueries } from "~/lib/browser-privacy";

const session = vi.hoisted(() => ({
  value: { session: null, me: null } as Record<string, unknown>,
}));
vi.mock("~/context/session", () => ({ useSession: () => session.value }));
const api = vi.hoisted(() => vi.fn());
vi.mock("~/lib/api", async (o) => ({ ...(await o<object>()), api }));
const channel = vi.hoisted(() => ({
  announce: vi.fn(),
  listeners: [] as ((m: unknown) => void)[],
}));
vi.mock("~/lib/watchlist-channel", () => ({
  announce: channel.announce,
  onAnnounce: (fn: (m: unknown) => void) => {
    channel.listeners.push(fn);
    return () => {};
  },
}));

const A = "0xaaaa000000000000000000000000000000000000";
const signedIn = (hasWatchlist: boolean) => {
  session.value = {
    session: { address: A, isAdmin: false, expiresAt: 9 },
    me: { address: A, isAdmin: false, expiresAt: 9, hasWatchlist },
  };
};

let qc: QueryClient;
const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  session.value = { session: null, me: null };
  channel.listeners = [];
});
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

it("signed out, or signed in without an account list: the browser list", () => {
  writeLocal(["x"]);
  const out = renderHook(() => useWatchlist(), { wrapper: wrap });
  expect(out.result.current.source).toBe("browser");
  expect(out.result.current.ids).toEqual(["x"]);
  signedIn(false);
  const inNoList = renderHook(() => useWatchlist(), { wrapper: wrap });
  expect(inNoList.result.current.source).toBe("browser");
  expect(api).not.toHaveBeenCalled();
});

it("signed in with an account list: reads it, adds with PUT and removes with DELETE", async () => {
  signedIn(true);
  writeLocal(["local-only"]);
  api.mockResolvedValueOnce({ ids: ["a"] });
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  await waitFor(() => expect(result.current.ids).toEqual(["a"]));
  expect(result.current.source).toBe("account");

  api.mockResolvedValueOnce({ ids: ["a", "b"] });
  act(() => result.current.toggle("b"));
  expect(result.current.ids).toEqual(["a", "b"]); // at once
  expect(api).toHaveBeenLastCalledWith("/api/watchlist/b", { method: "PUT" });
  await waitFor(() =>
    expect(channel.announce).toHaveBeenCalledWith({ address: A, ids: ["a", "b"] })
  );

  api.mockResolvedValueOnce({ ids: ["b"] });
  act(() => result.current.toggle("a"));
  expect(api).toHaveBeenLastCalledWith("/api/watchlist/a", { method: "DELETE" });
  await waitFor(() => expect(result.current.ids).toEqual(["b"]));
});

it("a failed add rolls back and says so", async () => {
  signedIn(true);
  api.mockResolvedValueOnce({ ids: [] });
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  await waitFor(() => expect(result.current.source).toBe("account"));
  api.mockRejectedValueOnce(new Error("offline"));
  act(() => result.current.toggle("b"));
  await waitFor(() => expect(result.current.ids).toEqual([]));
  expect(result.current.error).toBe("Couldn't update your watchlist.");
});

it("a broadcast for this account replaces the list; one for another account is ignored", async () => {
  signedIn(true);
  api.mockResolvedValueOnce({ ids: ["a"] });
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  await waitFor(() => expect(result.current.ids).toEqual(["a"]));
  act(() => channel.listeners.forEach((fn) => fn({ address: "0xbbbb", ids: ["z"] })));
  expect(result.current.ids).toEqual(["a"]);
  act(() => channel.listeners.forEach((fn) => fn({ address: A, ids: ["a", "c"] })));
  expect(result.current.ids).toEqual(["a", "c"]);
});

it("sign-out drops the account list from the cache", async () => {
  const { clearPrivateQueries } = await import("~/lib/browser-privacy");
  qc.setQueryData(watchlistKey(A), ["a"]);
  clearPrivateQueries(qc);
  expect(qc.getQueryData(watchlistKey(A))).toBeUndefined();
});

it("a list put in the cache (after a move) switches to the account list without /me", () => {
  signedIn(false);
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  act(() => qc.setQueryData(watchlistKey(A), ["m"]));
  expect(result.current.source).toBe("account");
  expect(result.current.ids).toEqual(["m"]);
});

it("sign-out mid-request: a late answer or failure does not bring the list back", async () => {
  signedIn(true);
  api.mockResolvedValueOnce({ ids: ["a"] });
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  await waitFor(() => expect(result.current.source).toBe("account"));

  let resolve!: (v: unknown) => void;
  api.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  act(() => result.current.toggle("b"));
  act(() => clearPrivateQueries(qc));
  await act(() => Promise.resolve(resolve({ ids: ["a", "b"] })));
  expect(qc.getQueryData(watchlistKey(A))).toBeUndefined();
  expect(channel.announce).not.toHaveBeenCalled();

  let reject!: (e: unknown) => void;
  api.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
  act(() => result.current.toggle("c"));
  act(() => clearPrivateQueries(qc));
  await act(() => Promise.resolve(reject(new Error("offline"))));
  expect(qc.getQueryData(watchlistKey(A))).toBeUndefined();
  expect(result.current.error).toBeNull();
});

it("hasWatchlist with the GET pending: account source, empty, nothing written", () => {
  signedIn(true);
  writeLocal(["x"]);
  api.mockReturnValueOnce(new Promise(() => {}));
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  expect(result.current.source).toBe("account");
  expect(result.current.ids).toEqual([]);
  act(() => result.current.toggle("b"));
  expect(readLocal()).toEqual(["x"]);
  expect(api).toHaveBeenCalledTimes(1);
});

it("hasWatchlist with the GET failing: stays account, says so, writes nothing", async () => {
  signedIn(true);
  writeLocal(["x"]);
  api.mockRejectedValueOnce(new Error("offline"));
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  await waitFor(() => expect(qc.getQueryState(watchlistKey(A))?.status).toBe("error"));
  expect(result.current.source).toBe("account");
  act(() => result.current.toggle("b"));
  expect(result.current.error).toBe("Couldn't update your watchlist.");
  expect(readLocal()).toEqual(["x"]);
  expect(api).toHaveBeenCalledTimes(1);
});

it("hasWatchlist with the GET 404: the browser list", async () => {
  signedIn(true);
  api.mockRejectedValueOnce(new ApiError(404, "no watchlist"));
  const { result } = renderHook(() => useWatchlist(), { wrapper: wrap });
  await waitFor(() => expect(result.current.source).toBe("browser"));
});
