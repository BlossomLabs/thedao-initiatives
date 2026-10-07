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
import type { AdminDashboard, AdminInitiative } from "~/lib/api-types";
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
