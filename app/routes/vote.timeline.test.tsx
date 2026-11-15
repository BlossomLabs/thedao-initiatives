/**
 * The vote's pages as the chain moves on: the results (/vote), "your ballot"
 * (/vote/ballot) and its editor (/vote/ballot/edit), each mounted once and polled
 * through one round, from before it opens to its close.
 *
 * Each moment is a browser clock and the newest block a node has. The round view served
 * is the server's own: the real replay (replayRound) over a fake chain at that block,
 * as JSON (roundJson). So what the pages show is what the chain has confirmed, never
 * what the clock alone says: past a cutoff with no block after it, nothing moves yet.
 */
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bytesToHex, zeroHash } from "viem";
import { api } from "~/lib/api";
import { encodeBallot, type Tier } from "../../shared/vote/ballot";
import type { VoteManifest } from "../../shared/vote/manifest";
import {
  type BallotEvent,
  replayRound,
  roundJson,
  type RoundSource,
} from "../../shared/vote/replay-round";
import { transcriptOf } from "../../shared/vote/transcript";
import VoteResults from "~/components/vote/VoteResults";
import MyBallot from "./vote.ballot";

const ME = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

/** Opens at 1000; S-Tier's first tally at 2000, then A-Tier and B-Tier back to back.
 * Windows of 60, 30 and 15 s: a tier runs 105 s at most. Three initiatives asking $400
 * each, a $1,200 pool. */
const M = vi.hoisted(() =>
  ({
    kind: "test",
    chainId: 11155111,
    contract: "0x1000000000000000000000000000000000000001",
    deployBlock: 1,
    opensAt: 1000,
    closesAt: 2315,
    schedule: { opensAt: 1000, firstTallyAt: [2000, 2105, 2210], initialWindow: 60, maxWindows: 3 },
    poolUsd: "1200000000",
    slugs: ["alpha", "beta", "gamma"],
    projects: [0, 1, 2].map(() => ({ goalUsd: "400000000", rfp: false, groups: [] })),
    groups: [],
    independentTiers: 1,
    // A test dollar, so donations to the accounts below count (and are tally events).
    currencies: [
      {
        symbol: "USD",
        asset: "0x0000000000000000000000000000000000000000",
        usdFeed: "0x0000000000000000000000000000000000000000",
      },
      {
        symbol: "tUSD",
        asset: "0x3000000000000000000000000000000000000003",
        usdFeed: "0x0000000000000000000000000000000000000000",
      },
    ],
    accounts: [
      "0x00000000000000000000000000000000000000a1",
      "0x00000000000000000000000000000000000000b2",
      "0x00000000000000000000000000000000000000c3",
    ],
  }) as unknown as VoteManifest
);

