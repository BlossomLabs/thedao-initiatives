import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bytesToHex } from "viem";
import { api, ApiError } from "~/lib/api";
import { encodeBallot } from "../../shared/vote/ballot";
import VoteCode from "./vote.code";
import MyBallot from "./vote.ballot";

const ME = "0x1111111111111111111111111111111111111111";
const SOMEONE = "0x2222222222222222222222222222222222222222";

const session = { current: null as null | { address: string } };
const openWalletPicker = vi.fn();
const signOut = vi.fn(() => Promise.resolve(true));
const submit = vi.fn();
const selfSend = vi.fn();
const retry = vi.fn();
const flow = {
  phase: { kind: "idle" } as { kind: string; reason?: string },
  last: null as null | { nonce: bigint },
};
/** What /api/vote/round answers (none: the request fails, as before phase 2). */
const roundIs = { body: null as null | Record<string, unknown> };
const OPEN_UNTIL = 4_000_000_000;
const round = vi.hoisted(() => ({
  closesAt: 4_000_000_000,
  opensAt: 0,
  kind: "test" as "test" | "real",
}));

vi.mock("../../shared/vote/manifest", async (original) => ({
  ...await original<typeof import("../../shared/vote/manifest")>(),
  ROUND: {
    get kind() {
      return round.kind;
    },
    get chainId() {
      return round.kind === "real" ? 1 : 11155111;
    },
    badge: "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C",
    contract: "0x1000000000000000000000000000000000000001",
    deployBlock: 1,
    get opensAt() {
      return round.opensAt;
    },
    get closesAt() {
      return round.closesAt;
    },
    schedule: { opensAt: 0, firstTallyAt: [100, 200, 300], initialWindow: 60, maxWindows: 3 },
    poolUsd: "913244000000",
    issuer: "0x2000000000000000000000000000000000000002",
    slugs: ["alpha", "beta", "gamma"],
  },
}));
vi.mock("~/context/session", () => ({
  useSession: () => ({ session: session.current, signOut }),
  sessionKey: (s: { address: string } | null) => s?.address ?? null,
}));
vi.mock("~/context/wallet", () => ({
  useWallet: () => ({ address: session.current?.address, isConnected: Boolean(session.current) }),
}));
vi.mock("~/context/wallet-picker", () => ({
  useWalletPicker: () => ({ openWalletPicker, walletPickerOpen: false }),
}));
vi.mock("~/hooks/use-board", () => ({
  useBoard: () => ({
    data: {
      flags: { aiSearch: true },
      cards: ["alpha", "beta", "gamma"].map((slug) => ({
        initiative: {
          id: slug,
          slug,
          title: slug.toUpperCase(),
          summary: slug === "gamma" ? "Formal verification of bridges" : "",
          recipientTeam: slug === "gamma" ? "Bridge researchers" : "",
          categories: [],
          goalUsd: 1000,
        },
        summary: { total: 0 },
      })),
    },
  }),
}));
vi.mock("~/hooks/use-vote", async (original) => ({
  ...await original<typeof import("~/hooks/use-vote")>(),
  useBallotSubmit: () => ({ phase: flow.phase, submit, retry, selfSend, last: flow.last }),
  useMintWait: () => ({ wait: () => Promise.resolve() }),
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

const CODE = "17.abc";

function mockApi(code: () => Promise<unknown>, claim?: () => Promise<unknown>) {
  vi.mocked(api).mockImplementation(
    ((path: string) => {
      if (path.startsWith("/api/vote/code/")) return code();
      if (path === "/api/vote/claim") return claim ? claim() : Promise.resolve({ hash: "0x1" });
      if (path === "/api/vote/round" && roundIs.body) return Promise.resolve(roundIs.body);
      return Promise.reject(new Error("unexpected " + path));
    }) as typeof api,
  );
}

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/vote/${CODE}`]}>
        <Routes>
          <Route path="/vote/:code" element={<VoteCode />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  session.current = null;
  openWalletPicker.mockReset();
  submit.mockReset();
  vi.mocked(api).mockReset();
  selfSend.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  flow.phase = { kind: "idle" };
  round.closesAt = OPEN_UNTIL;
  round.opensAt = 0;
  round.kind = "test";
  roundIs.body = null;
  flow.last = null;
});
afterEach(cleanup);

it("a mangled code says so", async () => {
  mockApi(() => Promise.reject(new ApiError(400, "bad", { code: "bad_code" })));
  show();
  expect(await screen.findByText(/This code doesn't look right/)).toBeInTheDocument();
});

it("a code someone else claimed says it is taken", async () => {
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: SOMEONE }));
  show();
  expect(await screen.findByText(/This badge is already taken/)).toBeInTheDocument();
});

it("the intro explains first; sign-in opens only on the button", async () => {
  mockApi(() => Promise.resolve({ n: 17, claimed: false, owner: null }));
  show();
  expect(await screen.findByRole("heading", { name: /congrats/i })).toBeInTheDocument();
  expect(screen.getByText(/\$913,244/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /security hub/i })).toHaveAttribute(
    "href",
    "https://securityhub.thedao.fund/",
  );
  expect(screen.getByRole("link", { name: /blossom budgeting/i })).toHaveAttribute(
    "href",
    "https://blossom.software/budgeting",
  );
  expect(openWalletPicker).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /claim my test badge/i }));
  expect(openWalletPicker).toHaveBeenCalledTimes(1);
});

it("signed in with another account than the badge's: says so and offers sign-out", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: SOMEONE }));
  show();
  expect(await screen.findByText(/belongs to another account/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /send my ballot/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
  expect(signOut).toHaveBeenCalled();
});

it("a second badge for the same person gets the bad-kid line", async () => {
  session.current = { address: ME };
  mockApi(
    () => Promise.resolve({ n: 17, claimed: false, owner: null }),
    () => Promise.reject(new ApiError(409, "One badge per person.", { code: "one_per_person" })),
  );
  show();
  fireEvent.click(await screen.findByRole("button", { name: /claim my test badge/i }));
  expect(await screen.findByText(/Nice try, bad kid/)).toBeInTheDocument();
});

it("the badge's owner gets the ballot, and sending posts the encoded tiers", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  expect(await screen.findByText("ALPHA")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^BETA/ }));
  fireEvent.click(screen.getByRole("button", { name: "Place in Must fund" }));
  fireEvent.click(screen.getByRole("button", { name: /send my ballot/i }));
  await waitFor(() => expect(submit).toHaveBeenCalled());
  const [tokenId, ballot] = submit.mock.calls[0];
  expect(tokenId).toBe(17n);
  expect(ballot).toBe(bytesToHex(encodeBallot(["alpha", "beta", "gamma"], { beta: "S" })));
  expect(ballot.includes("00")).toBe(false);
});

it("offers to send it yourself next to Send, and next to Retry after a failure", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  fireEvent.click(await screen.findByRole("button", { name: /^BETA/ }));
  fireEvent.click(screen.getByRole("button", { name: "Place in Must fund" }));
  fireEvent.click(screen.getByRole("button", { name: /send it yourself/i }));
  await waitFor(() => expect(selfSend).toHaveBeenCalled());
  expect(selfSend.mock.calls[0][0]).toBe(17n);
  cleanup();

  flow.phase = { kind: "failed", reason: "busy" };
  show();
  expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /send it yourself/i }).length).toBeGreaterThan(0);
});

it("accepting, then signing in, goes straight on to claiming — even if the page remounted", async () => {
  let minted = false;
  mockApi(
    () =>
      Promise.resolve(
        minted ? { n: 17, claimed: true, owner: ME } : { n: 17, claimed: false, owner: null },
      ),
    () => {
      minted = true;
      return Promise.resolve({ hash: "0x1" });
    },
  );
  show();
  fireEvent.click(await screen.findByRole("button", { name: /claim my test badge/i }));
  expect(openWalletPicker).toHaveBeenCalledTimes(1);
  // The sign-in modal finishes and the page comes back signed in (a fresh mount).
  cleanup();
  session.current = { address: ME };
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  show();
  await waitFor(() =>
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      "/api/vote/claim",
      expect.objectContaining({ method: "POST", json: { code: CODE } }),
    )
  );
  // On to the ballot, no second "Accept the challenge".
  expect(await screen.findByRole("button", { name: /send my ballot|place at least one/i }))
    .toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /claim my test badge/i })).toBeNull();
  // The ballot starts at the top, not where the claim button was.
  expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  scrollTo.mockRestore();
});

it("without accepting, a signed-in visitor still sees the intro and claims only on the button", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: false, owner: null }));
  show();
  expect(await screen.findByRole("button", { name: /claim my test badge/i })).toBeInTheDocument();
  expect(vi.mocked(api)).not.toHaveBeenCalledWith("/api/vote/claim", expect.anything());
});

it("the automatic claim after sign-in is sent once, even when effects run twice (StrictMode)", async () => {
  sessionStorage.setItem(`vote-accepted:0x1000000000000000000000000000000000000001:${CODE}`, "1");
  session.current = { address: ME };
  let resolveClaim!: (v: unknown) => void;
  mockApi(
    () => Promise.resolve({ n: 17, claimed: false, owner: null }),
    () => new Promise((r) => (resolveClaim = r)),
  );
  render(
    <StrictMode>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[`/vote/${CODE}`]}>
          <Routes>
            <Route path="/vote/:code" element={<VoteCode />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
  await waitFor(() =>
    expect(vi.mocked(api).mock.calls.filter(([p]) => p === "/api/vote/claim").length).toBe(1)
  );
  await new Promise((r) => setTimeout(r, 50));
  expect(vi.mocked(api).mock.calls.filter(([p]) => p === "/api/vote/claim").length).toBe(1);
  resolveClaim({ hash: "0x1" });
});

it("the ballot: search narrows the unranked list; a tile's tier buttons place it", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  expect(await screen.findByText("ALPHA")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox", { name: /search initiatives/i }), {
    target: { value: "bridges" },
  });
  await waitFor(() => expect(screen.queryByText("ALPHA")).toBeNull());
  expect(screen.getByText("GAMMA")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /clear the search/i }));
  expect(screen.getByText("ALPHA")).toBeInTheDocument();

  // Tap it, then tap a tier.
  fireEvent.click(screen.getByRole("button", { name: /^ALPHA/ }));
  fireEvent.click(screen.getByRole("button", { name: "Place in Should fund" }));
  expect(within(screen.getByRole("list", { name: "Should fund" })).getByText("ALPHA"))
    .toBeInTheDocument();
});

it("dragging a tile onto a tier ranks it; tiles keep their size", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  await screen.findByText("BETA");
  const tile = document.querySelector('[data-ballot-tile="beta"]') as HTMLElement;
  const before = tile.className;
  let under: Element | null = null;
  document.elementFromPoint = () => under;
  fireEvent.pointerDown(tile, {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 30 });
  // Picked up: the source only fades.
  expect(tile.className.replace(" opacity-40", "")).toBe(before);
  under = screen.getByRole("button", { name: "Place in Must fund" });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 50 });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 40, clientY: 50 });
  expect(within(screen.getByRole("list", { name: "Must fund" })).getByText("BETA"))
    .toBeInTheDocument();
  // In the tier it is a chip; the list's tiles keep their size.
  expect(document.querySelector('[data-ballot-chip="beta"]')).not.toBeNull();
  const other = document.querySelector('[data-ballot-tile="alpha"]') as HTMLElement;
  expect(other.className).toBe(before.replace("beta", "alpha"));
});

it("Cancel drops a tapped initiative without moving it", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  fireEvent.click(await screen.findByRole("button", { name: /^GAMMA/ }));
  expect(screen.getByRole("button", { name: /^GAMMA/ })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
  expect(screen.getByRole("button", { name: /^GAMMA/ })).toHaveAttribute("aria-pressed", "false");
  expect(within(screen.getByRole("list", { name: "Not ranked yet" })).getByText("GAMMA"))
    .toBeInTheDocument();
});

it("Enter asks AI, which orders the list; typing again goes back to keywords", async () => {
  session.current = { address: ME };
  vi.mocked(api).mockImplementation(
    ((path: string) => {
      if (path.startsWith("/api/vote/code/")) {
        return Promise.resolve({ n: 17, claimed: true, owner: ME });
      }
      if (path === "/api/ai-search") {
        return Promise.resolve({
          scores: [{ id: "gamma", score: 90 }, { id: "alpha", score: 40 }, {
            id: "beta",
            score: 10,
          }],
          pickThreshold: 50,
        });
      }
      return Promise.reject(new Error("unexpected " + path));
    }) as typeof api,
  );
  show();
  await screen.findByText("ALPHA");
  const box = screen.getByRole("searchbox", { name: /search initiatives/i });
  fireEvent.change(box, { target: { value: "who protects cross-chain bridges" } });
  fireEvent.submit(box.closest("form")!);
  expect(await screen.findByText(/initiatives ordered by relevance/i)).toBeInTheDocument();
  const order = Array.from(document.querySelectorAll("[data-ballot-tile]"))
    .map((b) => b.getAttribute("data-ballot-tile"));
  expect(order).toEqual(["gamma", "alpha", "beta"]);
  fireEvent.click(screen.getByRole("button", { name: /back to keywords/i }));
  expect(screen.queryByText(/initiatives ordered by relevance/i)).toBeNull();
});

it("a proposal's chevron shows a preview and Details without selecting or moving it", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  const toggle = await screen.findByRole("button", { name: "Show preview for GAMMA" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("Formal verification of bridges")).toBeNull();
  // Even with another initiative picked, previewing must not trigger a list drop.
  fireEvent.click(screen.getByRole("button", { name: /^ALPHA/ }));
  fireEvent.click(screen.getByRole("button", { name: "Place in Must fund" }));
  fireEvent.click(screen.getByRole("button", { name: "ALPHA" }));
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Formal verification of bridges")).toBeInTheDocument();
  expect(screen.queryByText("Bridge researchers")).toBeNull();
  expect(screen.queryByText("Raised")).toBeNull();
  const details = screen.getByRole("link", { name: /Details for GAMMA/ });
  expect(details).toHaveAttribute("href", "/initiative/gamma");
  expect(details).toHaveAttribute("target", "_blank");
  expect(details).toHaveAttribute("rel", "noopener noreferrer");
  expect(within(screen.getByRole("list", { name: "Must fund" })).getByText("ALPHA"))
    .toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^GAMMA/ })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(toggle);
  expect(screen.queryByText("Formal verification of bridges")).toBeNull();
  expect(toggle).toHaveAttribute("aria-expanded", "false");
});

function showMine(path = "/vote/ballot") {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/vote/ballot" element={<MyBallot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("my ballot (from /vote, no code): signed out asks to sign in", async () => {
  showMine();
  fireEvent.click(await screen.findByRole("button", { name: /sign in/i }));
  expect(openWalletPicker).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api)).not.toHaveBeenCalled();
});

it("my ballot: the signed-in account's badge opens its ballot", async () => {
  session.current = { address: ME };
  vi.mocked(api).mockImplementation(
    ((path: string) =>
      path === "/api/vote/mine"
        ? Promise.resolve({ ids: [17] })
        : Promise.reject(new Error("unexpected " + path))) as typeof api,
  );
  showMine();
  expect(await screen.findByRole("heading", { name: /your ballot/i })).toBeInTheDocument();
  expect(screen.getByText(/badge #17/i)).toBeInTheDocument();
});

it("my ballot: an account without a badge says so", async () => {
  session.current = { address: ME };
  vi.mocked(api).mockResolvedValue({ ids: [] });
  showMine();
  expect(await screen.findByText(/no badge on this account/i)).toBeInTheDocument();
});

it("after the close, an unclaimed code says voting has closed instead of offering the badge", async () => {
  round.closesAt = 1;
  mockApi(() => Promise.resolve({ n: 17, claimed: false, owner: null }));
  show();
  expect(await screen.findByRole("heading", { name: /voting has closed/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /claim my test badge/i })).toBeNull();
  expect(screen.getByRole("link", { name: /see the result/i })).toHaveAttribute("href", "/vote");
});

it("after the close, the owner sees the ballot their badge sent, not the ballot to edit", async () => {
  round.closesAt = 1;
  session.current = { address: ME };
  const sent = bytesToHex(encodeBallot(["alpha", "beta", "gamma"], { gamma: "S", alpha: "B" }));
  vi.mocked(api).mockImplementation(
    ((path: string) =>
      path.startsWith("/api/vote/code/")
        ? Promise.resolve({ n: 17, claimed: true, owner: ME })
        : path === "/api/vote/ballots"
        ? Promise.resolve({
          at: 0,
          ballots: [{ tokenId: "3", ballot: "0x0101ff" }, {
            tokenId: "17",
            ballot: sent,
          }],
        })
        : Promise.reject(new Error("unexpected " + path))) as typeof api,
  );
  // Sent from this browser: its saved tiers say B, which the chain alone reads as A.
  localStorage.setItem(
    "vote-tiers:0x1000000000000000000000000000000000000001:17",
    JSON.stringify({ gamma: "S", alpha: "B" }),
  );
  show();
  expect(await screen.findByRole("heading", { name: /voting has closed/i })).toBeInTheDocument();
  const s = await screen.findByRole("region", { name: /S · Must fund/ });
  expect(within(s).getByText("GAMMA")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: /B · Nice to have/ })).getByText("ALPHA"))
    .toBeInTheDocument();
  expect(screen.queryByText("BETA")).toBeNull();
  expect(screen.queryByRole("button", { name: /send my ballot/i })).toBeNull();
});

it("after the close, a badge that never voted says so", async () => {
  round.closesAt = 1;
  session.current = { address: ME };
  vi.mocked(api).mockImplementation(
    ((path: string) =>
      path === "/api/vote/mine"
        ? Promise.resolve({ ids: [17] })
        : path === "/api/vote/ballots"
        ? Promise.resolve({ at: 0, ballots: [] })
        : Promise.reject(new Error("unexpected " + path))) as typeof api,
  );
  showMine();
  expect(await screen.findByText(/didn't send a ballot before voting closed/i))
    .toBeInTheDocument();
});

it("after the close, on another device the sent ballot is read from the chain", async () => {
  round.closesAt = 1;
  session.current = { address: ME };
  const sent = bytesToHex(encodeBallot(["alpha", "beta", "gamma"], { beta: "S", alpha: "A" }));
  vi.mocked(api).mockImplementation(
    ((path: string) =>
      path === "/api/vote/mine"
        ? Promise.resolve({ ids: [17] })
        : path === "/api/vote/ballots"
        ? Promise.resolve({ at: 0, ballots: [{ tokenId: "17", ballot: sent }] })
        : Promise.reject(new Error("unexpected " + path))) as typeof api,
  );
  showMine();
  const s = await screen.findByRole("region", { name: /S · Must fund/ });
  expect(within(s).getByText("BETA")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: /A · Should fund/ })).getByText("ALPHA"))
    .toBeInTheDocument();
});

function mineIs(ids: number[]) {
  vi.mocked(api).mockImplementation(
    ((path: string) =>
      path === "/api/vote/mine"
        ? Promise.resolve({ ids })
        : Promise.reject(new Error("unexpected " + path))) as typeof api,
  );
}

it("real vote: a holder of two voting badges picks one; ?badge= opens it", async () => {
  round.kind = "real";
  session.current = { address: ME };
  mineIs([12, 40]);
  showMine("/vote/ballot?badge=40");
  expect(await screen.findByText(/TheDAO vote · Badge #40/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Badge #12" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Badge #40" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Badge #12" }));
  expect(await screen.findByText(/TheDAO vote · Badge #12/)).toBeInTheDocument();
});

it("real vote: an unknown ?badge= falls back to the first badge", async () => {
  round.kind = "real";
  session.current = { address: ME };
  mineIs([12, 40]);
  showMine("/vote/ballot?badge=99");
  expect(await screen.findByText(/TheDAO vote · Badge #12/)).toBeInTheDocument();
});

it("real vote: an account without a voting badge says so", async () => {
  round.kind = "real";
  session.current = { address: ME };
  mineIs([]);
  showMine();
  expect(await screen.findByText("This account has no voting badge.")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /your ballot/i })).toBeNull();
});

it("real vote: a paper code says the vote uses the voting badge, and claims nothing", async () => {
  round.kind = "real";
  show();
  expect(await screen.findByText(/TheDAO's vote uses the voting badge/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /your ballot/i })).toHaveAttribute(
    "href",
    "/vote/ballot",
  );
  expect(screen.queryByRole("button", { name: /claim/i })).toBeNull();
  expect(vi.mocked(api)).not.toHaveBeenCalled();
});

it("real vote: before it opens, the ballot says when and offers no Send", async () => {
  round.kind = "real";
  round.opensAt = 4_000_000_000 - 1;
  session.current = { address: ME };
  mineIs([12]);
  showMine();
  expect(await screen.findByText(/Voting opens/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /send my ballot|place at least one/i })).toBeNull();
});

// ---------------------------------------------------------------- quiet ending
const waiting = (tier: string, startsAt = 4_000_000_000) => ({ tier, status: "waiting", startsAt });
function roundBody(over: Record<string, unknown> = {}) {
  return {
    registrationClosesAt: 4_000_000_000,
    closed: false,
    tiers: [waiting("S"), waiting("A"), waiting("B")],
    accepted: {},
    rejected: [],
    live: { funded: [], awards: {} },
    ...over,
  };
}
async function ballotWith(body: Record<string, unknown>) {
  roundIs.body = body;
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  expect(await screen.findByRole("heading", { name: /your ballot/i })).toBeInTheDocument();
}

it("quiet ending: before registration closes, a badge that hasn't voted is told the deadline", async () => {
  await ballotWith(roundBody());
  expect(await screen.findByText(/Vote before .* UTC, or this badge can't vote\./))
    .toBeInTheDocument();
});

it("quiet ending: after registration, a badge that never voted can't send", async () => {
  await ballotWith(roundBody({ registrationClosesAt: 1 }));
  expect(await screen.findByText("Registration closed before this badge voted."))
    .toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /send my ballot|place at least one/i })).toBeNull();
});

it("quiet ending: S settling, quiet so far", async () => {
  await ballotWith(roundBody({
    accepted: { "17": "0x01ffff" },
    tiers: [
      {
        tier: "S",
        status: "settling",
        window: 1,
        windowEndsAt: 4_000_000_000,
        latestEndAt: 4_000_000_100,
        quiet: true,
        funded: ["alpha"],
      },
      waiting("A"),
      waiting("B"),
    ],
  }));
  // Its own box, in the ballot's column.
  const box = await screen.findByRole("region", { name: "Tier-S settling" });
  expect(within(box).getByText("Tier-S is settling")).toBeInTheDocument();
  expect(within(box).getByText("Window 1 of 3")).toBeInTheDocument();
  expect(within(box).getByText(/^Ends .* UTC$/)).toBeInTheDocument();
  expect(within(box).getByText("No change so far: it settles then.")).toBeInTheDocument();
});

it("quiet ending: S changed in this window", async () => {
  await ballotWith(roundBody({
    accepted: { "17": "0x01ffff" },
    tiers: [
      {
        tier: "S",
        status: "settling",
        window: 2,
        windowEndsAt: 4_000_000_000,
        latestEndAt: 4_000_000_100,
        quiet: false,
        funded: [],
      },
      waiting("A"),
      waiting("B"),
    ],
  }));
  expect(await screen.findByText("It changed in this window: a shorter window follows."))
    .toBeInTheDocument();
});

it("quiet ending: a settled S is named and locked; the badge sees what it paid and what's left", async () => {
  await ballotWith(roundBody({
    accepted: { "17": "0x01ffff" },
    share: "2000000000",
    tiers: [
      {
        tier: "S",
        status: "settled",
        at: 1,
        forced: false,
        funded: ["alpha"],
        awards: { alpha: "30000000000" },
        paid: { "17": { alpha: "900000000" }, "18": { alpha: "1000000" } },
      },
      waiting("A"),
      waiting("B"),
    ],
  }));
  const share = await screen.findByRole("region", { name: "Your share" });
  expect(within(share).getByText("$1,100 left of $2,000")).toBeInTheDocument();
  expect(within(share).getByText("Tier-S paid $900 to 1 initiative")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Must fund (settled)" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "ALPHA, funded: your share paid $900" }))
    .toBeDisabled();
});

it("quiet ending: a sent ballot the round refused says the earlier one still counts", async () => {
  flow.last = { nonce: 2n };
  await ballotWith(roundBody({
    accepted: { "17": "0x01ffff" },
    rejected: [{ tokenId: "17", nonce: 2, reason: "tier_settled" }],
  }));
  expect(
    await screen.findByText(
      /Not counted: it changed a settled tier\. Your earlier ballot still counts\./,
    ),
  )
    .toBeInTheDocument();
});

it("quiet ending: once B settles the ballot is closed, with what each tier funded", async () => {
  const settled = (tier: string, funded: string[]) => ({
    tier,
    status: "settled",
    at: 1,
    forced: false,
    funded,
    awards: {},
  });
  vi.mocked(api).mockReset();
  await ballotWithClosed(roundBody({
    closed: true,
    accepted: { "17": "0x01ffff" },
    tiers: [settled("S", ["alpha"]), settled("A", ["beta"]), settled("B", [])],
  }));
  expect(await screen.findByText("Tier-S: ALPHA")).toBeInTheDocument();
  expect(screen.getByText("Tier-A: BETA")).toBeInTheDocument();
});

async function ballotWithClosed(body: Record<string, unknown>) {
  roundIs.body = body;
  session.current = { address: ME };
  vi.mocked(api).mockImplementation(
    ((path: string) =>
      path.startsWith("/api/vote/code/")
        ? Promise.resolve({ n: 17, claimed: true, owner: ME })
        : path === "/api/vote/round"
        ? Promise.resolve(body)
        : path === "/api/vote/ballots"
        ? Promise.resolve({ at: 0, ballots: [] })
        : Promise.reject(new Error("unexpected " + path))) as typeof api,
  );
  show();
  expect(await screen.findByRole("heading", { name: /voting has closed/i })).toBeInTheDocument();
}

it("quiet ending: an A-only ballot's A freezes once S settles (the server counts its first group)", async () => {
  // Badge 17's counted ballot puts beta in its only group: rank 1, which this browser
  // shows in A.
  localStorage.setItem(
    "vote-tiers:0x1000000000000000000000000000000000000001:17",
    JSON.stringify({ beta: "A" }),
  );
  await ballotWith(roundBody({
    accepted: { "17": "0xff01ff" },
    tiers: [
      { tier: "S", status: "settled", at: 1, forced: false, funded: [], awards: {} },
      waiting("A"),
      waiting("B"),
    ],
  }));
  expect(await screen.findByRole("button", { name: "Should fund (settled)" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Must fund (settled)" })).toBeDisabled();
});

it("quiet ending: in the last window, a change can't buy another one", async () => {
  await ballotWith(roundBody({
    accepted: { "17": "0x01ffff" },
    tiers: [
      {
        tier: "S",
        status: "settling",
        window: 3,
        windowEndsAt: 4_000_000_000,
        latestEndAt: 4_000_000_000,
        quiet: false,
        funded: [],
      },
      waiting("A"),
      waiting("B"),
    ],
  }));
  expect(
    await screen.findByText(
      "It changed, but this is the last window: it settles at its end anyway.",
    ),
  )
    .toBeInTheDocument();
});

it("quiet ending: an unsent edit that moved a settled initiative is put back as it counted", async () => {
  localStorage.setItem(
    "vote-tiers:0x1000000000000000000000000000000000000001:17",
    JSON.stringify({ alpha: "A", beta: "B" }),
  );
  await ballotWith(roundBody({
    accepted: { "17": "0x01ffff" },
    share: "2000000000",
    tiers: [
      { tier: "S", status: "settled", at: 1, forced: false, funded: ["alpha"], awards: {} },
      waiting("A"),
      waiting("B"),
    ],
  }));
  const s = await screen.findByRole("list", { name: "Must fund" });
  expect(within(s).getByRole("button", { name: "ALPHA, funded" })).toBeDisabled();
  // What isn't settled stays as this browser had it.
  expect(
    within(screen.getByRole("list", { name: "Nice to have" })).getByRole("button", {
      name: "BETA",
    }),
  )
    .toBeInTheDocument();
});
