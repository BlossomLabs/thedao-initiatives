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
  /** The ballot rules: alpha and beta affiliated with Seal when `seal`. */
  ballotRules: false,
  seal: false,
}));
/** What the API answers beyond the round: ratings and review badges. */
const extra = { paths: {} as Record<string, unknown> };

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
    // Opens when the round does (a test can move it).
    get schedule() {
      return {
        opensAt: round.opensAt,
        firstTallyAt: [100, 200, 300],
        initialWindow: 60,
        maxWindows: 3,
      };
    },
    poolUsd: "913244000000",
    issuer: "0x2000000000000000000000000000000000000002",
    slugs: ["alpha", "beta", "gamma"],
    get projects() {
      return ["alpha", "beta", "gamma"].map((_, i) => ({
        askUsd: "400000000",
        rfp: false,
        groups: round.seal && i < 2 ? [0] : [],
      }));
    },
    groups: ["Seal"],
    independentTiers: 1,
    get ballotRules() {
      return round.ballotRules;
    },
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
      if (path in extra.paths) return Promise.resolve(extra.paths[path]);
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
  round.ballotRules = false;
  round.seal = false;
  extra.paths = {};
  roundIs.body = null;
  flow.last = null;
});
afterEach(cleanup);

/** Tap an initiative, then choose where it goes on its card. */
/** The card's selector: opens it and picks an option by its read-out name. */
async function pickIn(card: HTMLElement, name: string) {
  const trigger = within(card).getByRole("combobox");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const option = await screen.findByRole("option", { name });
  // Keyboard, as Base UI ignores a click that lands the instant the list opens.
  const list = screen.getByRole("listbox");
  for (const key of ["ArrowDown", "ArrowUp"]) {
    for (let i = 0; i < 6 && !option.hasAttribute("data-highlighted"); i++) {
      fireEvent.keyDown(list, { key });
      await waitFor(() => {}, { timeout: 20 }).catch(() => {});
    }
  }
  fireEvent.keyDown(option, { key: "Enter" });
}
async function placeIn(title: RegExp, choice: string) {
  fireEvent.click(await screen.findByRole("button", { name: title }));
  await pickIn(await screen.findByRole("dialog"), choice);
  // The card stays open after a choice: close it.
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

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
  await placeIn(/^BETA/, "Tier-S, Must fund");
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
  await placeIn(/^BETA/, "Tier-S, Must fund");
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

  // Tap it, then choose a tier on its card.
  await placeIn(/^ALPHA/, "Tier-A, Should fund");
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
  under = document.querySelector('[data-drop="S"]');
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 50 });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 40, clientY: 50 });
  expect(within(screen.getByRole("list", { name: "Must fund" })).getByText("BETA"))
    .toBeInTheDocument();
  // In the tier it is a chip; the list's tiles keep their size.
  expect(document.querySelector('[data-ballot-chip="beta"]')).not.toBeNull();
  const other = document.querySelector('[data-ballot-tile="alpha"]') as HTMLElement;
  expect(other.className).toBe(before.replace("beta", "alpha"));
});

it("a skipped initiative leaves the list, is kept in this browser, and isn't sent", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  await placeIn(/^GAMMA/, "Skip: hide it from the list");
  expect(within(screen.getByRole("list", { name: "Not ranked yet" })).queryByText("GAMMA"))
    .toBeNull();
  expect(
    JSON.parse(
      localStorage.getItem("vote-skipped:0x1000000000000000000000000000000000000001:17")!,
    ),
  ).toEqual(["gamma"]);
  await placeIn(/^BETA/, "Tier-S, Must fund");
  fireEvent.click(screen.getByRole("button", { name: /send my ballot/i }));
  await waitFor(() => expect(submit).toHaveBeenCalled());
  expect(submit.mock.calls[0][1]).toBe(
    bytesToHex(encodeBallot(["alpha", "beta", "gamma"], { beta: "S" })),
  );
});

