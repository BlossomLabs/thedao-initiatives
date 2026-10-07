vi.mock("~/context/session", () => ({
  useSession: () => ({
    session: {
      address: "0x1111111111111111111111111111111111111111",
      isAdmin: true,
      expiresAt: 9999999999,
    },
    signIn: vi.fn(),
  }),
  sessionKey: () => "admin",
}));
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { sendTransaction, waitForTransactionReceipt } from "wagmi/actions";
import { structuredRow } from "../../test/fixtures";
import type { AdminInitiativePage } from "~/lib/api-types";
import { api } from "~/lib/api";
import ManageInitiative from "./admin.initiative";

const wallet = vi.hoisted(() => ({ connected: true }));
const ADMIN = "0x1111111111111111111111111111111111111111";
const SAFE = "0x4534fA9FaEdE981FF7b9c9bFe112067ECA216609";
const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SIGNERS = [1, 2, 3, 4, 5].map((n) => `0x${String(n).repeat(40)}`);

vi.mock("~/context/wallet", () => ({
  useWallet: () => ({
    address: wallet.connected ? ADMIN : undefined,
    isConnected: wallet.connected,
  }),
  useWalletStore: () => ({ load: () => Promise.resolve({ config: {} }) }),
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

const page = (over: Partial<AdminInitiativePage["initiative"]>): AdminInitiativePage => ({
  initiative: {
    ...structuredRow(),
    contact: "me@example.org",
    funders: "",
    pendingRevision: null,
    ...over,
  },
  revisions: [],
  summary: { pledged: 0, received: 0, donated: 0, total: 0, live: false, ledger: 0, paidOut: 0 },
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
        deployed: Boolean(current.initiative.safeAddress) || onChain,
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
          <Route path="/admin/initiatives/:slug" element={<ManageInitiative />} />
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

it("a Safe already on-chain but unbound: the card offers to link it, no wallet needed", async () => {
  onChain = true; // mined earlier under a hash the browser lost track of
  wallet.connected = false;
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Link the Safe" }));
  await screen.findByText("deployed and verified");
  expect(sendTransaction).not.toHaveBeenCalled();
  expect(indexOf("/safe-confirm")).toBeGreaterThan(-1);
  expect(screen.queryByRole("button", { name: /Deploy Safe now/ })).toBeNull();
});

it("linking a Safe that does not match the spec is refused and reported", async () => {
  onChain = true;
  const base = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation((path, opts) =>
    String(path).endsWith("/safe-confirm")
      ? Promise.reject(new Error("Safe at 0x9239 REJECTED: threshold is 2, expected 3"))
      : base(path, opts)
  );
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Link the Safe" }));
  await screen.findByText(/REJECTED: threshold is 2/);
  expect(screen.queryByText("deployed and verified")).toBeNull();
  await screen.findByRole("button", { name: "Link the Safe" }); // still unbound
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

it("has no editor: the text is edited on the edit page, while it is open for edits", async () => {
  renderPage();
  const edit = await screen.findByRole("link", { name: "Edit initiative" });
  expect(edit).toHaveAttribute("href", `/initiative/${current.initiative.slug}/edit`);
  expect(document.getElementById("f-title")).toBeNull();
});

it("shows the formatted text in a box: open for a pending review, folded after", async () => {
  renderPage();
  const toggle = await screen.findByRole("button", { name: "Initiative text" });
  const box = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(within(box).getByText("why grant")).toBeVisible();
  expect(within(box).getByText("Only milestone")).toBeVisible();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  // Folded, the start of the text still shows, out of reach of the keyboard.
  expect(within(box).getByText("why grant")).toBeInTheDocument();
  expect(box).toHaveAttribute("inert");
});

it("the text box starts folded once the initiative is approved", async () => {
  current = page({ status: "approved", safeAddress: SAFE });
  renderPage();
  const toggle = await screen.findByRole("button", { name: "Initiative text" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("link", { name: "Edit initiative" })).toBeInTheDocument();
});

it("an archived initiative offers no edit link", async () => {
  current = page({ status: "archived", safeAddress: SAFE });
  renderPage();
  await screen.findByRole("button", { name: "Re-approve" });
  expect(screen.queryByRole("link", { name: "Edit initiative" })).toBeNull();
  expect(screen.getByText(/closed for edits while it is archived/)).toBeInTheDocument();
});

it("settings: only the changed field is sent", async () => {
  current = page({ proposer: ADMIN, sortRank: 2, paidOutUsd: 0 });
  renderPage();
  const save = await screen.findByRole("button", { name: "Save settings" });
  expect(save).toBeDisabled();
  expect(screen.getByLabelText(/^Owner/)).toHaveValue(ADMIN);
  fireEvent.change(screen.getByLabelText(/^Pin to board position/), { target: { value: "5" } });
  fireEvent.click(save);
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/admin/initiatives/1", {
      method: "PATCH",
      json: { sortRank: "5" },
    })
  );
  await screen.findByText("Settings saved.");
});

it("open points: the edit page's checks, read next to Approve", async () => {
  renderPage();
  await screen.findByRole("button", { name: "Approve" });
  expect(screen.getByText(/passes every check of the edit page/)).toBeInTheDocument();
});

it("open points: a missing section is listed", async () => {
  current = page({ sections: { ...structuredRow().sections, why: "" } });
  renderPage();
  await screen.findByRole("button", { name: "Approve" });
  expect(screen.getByText(/Why this matters is required/)).toBeInTheDocument();
});
it("the header row shows the type and the categories as one tight group, not the status", async () => {
  current = page({ categories: ["opsec", "defi"] });
  renderPage();
  const h1 = await screen.findByRole("heading", { level: 1 });
  const row = h1.nextElementSibling as HTMLElement;
  expect(row.querySelector(".st-pending, [class*='st-']")).toBeNull();
  const group = row.querySelector("[data-categories]") as HTMLElement;
  expect(group).not.toBeNull();
  expect(group.children).toHaveLength(2);
  expect(group.className).toContain("gap-1.5");
});

it("saving the categories posts a revision with them alone, through the proposer's route", async () => {
  current = page({ categories: ["opsec", "defi"] });
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Remove DeFi Safety" }));
  fireEvent.click(screen.getByRole("button", { name: "Save categories" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/initiatives/audit-tooling/revisions", {
      json: { categories: ["opsec"], initiativeId: "1" },
    })
  );
  expect(
    vi.mocked(api).mock.calls.some(([, o]) => (o as { method?: string })?.method === "PATCH"),
  ).toBe(false);
});

/** The page with a proposer's edit (revision 3) waiting: a new title and one category swapped. */
function withPendingEdit() {
  current = page({
    status: "approved",
    safeAddress: SAFE,
    revision: 2,
    pendingRevision: 3,
    categories: ["opsec", "defi"],
  });
  const revision = {
    ...structuredRow(),
    title: "Audit tooling for sharper rollups",
    categories: ["opsec", "wallets-signing"],
    structured: true,
    n: 3,
    author: "0x2222222222222222222222222222222222222222",
    source: "proposer",
    state: "pending",
    archived: false,
    createdAt: 1_760_000_000,
  };
  const fallback = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation((path, options) =>
    String(path) === "/api/initiatives/audit-tooling/revisions/3"
      ? Promise.resolve({ revision })
      : fallback(path, options)
  );
}

it("an edit awaiting approval shows what it changes against the live text, and Accept publishes it", async () => {
  withPendingEdit();
  renderPage();
  const panel = (await screen.findByText("Edit awaiting approval")).closest(
    ".panel",
  ) as HTMLElement;
  await waitFor(() => expect(panel.querySelector("ins")).not.toBeNull());
  expect(within(panel).getByText("Title")).toBeInTheDocument();
  expect(panel.querySelector(".diff ins")).toHaveTextContent("sharper");
  const tags = panel.querySelector("[data-categories]") as HTMLElement;
  expect(tags.querySelector("ins")).toHaveTextContent("Wallets");
  expect(tags.querySelector("del")).toHaveTextContent("DeFi");
  // the sections nobody touched are not listed
  expect(within(panel).queryByText("Summary")).toBeNull();
  fireEvent.click(within(panel).getByRole("button", { name: "Accept edit" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/admin/initiatives/1/revisions/3/accept", { json: {} })
  );
});

it("rejecting an edit sends the optional note for the proposer", async () => {
  withPendingEdit();
  renderPage();
  const panel = (await screen.findByText("Edit awaiting approval")).closest(
    ".panel",
  ) as HTMLElement;
  fireEvent.click(within(panel).getByRole("button", { name: "Reject…" }));
  fireEvent.change(within(panel).getByLabelText("Note for the proposer (optional)"), {
    target: { value: "Out of scope." },
  });
  fireEvent.click(within(panel).getByRole("button", { name: "Reject edit" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/admin/initiatives/1/revisions/3/reject", {
      json: { note: "Out of scope." },
    })
  );
});

it("no edit waiting: no approval panel", async () => {
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByText("Edit awaiting approval")).toBeNull();
});
