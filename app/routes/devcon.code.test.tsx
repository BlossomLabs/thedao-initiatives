import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      cards: ["alpha", "beta", "gamma"].map((slug) => ({
        initiative: { id: slug, slug, title: slug.toUpperCase(), goalUsd: 1000 },
        summary: { total: 0 },
      })),
    },
  }),
}));
vi.mock("~/hooks/use-devcon", async (original) => ({
  ...await original<typeof import("~/hooks/use-devcon")>(),
  useBallotSubmit: () => ({ phase: { kind: "idle" }, submit, retry: vi.fn(), last: null }),
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
  expect(await screen.findByText(/badge holder/i)).toBeInTheDocument();
  expect(screen.getByText(/\$913,244/)).toBeInTheDocument();
  expect(openWalletPicker).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /accept the challenge/i }));
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
  fireEvent.click(await screen.findByRole("button", { name: /accept the challenge/i }));
  expect(await screen.findByText(/Nice try, bad kid/)).toBeInTheDocument();
});

it("the badge's owner gets the ballot, and sending posts the encoded tiers", async () => {
  session.current = { address: ME };
  mockApi(() => Promise.resolve({ n: 17, claimed: true, owner: ME }));
  show();
  expect(await screen.findByText("ALPHA")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /BETA/ }));
  fireEvent.click(screen.getByRole("button", { name: /move here: must fund/i }));
  fireEvent.click(screen.getByRole("button", { name: /send my ballot/i }));
  await waitFor(() => expect(submit).toHaveBeenCalled());
  const [tokenId, ballot] = submit.mock.calls[0];
  expect(tokenId).toBe(17n);
  expect(ballot).toBe(bytesToHex(encodeBallot(["alpha", "beta", "gamma"], { beta: "S" })));
  expect(ballot.includes("00")).toBe(false);
});
