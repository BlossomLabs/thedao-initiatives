import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bytesToHex } from "viem";
import { api } from "~/lib/api";
import { usdK } from "~/lib/format";
import { confettiBurst } from "~/components/donate/Celebration";
import { encodeBallot } from "../../../shared/vote/ballot";
import { ROUND } from "../../../shared/vote/manifest";
import VoteResults from "./VoteResults";
import { liveInputsFrom, liveInputsJson } from "../../../shared/vote/live-inputs";
import { withGift } from "../../../shared/vote/next-tier";
import { jumps, threatOf } from "../../../shared/vote/threat";
import { effectiveRanks } from "../../../vote/shared/ranks";

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
    slugs: ["alpha", "beta"],
    // As on chain, each project's goalUsd is its goal.
    projects: [
      { goalUsd: "60000000000", rfp: false, groups: [] },
      { goalUsd: "30000000000", rfp: false, groups: [] },
    ],
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
  { id: "D", slug: "delta", title: "Delta reviews", goalUsd: 10_000, total: 0 },
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
    data: {
      cards: boardCards,
      totals: { raised: 10_000 },
      flags: { tokensOk: true },
      sponsors: [],
    },
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
// The donate form, down to its amount: what's typed goes to the page, as the real one's.
// A test round's form (test dollars) and the real one take the same amounts.
vi.mock("~/components/vote/TestDonate", async () => ({
  default: (await import("~/components/donate/DonateWidget")).default,
}));
vi.mock("~/components/donate/DonateWidget", async () => {
  const { parseUsd } = await import("~/lib/donate");
  return {
    default: (
      { onAmount, suggested, cap, onDonated, onConfirmed }: {
        onAmount?: (usd: number) => void;
        suggested?: { usd: number; label?: string } | { usd: number; label?: string }[];
        cap?: { usd: number; label?: string };
        onDonated?: (usd: number) => void;
        onConfirmed?: (r: { status: string; amountUsd: number }) => void;
      },
    ) => (
      <>
        <ul aria-label="Suggested amounts">
          {[suggested ?? []].flat().map((x) => <li key={x.usd}>${x.usd} {x.label}</li>)}
        </ul>
        {cap && <p data-cap="">${cap.usd} {cap.label}</p>}
        <input
          aria-label="Amount"
          type="number"
          // As the real form does: parseUsd, so a blank field is NaN.
          onChange={(e) => onAmount?.(parseUsd(e.currentTarget.value))}
        />
        <button
          type="button"
          // As both forms do once it goes through: the amount clears, then the page hears.
          onClick={(e) => {
            const field = e.currentTarget.previousElementSibling as HTMLInputElement;
            const usd = parseUsd(field.value);
            field.value = "";
            onAmount?.(Number.NaN);
            onDonated?.(usd);
            onConfirmed?.({ status: "confirmed", amountUsd: usd });
          }}
        >
          Donate
        </button>
      </>
    ),
  };
});
vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
vi.mock("~/components/donate/Celebration", () => ({ confettiBurst: vi.fn() }));
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

// Green rows' jumps, held back while a test wants to see them being worked out.
const jumpsGate = vi.hoisted(() => {
  const gate = { wait: Promise.resolve(), release: () => {}, hold: () => {} };
  gate.hold = () => {
    gate.wait = new Promise<void>((r) => (gate.release = r));
  };
  return gate;
});
vi.mock("../../../shared/vote/threat", async (original) => {
  const real = await original<typeof import("../../../shared/vote/threat")>();
  return {
    ...real,
    jumpsAsync: async (...a: Parameters<typeof real.jumpsAsync>) => {
      await jumpsGate.wait;
      return real.jumpsAsync(...a);
    },
  };
});
afterEach(() => {
  jumpsGate.release();
  jumpsGate.wait = Promise.resolve();
});
afterEach(cleanup);
// Some tests take Gamma and Delta into the round as well (`withFour`): back to two after.
const roundTwo = { slugs: [...ROUND.slugs], projects: [...ROUND.projects] };
afterEach(() => {
  ROUND.slugs.splice(0, Infinity, ...roundTwo.slugs);
  ROUND.projects.splice(0, Infinity, ...roundTwo.projects);
});
/** The round with Gamma and Delta in it too (initiatives 2 and 3). */
function withFour() {
  ROUND.slugs.push("gamma", "delta");
  ROUND.projects.push(
    { goalUsd: "10000000000", rfp: false, groups: [] },
    { goalUsd: "10000000000", rfp: false, groups: [] },
  );
}

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
    // The chain's asks: here goal less board raised (alpha $60K − $10K, beta $30K).
    asks: [usdMicro(50_000), usdMicro(30_000)],
    live: {
      funded: Object.keys(live),
      awards: Object.fromEntries(Object.entries(live).map(([k, [v]]) => [k, usdMicro(v)])),
      tiers: Object.fromEntries(Object.entries(live).map(([k, [, t]]) => [k, t])),
    },
    ...over,
  };
}

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

it("links a signed-in badge holder to their ballot", async () => {
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
    el?.tagName === "P" && /spent of the /.test(el.textContent ?? "")
  );
  // The board's list mounts with the closed round: wait for its cards.
  await screen.findAllByText("Beta audits");
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
  expect(hero(/\$80k spent of the \$100k demo pool/)).toBeInTheDocument();
  // Each tier heads its own section, with its count and what the vote gave it.
  expect(heading("S-Tier")).toHaveTextContent("S-Tier$30,000 allocated to 1 initiative");
  expect(heading("A-Tier")).toHaveTextContent("A-Tier$50,000 allocated to 1 initiative");
  // B-Tier funded nothing: no section, the hero says so.
  expect(heading("B-Tier")).toBeNull();
  expect(screen.getByText("B-Tier: no initiatives funded")).toBeInTheDocument();
  expect(screen.queryByText(/^[SA]-Tier: /)).toBeNull();
});

it("the final result: tier sections, then not funded", async () => {
  await showClosed();
  expect(screen.getByText("The vote's final result")).toBeInTheDocument();
  expect(heading("S-Tier")).toHaveTextContent("S-Tier$60,000 allocated to 1 initiative");
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
  expect(heading("S-Tier")).not.toBeNull();
  expect(heading("Not funded")).toBeNull();
});

it("spent of the pool uses the pool on-chain", async () => {
  await showClosed({ poolUsd: usdMicro(250_000) });
  expect(hero(/\$60k spent of the \$250k demo pool/)).toBeInTheDocument();
});

it("a tier that funded nothing says so", async () => {
  await showClosed();
  expect(screen.getByText("B-Tier: no initiatives funded")).toBeInTheDocument();
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
  expect(within(el).queryByRole("button", { name: /to [SAB]-Tier|ahead|Out of reach/ })).toBeNull();
  expect(el.querySelector(".cursor-help, .underline, .decoration-dotted")).toBeNull();
}

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
  expect(screen.queryByText(/to [SAB]-Tier/)).toBeNull();
  expect(screen.queryByText(/Out of reach/)).toBeNull();
  expect(document.querySelector("[data-what-if]")).toBeNull();
});

it.each(["/", "/?view=cards"])("not funded: its gap to B-Tier, no needed, in %s", async (url) => {
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
  // Raised $0 of a $30k ask, $12k to B-Tier: the tick at (0 + 12k) / 30k.
  expect(tickAt(row)).toBeCloseTo(40, 5);
  const callout = hover(row);
  expect(callout).toHaveTextContent("$12k to B-Tier");
  expect(callout).toHaveTextContent("Drops out of B-Tier: Alpha fuzzing");
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
  expect(callout).toHaveTextContent("Out of reach for B-Tier");
  expect(callout.style.right).toBe("calc(0% - 14px)");
});

