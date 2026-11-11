import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "~/lib/api";
import ConnectButton from "./ConnectButton";

const ME = "0x1111111111111111111111111111111111111111";
const round = vi.hoisted(() => ({ contract: "0x1000000000000000000000000000000000000001" }));
const navigate = vi.fn();

vi.mock("../../../shared/vote/manifest", async (original) => {
  const m = await original<typeof import("../../../shared/vote/manifest")>();
  return {
    ...m,
    roundDeployed: () => !/^0x0{40}$/i.test(round.contract),
  };
});
vi.mock("react-router", async (original) => ({
  ...await original<typeof import("react-router")>(),
  useNavigate: () => navigate,
}));
vi.mock("~/context/wallet", () => ({
  useWallet: () => ({ address: ME, isConnected: true }),
}));
vi.mock("~/context/session", () => ({
  useSession: () => ({
    session: { address: ME, isAdmin: false },
    me: { isBadgeHolder: false },
    connecting: false,
    signingIn: false,
    signOut: vi.fn(),
  }),
  sessionKey: (s: { address: string } | null) => s?.address ?? null,
}));
vi.mock("~/context/profile-dialog", () => ({
  useProfileDialog: () => ({ profileOpen: false, openProfile: vi.fn() }),
}));
vi.mock("~/context/wallet-picker", () => ({
  useWalletPicker: () => ({ openWalletPicker: vi.fn(), walletPickerOpen: false }),
}));
vi.mock("~/hooks/use-identity", () => ({
  useIdentity: () => ({ name: "me", avatar: null, hasName: false }),
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ConnectButton />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /me/ }));
}

beforeEach(() => {
  round.contract = "0x1000000000000000000000000000000000000001";
  vi.mocked(api).mockReset();
  navigate.mockReset();
});
afterEach(cleanup);

it("a voter in the round gets Vote in the menu, which opens the ballot", async () => {
  vi.mocked(api).mockResolvedValue({ ids: [12] });
  show();
  fireEvent.click(await screen.findByText("Vote"));
  expect(navigate).toHaveBeenCalledWith("/vote/ballot");
});

it("an account without a badge in the round gets no Vote", async () => {
  vi.mocked(api).mockResolvedValue({ ids: [] });
  show();
  await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("/api/vote/mine"));
  expect(await screen.findByText("My initiatives")).toBeInTheDocument();
  expect(screen.queryByText("Vote")).toBeNull();
});

it("with no round deployed: no Vote, and nobody asks", async () => {
  round.contract = `0x${"0".repeat(40)}`;
  show();
  expect(await screen.findByText("My initiatives")).toBeInTheDocument();
  expect(screen.queryByText("Vote")).toBeNull();
  expect(vi.mocked(api)).not.toHaveBeenCalledWith("/api/vote/mine");
});
