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
/** The pool card's read (#103): the contract's pool, the ETH price, the dates; and the
 * round's saved ETH. */
const poolState = vi.hoisted(() => ({
  chain: {} as Record<string, unknown>,
  pool: null as { eth: number; sold: boolean } | null,
}));
vi.mock("~/lib/api", async (o) => ({
  ...(await o<typeof import("~/lib/api")>()),
  api: (path: string) =>
    Promise.resolve(
      path === "/api/admin/vote-round/initiatives"
        ? { ...LIST, ...listState.extra }
        : path === "/api/admin/vote-round/pool-usd"
        ? poolState.chain
        : { ...ROUND, pool: poolState.pool },
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
const NOW = Math.floor(Date.now() / 1000);
beforeEach(() => {
  listState.extra = {};
  poolState.pool = { eth: 400, sold: false };
  poolState.chain = {
    poolUsd: "913244000000",
    ethUsd: 1813.5,
    lowerUntil: NOW + 86_400,
    closesAt: NOW + 2 * 86_400,
  };
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

it("switching rounds refreshes withdrawal support instead of keeping the old warning", async () => {
  listState.extra = { canWithdraw: false, final: false };
  mount();
  await screen.findByText(
    "This round's contract predates withdrawals: nothing can be withdrawn from it.",
  );
  const contract = "0x2000000000000000000000000000000000000002";
  post.mockImplementationOnce(() => {
    listState.extra = { canWithdraw: true, final: false };
    return Promise.resolve({ ...ROUND, round: { ...ROUND.round, contract } });
  });
  fireEvent.change(screen.getByLabelText("Round contract"), { target: { value: contract } });
  fireEvent.click(screen.getByRole("button", { name: "Run this round" }));
  const row = await rowOf("Alpha project");
  expect(within(row).getByRole("button", { name: "Withdraw from the vote" })).toBeEnabled();
  expect(
    screen.queryByText(
      "This round's contract predates withdrawals: nothing can be withdrawn from it.",
    ),
  ).toBeNull();
});

it("reading the same round again refreshes its withdrawal state", async () => {
  listState.extra = { canWithdraw: false, final: false };
  mount();
  await screen.findByText(
    "This round's contract predates withdrawals: nothing can be withdrawn from it.",
  );
  post.mockImplementationOnce(() => {
    listState.extra = { canWithdraw: true, final: false };
    return Promise.resolve(ROUND);
  });
  fireEvent.click(screen.getByRole("button", { name: "Read it again" }));
  const row = await rowOf("Alpha project");
  expect(within(row).getByRole("button", { name: "Withdraw from the vote" })).toBeEnabled();
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

// ------------------------------------------------------------------ the pool on-chain (#103)
const poolCard = async () =>
  (await screen.findByText("The pool on-chain")).closest("section") as HTMLElement;

it("the pool on-chain: the contract's dollars beside the live estimate, and how far off it is", async () => {
  mount();
  const card = await poolCard();
  await within(card).findByText("$913,244");
  expect(card.textContent).toContain("400 ETH at $1,813.50: $725,400");
  expect(card.textContent).toContain("The contract is 26% above the live estimate.");
});

it("setting the pool downloads the setPoolUsd batch for the round's admin", async () => {
  mount();
  const card = await poolCard();
  fireEvent.click(await within(card).findByRole("button", { name: "Use the estimate" }));
  expect((within(card).getByLabelText("New pool in dollars") as HTMLInputElement).value).toBe(
    "725400",
  );
  fireEvent.click(within(card).getByRole("button", { name: "Set the pool on-chain" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/vote-round/pool-usd", {
      json: { usd: 725400 },
    })
  );
  await waitFor(() => expect(clicks).toEqual([{ name: "pool-725400.json", href: "blob:batch" }]));
});

it("after S-Tier's first tally the pool can only go up: a lower amount is refused here", async () => {
  poolState.chain = { ...poolState.chain, lowerUntil: NOW - 60 };
  mount();
  const card = await poolCard();
  await within(card).findByText("$913,244");
  expect(card.textContent).toContain("S-Tier's first tally has passed: it can only go up now.");
  fireEvent.change(within(card).getByLabelText("New pool in dollars"), {
    target: { value: "800,000" },
  });
  expect(within(card).getByRole("button", { name: "Set the pool on-chain" })).toBeDisabled();
  fireEvent.change(within(card).getByLabelText("New pool in dollars"), {
    target: { value: "950000" },
  });
  expect(within(card).getByRole("button", { name: "Set the pool on-chain" })).toBeEnabled();
});

it("once voting closes the card only shows the contract's pool", async () => {
  poolState.chain = { ...poolState.chain, closesAt: NOW - 60, lowerUntil: NOW - 3600 };
  mount();
  const card = await poolCard();
  await within(card).findByText("$913,244");
  expect(card.textContent).toContain("Voting has closed; the pool can't change now.");
  expect(within(card).queryByRole("button", { name: "Set the pool on-chain" })).toBeNull();
});

it("without an ETH price, or with no ETH saved, there is no estimate", async () => {
  poolState.chain = { ...poolState.chain, ethUsd: null };
  const first = mount();
  const card = await poolCard();
  await within(card).findByText("$913,244");
  expect(card.textContent).toContain("The ETH price can't be read right now.");
  expect(within(card).queryByRole("button", { name: "Use the estimate" })).toBeNull();
  first.unmount();
  poolState.chain = { ...poolState.chain, ethUsd: 1813.5 };
  poolState.pool = null;
  mount();
  const again = await poolCard();
  await within(again).findByText("$913,244");
  expect(again.textContent).toContain("Save the pool's ETH above for a live estimate.");
});
