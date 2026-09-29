import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import type { Card } from "~/lib/api-types";
import Board from "./board";

const cards = vi.hoisted(() =>
  [
    { id: "a", title: "Alpha fuzzing", type: "rfp", categories: ["fuzzing-testing"] },
    { id: "b", title: "Beta wallets", type: "grant", categories: ["wallets-signing", "opsec"] },
    { id: "c", title: "Gamma opsec", type: "rfp", categories: ["opsec"] },
  ].map((x, i) => ({
    initiative: {
      id: x.id,
      slug: x.id,
      title: x.title,
      summary: "s",
      goalUsd: 1000,
      status: "approved",
      type: x.type,
      sortRank: null,
      safeAddress: "",
      categories: x.categories,
      createdAt: i,
      approvedAt: i,
    },
    summary: { pledged: 0, received: 0, donated: 0, total: 0, live: false, ledger: 0, paidOut: 0 },
    pct: 0,
    backers: 0,
    donations: 0,
    ledger: null,
    logos: [],
    funded: false,
    donationsEnabled: false,
  }))
) as unknown as Card[];

vi.mock("~/hooks/use-board", () => ({
  boardKey: ["board"],
  useBoard: () => ({
    data: { cards, totals: { raised: 0 }, flags: { aiSearch: true, tokensOk: false } },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("~/components/board/Hero", () => ({ default: () => null }));
vi.mock("~/components/board/PledgeBand", () => ({ default: () => null }));
vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
vi.mock("~/components/donate/DonateWidget", () => ({ default: () => null }));
const api = vi.fn();
vi.mock("~/lib/api", async (o) => ({
  ...(await o<typeof import("~/lib/api")>()),
  api: (...a: unknown[]) => api(...a),
}));
beforeEach(() => api.mockReset());

const at = (url: string) => {
  const router = createMemoryRouter([{ path: "/", element: <Board /> }], {
    initialEntries: [url],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
};

const findMatches = (q: string) => {
  fireEvent.change(screen.getByRole("textbox", { name: /security work/ }), {
    target: { value: q },
  });
  fireEvent.click(screen.getByRole("button", { name: "Find matches" }));
};

it("the phone Filters button is there from the first render, before the sheet code loads", () => {
  at("/");
  // synchronously: the stand-in, not a gap that fills in later
  expect(screen.getByRole("button", { name: "Filters (0)" })).toBeInTheDocument();
});

it("restores filters from the URL: count, pills and cards", async () => {
  at("/?cat=opsec&sort=newest");
  expect(screen.getAllByText("2 of 3 initiatives").length).toBeGreaterThan(0);
  expect(await screen.findByRole("combobox", { name: /Category/ })).toHaveTextContent("OpSec");
  expect(screen.queryByText("Alpha fuzzing")).toBeNull();
});

it("By category draws plain headings with a dot and a count", () => {
  at("/?sort=category");
  const h = screen.getByRole("heading", { name: /Fuzzing & Testing\s*1/ });
  expect(h.querySelector("span[aria-hidden]")).not.toBeNull();
  expect(screen.getByRole("heading", { name: /Wallets & Signing\s*1/ })).toBeInTheDocument();
});

it("AI order: Sort shows AI matches, filters still narrow, a manual sort clears it", async () => {
  api.mockResolvedValue({ matches: ["c"] });
  const router = at("/?sort=newest");
  findMatches("opsec things");
  await waitFor(() =>
    expect(screen.getAllByRole("combobox", { name: "Sort" })[0]).toHaveTextContent("AI matches")
  );
  expect(screen.getAllByText("AI pick")).toHaveLength(1);
  const sort = screen.getAllByRole("combobox", { name: "Sort" })[0];
  sort.focus();
  fireEvent.keyDown(sort, { key: "ArrowDown" });
  const opt = await screen.findByRole("option", { name: "Newest" });
  for (let i = 0; i < 8 && !opt.hasAttribute("data-highlighted"); i++) {
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 20));
  }
  fireEvent.keyDown(opt, { key: "Enter" });
  await waitFor(() => expect(screen.queryByText("AI pick")).toBeNull());
  expect(router.state.location.search).toContain("sort=newest");
});

it("filters still narrow the AI order", async () => {
  api.mockResolvedValue({ matches: ["a", "c"] });
  at("/?cat=opsec");
  findMatches("anything");
  await waitFor(() => expect(screen.getAllByText("AI pick")).toHaveLength(1));
  expect(screen.queryByText("Alpha fuzzing")).toBeNull();
});

it("Clear filters keeps the sort and the AI order", async () => {
  api.mockResolvedValue({ matches: ["b"] });
  const router = at("/?cat=opsec&status=open&sort=newest");
  findMatches("wallets");
  await screen.findByText("AI pick");
  fireEvent.click(
    screen.getAllByRole("button", { name: "Clear filters" })[0],
  );
  await waitFor(() => expect(router.state.location.search).toBe("?sort=newest"));
  expect(screen.getByText("AI pick")).toBeInTheDocument();
});

it("the phone Filters sheet applies its picks to the URL", async () => {
  const router = at("/?sort=newest");
  fireEvent.click(screen.getByRole("button", { name: "Filters (0)" }));
  const sheet = screen.getByRole("dialog", { name: "Filters" });
  fireEvent.click(within(sheet).getByRole("checkbox", { name: /OpSec/ }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Show 2 initiatives" }));
  await waitFor(() => expect(router.state.location.search).toBe("?cat=opsec&sort=newest"));
});

it("with nothing featured, the board orders by closest to funded and Sort has no Featured", () => {
  at("/");
  expect(screen.getAllByRole("combobox", { name: "Sort" })[0]).toHaveTextContent(
    "Closest to funded",
  );
  expect(screen.queryByText("Featured")).toBeNull();
});
