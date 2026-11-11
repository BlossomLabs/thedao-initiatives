import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  expect(await screen.findByText(/would be funded by 1 ballot.*Tier-S starts settling in/))
    .toBeInTheDocument();
  expect(await screen.findByText("Alpha fuzzing")).toBeInTheDocument();
  // The front page's board: its search box, only the round's initiatives, gold shares.
  expect(screen.getByRole("searchbox")).toBeInTheDocument();
  expect(screen.queryByText("Gamma outside")).toBeNull();
  // The list's title is the vote's, not the board's.
  expect(screen.getByText("If the vote ended now")).toBeInTheDocument();
  expect(screen.queryByText("Security initiatives looking for funding")).toBeNull();
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
    const s = (await screen.findAllByText("Tier-S"))[0];
    const a = (await screen.findAllByText("Tier-A"))[0];
    const funded = (element: HTMLElement) => element.closest("li, [data-initiative-id]")!;
    expect(within(funded(s) as HTMLElement).getByText("Beta audits")).toBeInTheDocument();
    expect(within(funded(a) as HTMLElement).getByText("Alpha fuzzing")).toBeInTheDocument();
    // List rows have separate desktop and mobile status slots.
    const rows = [...new Set(screen.getAllByText(/^Tier-[SAB]$/).map(funded))];
    expect(
      rows.map((row) => within(row as HTMLElement).getAllByText(/^Tier-[SAB]$/)[0].textContent),
    )
      .toEqual(["Tier-S", "Tier-A"]);
    expect(screen.queryByText("Tier-B")).toBeNull();
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
  expect(
    await screen.findByText(
      /Tier-S settled: \$30,000 to 1 initiative · Tier-A settling, window 2 ends .* UTC · Tier-B starts .* UTC/,
    ),
  ).toBeInTheDocument();
  const row = (title: string) => screen.getAllByText(title)[0].closest("li, [data-initiative-id]")!;
  expect(row("Beta audits").querySelector("[data-vote-fill]")).not.toBeNull();
  expect(row("Alpha fuzzing").querySelector("[data-vote-pending]")).not.toBeNull();
  expect(screen.getByText("if it settled now")).toBeInTheDocument();
});