it.each(["/", "/?view=cards"])(
  "closed S-Tier shows its lead in place of the chip in %s",
  async (url) => {
    await showClosed({ final: { next: {}, lead: { alpha: "46000000000" } } }, url);
    const row = rowOf("Alpha fuzzing");
    expect(within(row).queryByText("S-Tier")).toBeNull();
    // No tick for S-Tier: the callout sits at the bar's end.
    expect(tickAt(row)).toBeNull();
    const callout = hover(row);
    expect(callout).toHaveTextContent("$46k ahead");
    expect(callout).toHaveTextContent(
      "Its backers could give this much less between them and it would still be funded in S-Tier.",
    );
    expect(callout.style.right).toBe("calc(0% - 14px)");
    plainFigures(document.body);
  },
);

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

it("the hero says when B-Tier funds nothing yet", async () => {
  await showOpen(roundOf({ "1": ballot({ alpha: "S" }) }, { alpha: [50_000, "S"] }));
  expect(await screen.findByText(/B-Tier: nothing funded yet, the pool may not reach it\./))
    .toBeInTheDocument();
  cleanup();
  // Once a tier has started, the hero still says so; the round box says where it is.
  await showOpen(
    roundOf({ "1": ballot({ alpha: "S" }) }, { alpha: [50_000, "S"] }, {
      tiers: [
        { tier: "S", status: "settling", window: 1, windowEndsAt: 4_000_000_000 },
        waiting("A"),
        waiting("B"),
      ],
    }),
  );
  expect(await screen.findByText(/B-Tier: nothing funded yet/)).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Where the round is" })).toHaveTextContent(
    "S-Tier is settling",
  );
});

it("no B-Tier warning before anything is funded: no ballots yet", async () => {
  await showOpen(roundOf({}, {}));
  expect(await screen.findByText(/would be funded by 0 ballots/)).toBeInTheDocument();
  expect(screen.queryByText(/B-Tier: nothing funded yet/)).toBeNull();
});

// #104: while the pool is ETH not yet sold, its dollars are an estimate (they set the ballot
// minimum): the pages name it in ETH, the dollars only as "about".
const withPool = (pool: { eth: number; sold: boolean } | undefined) => {
  (ROUND as { pool?: { eth: number; sold: boolean } }).pool = pool;
};
afterEach(() => withPool(undefined));

it("the final result names an unsold pool in ETH, its dollars only as an estimate", async () => {
  withPool({ eth: 400, sold: false });
  await showClosed();
  const line = hero(/\$60k spent of the 400 ETH demo pool \(about \$100k\)/);
  expect(line).toBeInTheDocument();
  expect(line.textContent).not.toMatch(/of \$100k/);
  expect(screen.getByTitle(/its dollar value is an estimate/)).toBeInTheDocument();
});

it("once the pool is sold the final result names it in dollars", async () => {
  withPool({ eth: 400, sold: true });
  await showClosed();
  expect(hero(/\$60k spent of the \$100k demo pool$/)).toBeInTheDocument();
});

it("TheDAO's ballot names an unsold pool in ETH, as the hero does", async () => {
  withPool({ eth: 400, sold: false });
  await showOpen(roundOf({ "1": ballot({ alpha: "S" }) }, { alpha: [50_000, "S"] }));
  expect(
    await screen.findByText(/ of the 400 ETH demo pool \(about \$100,000\) if it ended now/),
  ).toBeInTheDocument();
});

it("TheDAO's ballot on a test round names the demo pool, as the hero does", async () => {
  await showOpen(roundOf({ "1": ballot({ alpha: "S" }) }, { alpha: [50_000, "S"] }));
  expect(await screen.findByText(/ of the \$\d[\d,]* demo pool if it ended now/))
    .toBeInTheDocument();
});

it("no warning while B-Tier funds something", async () => {
  await showOpen(roundOf({ "1": ballot({ alpha: "B" }) }, { alpha: [50_000, "B"] }));
  expect(screen.queryByText(/B-Tier: nothing funded yet/)).toBeNull();
});

/** The donation that moves an initiative up a tier, as the server sends it. */
const give = (over: Record<string, unknown> = {}) => ({
  tier: "S",
  gap: "9000000000",
  comesIn: [],
  dropsOut: [],
  moves: [],
  ...over,
});
/** An open round with `give` figures, and what one donation elsewhere takes to push each
 * of those in the tier settling now out of it (`null`: no threat found). */
function openWith(
  figures: Record<string, unknown> | undefined,
  live: Record<string, [number, "S" | "A" | "B"]> = { alpha: [50_000, "S"] },
  over: Record<string, unknown> = {},
  threat?: Record<string, string | null>,
) {
  const view = roundOf({ "1": ballot({ alpha: "S" }) }, live, over);
  return {
    ...view,
    live: { ...view.live, ...(figures ? { give: figures } : {}), ...(threat ? { threat } : {}) },
  };
}
const daoBallot = () => screen.getByRole("group", { name: /^TheDAO's ballot/ });
/** The list of what it takes to move up (the box above it names the closest ones too). */
const list = () => within(screen.getByRole("region", { name: /^What it takes to move up/ }));

it("while open: TheDAO's ballot beside what it takes each initiative to move up", async () => {
  await showOpen(openWith({ beta: give() }, undefined, {}, { alpha: usdMicro(4_000) }));
  expect(await screen.findByText(/would be funded by 1 ballot/)).toBeInTheDocument();
  // Where the round is: the stepper box in the header.
  const box = await screen.findByRole("region", { name: "Where the round is" });
  expect(within(box).getByRole("heading", { name: "Voting is open" })).toBeInTheDocument();
  // TheDAO's ballot: Alpha in S-Tier, if it settled now: neutral, not green (green is a
  // donation's preview here).
  const alpha = within(daoBallot()).getByLabelText(/^Alpha fuzzing, funded if it ended now/);
  expect(alpha).not.toHaveAttribute("data-live");
  expect(alpha.className).not.toContain("dao-green");
  // The call to action: Beta needs $9k donated to come into S-Tier.
  expect(screen.getByRole("heading", { name: "What it takes to move up" })).toBeInTheDocument();
  const row = list().getByRole("button", { name: /Beta audits/ });
  expect(row).toHaveTextContent("−$9k");
  expect(row).toHaveTextContent("to S-Tier");
  expect(row).toHaveTextContent("not included");
  expect(within(row).getByText("not included").className).toContain("text-[#ff8a88]");
  // Alpha, in S-Tier if it settled now, is in the list too, first: $4k given to another
  // initiative would push it out.
  const ahead = list().getByRole("button", { name: /Alpha fuzzing/ });
  expect(ahead).toHaveTextContent("$4k");
  expect(ahead).toHaveTextContent("$4kahead");
  expect(ahead).not.toHaveTextContent("−");
  // Where it is now, in green against Beta's red "not included" (#116).
  expect(within(ahead).getByText("now in S-Tier").className).toContain("text-[#a7e3a5]");
  const order = list().getAllByRole("button", { name: /Alpha fuzzing|Beta audits/ });
  expect(order.map((b) => b.textContent?.slice(0, 5))).toEqual(["Alpha", "Beta "]);
  // Only the round's initiatives.
  expect(screen.queryByText("Gamma outside")).toBeNull();
});

it("an open row's donate form stops at what the initiative still needs (#102)", async () => {
  await showOpen(openWith({ beta: give() }));
  const row = await list().findByRole("button", { name: /Beta audits/ });
  expect(row).toHaveTextContent("Needs $30,000");
  fireEvent.click(row);
  // The form gets the cap: what it still needs, "to be funded".
  await waitFor(() =>
    expect(document.querySelector("[data-cap]")).toHaveTextContent("$30000 to be funded")
  );
});

it("opening an initiative previews its donation on TheDAO's ballot", async () => {
  await showOpen(openWith({ beta: give({ dropsOut: [{ slug: "alpha", tier: "S" }] }) }));
  const ring = () => screen.getByRole("meter", { name: "What TheDAO allocated of the pool" });
  expect(ring().querySelector(".stroke-dao-green")).toBeNull();
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  const ballotNow = daoBallot();
  const joining = within(ballotNow).getByLabelText("Beta audits, comes in if you give $9,000");
  expect(joining).toHaveTextContent("+$9,000 if you give");
  // TheDAO's ring shows it too: a green stretch.
  expect(ring().querySelector(".stroke-dao-green")).not.toBeNull();
  // Dashed green: what your money brings in.
  expect(joining.className).toContain("border-dashed");
  expect(joining.className).toContain("border-dao-green");
  expect(within(ballotNow).getByLabelText("Alpha fuzzing, drops out")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "TheDAO's ballot, with your donation" }))
    .toBeInTheDocument();
  // The sentence, with the names set apart from the words in italics: green the one your
  // money brings in.
  const said = screen.getAllByText((_, el) =>
    el?.tagName === "P" &&
    /With your \$9,000, the initiative Beta audits comes into S-Tier\. 1 other initiative drops out\./
      .test(
        el.textContent ?? "",
      )
  );
  expect(said.length).toBeGreaterThan(0);
  expect(within(said[0]).getByText("Beta audits")).toHaveClass("text-[#a7e3a5]");
  expect(within(said[0]).getByText("Beta audits").tagName).toBe("I");
  // Who it is shows on TheDAO's ballot (struck through) and in the row: not here.
  expect(within(said[0]).queryByText("Alpha fuzzing")).toBeNull();
  // Clearing the preview closes it.
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByLabelText("Beta audits, comes in if you give $9,000")).toBeNull();
});

