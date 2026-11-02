import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bytesToHex } from "viem";
import { api, ApiError } from "~/lib/api";
import { encodeBallot } from "../../shared/devcon/ballot";
import DevconCode from "./devcon.code";

const ME = "0x1111111111111111111111111111111111111111";
const SOMEONE = "0x2222222222222222222222222222222222222222";

const session = { current: null as null | { address: string } };
const openWalletPicker = vi.fn();
const signOut = vi.fn(() => Promise.resolve(true));
const submit = vi.fn();
const selfSend = vi.fn();
const retry = vi.fn();
const flow = { phase: { kind: "idle" } as { kind: string; reason?: string } };

vi.mock("../../shared/devcon/manifest", async (original) => ({
  ...await original<typeof import("../../shared/devcon/manifest")>(),
  DEVCON: {
    chainId: 11155111,
    contract: "0x1000000000000000000000000000000000000001",
    deployBlock: 1,
    opensAt: 0,
    closesAt: 4_000_000_000,
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
          categories: [],
          goalUsd: 1000,
        },
        summary: { total: 0 },
      })),
    },
  }),
}));
vi.mock("~/hooks/use-devcon", async (original) => ({
  ...await original<typeof import("~/hooks/use-devcon")>(),
  useBallotSubmit: () => ({ phase: flow.phase, submit, retry, selfSend, last: null }),
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
      if (path.startsWith("/api/devcon/code/")) return code();
      if (path === "/api/devcon/claim") return claim ? claim() : Promise.resolve({ hash: "0x1" });
      return Promise.reject(new Error("unexpected " + path));
    }) as typeof api,
  );
}

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/devcon/${CODE}`]}>
        <Routes>
          <Route path="/devcon/:code" element={<DevconCode />} />
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
  fireEvent.click(screen.getByRole("button", { name: /claim my devcon badge/i }));
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
  fireEvent.click(await screen.findByRole("button", { name: /claim my devcon badge/i }));
  expect(await screen.findByText(/Nice try, bad kid/)).toBeInTheDocument();
});

it("the badge's owner gets the ballot, and sending posts the encoded tiers", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  expect(await screen.findByText("ALPHA")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /BETA/ }));
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
  fireEvent.click(await screen.findByRole("button", { name: /BETA/ }));
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
  fireEvent.click(await screen.findByRole("button", { name: /claim my devcon badge/i }));
  expect(openWalletPicker).toHaveBeenCalledTimes(1);
  // The sign-in modal finishes and the page comes back signed in (a fresh mount).
  cleanup();
  session.current = { address: ME };
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  show();
  await waitFor(() =>
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      "/api/devcon/claim",
      expect.objectContaining({ method: "POST", json: { code: CODE } }),
    )
  );
  // On to the ballot, no second "Accept the challenge".
  expect(await screen.findByRole("button", { name: /send my ballot|place at least one/i }))
    .toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /claim my devcon badge/i })).toBeNull();
  // The ballot starts at the top, not where the claim button was.
  expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  scrollTo.mockRestore();
});

it("without accepting, a signed-in visitor still sees the intro and claims only on the button", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: false, owner: null }));
  show();
  expect(await screen.findByRole("button", { name: /claim my devcon badge/i })).toBeInTheDocument();
  expect(vi.mocked(api)).not.toHaveBeenCalledWith("/api/devcon/claim", expect.anything());
});

it("the automatic claim after sign-in is sent once, even when effects run twice (StrictMode)", async () => {
  sessionStorage.setItem(`devcon-accepted:0x1000000000000000000000000000000000000001:${CODE}`, "1");
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
        <MemoryRouter initialEntries={[`/devcon/${CODE}`]}>
          <Routes>
            <Route path="/devcon/:code" element={<DevconCode />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
  await waitFor(() =>
    expect(vi.mocked(api).mock.calls.filter(([p]) => p === "/api/devcon/claim").length).toBe(1)
  );
  await new Promise((r) => setTimeout(r, 50));
  expect(vi.mocked(api).mock.calls.filter(([p]) => p === "/api/devcon/claim").length).toBe(1);
  resolveClaim({ hash: "0x1" });
});

it("the ballot: search narrows the unranked list; a tile's tier buttons place it", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  expect(await screen.findByText("ALPHA")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: /search initiatives/i }), {
    target: { value: "bridges" },
  });
  expect(screen.queryByText("ALPHA")).toBeNull();
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
      if (path.startsWith("/api/devcon/code/")) {
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
  const box = screen.getByRole("textbox", { name: /search initiatives/i });
  fireEvent.change(box, { target: { value: "who protects cross-chain bridges" } });
  fireEvent.submit(box.closest("form")!);
  expect(await screen.findByText(/ordered by ai relevance/i)).toBeInTheDocument();
  const order = within(screen.getByRole("list", { name: "Not ranked yet" }))
    .getAllByRole("button").map((b) => b.getAttribute("data-ballot-tile"));
  expect(order).toEqual(["gamma", "alpha", "beta"]);
  fireEvent.click(screen.getByRole("button", { name: /back to keywords/i }));
  expect(screen.queryByText(/ordered by ai relevance/i)).toBeNull();
});
