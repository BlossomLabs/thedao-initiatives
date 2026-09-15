import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { sendTransaction, waitForTransactionReceipt } from "wagmi/actions";
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
vi.mock("wagmi/actions", () => ({
  sendTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));
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
let onChain = false;
const calls = () => vi.mocked(api).mock.calls.map(([path]) => String(path));
const indexOf = (suffix: string) => calls().findIndex((c) => c.endsWith(suffix));

beforeEach(() => {
  wallet.connected = true;
  onChain = false;
  current = page({});
  vi.mocked(sendTransaction).mockReset().mockImplementation(() => {
    onChain = true; // mined as far as this test is concerned
    return Promise.resolve(("0x" + "ee".repeat(32)) as never);
  });
  vi.mocked(waitForTransactionReceipt).mockReset().mockResolvedValue(
    { status: "success" } as never,
  );
  vi.mocked(api).mockReset().mockImplementation((path) => {
    const p = String(path);
    if (p === "/api/admin/initiatives/1") return Promise.resolve(current);
    if (p.endsWith("/status")) {
      if (!current.initiative.safeAddress) {
        return Promise.reject(new Error("Deploy the Safe first"));
      }
      current = page({ ...current.initiative, status: "approved", approvedAt: 1 });
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
        deployed: Boolean(current.initiative.safeAddress),
      });
    }
    if (p.endsWith("/safe-confirm")) {
      if (!onChain) return Promise.resolve({ status: "pending", detail: "no Safe yet" });
      current = page({ ...current.initiative, safeAddress: SAFE });
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

it("Approve deploys the Safe from the admin's wallet first, then approves", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  await waitFor(() =>
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: FACTORY, data: "0x1688f0b9", chainId: 1 }),
    )
  );
  await waitFor(() => expect(indexOf("/status")).toBeGreaterThan(-1));
  expect(waitForTransactionReceipt).toHaveBeenCalled();
  expect(indexOf("/safe-confirm")).toBeGreaterThan(indexOf("/safe-deploy-params"));
  expect(indexOf("/status")).toBeGreaterThan(indexOf("/safe-confirm"));
  await screen.findByText("deployed and verified");
  await screen.findByRole("button", { name: "Archive" }); // approved now
});

it("Approve goes straight to the status change when the Safe is already there", async () => {
  current = page({ safeAddress: SAFE });
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  await waitFor(() => expect(indexOf("/status")).toBeGreaterThan(-1));
  expect(sendTransaction).not.toHaveBeenCalled();
  expect(indexOf("/safe-deploy-params")).toBe(-1);
});

it("a reverted deploy is reported and nothing is approved", async () => {
  vi.mocked(waitForTransactionReceipt).mockResolvedValue({ status: "reverted" } as never);
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  await screen.findAllByText(/reverted/);
  expect(indexOf("/status")).toBe(-1);
  await screen.findByRole("button", { name: "Approve" }); // still pending
});

it("without a wallet, an initiative with no Safe cannot be approved from here", async () => {
  wallet.connected = false;
  renderPage();
  const approve = await screen.findByRole("button", { name: /Approve/ });
  expect(approve).toBeDisabled();
  expect(indexOf("/status")).toBe(-1);
});