vi.mock("../../shared/vote/manifest", async (original) => ({
  ...await original<typeof import("../../shared/vote/manifest")>(),
  ROUND: M,
}));
vi.mock("~/hooks/use-board", () => ({
  boardKey: ["board"],
  useBoard: () => ({
    data: {
      cards: ["alpha", "beta", "gamma"].map((slug) => ({
        initiative: {
          id: slug,
          slug,
          title: slug.toUpperCase(),
          summary: "",
          goalUsd: 400,
          status: "approved",
          type: "grant",
          sortRank: null,
          safeAddress: "",
          categories: [],
          createdAt: 0,
          approvedAt: null,
        },
        summary: { pledged: 0, received: 0, donated: 0, total: 0, live: false },
        pct: 0,
        backers: 0,
        donations: 0,
        ledger: null,
        logos: [],
        funded: false,
        donationsEnabled: false,
      })),
      totals: { raised: 0 },
      flags: {},
      sponsors: [],
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("~/context/session", () => ({
  useSession: () => ({ session: { address: ME }, signOut: vi.fn(), me: null }),
  sessionKey: () => ME,
}));
vi.mock("~/context/wallet", () => ({
  useWallet: () => ({ address: ME, isConnected: true }),
}));
vi.mock("~/context/wallet-picker", () => ({
  useWalletPicker: () => ({ openWalletPicker: vi.fn(), walletPickerOpen: false }),
}));
vi.mock("~/hooks/use-vote-send", async (original) => ({
  ...await original<typeof import("~/hooks/use-vote-send")>(),
  useBallotSubmit: () => ({
    phase: { kind: "idle" },
    submit: vi.fn(),
    retry: vi.fn(),
    selfSend: vi.fn(),
    last: null,
  }),
  useMintWait: () => ({ wait: () => Promise.resolve() }),
}));
vi.mock("~/components/board/PledgeBand", () => ({ default: () => null }));
vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));
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

// ------------------------------------------------------------------- the chain

const ballotOf = (t: Record<string, Tier>) => bytesToHex(encodeBallot(M.slugs, t));
/** One block a second (block b at time b). Badges 1 (mine) and 2 vote early; badge 3
 * puts gamma in S-Tier during S-Tier's first window, so a second window runs. */
const EVENTS: BallotEvent[] = [
  { tokenId: "1", block: 1100, ballot: ballotOf({ alpha: "S", beta: "A", gamma: "B" }) },
  { tokenId: "2", block: 1200, ballot: ballotOf({ alpha: "S", beta: "A", gamma: "B" }) },
  { tokenId: "3", block: 2030, ballot: ballotOf({ gamma: "S" }) },
].map((e) => ({ ...e, voter: e.tokenId === "1" ? ME : OTHER, nonce: 1, timestamp: e.block }));

/** What changes an ask or the pool on-chain, from its block on: a donation (a balance
 * change on a project's account), a pledge, or a pool change. */
type Change = {
  block: number;
  kind: "donation" | "pledge" | "pool";
  asks?: bigint[];
  pool?: bigint;
};
const USD = (n: number) => BigInt(n) * 1_000_000n;
const chain = { events: EVENTS, changes: [] as Change[] };

/** The chain as a node whose newest block is `head` sees it. */
function chainAt(head: number): RoundSource {
  const events = chain.events.filter((e) => e.block! <= head);
  const changes = chain.changes.filter((c) => c.block <= head);
  /** The asks and pool at block b: the last change at or before it. */
  const at = (b: number) => {
    let asks = [USD(400), USD(400), USD(400)];
    let pool = USD(1200);
    for (const c of changes) {
      if (c.block > b) break;
      if (c.asks) asks = c.asks;
      if (c.pool !== undefined) pool = c.pool;
    }
    return { asks, pool };
  };
  const blocksOf = (kinds: Change["kind"][], from: number, to: number) =>
    changes.filter((c) => kinds.includes(c.kind) && c.block >= from && c.block <= to)
      .map((c) => c.block);
  return {
    head: () => Promise.resolve({ block: head, timestamp: head }),
    blockBefore: (t) => {
      const b = Math.min(head, t - 1);
      return Promise.resolve({ block: b, timestamp: b });
    },
    stateAt: (b) => Promise.resolve({ timestamp: b, asks: at(b).asks, poolUsd: at(b).pool }),
    accountingEventBlocks: (from, to) => Promise.resolve(blocksOf(["pledge", "pool"], from, to)),
    balanceChangeBlocks: (from, to) => Promise.resolve(blocksOf(["donation"], from, to)),
    ballots: () => Promise.resolve({ events, block: BigInt(head) }),
    committed: (_block, tokenIds) => {
      const t = transcriptOf(
        events.map((e) =>
          "revoked" in e
            ? e
            : { tokenId: e.tokenId, voter: e.voter, nonce: BigInt(e.nonce), ballot: e.ballot }
        ),
      );
      return Promise.resolve({
        transcript: t.transcript,
        recordCount: BigInt(t.count),
        hashes: tokenIds.map((id) => t.lastHash.get(id.toString()) ?? zeroHash),
      });
    },
    rulesHistory: () => Promise.resolve({ addedAt: [], pool: [] }),
  };
}

/** What /api/vote/round serves at `wall` (the server's clock), the node at `head`. */
const served = { body: null as unknown };
async function serve(wall: number, head: number) {
  const st = await replayRound(M, chainAt(head), { now: wall, finalAfterSecs: 600 });
  served.body = roundJson(st, M.slugs);
}

// --------------------------------------------------------------------- the pages

let qc: QueryClient;
beforeEach(() => {
  chain.events = EVENTS;
  chain.changes = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  vi.mocked(api).mockReset().mockImplementation(
    ((path: string) => {
      if (path === "/api/vote/round") return Promise.resolve(structuredClone(served.body));
      if (path === "/api/vote/mine") return Promise.resolve({ ids: [1] });
      if (path.startsWith("/api/reviews/ratings")) return Promise.resolve({ ratings: {} });
      return Promise.reject(new Error("not in test: " + path));
    }) as typeof api,
  );
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  M.projects[2].goalUsd = "400000000";
  cleanup();
  vi.useRealTimers();
});

function mount(page: "results" | "ballot" | "editor") {
  const path = page === "results"
    ? "/vote"
    : page === "ballot"
    ? "/vote/ballot"
    : "/vote/ballot/edit";
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/vote" element={<VoteResults />} />
          <Route path="/vote/ballot/edit?" element={<MyBallot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Moves the browser's clock to `wall` and the chain to `head`; the page's next poll
 * (every 5 s) brings the new round view. */
async function moment(wall: number, head: number) {
  await serve(wall, head);
  vi.setSystemTime((wall - 5) * 1000);
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  await act(() => vi.advanceTimersByTimeAsync(10));
}

/** The round box: its title, its stepper's steps ("name sub", the current one marked). */
async function roundBox() {
  const box = (await screen.findAllByRole("region", { name: "Where the round is" }))[0];
  const steps = within(box).getAllByRole("listitem").map((li) =>
    `${li.getAttribute("aria-current") ? "▶ " : ""}${li.textContent}`
  );
  return {
    title: within(box).getAllByRole("heading")[0].textContent ?? "",
    steps,
    text: box.textContent ?? "",
    waiting: Boolean(box.querySelector("[data-waiting-for-chain]")),
  };
}
const current = (steps: string[]) => steps.find((s) => s.startsWith("▶ "))?.slice(2) ?? null;
/** The initiatives shown gold: what a settled tier funded, for good. */
const gold = () =>
  [
    ...new Set(
      [...document.querySelectorAll("[data-final-chip][data-gold]")].map((el) =>
        el.getAttribute("data-final-chip")
      ),
    ),
  ].sort();

// ------------------------------------------------------------------------ the round

/** The round, moment by moment: [clock, newest block, what the round box says]. */
type Expect = { title: RegExp; current: RegExp | null; waiting?: boolean; gold: string[] };
const TIMELINE: [string, number, number, Expect][] = [
  ["before opening", 990, 989, { title: /^Voting opens/, current: /^Voting/, gold: [] }],
  // The clock says open; the chain's newest block is still before 1000.
  ["opening by the clock only", 1001, 998, {
    title: /^Voting opens/,
    current: /^Voting/,
    waiting: true,
    gold: [],
  }],
  ["open", 1500, 1499, { title: /^Voting is open/, current: /^Voting/, gold: [] }],
  ["S-Tier window 1, quiet", 2010, 2009, {
    title: /^S-Tier is settling/,
    current: /^S-TierWindow 1 of 3/,
    gold: [],
  }],
  ["S-Tier changed in window 1", 2040, 2039, {
    title: /^S-Tier is settling/,
    current: /^S-TierWindow 1 of 3/,
    gold: [],
  }],
  // Window 1 ended by the clock at 2060; the newest block is at 2058.
  ["window 1 over by the clock only", 2063, 2058, {
    title: /^S-Tier is settling/,
    current: /^S-TierWindow 1 of 3/,
    waiting: true,
    gold: [],
  }],
  ["S-Tier window 2", 2064, 2060, {
    title: /^S-Tier is settling/,
    current: /^S-TierWindow 2 of 3/,
    gold: [],
  }],
  ["window 2 over by the clock only", 2095, 2088, {
    title: /^S-Tier is settling/,
    current: /^S-TierWindow 2 of 3/,
    waiting: true,
    gold: [],
  }],
  // The block at 2089: nothing before 2090 can still come. S-Tier settles, quiet.
  ["S-Tier settled", 2096, 2089, {
    title: /^S-Tier settled: 2 initiatives/,
    current: null,
    gold: ["alpha", "gamma"],
  }],
  ["A-Tier settling", 2120, 2119, {
    title: /^A-Tier is settling/,
    current: /^A-TierWindow 1 of 3/,
    gold: ["alpha", "gamma"],
  }],
  ["A-Tier settled", 2200, 2199, {
    title: /^A-Tier settled: 1 initiative/,
    current: null,
    gold: ["alpha", "beta", "gamma"],
  }],
  ["closed", 2320, 2319, {
    title: /^The vote has ended/,
    current: null,
    gold: ["alpha", "beta", "gamma"],
  }],
];

async function walk(check: (name: string, x: Expect) => Promise<void> | void, from = 0) {
  for (const [name, wall, head, x] of TIMELINE.slice(from)) {
    await moment(wall, head);
    await check(name, x);
  }
}

it("the server's view: judged at the newest block, a tier settles once the chain confirms it", async () => {
  await serve(2063, 2058);
  expect(served.body).toMatchObject({
    head: { timestamp: 2058 },
    tiers: [{ tier: "S", status: "settling", window: 1 }, { status: "waiting" }, {
      status: "waiting",
    }],
  });
  await serve(2096, 2089);
  expect(served.body).toMatchObject({
    tiers: [{ tier: "S", status: "settled", at: 2090, funded: ["alpha", "gamma"] }, {
      status: "waiting",
    }, { status: "waiting" }],
  });
});

it("the results page follows the chain: stepper, round box and gold, moment by moment", async () => {
  await serve(990, 989);
  vi.setSystemTime(990_000);
  mount("results");
  await walk(async (name, x) => {
    if (name === "closed") {
      // Over: the final result, tier by tier, in place of the live one.
      expect(await screen.findByText("The vote's final result")).toBeInTheDocument();
      expect(screen.getByText("$800.00 allocated to 2 initiatives")).toBeInTheDocument();
      expect(screen.getByText("$400.00 allocated to 1 initiative")).toBeInTheDocument();
      return;
    }
    const box = await roundBox();
    expect(box.title, name).toMatch(x.title);
    if (x.current) expect(current(box.steps), name).toMatch(x.current);
    else expect(current(box.steps), name).toBeNull();
    expect(box.waiting, name).toBe(Boolean(x.waiting));
    expect(gold(), name).toEqual(x.gold);
  });
});

it("your ballot follows the chain: the stepper, and gold for what its settled tiers funded", async () => {
  // From the opening on: before badge 1's ballot is on-chain, this page is the editor's.
  const open = TIMELINE.findIndex(([name]) => name === "open");
  await serve(1500, 1499);
  vi.setSystemTime(1_500_000);
  mount("ballot");
  expect(await screen.findByRole("button", { name: "Edit my ballot" })).toBeInTheDocument();
  await walk(async (name, x) => {
    const box = await roundBox();
    expect(box.title, name).toMatch(x.title);
    if (x.current) expect(current(box.steps), name).toMatch(x.current);
    else expect(current(box.steps), name).toBeNull();
    expect(box.waiting, name).toBe(Boolean(x.waiting));
    expect(gold(), name).toEqual(x.gold);
  }, open);
});

it("the editor follows the chain: Send waits for the opening, settled tiers lock as they settle", async () => {
  await serve(990, 989);
  vi.setSystemTime(990_000);
  mount("editor");
  const send = () => screen.queryByRole("button", { name: /send my ballot|resend my ballot/i });
  const settled = (t: Tier) =>
    document.querySelector(`[data-drop="${t}"]`)?.textContent?.includes("Settled") ?? false;
  await walk(async (name, x) => {
    const box = await roundBox();
    expect(box.title, name).toMatch(x.title);
    expect(box.waiting, name).toBe(Boolean(x.waiting));
    if (name === "before opening" || name === "opening by the clock only") {
      // The contract would refuse a ballot until a block reaches the opening.
      expect(send(), name).toBeNull();
      return;
    }
    if (name === "closed") return; // the closed ballot: no editor any more
    const s = x.gold.includes("alpha");
    expect(settled("S"), name).toBe(s);
    expect(settled("A"), name).toBe(x.gold.includes("beta"));
    if (s) {
      // Badge 1 paid for alpha with half of its share; gamma was badge 3's.
      expect(
        screen.getAllByRole("button", { name: /^ALPHA, funded: your share paid \$\d/ }).length,
        name,
      ).toBeGreaterThan(0);
    }
  });
  // Closed: the page shows the ballot that counted beside the result.
  expect(await screen.findByRole("heading", { name: "TheDAO's result" })).toBeInTheDocument();
});

// ------------------------------------------------------- events between the tallies

/** Somebody else votes, a donation covers a project, a pledge lowers an ask, the pool
 * grows, and in S-Tier's first window a donation changes what it funds. Gamma's goal is
 * $600 here, too much for badge 3's share alone until a donation lowers its ask. (A
 * donation that only takes an ask to $0 is no change to the window: covered projects
 * are left out of the comparison, vote/docs/quiet-ending-rules.md.) */
const OPEN_EVENTS: BallotEvent[] = [
  ...EVENTS.slice(0, 2),
  {
    tokenId: "3",
    block: 1600,
    ballot: ballotOf({ gamma: "S" }),
    voter: OTHER,
    nonce: 1,
    timestamp: 1600,
  },
];
const CHANGES: Change[] = [
  { block: 2, kind: "pledge", asks: [USD(400), USD(400), USD(600)] }, // gamma's $600 goal
  { block: 1700, kind: "donation", asks: [USD(400), USD(0), USD(600)] }, // beta covered
  { block: 1800, kind: "pledge", asks: [USD(100), USD(0), USD(600)] }, // $300 pledged to alpha
  { block: 1900, kind: "pool", pool: USD(1500) },
  { block: 2030, kind: "donation", asks: [USD(100), USD(0), USD(300)] }, // $300 to gamma
];

/** A table's tiers, read off its chips: slug → tier letter. */
function tiersIn(label: string) {
  const group = screen.getByRole("group", { name: label });
  const out: Record<string, string> = {};
  for (const sec of group.querySelectorAll("section[aria-label]")) {
    const t = sec.getAttribute("aria-label")![0];
    for (const chip of sec.querySelectorAll("[data-final-chip]")) {
      out[chip.getAttribute("data-final-chip")!] = t;
    }
  }
  return out;
}
const chipLabel = (label: string, slug: string) =>
  screen.getByRole("group", { name: label }).querySelector(`[data-final-chip="${slug}"]`)
    ?.getAttribute("aria-label");

/** [what happened, clock, newest block]. */
const EVENT_TIMELINE: [string, number, number][] = [
  ["two ballots", 1500, 1499],
  ["somebody else votes", 1610, 1609],
  ["a donation covers beta", 1710, 1709],
  ["a pledge lowers alpha's ask", 1810, 1809],
  ["the pool grows", 1910, 1909],
  ["S-Tier window 1", 2010, 2009],
  ["a donation to gamma in window 1", 2040, 2039],
  ["S-Tier window 2", 2064, 2061],
  ["S-Tier settled", 2096, 2089],
];
function eventChain() {
  chain.events = OPEN_EVENTS;
  chain.changes = CHANGES;
  M.projects[2].goalUsd = String(USD(600));
}
async function walkEvents(check: (name: string) => Promise<void> | void) {
  eventChain();
  for (const [name, wall, head] of EVENT_TIMELINE) {
    await moment(wall, head);
    await check(name);
  }
}

it("the server's view follows every event: ballots, donations, pledges, the pool", async () => {
  eventChain();
  type View = {
    share: string;
    poolUsd: string;
    asks: string[];
    accepted: Record<string, string>;
    live: { tiers: Record<string, string>; covered: string[] };
    tiers: { status: string; window?: number; quiet?: boolean; funded?: string[] }[];
  };
  const at = async (wall: number, head: number) => (await serve(wall, head), served.body as View);
  const two = await at(1500, 1499);
  expect([two.share, two.live.tiers]).toEqual([String(USD(600)), { alpha: "S", beta: "A" }]);
  const voted = await at(1610, 1609);
  expect([voted.share, Object.keys(voted.accepted)]).toEqual([String(USD(400)), ["1", "2", "3"]]);
  const donated = await at(1710, 1709);
  expect(donated.live.covered).toEqual(["beta"]);
  expect(donated.live.tiers.beta).toBeUndefined();
  expect((await at(1810, 1809)).asks).toEqual([USD(100), USD(0), USD(600)].map(String));
  const grown = await at(1910, 1909);
  expect([grown.poolUsd, grown.share]).toEqual([String(USD(1500)), String(USD(500))]);
  expect((await at(2010, 2009)).tiers[0]).toMatchObject({
    window: 1,
    quiet: true,
    funded: ["alpha"],
  });
  // In S-Tier's first window the donation brings gamma in: another window will run.
  expect((await at(2040, 2039)).tiers[0]).toMatchObject({
    status: "settling",
    window: 1,
    quiet: false,
    funded: ["alpha", "gamma"],
  });
  expect((await at(2064, 2061)).tiers[0]).toMatchObject({ status: "settling", window: 2 });
  expect((await at(2096, 2089)).tiers[0]).toMatchObject({
    status: "settled",
    at: 2090,
    funded: ["alpha", "gamma"],
  });
});

it("the results page follows every event", async () => {
  await serve(1500, 1499);
  vi.setSystemTime(1_500_000);
  mount("results");
  await walkEvents(async (name) => {
    await screen.findByRole("group", { name: "TheDAO's ballot" });
    const t = tiersIn("TheDAO's ballot");
    const page = document.body.textContent ?? "";
    switch (name) {
      case "two ballots":
        expect(t, name).toMatchObject({ alpha: "S", beta: "A" });
        expect(page, name).toMatch(/by 2 ballots from the \$1,200/);
        break;
      case "somebody else votes":
        expect(page, name).toMatch(/by 3 ballots/);
        break;
      case "a donation covers beta":
        expect(t.beta, name).toBeUndefined();
        expect(page, name).toMatch(/Covered by donations.*BETA/);
        break;
      case "a pledge lowers alpha's ask":
        expect(chipLabel("TheDAO's ballot", "alpha"), name).toMatch(/\$100$/);
        break;
      case "the pool grows":
        expect(page, name).toMatch(/from the \$1,500/);
        break;
      case "S-Tier window 1":
        expect((await roundBox()).text, name).toContain("If nothing changes");
        break;
      case "a donation to gamma in window 1":
        expect(t.gamma, name).toBe("S");
        expect((await roundBox()).text, name).toContain("changed in this window");
        break;
      case "S-Tier window 2":
        expect(current((await roundBox()).steps), name).toMatch(/^S-TierWindow 2 of 3/);
        break;
      case "S-Tier settled":
        expect(gold(), name).toEqual(["alpha", "gamma"]);
        expect((await roundBox()).title, name).toMatch(/^S-Tier settled: 2 initiatives/);
        break;
    }
  });
});

it("your ballot follows every event: the live result beside it", async () => {
  await serve(1500, 1499);
  vi.setSystemTime(1_500_000);
  mount("ballot");
  expect(await screen.findByRole("button", { name: "Edit my ballot" })).toBeInTheDocument();
  await walkEvents((name) => {
    const t = tiersIn("The live result");
    switch (name) {
      case "two ballots":
        expect(t, name).toMatchObject({ alpha: "S", beta: "A" });
        break;
      case "a donation covers beta":
        expect(t.beta, name).toBeUndefined();
        break;
      case "a pledge lowers alpha's ask":
        expect(chipLabel("The live result", "alpha"), name).toMatch(/\$100$/);
        break;
      case "a donation to gamma in window 1":
        expect(t.gamma, name).toBe("S");
        break;
      case "S-Tier settled":
        // Gold on its own ballot only what it ranked there: alpha (gamma it had in B-Tier).
        expect(gold(), name).toEqual(["alpha", "gamma"]);
        break;
    }
  });
});

it("the editor follows every event: asks, the share, and what settles", async () => {
  await serve(1500, 1499);
  vi.setSystemTime(1_500_000);
  mount("editor");
  /** What the ballot asks for in all, at the chain's asks (the editor's ring). */
  const asked = () => document.body.textContent?.match(/\$[\d,]+ asked/)?.[0];
  await walkEvents((name) => {
    const page = document.body.textContent ?? "";
    switch (name) {
      case "two ballots":
        expect(page, name).toMatch(/share: about \$600/);
        expect(asked(), name).toBe("$1,400 asked");
        break;
      case "somebody else votes":
        expect(page, name).toMatch(/share: about \$400/);
        break;
      case "a donation covers beta":
        expect(asked(), name).toBe("$1,000 asked");
        break;
      case "a pledge lowers alpha's ask":
        expect(asked(), name).toBe("$700 asked");
        break;
      case "the pool grows":
        expect(page, name).toMatch(/share: about \$500/);
        break;
      case "a donation to gamma in window 1":
        expect(asked(), name).toBe("$400 asked");
        break;
      case "S-Tier settled":
        expect(document.querySelector('[data-drop="S"]')?.textContent, name).toContain("Settled");
        break;
    }
  });
});
