import type { AiSearchResult } from "../../shared/ai-search";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "~/lib/api-types";
import Board from "./board";

const searchMode = vi.hoisted(() => ({ automatic: false }));

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
    data: {
      cards,
      totals: { raised: 0 },
      flags: { aiSearch: true, aiSearchAuto: searchMode.automatic, tokensOk: false },
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("~/context/session", () => ({ useSession: () => ({ session: null, me: null }) }));
vi.mock("~/components/board/Hero", () => ({ default: () => null }));
vi.mock("~/components/board/PledgeBand", () => ({ default: () => null }));
vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
vi.mock("~/components/donate/DonateWidget", () => ({ default: () => null }));
const api = vi.fn();
vi.mock("~/lib/api", async (o) => ({
  ...(await o<typeof import("~/lib/api")>()),
  api: (...a: unknown[]) => api(...a),
}));
beforeEach(() => {
  api.mockReset();
  searchMode.automatic = false;
});

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
  fireEvent.change(screen.getByRole("searchbox", { name: /Search initiatives/ }), {
    target: { value: q },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
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

it("By category draws plain headings with a dot and what the category raised", () => {
  at("/?sort=category");
  const h = screen.getByRole("heading", { name: /Fuzzing & Testing\s*\$0 raised/ });
  expect(h.querySelector("span[aria-hidden]")).not.toBeNull();
  // 26px tall, the height BoardSkeleton holds for it
  expect(h).toHaveClass("text-[20px]", "leading-[26px]");
  expect(screen.getByRole("heading", { name: /Wallets & Signing\s*\$0 raised/ }))
    .toBeInTheDocument();
});

it("AI order: Sort shows AI matches, filters still narrow, a manual sort clears it", async () => {
  api.mockResolvedValue({ scores: [{ "id": "c", "score": 0.9 }], pickThreshold: 0.8 });
  const router = at("/?sort=newest&view=cards");
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
  api.mockResolvedValue({
    scores: [{ "id": "a", "score": 0.9 }, { "id": "c", "score": 0.9 }],
    pickThreshold: 0.8,
  });
  at("/?cat=opsec&view=cards");
  findMatches("anything cat:opsec");
  await waitFor(() => expect(screen.getAllByText("AI pick")).toHaveLength(1));
  expect(screen.queryByText("Alpha fuzzing")).toBeNull();
});

it("Clear filters keeps the sort and the AI order", async () => {
  api.mockResolvedValue({ scores: [{ "id": "b", "score": 0.9 }], pickThreshold: 0.8 });
  const router = at("/?cat=opsec&status=open&sort=newest&view=cards");
  findMatches("wallets cat:opsec funding:open");
  await screen.findByText("AI pick");
  fireEvent.click(
    screen.getAllByRole("button", { name: "Clear filters" })[0],
  );
  await waitFor(() => expect(router.state.location.search).toBe("?sort=newest&view=cards"));
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

it("a plain board is the list in sections by category", async () => {
  at("/");
  expect(screen.getAllByRole("combobox", { name: "Sort" })[0]).toHaveTextContent("By category");
  expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("heading", { name: /Fuzzing & Testing\s*\$0 raised/ }))
    .toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /OpSec\s*\$0 raised/ })).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
});

it("with nothing featured, Featured orders by closest to funded and Sort does not offer it", () => {
  at("/?sort=recommended");
  expect(screen.getAllByRole("combobox", { name: "Sort" })[0]).toHaveTextContent(
    "Closest to funded",
  );
  expect(screen.queryByText("Featured")).toBeNull();
});

describe("layout", () => {
  afterEach(() => localStorage.clear());

  it("the list is the plain URL, and the Cards button writes ?view=cards", async () => {
    const router = at("/?sort=newest");
    expect(await screen.findByText("Raised")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBe(3);
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    await waitFor(() => expect(router.state.location.search).toBe("?sort=newest&view=cards"));
    expect(screen.queryByText("Raised")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    await waitFor(() => expect(router.state.location.search).toBe("?sort=newest"));
  });

  it("a plain URL opens in the layout this device used last", async () => {
    at("/");
    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    expect(localStorage.getItem("thedao:board-layout")).toBe("cards");
    cleanup();
    const router = at("/");
    await waitFor(() => expect(router.state.location.search).toBe("?view=cards"));
  });
});

it("while the AI thinks, an empty keyword result says it is asking, not that nothing matches", async () => {
  let answer!: (v: AiSearchResult) => void;
  api.mockReturnValue(new Promise((r) => (answer = r)));
  at("/?view=cards");
  findMatches("tools that keep keys safe");
  expect(await screen.findByText("Asking AI for the best matches…")).toBeInTheDocument();
  expect(screen.queryByText(/No Initiatives match/)).toBeNull();
  await act(async () => {
    answer({ scores: [{ "id": "b", "score": 0.9 }], pickThreshold: 0.8 });
    await Promise.resolve();
  });
  expect(await screen.findByText("AI pick")).toBeInTheDocument();
});

it("nothing matches: no button of its own, the bar's Clear filters lights up and clears", async () => {
  const router = at("/?q=zzzz-nothing");
  expect(await screen.findByText(/No Initiatives match/)).toBeInTheDocument();
  const clears = screen.getAllByRole("button", { name: "Clear filters" });
  expect(clears).toHaveLength(2); // the bar's link: desktop row and phone line, no third
  for (const c of clears) expect(c.className).toContain("animate-shine");
  fireEvent.click(clears[0]);
  await waitFor(() => expect(router.state.location.search).toBe(""));
  expect(screen.queryByText(/No Initiatives match/)).toBeNull();
});

it("orders every proposal and labels the first three even with low scores", async () => {
  api.mockResolvedValue({
    scores: [{ id: "b", score: 0.7 }, { id: "a", score: 0.5 }, { id: "c", score: 0.1 }],
    pickThreshold: 0.8,
  });
  at("/?sort=newest&view=cards");
  findMatches("a weak match");
  await screen.findByText(/Initiatives ordered by relevance/);
  expect(
    [...document.querySelectorAll("[data-initiative-id]")].map((el) =>
      el.getAttribute("data-initiative-id")
    ),
  ).toEqual(["b", "a", "c"]);
  expect(screen.getAllByText("AI pick")).toHaveLength(3);
  expect(screen.getByText("70%")).toBeInTheDocument();
  expect(screen.getByText("50%")).toBeInTheDocument();
  expect(screen.getByText("10%")).toBeInTheDocument();
  expect(screen.getAllByRole("combobox", { name: "Sort" })[0]).toHaveTextContent("AI matches");
});

it("labels the first three and displays each score as a percentage", async () => {
  api.mockResolvedValue({
    scores: [{ id: "a", score: 0.9 }, { id: "b", score: 0.81 }, { id: "c", score: 0.8 }],
    pickThreshold: 0.8,
  });
  at("/?view=cards");
  findMatches("security");
  await waitFor(() => expect(screen.getAllByText("AI pick")).toHaveLength(3));
  const boundary = document.querySelector('[data-initiative-id="c"]')!;
  expect(within(boundary as HTMLElement).getByText("80%")).toBeInTheDocument();
});

it("list view uses score order and displays top-three percentages", async () => {
  api.mockResolvedValue({
    scores: [{ id: "b", score: 0.9 }, { id: "a", score: 0.8 }, { id: "c", score: 0.1 }],
    pickThreshold: 0.8,
  });
  at("/?view=list");
  findMatches("security work");
  await screen.findByText(/Initiatives ordered by relevance/);
  await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
  const rows = screen.getAllByRole("listitem");
  expect(rows.map((row) => within(row).getByRole("link").textContent)).toEqual([
    "Beta wallets",
    "Alpha fuzzing",
    "Gamma opsec",
  ]);
  expect(within(rows[0]).getAllByText("AI pick").length).toBeGreaterThan(0);
  expect(within(rows[1]).getAllByText("80%").length).toBeGreaterThan(0);
  expect(within(rows[2]).getAllByText("10%").length).toBeGreaterThan(0);
  localStorage.clear();
});

it("Jev searches as you type and sets keyword filtering aside during the debounce", async () => {
  searchMode.automatic = true;
  api.mockResolvedValue({
    scores: [{ id: "b", score: 0.9 }, { id: "a", score: 0.4 }, { id: "c", score: 0.1 }],
    pickThreshold: 0.8,
  });
  at("/?view=cards");
  fireEvent.change(screen.getByRole("searchbox", { name: /Search initiatives/ }), {
    target: { value: "tools that protect keys" },
  });
  expect(document.querySelectorAll("[data-initiative-id]")).toHaveLength(3);
  expect(api).not.toHaveBeenCalled();
  await screen.findAllByText("AI pick");
  expect(screen.queryByText(/Initiatives ordered by relevance/)).toBeNull();
  expect(api).toHaveBeenCalledTimes(1);
  expect(
    [...document.querySelectorAll("[data-initiative-id]")].map((el) =>
      el.getAttribute("data-initiative-id")
    ),
  ).toEqual(["b", "a", "c"]);
});

it("only the first three scored results get labels when there are more proposals", async () => {
  cards.push({
    ...cards[0],
    initiative: { ...cards[0].initiative, id: "d", slug: "d", title: "Delta" },
  });
  try {
    api.mockResolvedValue({
      scores: [{ id: "b", score: 0.95 }, { id: "d", score: 0.9 }, { id: "a", score: 0.85 }, {
        id: "c",
        score: 0.8,
      }],
      pickThreshold: 0.8,
    });
    at("/?view=cards");
    findMatches("security work");
    await screen.findByText(/Initiatives ordered by relevance/);
    expect(screen.getAllByText("AI pick")).toHaveLength(3);
    const fourth = document.querySelector('[data-initiative-id="c"]')!;
    expect(within(fourth as HTMLElement).queryByText("AI pick")).toBeNull();
    expect(within(fourth as HTMLElement).queryByText("80%")).toBeNull();
  } finally {
    cards.pop();
  }
});