it("closing a card leaves the initiative where it was", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  fireEvent.click(await screen.findByRole("button", { name: /^GAMMA/ }));
  const card = await screen.findByRole("dialog", { name: "GAMMA" });
  fireEvent.click(within(card).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

it("a proposal's card shows its summary and Details, and moves it only when asked", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  await placeIn(/^ALPHA/, "Tier-S, Must fund");
  expect(screen.queryByText("Formal verification of bridges")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^GAMMA/ }));
  const card = await screen.findByRole("dialog", { name: "GAMMA" });
  expect(card).toHaveTextContent("Formal verification of bridges");
  expect(screen.queryByText("Bridge researchers")).toBeNull();
  expect(screen.queryByText("Raised")).toBeNull();
  const details = within(card).getByRole("link", { name: /Details for GAMMA/ });
  expect(details).toHaveAttribute("href", "/initiative/gamma");
  expect(details).toHaveAttribute("target", "_blank");
  expect(details).toHaveAttribute("rel", "noopener noreferrer");
  fireEvent.click(within(card).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "GAMMA" })).toBeNull());
  expect(within(screen.getByRole("list", { name: "Must fund" })).getByText("ALPHA"))
    .toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Not ranked yet" })).getByText("GAMMA"))
    .toBeInTheDocument();
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
  // Badge 17's ballot: its editor, with the tiers to place initiatives in.
  expect(document.querySelector('[data-drop="S"]')).not.toBeNull();
  expect(vi.mocked(api)).toHaveBeenCalledWith("/api/vote/mine");
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
  expect(await screen.findByRole("heading", { level: 1, name: "Your ballot" })).toBeInTheDocument();
  expect(screen.getByText(/Voting has closed/)).toBeInTheDocument();
  // The ballot's table, beside the result's (which has the same tier rows).
  const mine = await screen.findByRole("group", { name: "Your ballot" });
  expect(within(within(mine).getByRole("region", { name: /S · Must fund/ })).getByText("GAMMA"))
    .toBeInTheDocument();
  expect(within(within(mine).getByRole("region", { name: /B · Nice to have/ })).getByText("ALPHA"))
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
  const mine = await screen.findByRole("group", { name: "Your ballot" });
  expect(within(within(mine).getByRole("region", { name: /S · Must fund/ })).getByText("BETA"))
    .toBeInTheDocument();
  expect(within(within(mine).getByRole("region", { name: /A · Should fund/ })).getByText("ALPHA"))
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
  // The picker's pressed badge says which ballot is open.
  expect(await screen.findByRole("button", { name: "Badge #40" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Badge #12" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Badge #12" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Badge #12" }))
      .toHaveAttribute("aria-pressed", "true")
  );
});

