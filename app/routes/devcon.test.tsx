import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
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
const boardCards = [
  { id: "A", slug: "alpha", title: "Alpha fuzzing", goalUsd: 60_000, total: 10_000 },
  { id: "B", slug: "beta", title: "Beta audits", goalUsd: 30_000, total: 0 },
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
  useBoard: () => ({ data: { cards: boardCards, flags: {} } }),
}));
vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

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
  expect(await screen.findByText(/Devcon is voting/)).toBeInTheDocument();
  expect(await screen.findByText(/\$50,000/)).toBeInTheDocument();
  expect(screen.getByText(/1 ballot/)).toBeInTheDocument();
  expect(screen.getByText("Alpha fuzzing")).toBeInTheDocument();
});

it("an RPC hiccup keeps the last result and says how old it is", async () => {
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
  expect(await screen.findByText(/\$50,000/)).toBeInTheDocument();
  vi.mocked(api).mockRejectedValue(new Error("rpc down"));
  await act(() => qc.refetchQueries({ queryKey: ["devcon-ballots"] }).catch(() => {}));
  expect(screen.getByText(/\$50,000/)).toBeInTheDocument();
  expect(screen.getByText(/updated .* ago/i)).toBeInTheDocument();
});
