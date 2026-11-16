import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import VoteRound from "./VoteRound";

const ROUND = {
  round: {
    kind: "real",
    chainId: 1,
    contract: "0x1000000000000000000000000000000000000001",
    opensAt: 1,
    closesAt: 2,
    firstTallyAt: 1,
    projects: 3,
    poolUsd: "1000000",
    at: 1,
    by: "x",
  },
  pool: null,
};
const LIST = {
  initiatives: [
    { slug: "alpha", withdrawn: false, settledIn: null },
    { slug: "beta", withdrawn: true, settledIn: null },
    { slug: "gamma", withdrawn: false, settledIn: "S" },
  ],
};
const BATCH = { version: "1.0", chainId: "1", meta: { name: "x" }, transactions: [] };

const post = vi.fn();
/** What the list adds about the round: final (every tier settled), canWithdraw. */
const listState = vi.hoisted(() => ({ extra: {} as Record<string, unknown> }));
vi.mock("~/lib/api", async (o) => ({
  ...(await o<typeof import("~/lib/api")>()),
  api: (path: string) =>
    Promise.resolve(
      path === "/api/admin/vote-round/initiatives" ? { ...LIST, ...listState.extra } : ROUND,
    ),
}));
vi.mock("~/hooks/use-admin-api", () => ({ useAdminApi: () => post }));
vi.mock("~/hooks/use-board", () => ({
  useBoard: () => ({
    data: {
      cards: [
        { initiative: { slug: "alpha", title: "Alpha project" } },
        { initiative: { slug: "beta", title: "Beta project" } },
        { initiative: { slug: "gamma", title: "Gamma project" } },
      ],
    },
  }),
}));

const clicks: { name: string; href: string }[] = [];
beforeEach(() => {
  listState.extra = {};
  clicks.length = 0;
  post.mockReset().mockResolvedValue(BATCH);
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:batch"), revokeObjectURL: vi.fn() }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      clicks.push({ name: this.getAttribute("download") ?? "", href: this.href });
    },
  );
});
afterEach(() => vi.restoreAllMocks());

const mount = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <VoteRound />
    </QueryClientProvider>,
  );
const rowOf = async (title: string) =>
  (await screen.findByText(title)).closest("li") as HTMLElement;

it("withdrawing downloads the Safe batch for the initiative", async () => {
  mount();
  const row = await rowOf("Alpha project");
  fireEvent.click(within(row).getByRole("button", { name: "Withdraw from the vote" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/vote-round/withdraw", {
      json: { slug: "alpha", withdrawn: true },
    })
  );
  await waitFor(() =>
    expect(clicks).toEqual([{ name: "withdraw-alpha.json", href: "blob:batch" }])
  );
});

it("a withdrawn initiative offers the undo", async () => {
  mount();
  const row = await rowOf("Beta project");
  expect(within(row).getByText("Withdrawn")).toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "Undo withdrawal" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/vote-round/withdraw", {
      json: { slug: "beta", withdrawn: false },
    })
  );
  await waitFor(() => expect(clicks[0].name).toBe("undo-withdraw-beta.json"));
});

it("a settled initiative's button is off, with the reason", async () => {
  mount();
  const row = await rowOf("Gamma project");
  expect(within(row).getByRole("button", { name: "Withdraw from the vote" })).toBeDisabled();
  expect(within(row).getByText("Settled in S-Tier: it can't be withdrawn.")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

it("a round whose contract predates withdrawals says so, with no buttons", async () => {
  listState.extra = { canWithdraw: false, final: false };
  mount();
  expect(
    await screen.findByText(
      "This round's contract predates withdrawals: nothing can be withdrawn from it.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Withdraw from the vote" })).toBeNull();
});

it("once every tier has settled the card says the tally is final, with no buttons", async () => {
  listState.extra = { canWithdraw: true, final: true };
  mount();
  expect(
    await screen.findByText(
      "Every tier has settled: the vote's tally is final, nothing to withdraw from.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Withdraw from the vote" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Undo withdrawal" })).toBeNull();
});
