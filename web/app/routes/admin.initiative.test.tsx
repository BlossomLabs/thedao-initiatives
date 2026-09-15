import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { sendTransaction } from "wagmi/actions";
import { structuredRow } from "../../test/fixtures";
import type { AdminInitiativePage } from "~/lib/api-types";
import { api } from "~/lib/api";
import AdminInitiativeEditor from "./admin.initiative";

const wallet = vi.hoisted(() => ({ connected: true }));
const ADMIN = "0x1111111111111111111111111111111111111111";
const SAFE = "0x4534fA9FaEdE981FF7b9c9bFe112067ECA216609";
const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SIGNERS = [1, 2, 3, 4, 5].map((n) => `0x${String(n).repeat(40)}`);

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: wallet.connected ? ADMIN : undefined,
    isConnected: wallet.connected,
  }),
  useConfig: () => ({}),
}));
vi.mock("wagmi/actions", () => ({ sendTransaction: vi.fn() }));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));
vi.mock("~/components/wallet/Identity", () => ({ default: () => null }));
vi.mock("~/components/initiative-form/InitiativeForm", () => ({ default: () => null }));

const page = (over: Partial<AdminInitiativePage["initiative"]>): AdminInitiativePage => ({
  initiative: { ...structuredRow(), contact: "me@example.org", funders: "", ...over },
  revisions: [],
  summary: { pledged: 0, donated: 0, total: 0, live: false, ledger: 0, paidOut: 0 },
  pledges: [],
  donations: [],
  safeSync: null,
  signers: { ok: true, detail: "ok", list: SIGNERS, threshold: 3 },
});

let current: AdminInitiativePage;
const calls = () => vi.mocked(api).mock.calls.map(([path]) => String(path));

beforeEach(() => {
  wallet.connected = true;
  current = page({});
  vi.mocked(sendTransaction).mockReset().mockResolvedValue(("0x" + "ee".repeat(32)) as never);
  vi.mocked(api).mockReset().mockImplementation((path) => {
    const p = String(path);
    if (p === "/api/admin/initiatives/1") return Promise.resolve(current);
    if (p.endsWith("/status")) {
      // approval assigns the counterfactual address server-side
      current = page({ status: "approved", approvedAt: 1, safeAddress: SAFE });
      return Promise.resolve({ initiative: current.initiative });
    }
    if (p.endsWith("/safe-deploy-params")) {
      return Promise.resolve({
        enabled: true,
        chainId: 1,
        factory: FACTORY,
        calldata: "0x1688f0b9",
        signers: SIGNERS,
        threshold: 3,
        address: SAFE,
        deployed: false,
      });
    }
    if (p.endsWith("/safe-confirm")) {
      current = page({ status: "approved", approvedAt: 1, safeAddress: SAFE, safeDeployed: true });
      return Promise.resolve({ status: "ok", address: SAFE, detail: "verified: 3-of-5 Safe" });
    }
    return Promise.resolve({});
  });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/initiatives/1"]}>
        <Routes>
          <Route path="/admin/initiatives/:slug" element={<AdminInitiativeEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("approving sends the Safe deploy from the admin's wallet in the same motion", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  await waitFor(() =>
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: FACTORY, data: "0x1688f0b9", chainId: 1 }),
    )
  );
  await waitFor(() => expect(calls().some((c) => c.endsWith("/safe-confirm"))).toBe(true));
  const status = calls().findIndex((c) => c.endsWith("/status"));
  const params = calls().findIndex((c) => c.endsWith("/safe-deploy-params"));
  expect(status).toBeGreaterThan(-1);
  expect(params).toBeGreaterThan(status); // the address exists before the wallet is asked
  await screen.findByText("deployed and verified");
});

it("approving without a connected wallet still approves and leaves the deploy for later", async () => {
  wallet.connected = false;
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  await screen.findByText("address assigned, not deployed yet");
  expect(sendTransaction).not.toHaveBeenCalled();
  expect(calls().some((c) => c.endsWith("/status"))).toBe(true);
  await screen.findByRole("button", { name: "Connect a wallet to deploy" });
});
