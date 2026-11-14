vi.mock("~/context/session", () => ({
  useSession: () => ({
    session: {
      address: "0x1111111111111111111111111111111111111111",
      isAdmin: true,
      expiresAt: 9999999999,
    },
    signOut: vi.fn(),
  }),
  sessionKey: () => "admin",
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));
vi.mock("~/hooks/use-site-settings", () => ({ useSiteSettings: () => ({ data: undefined }) }));
vi.mock("~/components/admin/SyncContent", () => ({ default: () => null }));
vi.mock("~/components/admin/Admins", () => ({ default: () => null }));
import { MemoryRouter, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { structuredRow } from "../../test/fixtures";
import type { AdminDashboard, AdminInitiative, HeldComment } from "~/lib/api-types";
import { api } from "~/lib/api";
import Dashboard from "./admin.dashboard";

const summary = {
  pledged: 0,
  received: 0,
  donated: 0,
  total: 0,
  live: false,
  ledger: 0,
  paidOut: 0,
};
const row = (id: string, over: Partial<AdminInitiative>) => ({
  initiative: {
    ...structuredRow(),
    id,
    slug: `slug-${id}`,
    contact: "",
    categories: [],
    ...over,
  } as unknown as AdminInitiative,
  summary,
  safeSync: null,
});

const dashboard: AdminDashboard = {
  rows: [
    row("1", {
      title: "Echidna fuzzing",
      type: "grant",
      status: "approved",
      contact: "Gustavo @ggrieco",
    }),
    row("2", {
      title: "Safe Lockdown Guard",
      type: "rfp",
      status: "approved",
      contact: "ops@safe.example",
    }),
    row("3", { title: "Directory of Value", type: "rfp", status: "approved" }),
    row("4", { title: "Pending grant", type: "grant", status: "pending" }),
  ],
  pendingCount: 1,
  chain: { detail: "ok", checkedAt: 0 },
  held: [],
  unanswered: [],
  reported: [],
  weekAgo: 0,
  bell: 0,
  safeApi: { configured: true, quota: null, refreshMinutes: 5 },
  signers: { ok: true, detail: "3 of 5", list: [], threshold: 3 },
};

beforeEach(() => {
  vi.mocked(api).mockReset().mockImplementation((path) =>
    String(path) === "/api/admin/dashboard"
      ? Promise.resolve(dashboard)
      : Promise.reject(new Error(`unexpected ${String(path)}`))
  );
});

const where = { search: "" };
function Location() {
  where.search = useLocation().search;
  return null;
}
const mount = (url = "/admin") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <Dashboard />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
const box = () => screen.findByRole("searchbox", { name: "Search by project or contact" });

it("the first status card counts the approved initiatives by type, as on the board", async () => {
  mount();
  expect(await screen.findByText("3 approved")).toBeInTheDocument();
  expect(screen.getByText("1 grant")).toBeInTheDocument();
  expect(screen.getByText("2 RFPs")).toBeInTheDocument();
});

it("the search filters the table by project or contact as you type", async () => {
  mount();
  const box = await screen.findByRole("searchbox", { name: "Search by project or contact" });
  fireEvent.change(box, { target: { value: "lockdown" } });
  expect(screen.getByText("Safe Lockdown Guard")).toBeInTheDocument();
  expect(screen.queryByText("Echidna fuzzing")).toBeNull();
  expect(screen.getByText(/1 of 4/)).toBeInTheDocument();
  fireEvent.change(box, { target: { value: "ggrieco" } });
  expect(screen.getByText("Echidna fuzzing")).toBeInTheDocument();
  expect(screen.queryByText("Safe Lockdown Guard")).toBeNull();
});

it("when nothing matches, the table says so and one click clears the search", async () => {
  mount();
  const box = await screen.findByRole("searchbox", { name: "Search by project or contact" });
  fireEvent.change(box, { target: { value: "nothing like this" } });
  expect(screen.getByText(/No initiatives match\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
  expect(box).toHaveValue("");
  expect(screen.getByText("Echidna fuzzing")).toBeInTheDocument();
  expect(screen.getByText(/4 of 4/)).toBeInTheDocument();
});

it("the user's example: type:grant status:pending First QA", async () => {
  mount();
  fireEvent.change(await box(), { target: { value: "type:grant status:pending grant" } });
  expect(screen.getByText("Pending grant")).toBeInTheDocument();
  expect(screen.queryByText("Echidna fuzzing")).toBeNull();
  expect(screen.getByText(/1 of 4/)).toBeInTheDocument();
});

it("typing a qualifier moves its pill; the query lives in the URL", async () => {
  mount();
  fireEvent.change(await box(), { target: { value: "status:pending" } });
  expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Pending");
  await waitFor(() => expect(where.search).toBe("?q=status%3Apending"));
});

it("picking a pill writes its qualifier into the query, keeping the words", async () => {
  mount();
  const input = await box();
  fireEvent.change(input, { target: { value: "lockdown" } });
  const status = screen.getByRole("combobox", { name: "Status" });
  status.focus();
  fireEvent.keyDown(status, { key: "ArrowDown" });
  const approved = await screen.findByRole("option", { name: /Approved/ });
  for (let i = 0; i < 6 && !approved.hasAttribute("data-highlighted"); i++) {
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 20));
  }
  fireEvent.keyDown(approved, { key: "Enter" });
  expect(input).toHaveValue("lockdown status:approved");
  expect(screen.getByText("Safe Lockdown Guard")).toBeInTheDocument();
});

it("a shared URL restores the view", async () => {
  mount("/admin?q=type%3Arfp");
  expect(await box()).toHaveValue("type:rfp");
  expect(screen.getByText(/2 of 4/)).toBeInTheDocument();
  expect(screen.queryByText("Echidna fuzzing")).toBeNull();
});

it("an unknown value is named and ignored", async () => {
  mount();
  fireEvent.change(await box(), { target: { value: "status:pendng" } });
  expect(screen.getByText(/Unknown status: pendng\./)).toBeInTheDocument();
  expect(screen.getByText(/4 of 4/)).toBeInTheDocument();
});

it("the untagged count fills in cat:untagged", async () => {
  mount();
  await box();
  fireEvent.click(screen.getByRole("button", { name: /4 untagged/ }));
  expect(await box()).toHaveValue("cat:untagged");
});

it("edits in review: a count that fills in edit:review, and a mark on the row", async () => {
  vi.mocked(api).mockImplementation((path) =>
    String(path) === "/api/admin/dashboard"
      ? Promise.resolve({
        ...dashboard,
        rows: dashboard.rows.map((r, i) =>
          i === 1 ? { ...r, initiative: { ...r.initiative, pendingRevision: 3 } } : r
        ),
      })
      : Promise.resolve({})
  );
  mount();
  await box();
  fireEvent.click(screen.getByRole("button", { name: /1 edit in review/ }));
  expect(await box()).toHaveValue("edit:review");
  await waitFor(() => expect(screen.getByText(/1 of 4/)).toBeInTheDocument());
  expect(screen.getByText("edit in review")).toBeInTheDocument();
});

it("no edits in review: no count to click", async () => {
  mount();
  await box();
  expect(screen.queryByRole("button", { name: /in review/ })).toBeNull();
});

const HELD_ADDR = "0x1563915e194D8CfBA1943570603F7606A3115508";
const heldRow = (over: Partial<HeldComment> = {}): HeldComment => ({
  id: "c1",
  type: "other",
  topic: "",
  body: "https://claim-airdrop.example/x",
  displayName: "",
  address: HELD_ADDR,
  roles: [],
  answered: false,
  reviewed: false,
  accepted: false,
  featured: 0,
  votes: 0,
  myvote: 0,
  createdAt: 1_800_000_000,
  replies: [],
  initiativeId: "1",
  parentId: "p1",
  status: "held",
  email: "",
  reports: 0,
  aiSummary: "",
  aiScreen: {
    verdict: null,
    nameFlag: null,
    reason: "AI screen failed: timeout: no answer in 25 s",
    error: "timeout: no answer in 25 s",
    at: 1_800_000_000,
  },
  initiative: { slug: "slug-1", title: "Echidna fuzzing" },
  context: {
    parent: {
      id: "p1",
      body: "What does the audit cover?",
      displayName: "Asker",
      address: "",
      status: "published",
    },
    author: {
      address: HELD_ADDR,
      admin: false,
      proposerOf: [{
        slug: "slug-3",
        title: "Directory of Value",
        status: "approved",
        here: false,
      }],
      backed: [{ slug: "slug-1", title: "Echidna fuzzing", usd: 25, here: true }],
      badge: false,
      comments: { published: 2, held: 1, discarded: 1 },
      firstSeen: 1_790_000_000,
    },
  },
  ...over,
} as unknown as HeldComment);

const withHeld = (held: HeldComment[]) =>
  vi.mocked(api).mockImplementation((path) =>
    String(path) === "/api/admin/dashboard"
      ? Promise.resolve({ ...dashboard, held })
      : Promise.resolve({})
  );

it("a held reply shows its thread, the screen's reason, and who wrote it", async () => {
  withHeld([heldRow()]);
  mount();
  expect(await screen.findByText("No answer")).toBeInTheDocument();
  expect(screen.getByText("The screen failed: timeout: no answer in 25 s")).toBeInTheDocument();
  expect(screen.queryByText("AI screen error")).toBeNull();
  // The link is text, not a link, with its domain flagged.
  const body = screen.getByTestId("held-body");
  expect(body).toHaveTextContent("https://claim-airdrop.example/x");
  expect(body.querySelector("a")).toBeNull();
  expect(screen.getByText("claim-airdrop.example")).toBeInTheDocument();
  expect(screen.getByText(/not the board, a code host or a known forum/)).toBeInTheDocument();
  expect(screen.getByText("What does the audit cover?")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the thread" }))
    .toHaveAttribute("href", "/initiative/slug-1#qa-p1");
  expect(screen.getByText(HELD_ADDR)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the address on Etherscan" }))
    .toHaveAttribute("href", `https://etherscan.io/address/${HELD_ADDR}`);
  expect(screen.getByText("Proposer of Directory of Value")).toBeInTheDocument();
  expect(screen.getByText("Backer: $25.00 to this initiative")).toBeInTheDocument();
  expect(screen.getByText("Comments: 2 published · 1 held · 1 discarded")).toBeInTheDocument();
  expect(screen.getByText("No ETHSecurity badge")).toBeInTheDocument();
});

it("re-run AI screen asks the API again for that row", async () => {
  withHeld([heldRow()]);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Re-run AI screen" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/admin/comments/c1/rescreen", { method: "POST" })
  );
});

it("an older held row without a recorded screen says how to find out why", async () => {
  withHeld([heldRow({ aiScreen: null, aiSummary: "AI screen error" })]);
  mount();
  expect(await screen.findByText(/Re-run to see why it was held/)).toBeInTheDocument();
});