it("an amount typed and then removed leaves nothing on TheDAO's ballot (#100)", async () => {
  await showOpen(openWith({ beta: give() }));
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  expect(within(daoBallot()).getByLabelText("Beta audits, comes in if you give $9,000"))
    .toBeInTheDocument();
  const field = await screen.findByRole("spinbutton", { name: "Amount" });
  fireEvent.change(field, { target: { value: "12000" } });
  await waitFor(() =>
    expect(within(daoBallot()).getByLabelText("Beta audits, comes in if you give $12,000"))
      .toBeInTheDocument()
  );
  fireEvent.change(field, { target: { value: "" } });
  await waitFor(() => expect(within(daoBallot()).queryByText(/if you give/)).toBeNull());
});

// #100: a donation that went through stays green on TheDAO's ballot, solid, "+$X yours",
// and its row says so, so the voter can keep giving.
afterEach(() => localStorage.clear());

async function donateToBeta(usd: string) {
  const field = await screen.findByRole("spinbutton", { name: "Amount" });
  fireEvent.change(field, { target: { value: usd } });
  fireEvent.click(screen.getByRole("button", { name: "Donate" }));
}

it("a donation that went through stays green, solid, with '+$X yours'; its row says so", async () => {
  await showOpen(openWith({ beta: give() }));
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  await donateToBeta("9000");
  const chip = await within(daoBallot()).findByLabelText(
    "Beta audits, funded if it ended now, $9,000 of it yours",
  );
  expect(chip).toHaveTextContent("+$9,000 yours");
  expect(chip.className).toContain("border-dao-green");
  expect(chip.className).not.toContain("border-dashed");
  expect(within(daoBallot()).queryByText(/if you give/)).toBeNull();
  expect(document.querySelector("[data-yours]")).toHaveTextContent(
    "+$9,000 yours so far. You can keep giving.",
  );
});

it("after a donation, another amount is previewed dashed on top of what was given", async () => {
  await showOpen(openWith({ beta: give() }));
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  await donateToBeta("9000");
  await within(daoBallot()).findByText("+$9,000 yours");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Amount" }), {
    target: { value: "3000" },
  });
  expect(await within(daoBallot()).findByText("+$3,000 if you give")).toBeInTheDocument();
  // What it says counts both: the $9,000 isn't in the figures yet.
  expect(
    screen.getAllByText((_, el) =>
      el?.tagName === "P" && /^With your \$12,000, /.test(el.textContent ?? "")
    ).length,
  ).toBeGreaterThan(0);
  // Two donations add up.
  fireEvent.click(screen.getByRole("button", { name: "Donate" }));
  expect(await within(daoBallot()).findByText("+$12,000 yours")).toBeInTheDocument();
});

it("once the figures count the donation, the real result takes over, still '+$X yours'", async () => {
  const qc = new QueryClient();
  vi.mocked(api).mockResolvedValue(openWith({ beta: give() }));
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VoteResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  await donateToBeta("9000");
  await within(daoBallot()).findByText("+$9,000 yours");
  // Figures without it yet (Beta still asks $30K): still held where the preview put it.
  await act(() => qc.refetchQueries({ queryKey: ["vote-round"] }));
  expect(within(daoBallot()).getByText("+$9,000 yours")).toBeInTheDocument();
  // Counted: Beta asks $21K, and the live tally funds it in A-Tier, not where the preview had it.
  vi.mocked(api).mockResolvedValue(
    openWith(undefined, { alpha: [50_000, "S"], beta: [21_000, "A"] }, {
      asks: [usdMicro(50_000), usdMicro(21_000)],
    }),
  );
  await act(() => qc.refetchQueries({ queryKey: ["vote-round"] }));
  const chip = await within(daoBallot()).findByLabelText(
    "Beta audits, funded if it ended now, $9,000 of it yours",
  );
  expect(within(daoBallot()).getByRole("region", { name: /^A/ })).toContainElement(chip);
});

it("what was given is remembered in this browser, per round", async () => {
  await showOpen(openWith({ beta: give() }));
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  await donateToBeta("9000");
  await within(daoBallot()).findByText("+$9,000 yours");
  cleanup();
  await showOpen(openWith({ beta: give() }));
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  expect(await screen.findByText("+$9,000 yours so far. You can keep giving."))
    .toBeInTheDocument();
});

it("once S-Tier settles, the figures are to A-Tier and S-Tier's chips are gold", async () => {
  await showOpen(openWith({ alpha: give({ tier: "A", gap: "4000000000" }) }, {}, {
    tiers: [
      settled("S", ["beta"], { beta: usdMicro(30_000) }),
      {
        tier: "A",
        status: "settling",
        window: 1,
        windowEndsAt: 4_000_000_000,
        latestEndAt: 4_000_000_100,
        quiet: true,
        funded: [],
      },
      waiting("B"),
    ],
  }));
  expect(await screen.findByRole("heading", { name: "What it takes to move up" }))
    .toBeInTheDocument();
  expect(list().getByRole("button", { name: /Alpha fuzzing/ })).toHaveTextContent("−$4k");
  expect(list().getByRole("button", { name: /Alpha fuzzing/ })).toHaveTextContent("to A-Tier");
  const beta = within(daoBallot()).getByLabelText(/^Beta audits, funded/);
  expect(beta).toHaveAttribute("data-gold", "true");
});

it("what no donation alone brings in is counted at the end, shown on demand", async () => {
  await showOpen(openWith({ beta: give({ gap: null }) }));
  const more = await screen.findByRole("button", { name: "+ 1 more initiative" });
  expect(list().queryByRole("button", { name: /Beta audits/ })).toBeNull();
  fireEvent.click(more);
  expect(list().getByRole("button", { name: /Beta audits/ })).toHaveTextContent(
    "Out of reach for S-Tier",
  );
});

it("rows show the chain ask, not goal less board raised", async () => {
  // On chain, a pledge the board hasn't shown yet: Beta asks $25K, not $30K − $0.
  await showOpen(
    openWith({ beta: give() }, undefined, { asks: [usdMicro(50_000), usdMicro(25_000)] }),
  );
  const row = await list().findByRole("button", { name: /Beta audits/ });
  expect(row).toHaveTextContent("Needs $25,000");
  expect(row).not.toHaveTextContent("$30,000");
});

