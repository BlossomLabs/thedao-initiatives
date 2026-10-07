import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WatchlistOfferSlot from "./WatchlistOfferSlot";
import { __resetCache, ASK_KEY, readLocal, writeAsk, writeLocal } from "~/lib/watchlist-local";
import { watchlistKey } from "~/hooks/use-watchlist";
import { clearPrivateQueries } from "~/lib/browser-privacy";

const session = vi.hoisted(() => ({
  value: { session: null, me: null } as Record<string, unknown>,
}));
vi.mock("~/context/session", () => ({ useSession: () => session.value }));
const api = vi.hoisted(() => vi.fn());
vi.mock("~/lib/api", async (o) => ({ ...(await o<object>()), api }));
vi.mock("~/lib/watchlist-channel", () => ({ announce: vi.fn(), onAnnounce: () => () => {} }));

const A = "0xaaaa000000000000000000000000000000000000";
const B = "0xbbbb000000000000000000000000000000000000";
const signIn = (address = A, expiresAt = 9) => {
  session.value = {
    session: { address, isAdmin: false, expiresAt },
    me: { address, isAdmin: false, expiresAt, hasWatchlist: false },
  };
};
let qc: QueryClient;
const mount = () =>
  render(
    <QueryClientProvider client={qc}>
      <WatchlistOfferSlot />
    </QueryClientProvider>,
  );
const title = () => screen.queryByText("Keep your watchlist on your account?");
/** The announcement is in the status element, and nowhere visible. */
const movedOnlyInStatus = async () => {
  const status = await screen.findByText("Watchlist moved to your account.");
  expect(status).toBe(screen.getByRole("status"));
  expect(title()).toBeNull();
};
const asked = () => JSON.parse(localStorage.getItem(ASK_KEY) ?? "{}");

beforeEach(() => {
  qc = new QueryClient();
  session.value = { session: null, me: null };
});
afterEach(() => {
  localStorage.clear();
  __resetCache();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("asks only when signed in with a non-empty browser list", async () => {
  writeLocal(["a", "b", "c"]);
  const { unmount } = mount();
  expect(title()).toBeNull();
  unmount();
  signIn();
  mount();
  expect(await screen.findByText("Keep your watchlist on your account?")).toBeInTheDocument();
  expect(screen.getAllByText(/You have 3 initiatives on this browser's watchlist\./).length)
    .toBeGreaterThan(0);
});

it("one initiative reads in the singular", async () => {
  writeLocal(["a"]);
  signIn();
  mount();
  expect((await screen.findAllByText(/You have 1 initiative on this browser's watchlist\./)).length)
    .toBeGreaterThan(0);
});

it("Move imports, clears the browser list only after success, and says so", async () => {
  writeLocal(["a", "b"]);
  signIn();
  let resolve!: (v: unknown) => void;
  api.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Move to my account" }));
  expect(api).toHaveBeenCalledWith("/api/watchlist/import", { json: { ids: ["a", "b"] } });
  expect(readLocal()).toEqual(["a", "b"]); // not before the server says yes
  resolve({ ids: ["a", "b"] });
  await movedOnlyInStatus();
  expect(readLocal()).toEqual([]);
  expect(qc.getQueryData(watchlistKey(A))).toEqual(["a", "b"]);
  expect(asked()[A]).toBeUndefined(); // no box ticked: nothing remembered
});

it("a failed move keeps the browser list and offers to try again", async () => {
  writeLocal(["a"]);
  signIn();
  api.mockRejectedValueOnce(new Error("offline"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Move to my account" }));
  expect(await screen.findByText("Couldn't move your watchlist. Try again.")).toBeInTheDocument();
  expect(readLocal()).toEqual(["a"]);
});

it("Not now hides it until the next sign-in; with Don't ask again, never for this account", async () => {
  writeLocal(["a"]);
  signIn(A, 9);
  const { unmount } = mount();
  fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
  await waitFor(() => expect(title()).toBeNull());
  expect(asked()[A]).toBe("later:9");
  unmount();
  signIn(A, 10); // a new sign-in asks again
  mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Don't ask again" }));
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(title()).toBeNull());
  expect(asked()[A]).toBe("never");
});

it("Don't ask again with Move: the next sign-in with bookmarks moves them without asking", async () => {
  writeLocal(["a"]);
  signIn(A, 9);
  api.mockResolvedValueOnce({ ids: ["a"] });
  const { unmount } = mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Don't ask again" }));
  fireEvent.click(screen.getByRole("button", { name: "Move to my account" }));
  await movedOnlyInStatus();
  expect(asked()[A]).toBe("always");
  unmount();

  writeLocal(["b"]); // bookmarked while signed out
  signIn(A, 10);
  api.mockResolvedValueOnce({ ids: ["a", "b"] });
  mount();
  await movedOnlyInStatus();
  expect(title()).toBeNull();
  expect(api).toHaveBeenLastCalledWith("/api/watchlist/import", { json: { ids: ["b"] } });
  expect(readLocal()).toEqual([]);
});

it("an automatic move that fails shows nothing and keeps the bookmarks", async () => {
  writeLocal(["b"]);
  writeAsk(A, "always");
  signIn(A);
  api.mockRejectedValueOnce(new Error("offline"));
  mount();
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(title()).toBeNull();
  expect(screen.queryByText("Watchlist moved to your account.")).toBeNull();
  expect(readLocal()).toEqual(["b"]);
});

it("another account on the same browser is still asked", async () => {
  writeLocal(["a"]);
  writeAsk(A, "always");
  signIn(B);
  mount();
  expect(await screen.findByText("Keep your watchlist on your account?")).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

it("storage off: nothing can be on the browser list, so nothing is offered, and nothing throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  signIn();
  mount();
  expect(title()).toBeNull();
});

it("the status element exists before the card shows and holds the announcement after", async () => {
  writeLocal(["a", "b", "c"]);
  const { rerender } = mount();
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("");
  expect(status).toHaveClass("sr-only");
  signIn();
  rerender(
    <QueryClientProvider client={qc}>
      <WatchlistOfferSlot />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Keep your watchlist on your account?" });
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toBe(status);
  expect(status).toHaveTextContent(
    "Keep your watchlist on your account? You have 3 initiatives on this browser's watchlist.",
  );
  expect(document.querySelector("[aria-live]")).toBeNull();
  expect(document.activeElement).toBe(document.body);
});

it("Close and Not now are disabled while the move is in flight", async () => {
  writeLocal(["a"]);
  signIn();
  api.mockReturnValueOnce(new Promise(() => {}));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Move to my account" }));
  expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Not now" })).toBeDisabled();
});

it("signing out mid-import: the list is not cached, nothing is announced, the sent ids are cleared", async () => {
  writeLocal(["a"]);
  signIn();
  let resolve!: (v: unknown) => void;
  api.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Move to my account" }));
  clearPrivateQueries(qc);
  session.value = { session: null, me: null };
  resolve({ ids: ["a"] });
  await waitFor(() => expect(readLocal()).toEqual([]));
  expect(qc.getQueryData(watchlistKey(A))).toBeUndefined();
  expect(screen.queryByText("Watchlist moved to your account.")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("");
});

it("a bookmark added while the import is pending survives the move", async () => {
  writeLocal(["a"]);
  signIn();
  let resolve!: (v: unknown) => void;
  api.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Move to my account" }));
  writeLocal(["a", "z"]); // another tab
  resolve({ ids: ["a"] });
  await waitFor(() => expect(readLocal()).toEqual(["z"]));
});