it("real vote: an unknown ?badge= falls back to the first badge", async () => {
  round.kind = "real";
  session.current = { address: ME };
  mineIs([12, 40]);
  showMine("/vote/ballot?badge=99");
  expect(await screen.findByRole("button", { name: "Badge #12" }))
    .toHaveAttribute("aria-pressed", "true");
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
  // A ballot that counts opens on the page that shows it: these tests are about editing.
  await openEditor();
}

/** Into the editor: from the "your ballot" page (a counted ballot) once the round has
 * loaded and shown it, or straight there. */
async function openEditor() {
  await waitFor(() => {
    const edit = screen.queryByRole("button", { name: "Edit my ballot" });
    if (edit) fireEvent.click(edit);
    expect(document.querySelector('[data-drop="S"]')).not.toBeNull();
  });
}

/** The round box, and the window kinds of its bar (if a tier is settling). */
const roundBox = () => screen.findByRole("region", { name: "Where the round is" });
const windows = (box: HTMLElement) =>
  [...box.querySelectorAll("[data-window]")].map((w) => w.getAttribute("data-window"));
const settlingS = (window: number, quiet: boolean, last = false) => ({
  tier: "S",
  status: "settling",
  window,
  windowEndsAt: 4_000_000_000,
  latestEndAt: last ? 4_000_000_000 : 4_000_000_100,
  quiet,
  funded: [],
});

it("quiet ending: before Tier-S settles, a badge that hasn't voted is told so in the round box", async () => {
  await ballotWith(roundBody());
  const box = await roundBox();
  expect(within(box).getByRole("status")).toHaveTextContent(
    "This badge hasn’t voted yet. Send a first ballot before Tier-S settles, or it won’t be able to vote.",
  );
  // Dates in local time, UTC only in their titles.
  expect(box.querySelector("time")!.title).toMatch(/ UTC$/);
});

it("quiet ending: after registration, a badge that never voted gets no ballot at all", async () => {
  // Not ballotWith: the ballot shows only until the round loads, then the 404 replaces it.
  roundIs.body = roundBody({ registrationClosesAt: 1 });
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  expect(await screen.findByRole("heading", { name: "No ballot found" })).toBeInTheDocument();
  expect(screen.getByText(/can’t\s+vote this round/)).toBeInTheDocument();
  // Where the vote is, read only, and where to follow it: no tiers, no Send.
  expect(await roundBox()).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Must fund" })).toBeNull();
  expect(screen.queryByRole("button", { name: /send my ballot|place at least one/i })).toBeNull();
  expect(screen.getByRole("link", { name: "Follow the results live" })).toBeInTheDocument();
});

it("a ballot that counts opens on the page that shows it; Edit goes back to the ballot", async () => {
  // Badge 17's counted ballot: alpha alone in its group, read as Tier-S.
  roundIs.body = roundBody({
    accepted: { "17": "0x01ffff" },
    // If it ended now, Tier-S would fund ALPHA: the live result, beside the ballot.
    live: {
      funded: ["alpha"],
      awards: { alpha: "30000000000" },
      tiers: { alpha: "S" },
      // Badge 17 would pay $12,000 of it.
      paid: { "17": { alpha: "12000000000" } },
    },
  });
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  const edit = await screen.findByRole("button", { name: "Edit my ballot" });
  expect(screen.getByRole("heading", { level: 2, name: "The live result" })).toBeInTheDocument();
  expect(screen.getByText(/\$30,000 of the .* pool if it ended now · 1 initiative/))
    .toBeInTheDocument();
  // Only the live tally funds ALPHA (Tier-S hasn't settled): green in both tables, not gold.
  const alpha = document.querySelectorAll('[data-final-chip="alpha"]');
  expect(alpha).toHaveLength(2);
  for (const chip of alpha) {
    expect(chip).toHaveAttribute("data-live");
    expect(chip).not.toHaveAttribute("data-gold");
  }
  // On the ballot, ALPHA's chip says what this badge would give it.
  expect(
    screen.getByRole("listitem", {
      name: /^ALPHA, funded if it ended now: your share would pay \$12,000$/,
    }),
  )
    .toBeInTheDocument();
  // TheDAO's ring too: all green, nothing settled yet.
  const dao = screen.getByRole("meter", { name: "What TheDAO allocated of the pool" });
  expect(dao.querySelector("circle.stroke-dao-green")).not.toBeNull();
  expect(dao.querySelector("circle.stroke-vote")).toBeNull();
  // Its parts say what they are, as the editor's ring does: a tap opens one.
  // (jsdom lays nothing out: the ring's centre is at 0, 0; a tap just right of the top.)
  fireEvent.click(dao.querySelector<HTMLElement>("[data-ring-hit]")!, {
    clientX: 1,
    clientY: -20,
  });
  expect(await screen.findByText("If it ended now")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Your ballot" })).toBeInTheDocument();
  expect(screen.getByText(/It counts\. You can change it until each tier settles/))
    .toBeInTheDocument();
  // No editor here: no tiers to drop into, no Send.
  expect(document.querySelector('[data-drop="S"]')).toBeNull();
  expect(screen.queryByRole("button", { name: /send my ballot/i })).toBeNull();
  fireEvent.click(edit);
  expect(document.querySelector('[data-drop="S"]')).not.toBeNull();
  // Unchanged, it still counts: the send panel says so, and its button leads back.
  expect(screen.getByText("Your ballot counts")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "See my ballot" }));
  expect(await screen.findByRole("button", { name: "Edit my ballot" })).toBeInTheDocument();
});