it("without the chain's asks, rows show no ask", async () => {
  await showOpen(openWith({ beta: give() }, undefined, { asks: undefined }));
  const row = await list().findByRole("button", { name: /Beta audits/ });
  expect(row).not.toHaveTextContent("Needs");
  expect(row).toHaveTextContent("not included");
});

it("asks served the wrong length read as none: rows show no ask", async () => {
  // One ask too many: none of them can be trusted to belong to its initiative.
  const asks = [usdMicro(50_000), usdMicro(25_000), usdMicro(1_000)];
  await showOpen(openWith({ beta: give() }, undefined, { asks }));
  const row = await list().findByRole("button", { name: /Beta audits/ });
  expect(row).not.toHaveTextContent("Needs");
  expect(row).toHaveTextContent("not included");
});

it("says so while the figures are worked out", async () => {
  await showOpen(openWith(undefined));
  expect(await screen.findByText("Working out what each initiative needs…")).toBeInTheDocument();
});

it("the ballot editor's search box filters the list", async () => {
  await showOpen(openWith({ alpha: give({ gap: "2000000000" }), beta: give() }, {}));
  expect(await list().findByRole("button", { name: /Alpha fuzzing/ })).toBeInTheDocument();
  expect(screen.getByText("Open initiatives")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "beta" } });
  // The box filters a moment after typing.
  await waitFor(() => expect(list().queryByRole("button", { name: /Alpha fuzzing/ })).toBeNull());
  expect(screen.getByText(/^1 of 2 initiatives/)).toBeInTheDocument();
  expect(list().getByRole("button", { name: /Beta audits/ })).toBeInTheDocument();
});

it("beside the round box: the three closest to the tier settling now", async () => {
  // Four initiatives in the round: three close, one out of reach.
  await showOpen(openWith({
    alpha: give({ gap: "12000000000" }),
    beta: give({ gap: "3000000000" }),
  }, {}));
  const box = await screen.findByRole("region", { name: "Closest to S-Tier" });
  const picks = within(box).getAllByRole("button");
  // Closest first, each with what it misses.
  expect(picks.map((b) => b.textContent)).toEqual(["Beta audits−$3k", "Alpha fuzzing−$12k"]);
  expect(box).toHaveTextContent("1 initiative is within $10k of S-Tier.");
  expect(within(box).getByRole("link", { name: "See all 2 ↓" })).toHaveAttribute(
    "href",
    "#give-heading",
  );
  // Picking one opens it in the list, with its preview on TheDAO's ballot.
  fireEvent.click(picks[0]);
  expect(list().getByRole("button", { name: /Beta audits/, expanded: true })).toBeInTheDocument();
  expect(within(daoBallot()).getByLabelText("Beta audits, comes in if you give $3,000"))
    .toBeInTheDocument();
});

it("a donation that moves another initiative says so, and shows it in its new tier", async () => {
  // Beta, not funded, comes into B-Tier with $9k; Alpha moves from S-Tier to A-Tier.
  await showOpen(openWith({
    beta: give({ tier: "B", moves: [{ slug: "alpha", from: "S", to: "A" }] }),
  }));
  const row = await list().findByRole("button", { name: /Beta audits/ });
  expect(row).toHaveTextContent("to B-Tier");
  fireEvent.click(row);
  const said = screen.getAllByText((_, el) =>
    el?.tagName === "P" &&
    /comes into B-Tier\. 1 other initiative changes place\./.test(el.textContent ?? "")
  );
  expect(said.length).toBeGreaterThan(0);
});

it("an opened row says what else its donation changes, a link opens who", async () => {
  await showOpen(openWith({
    beta: give({
      moves: [{ slug: "alpha", from: "S", to: "A" }],
      dropsOut: [{ slug: "gamma", tier: "B" }],
    }),
  }));
  const row = await list().findByRole("button", { name: /Beta audits/ });
  // Not under its title (the opened row says it).
  expect(row).not.toHaveTextContent("drops out");
  fireEvent.click(row);
  // The row's sentence says how many; the link opens who.
  const link = screen.getByRole("button", { name: "moves 2 other initiatives" });
  expect(link.closest("p")).toHaveTextContent(
    "$9,000 more brings it into S-Tier if the vote ended now, and moves 2 other initiatives.",
  );
  expect(link).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(link);
  expect(link).toHaveAttribute("aria-expanded", "true");
  const lines = (await screen.findAllByText(/S-Tier → A-Tier|drops out of B-Tier/)).map((el) =>
    el.closest("li")!.textContent
  );
  expect(lines).toEqual(["↓Alpha fuzzingS-Tier → A-Tier", "↓gammadrops out of B-Tier"]);
  // On TheDAO's ballot: Alpha in A-Tier, from S-Tier.
  expect(within(daoBallot()).getByLabelText("Alpha fuzzing, moves down from S-Tier"))
    .toBeInTheDocument();
});

it("a donation that changes nothing else has no link to who", async () => {
  await showOpen(openWith({ beta: give() }));
  const row = await list().findByRole("button", { name: /Beta audits/ });
  expect(row).not.toHaveTextContent("moves");
  fireEvent.click(row);
  expect(
    screen.getAllByText((_, el) =>
      el?.tagName === "P" &&
      el.textContent === "$9,000 more brings it into S-Tier if the vote ended now."
    ),
  ).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /other initiative/ })).toBeNull();
});

it("green rows show ahead amounts and hide rows without a checked amount until expanded", async () => {
  withFour();
  await showOpen(
    openWith({}, { alpha: [20_000, "S"], beta: [20_000, "S"], gamma: [10_000, "S"] }, {}, {
      alpha: usdMicro(12_000),
      beta: usdMicro(1_000),
      gamma: null,
    }),
  );
  expect(list().queryByRole("button", { name: /Gamma outside/ })).toBeNull();
  // Three: two show, the link shows the third with its amount left blank.
  fireEvent.click(await list().findByRole("button", { name: "+ 1 more initiative" }));
  const order = list().getAllByRole("button", { name: /Alpha fuzzing|Beta audits|Gamma/ });
  expect(order.map((b) => b.textContent?.slice(0, 5))).toEqual(["Beta ", "Alpha", "Gamma"]);
  expect(order[0]).toHaveTextContent("$1kahead");
  expect(order[1]).toHaveTextContent("$12kahead");
  expect(order[2].querySelector("[data-figure]")).toHaveTextContent(/^$/);
  expect(order[2]).not.toHaveTextContent("ahead");
  expect(order[2].querySelector("b")).toBeNull();
});

it("a compact green pill keeps the exact checked amount in its title", async () => {
  await showOpen(openWith({}, { alpha: [20_000, "S"] }, {}, { alpha: usdMicro(12_340) }));
  const row = await list().findByRole("button", { name: /Alpha fuzzing/ });
  expect(row).toHaveTextContent("$12.3kahead");
  expect(row.querySelector("[data-figure]")).toHaveAttribute(
    "title",
    "$12,340 donated elsewhere could move it out of S-Tier; smaller amounts may also do so.",
  );
  fireEvent.click(row);
  expect(screen.getByText((_, el) =>
    el?.tagName === "P" &&
    el.textContent!.startsWith("A donation of $12,340")
  )).toHaveTextContent("Smaller donations may also do so.");
});

/** Four initiatives in S-Tier if it settled now, each a donation elsewhere from out. */
function fourGreen() {
  withFour();
  return openWith(
    {},
    {
      alpha: [20_000, "S"],
      beta: [20_000, "S"],
      gamma: [10_000, "S"],
      delta: [10_000, "S"],
    },
    {},
    {
      alpha: usdMicro(1_000),
      beta: usdMicro(2_000),
      gamma: usdMicro(3_000),
      delta: usdMicro(4_000),
    },
  );
}
const greenRows = () =>
  list().queryAllByRole("button", { name: /Alpha fuzzing|Beta audits|Gamma|Delta/ });