const settled = (tier: string, funded: string[], awards: Record<string, string>) => ({
  tier,
  status: "settled",
  at: 1,
  forced: false,
  funded,
  awards,
});
/** A closed round: alpha funded in S with $60K, beta not, unless `tiers` says otherwise. */
async function showClosed(over: Record<string, unknown> = {}, url = "/") {
  vi.mocked(api).mockResolvedValue(
    roundOf({ "1": ballot({ alpha: "S" }) }, {}, {
      closed: true,
      tiers: [
        settled("S", ["alpha"], { alpha: usdMicro(60_000) }),
        settled("A", [], {}),
        settled("B", [], {}),
      ],
      ...over,
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText((_, el) =>
    el?.tagName === "P" && /pool spent/.test(el.textContent ?? "")
  );
}
/** The hero line: its words are split by the coloured "pool". */
const hero = (re: RegExp) =>
  screen.getByText((_, el) => el?.tagName === "P" && re.test(el.textContent ?? ""));
const heading = (name: string) => screen.queryByRole("heading", { name: new RegExp(`^${name}`) });

it("once B settles, the final result: spent of the pool, a section per tier", async () => {
  await showClosed({
    tiers: [
      settled("S", ["beta"], { beta: usdMicro(30_000) }),
      settled("A", ["alpha"], { alpha: usdMicro(50_000) }),
      settled("B", [], {}),
    ],
  });
  expect(hero(/\$80k of \$100k demo pool spent/)).toBeInTheDocument();
  // Each tier heads its own section, with its count and what the vote gave it.
  expect(heading("Tier-S")).toHaveTextContent("Tier-S$30,000 allocated to 1 initiative");
  expect(heading("Tier-A")).toHaveTextContent("Tier-A$50,000 allocated to 1 initiative");
  // Tier-B funded nothing: no section, the hero says so.
  expect(heading("Tier-B")).toBeNull();
  expect(screen.getByText("Tier-B: no initiatives funded")).toBeInTheDocument();
  expect(screen.queryByText(/^Tier-[SA]: /)).toBeNull();
});

it("the final result: tier sections, then not funded", async () => {
  await showClosed();
  expect(screen.getByText("The vote's final result")).toBeInTheDocument();
  expect(heading("Tier-S")).toHaveTextContent("Tier-S$60,000 allocated to 1 initiative");
  expect(heading("Not funded")).toHaveTextContent("Not funded1 initiative");
  // Beta wasn't funded: no "needed $X" (its bar's what-if says how close it came).
  expect(screen.getAllByText("Beta audits")[0].closest("li, [data-initiative-id]"))
    .not.toHaveTextContent(/needed/i);
  // The list's header names the final amount and no type column.
  // The tier sections read Initiative · Backers · Final, Not funded Initiative · Backers ·
  // Raised: no Funded column, the bars' what-ifs carry it.
  expect(screen.getAllByText("Final")).toHaveLength(1);
  expect(screen.getAllByText("Raised")).toHaveLength(1);
  expect(screen.getAllByText("Backers")).toHaveLength(2);
  expect(screen.queryByText("Needed")).toBeNull();
  expect(screen.queryByText("Funded")).toBeNull();
  expect(screen.queryByText("Type")).toBeNull();
});

it.each(["/", "/?view=cards"])("cards show the final amount only in %s", async (url) => {
  await showClosed({}, url);
  const card = (await screen.findAllByText("Alpha fuzzing"))[0].closest(
    "li, [data-initiative-id]",
  )!;
  // Alpha had $10K and the vote gave it $60K.
  expect(card).toHaveTextContent("$70k");
  const text = ["Alpha fuzzing", "Beta audits"].map((t) =>
    screen.getAllByText(t)[0].closest("li, [data-initiative-id]")!.textContent
  ).join(" ");
  expect(text).not.toMatch(/of \$\d/);
  expect(text).not.toMatch(/Qualified/);
  expect(text).not.toMatch(/Grant/i);
});

it("an empty list draws no heading", async () => {
  await showClosed({
    tiers: [
      settled("S", ["alpha", "beta"], { alpha: usdMicro(50_000), beta: usdMicro(30_000) }),
      settled("A", [], {}),
      settled("B", [], {}),
    ],
  });
  expect(heading("Tier-S")).not.toBeNull();
  expect(heading("Not funded")).toBeNull();
});

it("spent of the pool uses the pool on-chain", async () => {
  await showClosed({ poolUsd: usdMicro(250_000) });
  expect(hero(/\$60k of \$250k demo pool spent/)).toBeInTheDocument();
});

it("a tier that funded nothing says so", async () => {
  await showClosed();
  expect(screen.getByText("Tier-B: no initiatives funded")).toBeInTheDocument();
});

it("no search or filters on the final result", async () => {
  await showClosed();
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /filter/i })).toBeNull();
});

const gap = (over: Record<string, unknown> = {}) => ({
  tier: "S",
  gap: "41200000000",
  comesIn: [{ slug: "beta", tier: "A" }],
  dropsOut: [],
  moves: [],
  ...over,
});

/** The row (list) or card holding a title. */
const rowOf = (title: string) =>
  screen.getAllByText(title)[0].closest("li, [data-initiative-id]") as HTMLElement;
/** A mouse on the row or card: its what-if callout opens over the bar. */
function hover(el: HTMLElement): HTMLElement {
  fireEvent.pointerEnter(el, { pointerType: "mouse" });
  return el.querySelector("[data-vote-callout]") as HTMLElement;
}
/** The what-if tick's position on the bar, % of the ask, or null without one. */
const tickAt = (el: HTMLElement) => {
  const t = el.querySelector<HTMLElement>("[data-vote-tick][data-what-if]");
  return t ? parseFloat(t.style.left) : null;
};
/** No figure looks like a link: no button, underline or help cursor. */
function plainFigures(el: HTMLElement) {
  expect(within(el).queryByRole("button", { name: /to Tier-|ahead|Out of reach/ })).toBeNull();
  expect(el.querySelector(".cursor-help, .underline, .decoration-dotted")).toBeNull();
}