it("a counted ballot is always beside the live result, even before it would fund anything", async () => {
  // A $500 pool: ALPHA's $400 is a quarter of the ring (full at 3×, $1,500).
  roundIs.body = roundBody({ accepted: { "17": "0x01ffff" }, poolUsd: "500000000" });
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  await screen.findByRole("button", { name: "Edit my ballot" });
  // The avatar's ring is the editor's: the ballot's ask, toward 3× the pool, in green.
  const ring = screen.getByRole("meter", { name: "What your ballot asks for, of 3× the pool" });
  expect(ring).toHaveAttribute("aria-valuenow", "400");
  expect(ring).toHaveAttribute("aria-valuemax", "1500");
  expect(ring.querySelector("circle.stroke-dao-green")).not.toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: "The live result" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "The live result" })).toBeInTheDocument();
});

it("quiet ending: S settling, quiet so far", async () => {
  await ballotWith(roundBody({
    accepted: { "17": "0x01ffff" },
    tiers: [{ ...settlingS(1, true), funded: ["alpha"] }, waiting("A"), waiting("B")],
  }));
  const box = await roundBox();
  expect(within(box).getByRole("heading", { name: "Tier-S is settling" })).toBeInTheDocument();
  expect(within(box).getByRole("timer")).toHaveTextContent(/^in \d+d \d+h$/);
  expect(windows(box)).toEqual(["current", "maybe", "maybe"]);
  expect(box).toHaveTextContent("No change so far: Tier-S settles when this window ends");
  expect(within(box).getByRole("status")).toHaveTextContent(
    "Your ballot counts. You can still change every tier.",
  );
});

it("quiet ending: S changed in this window: the next one will follow", async () => {
  await ballotWith(roundBody({
    accepted: { "17": "0x01ffff" },
    tiers: [settlingS(2, false), waiting("A"), waiting("B")],
  }));
  const box = await roundBox();
  expect(box).toHaveTextContent("Tier-S changed in this window: a shorter window follows at");
  expect(windows(box)).toEqual(["past", "current", "coming"]);
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
  // What's left of the share heads the ballot; the round box says what Tier-S took.
  expect(await screen.findByText("$1,100 of your $2,000 share left")).toBeInTheDocument();
  expect(await roundBox()).toHaveTextContent("1 of the 1 was on your ballot. You paid $900.00");
  // Settled: the tier says so, and its chip opens a card that can't move it.
  expect(document.querySelector('[data-drop="S"]')).toHaveTextContent("Settled");
  expect(screen.getByRole("button", { name: "ALPHA, funded: your share paid $900" }))
    .toBeInTheDocument();
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
  // TheDAO's result, as the same tier table as the ballot beside it.
  const result = await screen.findByRole("group", { name: "TheDAO's result" });
  expect(within(within(result).getByRole("region", { name: "S · Must fund" })).getByText("ALPHA"))
    .toBeInTheDocument();
  expect(within(within(result).getByRole("region", { name: "A · Should fund" })).getByText("BETA"))
    .toBeInTheDocument();
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
  expect(await screen.findByRole("heading", { level: 1, name: "Your ballot" })).toBeInTheDocument();
  expect(screen.getByText(/Voting has closed/)).toBeInTheDocument();
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
  await waitFor(() =>
    expect(document.querySelector('[data-drop="A"]')).toHaveTextContent("Settled")
  );
  expect(document.querySelector('[data-drop="S"]')).toHaveTextContent("Settled");
  // Its card can't move it out of the frozen tier.
  fireEvent.click(screen.getByRole("button", { name: /^BETA/ }));
  const card = await screen.findByRole("dialog", { name: "BETA" });
  expect(within(card).queryByRole("combobox", { name: /^Change where/ })).toBeNull();
});