it("every green row with an ahead amount remains visible", async () => {
  await showOpen(fourGreen());
  await list().findByRole("button", { name: /Alpha fuzzing/ });
  expect(greenRows().map((b) => b.textContent?.slice(0, 5)))
    .toEqual(["Alpha", "Beta ", "Gamma", "Delta"]);
  expect(list().queryByRole("button", { name: /^Show |^\+ / })).toBeNull();
});

/** One checked green amount, one green row with none found, one red gap and one out of reach. */
function bothEnds() {
  withFour();
  return openWith(
    { gamma: give(), delta: give({ gap: null }) },
    { alpha: [20_000, "S"], beta: [20_000, "S"] },
    {},
    { alpha: usdMicro(1_000), beta: null },
  );
}

it("one bottom link expands and collapses both ends of the list", async () => {
  await showOpen(bothEnds());
  const more = await list().findByRole("button", { name: "+ 2 more initiatives" });
  expect(greenRows().map((b) => b.textContent?.slice(0, 5))).toEqual(["Alpha", "Gamma"]);
  expect(list().getAllByRole("button", { name: /^Show |^\+ / })).toHaveLength(1);
  expect(greenRows()[1].compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();
  expect(more).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(more);
  expect(greenRows().map((b) => b.textContent?.slice(0, 5)))
    .toEqual(["Alpha", "Beta ", "Gamma", "Delta"]);
  expect(greenRows()[1].querySelector("[data-figure]")).toHaveTextContent(/^$/);
  expect(greenRows()[3]).toHaveTextContent("Out of reach for S-Tier");
  const less = list().getByRole("button", { name: "Show fewer" });
  expect(less).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(less);
  expect(greenRows().map((b) => b.textContent?.slice(0, 5))).toEqual(["Alpha", "Gamma"]);
  expect(list().getByRole("button", { name: "+ 2 more initiatives" })).toBeInTheDocument();
});

it.each([
  { title: /Beta audits/, order: ["Alpha", "Beta ", "Gamma"] },
  { title: /Delta reviews/, order: ["Alpha", "Gamma", "Delta"] },
])("an open $title row remains visible when both ends are collapsed", async ({ title, order }) => {
  await showOpen(bothEnds());
  fireEvent.click(await list().findByRole("button", { name: "+ 2 more initiatives" }));
  fireEvent.click(list().getByRole("button", { name: title }));
  fireEvent.click(list().getByRole("button", { name: "Show fewer" }));
  expect(greenRows().map((b) => b.textContent?.slice(0, 5))).toEqual(order);
  expect(list().getByRole("button", { name: "+ 1 more initiative" })).toBeInTheDocument();
  // Closing the row puts it back behind the same link.
  fireEvent.click(list().getByRole("button", { name: title }));
  expect(greenRows().map((b) => b.textContent?.slice(0, 5))).toEqual(["Alpha", "Gamma"]);
  expect(list().getByRole("button", { name: "+ 2 more initiatives" })).toBeInTheDocument();
});

it("a filter reveals matching rows from both hidden ends", async () => {
  await showOpen(bothEnds());
  await list().findByRole("button", { name: "+ 2 more initiatives" });
  // Every title has an "a".
  fireEvent.change(list().getByRole("searchbox"), { target: { value: "a" } });
  await waitFor(() => expect(greenRows()).toHaveLength(4));
  expect(list().queryByRole("button", { name: /^Show |^\+ / })).toBeNull();
  fireEvent.change(list().getByRole("searchbox"), { target: { value: "" } });
  await waitFor(() => expect(greenRows()).toHaveLength(2));
  expect(list().getByRole("button", { name: "+ 2 more initiatives" })).toBeInTheDocument();
});

it("an open green row's sentence", async () => {
  await showOpen(
    openWith({}, { alpha: [20_000, "S"], beta: [20_000, "S"] }, {}, {
      alpha: usdMicro(1_000),
      beta: null,
    }),
  );
  const sentence = (start: string) =>
    screen.getAllByText((_, el) => el?.tagName === "P" && el.textContent!.startsWith(start));
  fireEvent.click(await list().findByRole("button", { name: /Alpha fuzzing/ }));
  const [one] = sentence("A donation of $1,000");
  expect(one).toHaveTextContent(
    "A donation of $1,000 to another initiative could move it out of S-Tier if the vote ended now.",
  );
  expect(one).not.toHaveTextContent("Beta");
  fireEvent.click(list().getByRole("button", { name: "+ 1 more initiative" }));
  fireEvent.click(list().getByRole("button", { name: /Beta audits/ }));
  const [included] = sentence("In S-Tier");
  expect(included).toHaveTextContent(
    "In S-Tier if the vote ended now. None of the donations to other initiatives we checked would move it out. Other amounts may still do so.",
  );
  expect(included).not.toHaveTextContent("Alpha");
  expect(included).not.toHaveTextContent(/safe|No single donation/);
  expect(one).toHaveTextContent("Smaller donations may also do so.");
});

it("a missing green figure stays blank without claiming donations were checked", async () => {
  withFour();
  await showOpen(
    openWith({}, { alpha: [20_000, "S"], beta: [20_000, "S"], gamma: [10_000, "S"] }, {}, {
      alpha: usdMicro(1_000),
      beta: null,
    }),
  );
  fireEvent.click(await list().findByRole("button", { name: "+ 1 more initiative" }));
  const order = list().getAllByRole("button", { name: /Alpha fuzzing|Beta audits|Gamma/ });
  expect(order.map((b) => b.textContent?.slice(0, 5))).toEqual(["Alpha", "Beta ", "Gamma"]);
  expect(order[2].querySelector("[data-figure]")).toHaveTextContent(/^$/);
  expect(order[2]).not.toHaveTextContent("safe");
  expect(order[2]).not.toHaveTextContent("ahead");
  fireEvent.click(order[2]);
  const [p] = screen.getAllByText((_, el) =>
    el?.tagName === "P" && el.textContent!.startsWith("In S-Tier")
  );
  expect(p).toHaveTextContent(
    "In S-Tier if it settled now. A donation lowers what it asks of the pool.",
  );
  expect(p).not.toHaveTextContent("with little to spare");
});

/** The live tally's inputs for the test round: Alpha ($50K) and Beta ($30K), one voter
 * with the $60K pool ranking Alpha first, Beta second. */
function inputsFor(costsK: [number, number]) {
  const ballots = [[1, 2]];
  return liveInputsJson({
    m: 2,
    costs: costsK.map((k) => BigInt(k) * 1_000_000_000n),
    voters: ["1"],
    weights: [60_000_000_000n],
    ranks: ballots.map((b) => effectiveRanks(b, 2)),
    ballots,
    poolUsd: 60_000_000_000n,
    spent: 0n,
    done: new Set(),
    withdrawn: new Set(),
  }, 0);
}

it("with the tally's inputs, any amount is previewed: money freed brings another in", async () => {
  // Alpha is in S-Tier; Beta doesn't fit in the $10K left.
  const view = openWith({ beta: give({ tier: "B", gap: "20000000000" }) });
  await showOpen({ ...view, live: { ...view.live, inputs: inputsFor([50, 30]) } });
  fireEvent.click(await list().findByRole("button", { name: /Alpha fuzzing/ }));
  const amount = await screen.findByRole("spinbutton", { name: "Amount" });
  // $5K frees too little: it only asks the pool for less (and Alpha, in S-Tier, has no threat found).
  fireEvent.change(amount, { target: { value: "5000" } });
  expect(
    await screen.findByText(
      "It asks the pool for $5,000 less. None of the donations to other initiatives we checked would move it out of S-Tier after this donation. Other amounts may still do so.",
    ),
  ).toBeInTheDocument();
  // $20K frees enough for Beta ($30K) to come in.
  fireEvent.change(amount, { target: { value: "20000" } });
  // Said once, above TheDAO's ballot, beside its preview (not again under the form).
  const said = await screen.findAllByText((_, el) =>
    el?.tagName === "P" &&
    /^With your \$20,000, Alpha fuzzing asks the pool for less\. 1 other initiative comes in\.$/
      .test(el.textContent ?? "")
  );
  expect(said).toHaveLength(1);
  expect(screen.queryByText(/if the vote ended now\. 1 other/)).toBeNull();
  expect(screen.getByRole("group", { name: "TheDAO's ballot, with your donation" }))
    .toBeInTheDocument();
  // Beta, brought in by the money freed: green, ↑ and "came in".
  const beta = within(daoBallot()).getByLabelText("Beta audits, comes in with your donation");
  expect(beta).toHaveTextContent("↑Beta auditscame in");
  expect(beta.className).toContain("border-dao-green/70");
});

it("without the chain's asks, the preview gives no amount, it says the figures are being worked out", async () => {
  const view = openWith({ beta: give({ tier: "B", gap: "20000000000" }) }, undefined, {
    asks: undefined,
  });
  await showOpen({ ...view, live: { ...view.live, inputs: inputsFor([50, 30]) } });
  fireEvent.click(await list().findByRole("button", { name: /Alpha fuzzing/ }));
  const amount = await screen.findByRole("spinbutton", { name: "Amount" });
  fireEvent.change(amount, { target: { value: "5000" } });
  expect(await screen.findByText("What it saves the pool is being worked out."))
    .toBeInTheDocument();
  expect(screen.queryByText(/asks the pool for \$/)).toBeNull();
});

it("a cleared amount previews nothing, and doesn't break the page", async () => {
  const view = openWith({ beta: give({ tier: "B", gap: "20000000000" }) });
  await showOpen({ ...view, live: { ...view.live, inputs: inputsFor([50, 30]) } });
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  const amount = await screen.findByRole("spinbutton", { name: "Amount" });
  fireEvent.change(amount, { target: { value: "5000" } });
  // What the form says for a blank field (parseUsd("") is NaN).
  fireEvent.change(amount, { target: { value: "" } });
  expect(screen.getByRole("heading", { name: "What it takes to move up" })).toBeInTheDocument();
  expect(screen.queryByText(/asks the pool for \$/)).toBeNull();
});

it("with the tally's inputs, the form suggests the donation to each tier above", async () => {
  // Beta ($30K) isn't funded: the pool has $10K left after Alpha.
  const view = openWith({ beta: give({ tier: "B", gap: "20000000000" }) });
  await showOpen({ ...view, live: { ...view.live, inputs: inputsFor([50, 30]) } });
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  const chips = within(await screen.findByRole("list", { name: "Suggested amounts" }))
    .getAllByRole("listitem").map((li) => li.textContent);
  // The lowest first; each one tier up, and every tier it can reach.
  expect(chips.length).toBeGreaterThan(0);
  expect(chips[0]).toMatch(/^\$\d+ to [SAB]-Tier$/);
  const usds = chips.map((t) => Number(t!.slice(1).split(" ")[0]));
  expect([...usds].sort((a, b) => a - b)).toEqual(usds);
});

it("a donation that only pushes others out says it drops them", async () => {
  await showOpen(openWith({
    beta: give({
      tier: "B",
      dropsOut: [{ slug: "alpha", tier: "S" }, { slug: "gamma", tier: "B" }],
    }),
  }));
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  // Red, as what drops out is.
  expect(screen.getByRole("button", { name: "drops 2 other initiatives" }).className)
    .toContain("text-[#ff8a88]");
  expect(screen.queryByRole("button", { name: /^moves/ })).toBeNull();
  // Above TheDAO's ballot too.
  expect(
    screen.getAllByText((_, el) =>
      el?.tagName === "P" && /2 other initiatives drop out\.$/.test(el.textContent ?? "")
    ),
  ).toHaveLength(1);
});

it("a donation that only brings others in says it brings them in, in green", async () => {
  await showOpen(openWith({ beta: give({ tier: "B", comesIn: [{ slug: "gamma", tier: "B" }] }) }));
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  const link = screen.getByRole("button", { name: "brings in another initiative" });
  expect(link.className).toContain("text-[#a7e3a5]");
  expect(
    screen.getAllByText((_, el) =>
      el?.tagName === "P" && /1 other initiative comes in\.$/.test(el.textContent ?? "")
    ),
  ).toHaveLength(1);
});

it("TheDAO's ring: the tier settling now and the later tiers in two neutrals, no ballot green", async () => {
  // Signed in with badge 1, whose ballot has Alpha: still no green here (green is a
  // donation's preview on this page).
  signedIn.address = "0x00000000000000000000000000000000000000aa";
  signedIn.badge = 1;
  await showOpen(roundOf({ "1": ballot({ alpha: "S" }) }, {
    alpha: [50_000, "S"],
    beta: [30_000, "A"],
  }));
  const ring = await screen.findByRole("meter", { name: "What TheDAO allocated of the pool" });
  expect(ring.querySelector(".stroke-dao-green")).toBeNull();
  // Alpha, S-Tier's, settling now (the lighter neutral); Beta, a later tier (dimmer).
  expect(ring.querySelector(".stroke-white\\/75")).not.toBeNull();
  expect(ring.querySelector(".stroke-white\\/30")).not.toBeNull();
  signedIn.address = null;
  signedIn.badge = null;
});

it("the donation's sentence sits under the tier table, above the legend", async () => {
  await showOpen(openWith({ beta: give() }));
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  const said = await screen.findByText((_, el) =>
    el?.tagName === "P" && /^With your \$9,000, the initiative Beta audits comes into S-Tier\./
      .test(el.textContent ?? "")
  );
  const table = daoBallot();
  const legend = screen.getByText("settling now");
  // After the table, before the legend, in the page's order.
  expect(table.compareDocumentPosition(said) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(said.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("TheDAO's ring, with a donation: green what the pool pays for it, its ask less the gift", async () => {
  // Beta needs $30K; $9K donated: the pool pays the other $21K.
  await showOpen(openWith({ beta: give() }));
  fireEvent.click(await list().findByRole("button", { name: /Beta audits/ }));
  const ring = screen.getByRole("meter", { name: "What TheDAO allocated of the pool" });
  expect(ring.getAttribute("aria-valuetext")).toContain("With your donation: $21,000.");
  expect(ring.querySelector(".stroke-dao-green")).not.toBeNull();
});

it("a covered project is listed as covered by donations, not under a tier", async () => {
  // Beta's ask is $0: covered when S-Tier settled, so it funded nothing and isn't "not funded".
  await showClosed({
    tiers: [
      { ...settled("S", ["alpha"], { alpha: usdMicro(60_000) }), covered: ["beta"] },
      settled("A", [], {}),
      settled("B", [], {}),
    ],
  });
  const box = screen.getByRole("region", { name: "Covered by donations" });
  expect(within(box).getByText("Beta audits")).toBeInTheDocument();
  expect(heading("Not funded")).toBeNull();
  expect(heading("S-Tier")).toHaveTextContent("S-Tier$60,000 allocated to 1 initiative");
});

it("covered projects are not counted as funded by the pool", async () => {
  await showClosed({
    tiers: [
      { ...settled("S", ["alpha"], { alpha: usdMicro(60_000) }), covered: ["beta"] },
      settled("A", [], {}),
      settled("B", [], {}),
    ],
  });
  expect(hero(/\$60k spent of the \$100k demo pool/)).toBeInTheDocument();
  expect(heading("S-Tier")).toHaveTextContent("1 initiative");
});

it("while open, a project covered now is covered for now, one covered at a settlement is final", async () => {
  const view = openWith({ beta: give() });
  await showOpen({
    ...view,
    tiers: [
      { ...settled("S", ["alpha"], { alpha: usdMicro(50_000) }), covered: ["beta"] },
      waiting("A"),
      waiting("B"),
    ],
    live: { ...view.live, covered: ["beta", "gamma"] },
  });
  const box = await screen.findByRole("region", { name: "Covered by donations" });
  expect(within(box).getByText("Beta audits")).toBeInTheDocument();
  const now = screen.getByRole("region", { name: "Covered by donations for now" });
  expect(within(now).getByText("gamma")).toBeInTheDocument();
  expect(within(now).queryByText("Beta audits")).toBeNull();
});

it("a donation that covers the whole ask reads as covered, not as dropping out", async () => {
  const view = openWith({ beta: give({ tier: "B", gap: "20000000000" }) });
  await showOpen({ ...view, live: { ...view.live, inputs: inputsFor([50, 30]) } });
  fireEvent.click(await list().findByRole("button", { name: /Alpha fuzzing/ }));
  fireEvent.change(await screen.findByRole("spinbutton", { name: "Amount" }), {
    target: { value: "50000" },
  });
  expect(
    await screen.findByText((_, el) =>
      el?.tagName === "P" &&
      /^With your \$50,000, Alpha fuzzing is covered by donations\. 1 other initiative comes in\.$/
        .test(el.textContent ?? "")
    ),
  ).toBeInTheDocument();
  const now = screen.getByRole("region", { name: "Covered by donations for now" });
  expect(within(now).getByText("Alpha fuzzing")).toBeInTheDocument();
  expect(within(daoBallot()).queryByLabelText(/Alpha fuzzing, drops out/)).toBeNull();
});

it("gaps from before the latest change say they are being updated; a project covered since leaves the list", async () => {
  // Beta's gap was searched before a donation covered it; the round view already has it
  // covered, and the gaps are a search behind.
  const view = openWith({ beta: give() });
  await showOpen({
    ...view,
    live: { ...view.live, covered: ["beta"], aheadStale: true },
  });
  expect(await screen.findByText(/Something changed on-chain: these figures are being updated/))
    .toBeInTheDocument();
  expect(list().queryByRole("button", { name: /Beta audits/ })).toBeNull();
  cleanup();
  // Searched again: no note.
  await showOpen(openWith({ beta: give() }));
  await list().findByRole("button", { name: /Beta audits/ });
  expect(screen.queryByText(/these figures are being updated/)).toBeNull();
});

it("while open, a withdrawn project is listed as Withdrawn, apart, with no donation gap", async () => {
  const view = openWith({ beta: give() });
  await showOpen({ ...view, live: { ...view.live, withdrawn: ["beta"] } });
  const box = await screen.findByRole("region", { name: "Withdrawn" });
  expect(within(box).getByText("Beta audits")).toBeInTheDocument();
  // Not under covered, and no row to donate to (its old gap is dropped).
  expect(screen.queryByRole("region", { name: /^Covered by donations/ })).toBeNull();
  expect(list().queryByRole("button", { name: /Beta audits/ })).toBeNull();
  expect(list().getByRole("button", { name: /Alpha fuzzing/ })).toBeInTheDocument();
});

it("once closed, a withdrawn project is apart from the tiers and not funded", async () => {
  await showClosed({
    tiers: [
      settled("S", ["alpha"], { alpha: usdMicro(60_000) }),
      settled("A", [], {}),
      // Alpha's flag says withdrawn, but it was funded in S-Tier: it shows as funded.
      { ...settled("B", [], {}), withdrawn: ["alpha", "beta"] },
    ],
  });
  const box = screen.getByRole("region", { name: "Withdrawn" });
  expect(within(box).getByText("Beta audits")).toBeInTheDocument();
  expect(within(box).queryByText("Alpha fuzzing")).toBeNull();
  expect(heading("S-Tier")).toHaveTextContent("S-Tier$60,000 allocated to 1 initiative");
  expect(heading("Not funded")).toBeNull();
});

describe("while the page is open", () => {
  /** The results page on its own QueryClient, refetched by `next`. */
  async function live(first: Record<string, unknown>) {
    const qc = new QueryClient();
    vi.mocked(api).mockResolvedValue(first);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <VoteResults />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText(/Test vote/i);
    return async (round: Record<string, unknown>) => {
      vi.mocked(api).mockResolvedValue(round);
      await act(() => qc.refetchQueries({ queryKey: ["vote-round"] }));
    };
  }

  it("an initiative the live tally moves just changes tier: no arrow, no tier name", async () => {
    const next = await live(openWith({}, { alpha: [50_000, "A"] }));
    await waitFor(() => within(daoBallot()).getByLabelText(/^Alpha fuzzing, funded/));
    await next(openWith({}, { alpha: [50_000, "S"], beta: [30_000, "B"] }));
    const s = await waitFor(() => {
      const s = within(daoBallot()).getByRole("region", { name: /^S · / });
      within(s).getByLabelText(/^Alpha fuzzing, funded/);
      return s;
    });
    expect(within(s).getByLabelText(/^Alpha fuzzing/)).not.toHaveTextContent(/↑|from|Tier/);
  });

  it("a donation's preview doesn't move the chips, on or off; the live tally does", async () => {
    // jsdom lays nothing out: a chip is 100px down per tier and 50px along per place in it.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const li = this.closest("li");
        const section = this.closest("section");
        return (li && section
          ? {
            left: [...li.parentElement!.children].indexOf(li) * 50,
            top: [...section.parentElement!.children].indexOf(section) * 100,
          }
          : { left: 0, top: 0 }) as DOMRect;
      },
    );
    const animate = vi.fn(() => ({ finished: Promise.resolve() }));
    Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true });
    try {
      const next = await live(
        openWith({ beta: give({ moves: [{ slug: "alpha", from: "S", to: "A" }] }) }),
      );
      const row = await list().findByRole("button", { name: /Beta audits/ });
      // The page loading isn't a move.
      expect(animate).not.toHaveBeenCalled();
      fireEvent.click(row);
      // The preview: Alpha marked in A-Tier, still, with its arrow and where it came from.
      expect(within(daoBallot()).getByLabelText("Alpha fuzzing, moves down from S-Tier"))
        .toHaveTextContent("from S-Tier");
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      await waitFor(() => within(daoBallot()).getByLabelText(/^Alpha fuzzing, funded/));
      expect(animate).not.toHaveBeenCalled();
      // The live tally moves Alpha down: now it moves.
      await next(openWith({}, { alpha: [50_000, "A"] }));
      await waitFor(() => expect(animate).toHaveBeenCalled());
    } finally {
      vi.restoreAllMocks();
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
    }
  });

  it("a gap a donation closes counts down, then flips to its checked threat", async () => {
    const next = await live(openWith({ alpha: give() }, {}));
    const alpha = () => list().getByRole("button", { name: /Alpha fuzzing/ });
    await waitFor(() => expect(alpha()).toHaveTextContent("−$9k"));
    await next(openWith({}, { alpha: [50_000, "S"] }, {}, { alpha: usdMicro(4_000) }));
    // Still red on its way down to $0, then green.
    expect(alpha().querySelector("[data-figure]")).toHaveAttribute("data-figure", "gap");
    await waitFor(() => expect(alpha()).toHaveTextContent("$4kahead"), {
      timeout: 3000,
    });
    expect(alpha().querySelector("[data-figure]")).toHaveAttribute("data-figure", "threat");
  });

  it("the vote finishing: gold, no confetti (that's for donations)", async () => {
    vi.mocked(confettiBurst).mockClear();
    const next = await live(
      roundOf({ "1": ballot({ alpha: "S" }) }, { alpha: [50_000, "S"] }, {
        tiers: [
          settled("S", ["alpha"], { alpha: usdMicro(50_000) }),
          settled("A", [], {}),
          waiting("B"),
        ],
      }),
    );
    expect(confettiBurst).not.toHaveBeenCalled();
    const closed = roundOf({ "1": ballot({ alpha: "S" }) }, {}, {
      closed: true,
      tiers: [
        settled("S", ["alpha"], { alpha: usdMicro(50_000) }),
        settled("A", [], {}),
        settled("B", [], {}),
      ],
    });
    await next(closed);
    // The hero's amount takes the gold light, and the funded cards glow tier by tier.
    await waitFor(() => expect(document.querySelector("[data-finished]")).not.toBeNull());
    expect(document.querySelector(".animate-gold-glow")).not.toBeNull();
    expect(confettiBurst).not.toHaveBeenCalled();
  });

  it("a page opened on a finished vote doesn't light up", async () => {
    vi.mocked(confettiBurst).mockClear();
    await showClosed();
    expect(confettiBurst).not.toHaveBeenCalled();
    expect(document.querySelector("[data-finished]")).toBeNull();
  });
});

describe("an open green row's jumps (worked out on the page from the tally's inputs)", () => {
  const K = 1_000_000_000n;
  /** Four in the round, both voters placing all four in S-Tier: Gamma ($30K) is in S-Tier
   * with a number, Delta ($20K) is in it with no threat found, Alpha and Beta ($40K) don't fit. */
  function greenInputs(weightsK: [number, number] = [25, 25], deltaK = 20) {
    const ballots = [[1, 1, 1, 1], [1, 1, 1, 1]];
    return liveInputsJson({
      m: 4,
      costs: [40, 40, 30, deltaK].map((k) => BigInt(k) * K),
      voters: ["1", "2"],
      weights: weightsK.map((w) => BigInt(w) * K),
      ranks: ballots.map((b) => effectiveRanks(b, 4)),
      ballots,
      poolUsd: 60n * K,
      spent: 0n,
      done: new Set(),
      withdrawn: new Set(),
    }, 0);
  }
  /** The round view serving those inputs: Gamma and Delta in S-Tier, Gamma's number served. */
  function greenRound(inputs = greenInputs()) {
    if (ROUND.slugs.length === 2) withFour();
    const view = openWith(
      {},
      { gamma: [30_000, "S"], delta: [20_000, "S"] },
      { asks: [40_000, 40_000, 30_000, 20_000].map(usdMicro) },
      { gamma: usdMicro(10_000), delta: null },
    );
    return { ...view, live: { ...view.live, inputs } };
  }
  /** Gamma's chips as the page should label them, from `jumps()` on the same inputs. */
  const expectedChips = (inputs: ReturnType<typeof greenInputs>) => {
    const { inp, first } = liveInputsFrom(inputs);
    return jumps(inp, first, 2).map((j) => {
      const usd = Number(j.usd / 1_000_000n);
      const t = j.threat === null ? null : Number(j.threat / 1_000_000n);
      return `$${usd} ${t === null ? "to stay ahead" : `+${usdK(t - 10_000).slice(1)} ahead`}`;
    });
  };
  const chips = () =>
    within(screen.getByRole("list", { name: "Suggested amounts" })).queryAllByRole("listitem")
      .map((li) => li.textContent);
  const WORKING = "Working out what a donation does…";
  const TYPED_WORKING = "Working out what it does…";
  const gammaRow = () => list().findByRole("button", { name: /Gamma outside/ });
  const pause = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

  it("an open green row suggests the donations at which its number jumps", async () => {
    const want = expectedChips(greenInputs());
    expect(want).toEqual(["$1000 +1k ahead", "$10000 to stay ahead"]);
    jumpsGate.hold();
    await showOpen(greenRound());
    fireEvent.click(await gammaRow());
    // Opened while the work is still under way: the usual chips, and a line saying so.
    expect(screen.getByText(WORKING)).toBeInTheDocument();
    expect(chips()).toEqual([]);
    jumpsGate.release();
    await waitFor(() => expect(chips()).toEqual(want));
    expect(screen.queryByText(WORKING)).toBeNull();
    // The cap stays: what it still needs.
    expect(document.querySelector("[data-cap]")).toHaveTextContent("$30000 to be funded");
  });

  it("the visible green rows are worked out before anything is opened", async () => {
    await showOpen(greenRound());
    await gammaRow();
    // The page works them out with nothing open.
    await pause(300);
    fireEvent.click(await gammaRow());
    expect(screen.queryByText(WORKING)).toBeNull();
    expect(chips()).toEqual(expectedChips(greenInputs()));
  });

  it("a row with no threat found has no jump chips", async () => {
    await showOpen(greenRound());
    fireEvent.click(await list().findByRole("button", { name: "+ 1 more initiative" }));
    fireEvent.click(list().getByRole("button", { name: /Delta reviews/ }));
    expect(chips()).toEqual([]);
    expect(screen.queryByText(WORKING)).toBeNull();
    expect(document.querySelector("[data-cap]")).toHaveTextContent("$20000 to be funded");
  });

  it("jump chips are worked out again when the round's inputs change", async () => {
    const qc = new QueryClient();
    vi.mocked(api).mockResolvedValue(greenRound());
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <VoteResults />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await gammaRow());
    await waitFor(() => expect(chips()).toEqual(expectedChips(greenInputs())));
    // Somebody voted: new figures, new chips.
    const next = greenInputs([30, 30], 25);
    const want = expectedChips(next);
    expect(want).not.toEqual(expectedChips(greenInputs()));
    vi.mocked(api).mockResolvedValue(greenRound(next));
    await act(() => qc.invalidateQueries());
    await waitFor(() => expect(chips()).toEqual(want));
  });

  it("closing a green row stops its work", async () => {
    const error = vi.spyOn(console, "error");
    try {
      jumpsGate.hold();
      await showOpen(greenRound());
      const row = await gammaRow();
      fireEvent.click(row);
      expect(screen.getByText(WORKING)).toBeInTheDocument();
      fireEvent.click(row);
      jumpsGate.release();
      await pause(300);
      expect(screen.queryByRole("list", { name: "Suggested amounts" })).toBeNull();
      expect(screen.queryByText(WORKING)).toBeNull();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("a typed amount on a green row says the new number", async () => {
    await showOpen(greenRound());
    fireEvent.click(await gammaRow());
    const { inp, first } = liveInputsFrom(greenInputs());
    const after = threatOf(withGift(inp, 2, 2000n * 1_000_000n), first, 2);
    const line = after === null
      ? "It asks the pool for $2,000 less. None of the donations to other initiatives we checked would move it out of S-Tier after this donation. Other amounts may still do so."
      : `It asks the pool for $2,000 less. A donation of ${
        "$" + Number(after! / 1_000_000n).toLocaleString("en-US")
      } elsewhere could then move it out of S-Tier. Smaller donations may also do so.`;
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Amount" }), {
      target: { value: "2000" },
    });
    // While it is worked out, the line says so.
    expect(screen.getByText(TYPED_WORKING)).toBeInTheDocument();
    expect(await screen.findByText(line, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(TYPED_WORKING)).toBeNull();
    // Cleared, then the same amount again: the same line at once.
    const amount = screen.getByRole("spinbutton", { name: "Amount" });
    fireEvent.change(amount, { target: { value: "" } });
    expect(screen.queryByText(line)).toBeNull();
    await pause(500);
    fireEvent.change(amount, { target: { value: "2000" } });
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it("no number for a blank, mistyped or covering amount", async () => {
    await showOpen(greenRound());
    fireEvent.click(await gammaRow());
    const amount = await screen.findByRole("spinbutton", { name: "Amount" });
    const said = () => screen.queryByText(/It asks the pool for|Working out what it does/);
    for (const value of ["", "abc"]) {
      fireEvent.change(amount, { target: { value } });
      await pause(500);
      expect(said()).toBeNull();
    }
    // Its whole ask: covered by donations, in no tier, no number.
    fireEvent.change(amount, { target: { value: "30000" } });
    expect(
      await screen.findByText((_, el) =>
        el?.tagName === "P" &&
        /^With your \$30,000, Gamma outside is covered by donations/.test(el.textContent ?? "")
      ),
    ).toBeInTheDocument();
    await pause(500);
    expect(said()).toBeNull();
    expect(screen.queryByText(/elsewhere could then move it out/)).toBeNull();
  });
});
