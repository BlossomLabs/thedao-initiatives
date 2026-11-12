import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bytesToHex } from "viem";
import { api } from "~/lib/api";
import { encodeBallot } from "../../../shared/vote/ballot";
import VoteResults from "./VoteResults";

vi.mock("../../../shared/vote/manifest", async (original) => ({
  ...await original<typeof import("../../../shared/vote/manifest")>(),
  ROUND: {
    kind: "test",
    chainId: 11155111,
    contract: "0x1000000000000000000000000000000000000001",
    deployBlock: 1,
    opensAt: 0,
    closesAt: 4_000_000_000,
    schedule: { opensAt: 0, firstTallyAt: [100, 200, 300], initialWindow: 60, maxWindows: 3 },
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
        a[0] === "/api/vote/round"
          ? api(...a)
          : a[0] === "/api/vote/mine"
          ? Promise.resolve({ ids: signedIn.badge === null ? [] : [signedIn.badge] })
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
const usdMicro = (usd: number) => String(usd * 1_000_000);
const waiting = (tier: string) => ({ tier, status: "waiting", startsAt: 4_000_000_000 });
/** /api/vote/round with nothing settled yet: the live tally is everything. */
function roundOf(
  accepted: Record<string, string>,
  live: Record<string, [number, "S" | "A" | "B"]>,
  over: Record<string, unknown> = {},
) {
  return {
    registrationClosesAt: 4_000_000_000,
    closed: false,
    tiers: [waiting("S"), waiting("A"), waiting("B")],
    accepted,
    rejected: [],
    live: {
      funded: Object.keys(live),
      awards: Object.fromEntries(Object.entries(live).map(([k, [v]]) => [k, usdMicro(v)])),
      tiers: Object.fromEntries(Object.entries(live).map(([k, [, t]]) => [k, t])),
    },
    ...over,
  };
}

it("says what is going on and what the vote would fund right now", async () => {
  vi.mocked(api).mockResolvedValue(
    roundOf({ "1": ballot({ alpha: "S" }) }, { alpha: [50_000, "S"] }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/Test vote/i)).toBeInTheDocument();
  expect(await screen.findByText(/would be funded by 1 ballot/)).toBeInTheDocument();
  // Where the round is: the stepper box in the header, without a badge's line.
  const box = await screen.findByRole("region", { name: "Where the round is" });
  expect(within(box).getByRole("heading", { name: "Voting is open" })).toBeInTheDocument();
  expect(within(box).queryByRole("status")).toBeNull();
  expect(await screen.findByText("Alpha fuzzing")).toBeInTheDocument();
  // The front page's board: its search box, only the round's initiatives, gold shares.
  expect(screen.getByRole("searchbox")).toBeInTheDocument();
  expect(screen.queryByText("Gamma outside")).toBeNull();
  // Nothing has settled: it is all "if it settled now".
  await waitFor(() => expect(document.querySelector("[data-vote-pending]")).not.toBeNull());
});

it.each(["/vote", "/vote?view=cards"])(
  "orders the funded group by result tier in %s",
  async (url) => {
    vi.mocked(api).mockResolvedValue(
      roundOf({ "1": ballot({ alpha: "A", beta: "S" }) }, {
        beta: [30_000, "S"],
        alpha: [50_000, "A"],
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[url]}>
          <VoteResults />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // The result chips, not the round box's stepper (which names every tier too).
    const board = (els: HTMLElement[]) =>
      els.filter((e) => !e.closest('[aria-label="Where the round is"]'));
    const chip = (name: string) =>
      waitFor(() => {
        const found = board(screen.getAllByText(name))[0];
        expect(found).toBeDefined();
        return found;
      });
    const s = await chip("Tier-S");
    const a = await chip("Tier-A");
    const funded = (element: HTMLElement) => element.closest("li, [data-initiative-id]")!;
    expect(within(funded(s) as HTMLElement).getByText("Beta audits")).toBeInTheDocument();
    expect(within(funded(a) as HTMLElement).getByText("Alpha fuzzing")).toBeInTheDocument();
    // List rows have separate desktop and mobile status slots.
    const rows = [...new Set(board(screen.getAllByText(/^Tier-[SAB]$/)).map(funded))];
    expect(
      rows.map((row) => within(row as HTMLElement).getAllByText(/^Tier-[SAB]$/)[0].textContent),
    )
      .toEqual(["Tier-S", "Tier-A"]);
    expect(board(screen.queryAllByText("Tier-B"))).toEqual([]);
  },
);

it("an RPC hiccup keeps the last result", async () => {
  const qc = new QueryClient();
  vi.mocked(api).mockResolvedValue(
    roundOf({ "1": ballot({ alpha: "S" }) }, { alpha: [50_000, "S"] }),
  );
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/would be funded by 1 ballot/)).toBeInTheDocument();
  vi.mocked(api).mockRejectedValue(new Error("rpc down"));
  await act(() => qc.refetchQueries({ queryKey: ["vote-round"] }).catch(() => {}));
  expect(screen.getByText(/would be funded by 1 ballot/)).toBeInTheDocument();
  expect(screen.queryByText(/updated .* ago/i)).toBeNull();
});

it("links back to this browser's ballot, once it has opened one", async () => {
  vi.mocked(api).mockResolvedValue(roundOf({}, {}));
  const show = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <VoteResults />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  localStorage.clear();
  show();
  expect(await screen.findByText(/Test vote/i)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /your ballot/i })).toBeNull();
  cleanup();

  localStorage.setItem("vote-my-code:0x1000000000000000000000000000000000000001", "7.sig");
  show();
  expect(await screen.findByRole("link", { name: /see or change your ballot/i }))
    .toHaveAttribute("href", "/vote/7.sig");
  localStorage.clear();
});

it("links a signed-in badge holder to their ballot, even without the code in this browser", async () => {
  localStorage.clear();
  signedIn.address = "0x1111111111111111111111111111111111111111";
  signedIn.badge = 7;
  vi.mocked(api).mockResolvedValue(roundOf({}, {}));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("link", { name: /see or change your ballot/i }))
    .toHaveAttribute("href", "/vote/ballot");
  signedIn.address = null;
  signedIn.badge = null;
});

it("S settled is solid gold; A settling is lighter, with its window and B's start", async () => {
  vi.mocked(api).mockResolvedValue(
    roundOf({ "1": ballot({ alpha: "A", beta: "S" }) }, { alpha: [50_000, "A"] }, {
      tiers: [
        {
          tier: "S",
          status: "settled",
          at: 1,
          forced: false,
          funded: ["beta"],
          awards: { beta: usdMicro(30_000) },
        },
        {
          tier: "A",
          status: "settling",
          window: 2,
          windowEndsAt: 4_000_000_000,
          latestEndAt: 4_000_000_100,
          quiet: false,
          funded: ["alpha"],
        },
        waiting("B"),
      ],
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // The round box: Tier-S done with what it funded, Tier-A settling with its windows.
  const box = await screen.findByRole("region", { name: "Where the round is" });
  expect(within(box).getByRole("heading", { name: "Tier-A is settling" })).toBeInTheDocument();
  expect(box).toHaveTextContent("1 funded · $30k");
  expect([...box.querySelectorAll("[data-window]")].map((w) => w.getAttribute("data-window")))
    .toEqual(["past", "current", "coming"]);
  const row = (title: string) => screen.getAllByText(title)[0].closest("li, [data-initiative-id]")!;
  expect(row("Beta audits").querySelector("[data-vote-fill]")).not.toBeNull();
  expect(row("Alpha fuzzing").querySelector("[data-vote-pending]")).not.toBeNull();
  expect(screen.getByText("if it settled now")).toBeInTheDocument();
});

it("once B settles, the final result", async () => {
  const settled = (tier: string, funded: string[], awards: Record<string, string>) => ({
    tier,
    status: "settled",
    at: 1,
    forced: false,
    funded,
    awards,
  });
  vi.mocked(api).mockResolvedValue(
    roundOf({ "1": ballot({ alpha: "A", beta: "S" }) }, {}, {
      closed: true,
      tiers: [
        settled("S", ["beta"], { beta: usdMicro(30_000) }),
        settled("A", ["alpha"], { alpha: usdMicro(50_000) }),
        settled("B", [], {}),
      ],
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/Final result: \$80,000 to 2 initiatives/)).toBeInTheDocument();
});