it("quiet ending: in the last window, a change can't buy another one", async () => {
  await ballotWith(roundBody({
    accepted: { "17": "0x01ffff" },
    tiers: [settlingS(3, false, true), waiting("A"), waiting("B")],
  }));
  const box = await roundBox();
  expect(box).toHaveTextContent("The last window: Tier-S settles at");
  expect(windows(box)).toEqual(["past", "past", "current"]);
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
  expect(within(s).getByRole("button", { name: "ALPHA, funded" })).toBeInTheDocument();
  // What isn't settled stays as this browser had it.
  expect(
    within(screen.getByRole("list", { name: "Nice to have" })).getByRole("button", {
      name: "BETA",
    }),
  )
    .toBeInTheDocument();
});

// ---------------------------------------------------------------- ballot rules
const SKIPPED_KEY = "vote-skipped:0x1000000000000000000000000000000000000001:17";
const TIERS_KEY = "vote-tiers:0x1000000000000000000000000000000000000001:17";

it("ballot rules: a ballot breaking a rule shows why and can't be sent", async () => {
  round.ballotRules = true;
  round.seal = true;
  localStorage.setItem(TIERS_KEY, JSON.stringify({ alpha: "S", beta: "S", gamma: "S" }));
  // $500 pool: $1,200 requested clears 1.5×; Seal holds $800 of Tier-S's $1,200.
  await ballotWith(roundBody({ poolUsd: "500000000" }));
  const box = await screen.findByRole("region", { name: "Ballot rules" });
  expect(
    within(box).getByText(
      "Tier-S needs at least 3 independent projects. ALPHA and BETA are affiliated with Seal, so they count as one.",
    ),
  ).toBeInTheDocument();
  expect(
    within(box).getByText(
      "Projects affiliated with Seal take $800 of Tier-S's $1,200. One affiliation can hold at most half.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /send my ballot/i })).toBeDisabled();
  expect(screen.getByRole("button", { name: /send it yourself/i })).toBeDisabled();
});

it("ballot rules: a valid ballot shows no rules box and can be sent", async () => {
  round.ballotRules = true;
  localStorage.setItem(TIERS_KEY, JSON.stringify({ alpha: "S", beta: "S", gamma: "S" }));
  await ballotWith(roundBody({ poolUsd: "500000000" }));
  expect(screen.queryByRole("region", { name: "Ballot rules" })).toBeNull();
  expect(screen.getByRole("button", { name: /send my ballot/i })).toBeEnabled();
});

it("prefill: in a test round the signed-in reviewer's ratings fill a fresh ballot", async () => {
  extra.paths = {
    "/api/reviews/identity": { tokenIds: ["9", "5"], canReview: true },
    "/api/reviews/ratings?tokenId=5": {
      ratings: { alpha: { mine: 5 }, beta: { mine: 4 }, gamma: { mine: 2 } },
    },
  };
  await ballotWith(roundBody());
  const s = await screen.findByRole("list", { name: "Must fund" });
  expect(within(s).getByRole("button", { name: "ALPHA" })).toBeInTheDocument();
  expect(
    within(screen.getByRole("list", { name: "Should fund" })).getByRole("button", { name: "BETA" }),
  )
    .toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Nice to have" })).toBeNull();
  // 2★ is skipped: off the list, behind the link at its end.
  expect(screen.getByText("All ranked or skipped.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Show 1 skipped/ }));
  expect(within(screen.getByRole("list", { name: "Skipped" })).getByText("GAMMA"))
    .toBeInTheDocument();
});

it("prefill: a counted ballot or a saved draft wins over ratings", async () => {
  extra.paths = {
    "/api/reviews/identity": { tokenIds: ["5"], canReview: true },
    "/api/reviews/ratings?tokenId=5": { ratings: { alpha: { mine: 5 } } },
  };
  localStorage.setItem(TIERS_KEY, JSON.stringify({ gamma: "B" }));
  await ballotWith(roundBody());
  expect(await screen.findByRole("list", { name: "Nice to have" })).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Must fund" })).toBeNull();
  cleanup();
  localStorage.clear();
  await ballotWith(roundBody({ accepted: { "17": "0xffff01" } }));
  expect(await screen.findByRole("list", { name: "Must fund" })).toBeInTheDocument();
  expect(
    within(screen.getByRole("list", { name: "Must fund" })).getByRole("button", { name: "GAMMA" }),
  )
    .toBeInTheDocument();
});

it("prefill: a ballot already counted (Tier-S settled) still gets its 1–2★ skipped, once", async () => {
  extra.paths = {
    "/api/reviews/identity": { tokenIds: ["5"], canReview: true },
    "/api/reviews/ratings?tokenId=5": {
      ratings: { alpha: { mine: 1 }, beta: { mine: 2 }, gamma: { mine: 5 } },
    },
  };
  await ballotWith(roundBody({
    accepted: { "17": "0xff01ff" },
    tiers: [
      { tier: "S", status: "settled", at: 1, forced: false, funded: [], awards: {} },
      waiting("A"),
      waiting("B"),
    ],
  }));
  // The counted ballot stays as it is (BETA in Tier-S, 2★ or not); ALPHA is skipped.
  expect(
    within(await screen.findByRole("list", { name: "Must fund" })).getByRole("button", {
      name: /^BETA/,
    }),
  ).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: /Show 1 skipped/ }));
  expect(within(screen.getByRole("list", { name: "Skipped" })).getByText("ALPHA"))
    .toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(SKIPPED_KEY)!)).toEqual(["alpha", "beta"]);
});

