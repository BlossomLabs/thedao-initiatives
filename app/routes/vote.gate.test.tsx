import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "~/lib/api";
import Board from "./board";
import VoteRoute from "./vote";

const ME = "0x1111111111111111111111111111111111111111";
const round = vi.hoisted(() => ({
  kind: "test" as "test" | "real",
  contract: "0x1000000000000000000000000000000000000001",
  opensAt: 0,
}));
const who = vi.hoisted(() => ({ address: null as string | null, isAdmin: false }));
const openWalletPicker = vi.fn();

vi.mock("../../shared/vote/manifest", async (original) => {
  const m = await original<typeof import("../../shared/vote/manifest")>();
  return {
    ...m,
    ROUND: {
      ...m.NO_ROUND,
      get kind() {
        return round.kind;
      },
      get contract() {
        return round.contract;
      },
      get opensAt() {
        return round.opensAt;
      },
    },
    roundDeployed: () => !/^0x0{40}$/i.test(round.contract),
  };
});
vi.mock("~/components/vote/VoteResults", () => ({ default: () => <p>vote results</p> }));
// The board's answer names the round, and carries the whole of it once the real vote has
// opened: that's how the front page learns it, with no request of its own.
vi.mock("~/hooks/use-board", () => ({
  useBoard: () => ({
    data: {
      flags: {
        round: {
          kind: round.kind,
          contract: round.contract,
          opensAt: round.opensAt,
          ...(round.kind === "real" && Date.now() / 1000 >= round.opensAt
            ? { manifest: { ...round, kind: "real" } }
            : {}),
        },
      },
    },
  }),
}));
vi.mock("~/lib/vote-round", async (original) => ({
  ...await original<typeof import("~/lib/vote-round")>(),
  // The round is the mock above: nothing to set.
  primeRound: () => {},
  useRound: () => round,
}));
vi.mock("~/components/board/BoardPage", () => ({ default: () => <p>the board</p> }));
vi.mock("~/context/session", () => ({
  useSession: () => ({
    session: who.address ? { address: who.address, isAdmin: who.isAdmin } : null,
    me: null,
  }),
}));
vi.mock("~/context/wallet-picker", () => ({
  useWalletPicker: () => ({ openWalletPicker, walletPickerOpen: false }),
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

function at(path: string) {
  const router = createMemoryRouter(
    [{ path: "/", element: <Board /> }, { path: "/vote", element: <VoteRoute /> }],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  round.kind = "test";
  round.contract = "0x1000000000000000000000000000000000000001";
  round.opensAt = 0;
  who.address = null;
  who.isAdmin = false;
  vi.mocked(api).mockReset();
  openWalletPicker.mockReset();
});
afterEach(cleanup);

it("the real vote, open: the front page stays the board; the results are on /vote", async () => {
  round.kind = "real";
  at("/");
  expect(await screen.findByText("the board")).toBeInTheDocument();
  expect(screen.queryByText("vote results")).toBeNull();
});

it("the real vote, not open yet: the front page is the board", async () => {
  round.kind = "real";
  round.opensAt = 4_000_000_000;
  at("/");
  expect(await screen.findByText("the board")).toBeInTheDocument();
});

it("a test vote leaves the front page alone", async () => {
  at("/");
  expect(await screen.findByText("the board")).toBeInTheDocument();
  expect(screen.queryByText("vote results")).toBeNull();
});

it("a test vote's results are for voters: signed out, a sign-in", async () => {
  at("/vote");
  expect(await screen.findByText("This page is for voters.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(openWalletPicker).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("vote results")).toBeNull();
});

it("a test vote's results: signed in without a badge, says so", async () => {
  who.address = ME;
  vi.mocked(api).mockResolvedValue({ ids: [] });
  at("/vote");
  expect(await screen.findByText("Your account has no badge in this test vote."))
    .toBeInTheDocument();
  expect(screen.queryByText("vote results")).toBeNull();
});

it("a test vote's results: a voter sees them", async () => {
  who.address = ME;
  vi.mocked(api).mockResolvedValue({ ids: [17] });
  at("/vote");
  expect(await screen.findByText("vote results")).toBeInTheDocument();
});

it("a test vote's results: an admin sees them without a badge", async () => {
  who.address = ME;
  who.isAdmin = true;
  vi.mocked(api).mockResolvedValue({ ids: [] });
  at("/vote");
  expect(await screen.findByText("vote results")).toBeInTheDocument();
});

it("the production vote has results at /vote", async () => {
  round.kind = "real";
  const router = at("/vote");
  expect(await screen.findByText("vote results")).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/vote");
});

it("no vote deployed: /vote says so", async () => {
  round.contract = `0x${"0".repeat(40)}`;
  at("/vote");
  expect(await screen.findByText("There's no vote right now.")).toBeInTheDocument();
});

it("the real vote, open: the first render is still the board, as prerendered (no hydration mismatch)", () => {
  round.kind = "real";
  const html = renderToString(<Board />);
  expect(html).toContain("the board");
  expect(html).not.toContain("vote results");
});
