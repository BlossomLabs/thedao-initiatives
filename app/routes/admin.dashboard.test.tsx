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
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );

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
  fireEvent.click(screen.getByRole("button", { name: "Clear search and category" }));
  expect(box).toHaveValue("");
  expect(screen.getByText("Echidna fuzzing")).toBeInTheDocument();
  expect(screen.getByText(/4 of 4/)).toBeInTheDocument();
});