it("paste: settled tiers stay as counted, and the page says so", async () => {
  await ballotWith(roundBody({
    accepted: { "17": "0x01ffff" },
    tiers: [
      { tier: "S", status: "settled", at: 1, forced: false, funded: ["alpha"], awards: {} },
      waiting("A"),
      waiting("B"),
    ],
  }));
  fireEvent.click(await screen.findByRole("button", { name: "Use an LLM…" }));
  fireEvent.change(screen.getByLabelText("Paste its ballot"), { target: { value: "beta,gamma" } });
  fireEvent.click(screen.getByRole("button", { name: "Use this ballot" }));
  expect(await screen.findByText("Pasted. Settled tiers stay as they were counted."))
    .toBeInTheDocument();
  const s = screen.getByRole("list", { name: "Must fund" });
  expect(within(s).getByRole("button", { name: /^ALPHA/ })).toBeInTheDocument();
  expect(within(s).queryByRole("button", { name: /^BETA/ })).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

it("ballot rules: after a failure, Send it yourself stays off while a rule is broken", async () => {
  round.ballotRules = true;
  round.seal = true;
  flow.phase = { kind: "failed", reason: "This ballot breaks the ballot rules." };
  localStorage.setItem(TIERS_KEY, JSON.stringify({ alpha: "S", beta: "S", gamma: "S" }));
  await ballotWith(roundBody({ poolUsd: "500000000" }));
  await screen.findByRole("region", { name: "Ballot rules" });
  expect(screen.queryByRole("button", { name: "Send it yourself" })).toBeNull();
});

it("ballot rules: an empty Tier-S is refused, though the chain would read Tier-A as Tier-S", async () => {
  round.ballotRules = true;
  localStorage.setItem(TIERS_KEY, JSON.stringify({ alpha: "A", beta: "A", gamma: "A" }));
  await ballotWith(roundBody({ poolUsd: "500000000" }));
  // The ballot box says what's missing; with no affiliations to explain, no box below.
  expect(await screen.findByText("Needs at least 3 independent projects in Tier-S"))
    .toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Ballot rules" })).toBeNull();
  expect(screen.getByRole("button", { name: /send my ballot/i })).toBeDisabled();
});
