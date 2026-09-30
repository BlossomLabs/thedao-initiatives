import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBoard } from "./use-board";
import Money from "~/components/ui/Money";
import { cachedFunding } from "~/lib/cached-funding";
import { TWEEN_MS } from "./use-tweened-number";

const clients: QueryClient[] = [];
const client = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(qc);
  return qc;
};
const board = (total: number, refreshDue: boolean) => ({
  cards: [{ summary: { total, refreshDue } }],
  totals: { raised: total },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => resolve = r);
  return { promise, resolve };
}
function View() {
  const { data, isLoading } = useBoard();
  return isLoading ? <p>Loading</p> : (
    <>
      <Money value={data!.totals.raised} />
      <span>{data!.totals.donations} donations</span>
    </>
  );
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((qc) => qc.clear());
  vi.unstubAllGlobals();
});

it("shows saved values before a slow refresh, then animates the mounted number", async () => {
  let frame!: FrameRequestCallback;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frame = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const fresh = deferred<Response>();
  const fetchMock = vi.fn((path: string, _init?: RequestInit) =>
    path.includes("?refresh=1") ? fresh.promise : Promise.resolve(Response.json(board(100, true)))
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={client()}>
      <View />
    </QueryClientProvider>,
  );
  const number = await screen.findByText("$100.00");
  expect(screen.queryByText("Loading")).not.toBeInTheDocument();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  for (const [, init] of fetchMock.mock.calls) {
    expect(new Headers(init?.headers).get("X-Session-Activity")).toBe("passive");
  }
  expect(number).not.toHaveAttribute("data-changed");
  act(() => fresh.resolve(Response.json(board(200, false))));
  await waitFor(() => expect(number).toHaveAttribute("data-changed", "true"));
  act(() => frame(performance.now() + TWEEN_MS + 1));
  expect(number).toHaveTextContent("$200.00");
  expect(screen.getByText("$200.00")).toBe(number);
});

it("a fresh snapshot makes no refresh request", async () => {
  const fetchMock = vi.fn(() => Promise.resolve(Response.json(board(100, false))));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={client()}>
      <View />
    </QueryClientProvider>,
  );
  await screen.findByText("$100.00");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("a refresh outage preserves the saved values", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) =>
      path.includes("?refresh=1")
        ? Promise.reject(new TypeError("offline"))
        : Promise.resolve(Response.json(board(100, true)))
    ),
  );
  render(
    <QueryClientProvider client={client()}>
      <View />
    </QueryClientProvider>,
  );
  await screen.findByText("$100.00");
  expect(screen.queryByText("Loading")).not.toBeInTheDocument();
});

it("a cancelled snapshot cannot repopulate a cleared query", async () => {
  const pending = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  const qc = client();
  const controller = new AbortController();
  const result = cachedFunding(qc, ["private"], "/snapshot", () => true, controller.signal);
  controller.abort();
  qc.clear();
  pending.resolve(Response.json({ total: 100 }));
  await expect(result).rejects.toThrow();
  expect(qc.getQueryData(["private"])).toBeUndefined();
});

it("refreshes stale donation counts even when balances are fresh", async () => {
  const fresh = deferred<Response>();
  const snapshot = {
    cards: [{
      summary: { total: 100, refreshDue: false },
      ledger: { refreshDue: true, updating: false },
    }],
    totals: { raised: 100, donations: 1 },
  };
  const fetchMock = vi.fn((url: string) =>
    url.includes("?refresh=1") ? fresh.promise : Promise.resolve(Response.json(snapshot))
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={client()}>
      <View />
    </QueryClientProvider>,
  );
  await screen.findByText("1 donations");
  act(() =>
    fresh.resolve(Response.json({
      ...snapshot,
      cards: [{ ...snapshot.cards[0], ledger: { refreshDue: false, updating: false } }],
      totals: { raised: 100, donations: 2 },
    }))
  );
  await screen.findByText("2 donations");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("paints from the request the page started before the app loaded, without a second one", async () => {
  const fetchMock = vi.fn(() => Promise.resolve(Response.json(board(100, false))));
  vi.stubGlobal("fetch", fetchMock);
  globalThis.__early = { "/api/board": Promise.resolve(Response.json(board(300, false))) };
  render(
    <QueryClientProvider client={client()}>
      <View />
    </QueryClientProvider>,
  );
  await screen.findByText("$300.00");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(globalThis.__early["/api/board"]).toBeUndefined();
});

it("sends its own request when the early one failed", async () => {
  const fetchMock = vi.fn(() => Promise.resolve(Response.json(board(100, false))));
  vi.stubGlobal("fetch", fetchMock);
  const failed = Promise.reject(new TypeError("offline"));
  failed.catch(() => {});
  globalThis.__early = { "/api/board": failed };
  render(
    <QueryClientProvider client={client()}>
      <View />
    </QueryClientProvider>,
  );
  await screen.findByText("$100.00");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