it.each(["/", "/?view=cards"])("an open round shows each initiative's gap in %s", async (url) => {
  const view = roundOf({ "1": ballot({ alpha: "A" }) }, { alpha: [50_000, "A"] });
  vi.mocked(api).mockResolvedValue({
    ...view,
    live: { ...view.live, next: { alpha: gap(), beta: gap({ gap: null, tier: "B" }) } },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findAllByText("Alpha fuzzing");
  const alpha = rowOf("Alpha fuzzing");
  // Alpha raised $10k of $60k and is $41.2k from Tier-S (the figure rounds it up to $42k,
  // the tick does not): the tick at 51.2/60.
  await waitFor(() => expect(tickAt(alpha)).toBeCloseTo((51_200 / 60_000) * 100, 5));
  const callout = hover(alpha);
  expect(callout).toHaveTextContent("$42k to Tier-S");
  expect(callout).toHaveTextContent("Comes in: Beta audits (Tier-A)");
  // Out of reach: no tick, the callout at the bar's end.
  const beta = rowOf("Beta audits");
  expect(tickAt(beta)).toBeNull();
  const reach = hover(beta);
  expect(reach).toHaveTextContent("Out of reach for Tier-B");
  expect(reach.style.right).toBe("calc(0% - 14px)");
  plainFigures(document.body);
});

it("the open vote's list has no Funded column; its tier sits after the title", async () => {
  const view = roundOf({ "1": ballot({ alpha: "A" }) }, { alpha: [50_000, "A"] });
  vi.mocked(api).mockResolvedValue({ ...view, live: { ...view.live, next: { alpha: gap() } } });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findAllByText("Alpha fuzzing");
  expect(screen.queryByText("Funded")).toBeNull();
  expect(screen.getAllByText("Backers").length).toBeGreaterThan(0);
  expect(within(rowOf("Alpha fuzzing")).getAllByText("Tier-A").length).toBeGreaterThan(0);
});

it("a funded card keeps its tier next to the gap", async () => {
  const view = roundOf({ "1": ballot({ alpha: "A" }) }, { alpha: [50_000, "A"] });
  vi.mocked(api).mockResolvedValue({
    ...view,
    live: { ...view.live, next: { alpha: gap(), beta: gap({ tier: "B" }) } },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/?view=cards"]}>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findAllByText("Alpha fuzzing");
  // The figure stays in the amount row, plain: the value big, the words small.
  const alpha = await waitFor(() => {
    const el = rowOf("Alpha fuzzing");
    expect(el.querySelector("[data-what-if-figure]")).toHaveTextContent("$42k to Tier-S");
    return el;
  });
  expect(within(alpha).getByText("Tier-A")).toBeInTheDocument();
  // Beta isn't funded: the gap alone.
  const beta = rowOf("Beta audits");
  const figure = beta.querySelector("[data-what-if-figure]")!;
  expect(figure).toHaveTextContent("$42k to Tier-B");
  // The gap names its tier too ("to Tier-B"); no chip outside it.
  expect(
    within(beta).queryAllByText(/^Tier-[SAB]$/).filter((e) => !figure.contains(e)),
  ).toEqual([]);
  // Its details are in the bar's callout, on hover.
  const details = hover(beta);
  expect(details).toHaveTextContent("$42k to Tier-B");
  expect(details).toHaveTextContent("Comes in: Beta audits (Tier-A)");
  plainFigures(document.body);
});

it("a result card funded from $0 shows its final amount in green", async () => {
  await showClosed({
    tiers: [
      settled("S", ["alpha", "beta"], { alpha: usdMicro(50_000), beta: usdMicro(30_000) }),
      settled("A", [], {}),
      settled("B", [], {}),
    ],
  }, "/?view=cards");
  const beta = (await screen.findAllByText("Beta audits"))[0].closest("[data-initiative-id]")!;
  const amount = within(beta as HTMLElement).getByText("$30k");
  expect(amount).toHaveClass("text-dao-green");
  expect(amount).not.toHaveClass("text-white/40");
});

it("a closed round shows no gap", async () => {
  // Even if the server still sent gaps, a closed round draws none.
  await showClosed({
    live: { funded: [], awards: {}, next: { alpha: gap(), beta: gap({ gap: null, tier: "B" }) } },
  });
  expect(screen.queryByText(/to Tier-/)).toBeNull();
  expect(screen.queryByText(/Out of reach/)).toBeNull();
  expect(document.querySelector("[data-what-if]")).toBeNull();
});

it.each(["/", "/?view=cards"])("not funded: its gap to Tier-B, no needed, in %s", async (url) => {
  await showClosed({
    final: {
      next: {
        beta: gap({
          tier: "B",
          gap: "12000000000",
          comesIn: [],
          dropsOut: [{ slug: "alpha", tier: "B" }],
        }),
      },
      lead: {},
    },
  }, url);
  const row = rowOf("Beta audits");
  expect(row).not.toHaveTextContent(/needed/i);
  // Raised $0 of a $30k ask, $12k to Tier-B: the tick at (0 + 12k) / 30k.
  expect(tickAt(row)).toBeCloseTo(40, 5);
  const callout = hover(row);
  expect(callout).toHaveTextContent("$12k to Tier-B");
  expect(callout).toHaveTextContent("Drops out of Tier-B: Alpha fuzzing");
  plainFigures(document.body);
});

it("not funded and out of reach: no tick, the callout at the bar's end", async () => {
  await showClosed({
    final: { next: { beta: gap({ tier: "B", gap: null }) }, lead: {} },
  });
  const row = rowOf("Beta audits");
  expect(row).not.toHaveTextContent(/needed/i);
  expect(tickAt(row)).toBeNull();
  const callout = hover(row);
  expect(callout).toHaveTextContent("Out of reach for Tier-B");
  expect(callout.style.right).toBe("calc(0% - 14px)");
});

it.each(["/", "/?view=cards"])(
  "closed Tier-S shows its lead in place of the chip in %s",
  async (url) => {
    await showClosed({ final: { next: {}, lead: { alpha: "46000000000" } } }, url);
    const row = rowOf("Alpha fuzzing");
    expect(within(row).queryByText("Tier-S")).toBeNull();
    // No tick for Tier-S: the callout sits at the bar's end.
    expect(tickAt(row)).toBeNull();
    const callout = hover(row);
    expect(callout).toHaveTextContent("$46k ahead");
    expect(callout).toHaveTextContent(
      "Its backers could give this much less between them and it would still be funded in Tier-S.",
    );
    expect(callout.style.right).toBe("calc(0% - 14px)");
    plainFigures(document.body);
  },
);

it("an open round shows Tier-S leads", async () => {
  const view = roundOf({ "1": ballot({ alpha: "S" }) }, { alpha: [50_000, "S"] });
  vi.mocked(api).mockResolvedValue({
    ...view,
    live: { ...view.live, lead: { alpha: "12000000000" } },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/?view=cards"]}>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findAllByText("Alpha fuzzing");
  const card = await waitFor(() => {
    const el = rowOf("Alpha fuzzing");
    expect(el.querySelector("[data-what-if-figure]")).toHaveTextContent("$12k ahead");
    return el;
  });
  // Beside its tier chip.
  expect(within(card).getByText("Tier-S")).toBeInTheDocument();
  plainFigures(document.body);
});

async function showOpen(round: Record<string, unknown>) {
  vi.mocked(api).mockResolvedValue(round);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText(/Test vote/i);
}

it("the hero says when Tier-B funds nothing yet", async () => {
  await showOpen(roundOf({ "1": ballot({ alpha: "S" }) }, { alpha: [50_000, "S"] }));
  expect(await screen.findByText(/Tier-B: nothing funded yet, the pool may not reach it\./))
    .toBeInTheDocument();
  cleanup();
  // Once a tier has started, the stage line carries it too.
  await showOpen(
    roundOf({ "1": ballot({ alpha: "S" }) }, { alpha: [50_000, "S"] }, {
      tiers: [
        { tier: "S", status: "settling", window: 1, windowEndsAt: 4_000_000_000 },
        waiting("A"),
        waiting("B"),
      ],
    }),
  );
  expect(await screen.findByText(/Tier-S settling.*Tier-B: nothing funded yet/))
    .toBeInTheDocument();
});

it("no warning while Tier-B funds something", async () => {
  await showOpen(roundOf({ "1": ballot({ alpha: "B" }) }, { alpha: [50_000, "B"] }));
  expect(screen.queryByText(/Tier-B: nothing funded yet/)).toBeNull();
});
