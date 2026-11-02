import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bytesToHex } from "viem";
import { api } from "~/lib/api";
import { encodeBallot } from "../../shared/devcon/ballot";
import Devcon from "./devcon";

vi.mock("../../shared/devcon/manifest", async (original) => ({
  ...await original<typeof import("../../shared/devcon/manifest")>(),
  DEVCON: {
    chainId: 11155111,
    contract: "0x1000000000000000000000000000000000000001",
    deployBlock: 1,
    opensAt: 0,
    closesAt: 4_000_000_000,
    poolUsd: "100000000000",
    issuer: "0x2000000000000000000000000000000000000002",
    slugs: ["alpha", "beta"],
  },
}));
const signedIn = vi.hoisted(() => ({
  address: null as string | null,
  badge: null as number | null,
}));
const boardCards = [
  { id: "A", slug: "alpha", title: "Alpha fuzzing", goalUsd: 60_000, total: 10_000 },
  { id: "B", slug: "beta", title: "Beta audits", goalUsd: 30_000, total: 0 },
  { id: "G", slug: "gamma", title: "Gamma outside", goalUsd: 10_000, total: 0 },
].map((c) => ({
  initiative: {
    id: c.id,
    slug: c.slug,
    title: c.title,
    summary: "",
    goalUsd: c.goalUsd,
    status: "approved",
    type: "grant",
    sortRank: null,
    safeAddress: "",
    categories: [],
    createdAt: 0,
    approvedAt: null,
  },
  summary: { pledged: 0, received: 0, donated: c.total, total: c.total, live: false },
  pct: (c.total / c.goalUsd) * 100,
  backers: 0,
  donations: 0,
  ledger: null,
  logos: [],
  funded: false,
  donationsEnabled: false,
}));
vi.mock("~/hooks/use-board", () => ({
  boardKey: ["board"],
  useBoard: () => ({
    data: { cards: boardCards, totals: { raised: 10_000 }, flags: {}, sponsors: [] },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("~/context/session", () => ({
  useSession: () => ({
    session: signedIn.address ? { address: signedIn.address } : null,
    me: null,
  }),
}));
vi.mock("~/components/board/PledgeBand", () => ({ default: () => null }));
vi.mock("~/components/donate/DonateWidget", () => ({ default: () => null }));
vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
vi.mock("~/lib/api", async (original) => {
  const api = vi.fn();
  return {
    ...await original<typeof import("~/lib/api")>(),
    api: Object.assign(
      (...a: unknown[]) =>
        a[0] === "/api/devcon/ballots"
          ? api(...a)
          : a[0] === "/api/devcon/mine"
          ? Promise.resolve({ n: signedIn.badge })
          : Promise.reject(new Error("not in test")),
      {
        mock: api.mock,
        mockResolvedValue: api.mockResolvedValue.bind(api),
        mockRejectedValue: api.mockRejectedValue.bind(api),
      },
    ),
  };
});

// The hero's count-up waits to be on screen.
vi.stubGlobal(
  "IntersectionObserver",
  class {
    constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
    observe() {
      this.cb([{ isIntersecting: true }]);
    }
    unobserve() {}
    disconnect() {}
  },
);

afterEach(cleanup);

const ballot = (t: Record<string, "S" | "A" | "B">) =>
  bytesToHex(encodeBallot(["alpha", "beta"], t));

it("says what is going on and what the vote would fund right now", async () => {
  vi.mocked(api).mockResolvedValue({
    at: 1,
    ballots: [{ tokenId: "1", ballot: ballot({ alpha: "S" }) }],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Devcon />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/Devcon 8 · demo vote/i)).toBeInTheDocument();
  expect(await screen.findByText(/would be funded by 1 ballot/)).toBeInTheDocument();
  expect(await screen.findByText("Alpha fuzzing")).toBeInTheDocument();
  // The front page's board: its search box, only the round's initiatives, gold shares.
  expect(screen.getByRole("searchbox")).toBeInTheDocument();
  expect(screen.queryByText("Gamma outside")).toBeNull();
  await waitFor(() => expect(document.querySelector("[data-vote-fill]")).not.toBeNull());
});

it("an RPC hiccup keeps the last result", async () => {
  const qc = new QueryClient();
  vi.mocked(api).mockResolvedValue({
    at: 1,
    ballots: [{ tokenId: "1", ballot: ballot({ alpha: "S" }) }],
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Devcon />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/would be funded by 1 ballot/)).toBeInTheDocument();
  vi.mocked(api).mockRejectedValue(new Error("rpc down"));
  await act(() => qc.refetchQueries({ queryKey: ["devcon-ballots"] }).catch(() => {}));
  expect(screen.getByText(/would be funded by 1 ballot/)).toBeInTheDocument();
  expect(screen.queryByText(/updated .* ago/i)).toBeNull();
});

it("links back to this browser's ballot, once it has opened one", async () => {
  vi.mocked(api).mockResolvedValue({ at: 1, ballots: [] });
  const show = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Devcon />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  localStorage.clear();
  show();
  expect(await screen.findByText(/Devcon 8 · demo vote/i)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /your ballot/i })).toBeNull();
  cleanup();

  localStorage.setItem("devcon-my-code:0x1000000000000000000000000000000000000001", "7.sig");
  show();
  expect(await screen.findByRole("link", { name: /see or change your ballot/i }))
    .toHaveAttribute("href", "/devcon/7.sig");
  localStorage.clear();
});

it("links a signed-in badge holder to their ballot, even without the code in this browser", async () => {
  localStorage.clear();
  signedIn.address = "0x1111111111111111111111111111111111111111";
  signedIn.badge = 7;
  vi.mocked(api).mockResolvedValue({ at: 1, ballots: [] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Devcon />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("link", { name: /see or change your ballot/i }))
    .toHaveAttribute("href", "/devcon/my-ballot");
  signedIn.address = null;
  signedIn.badge = null;
});
