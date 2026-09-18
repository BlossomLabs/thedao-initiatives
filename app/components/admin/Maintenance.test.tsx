import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Maintenance from "./Maintenance";
import type { MaintenanceState } from "~/lib/api-types";

vi.mock("~/context/session", () => ({
  useSession: () => ({ session: { address: "admin", isAdmin: true }, signIn: vi.fn() }),
  sessionKey: () => "admin:true",
}));

const api = vi.fn();
vi.mock("~/lib/api", async (orig) => ({
  ...(await orig<typeof import("~/lib/api")>()),
  api: (...args: unknown[]) => api(...args),
}));

const OFF: MaintenanceState = { on: false, by: "", at: 0, note: "" };
const ON: MaintenanceState = { on: true, by: "0xadmin", at: 1_800_000_000, note: "Moving" };
const BACKUP = {
  format: "thedao-kv-backup/1",
  exportedAt: "x",
  prefixes: { rfp: 1 },
  entries: [{ key: ["rfp", "1"], value: { id: "1" } }],
};

const clicks: string[] = [];
beforeEach(() => {
  clicks.length = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:backup"),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      clicks.push(this.getAttribute("download") ?? "");
    },
  );
});
afterEach(() => vi.restoreAllMocks());

function mount(initial: MaintenanceState) {
  let state = initial;
  api.mockReset();
  api.mockImplementation((path: string, opts?: { json?: unknown; method?: string }) => {
    if (path === "/api/admin/maintenance") return Promise.resolve(state);
    if (path === "/api/admin/maintenance/enter") {
      state = { ...ON, note: (opts?.json as { note: string }).note };
      return Promise.resolve(state);
    }
    if (path === "/api/admin/maintenance/exit") {
      state = { ...state, on: false, note: "" };
      return Promise.resolve(state);
    }
    if (path === "/api/admin/backup") return Promise.resolve(BACKUP);
    if (path === "/api/admin/restore") {
      return Promise.resolve({ written: 1, skipped: 2, claimsRebuilt: 0 });
    }
    return Promise.reject(new Error("unexpected " + path));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Maintenance />
    </QueryClientProvider>,
  );
}

test("entering maintenance posts the note and the card flips to on", async () => {
  mount(OFF);
  expect(await screen.findByText(/Maintenance is off/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Restore/ })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Note for visitors"), { target: { value: "Moving" } });
  fireEvent.click(screen.getByRole("button", { name: "Enter maintenance mode" }));
  expect(await screen.findByText(/Maintenance is on/)).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/api/admin/maintenance/enter", { json: { note: "Moving" } });
  expect(screen.getByRole("button", { name: /Restore/ })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Exit maintenance mode" }));
  expect(await screen.findByText(/Maintenance is off/)).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/api/admin/maintenance/exit", { json: {} });
});

test("downloading a backup saves the JSON the API returns", async () => {
  mount(OFF);
  await screen.findByText(/Maintenance is off/);
  fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
  await waitFor(() => expect(clicks.length).toBe(1));
  expect(clicks[0]).toMatch(/^thedao-kv-backup-.*\.json$/);
  expect(api).toHaveBeenCalledWith("/api/admin/backup", expect.anything());
  expect(screen.getByRole("status")).toHaveTextContent("1 entries");
});

test("restoring a file posts it in merge mode and reports the counts; a bad file shows inline", async () => {
  mount(ON);
  await screen.findByText(/Maintenance is on/);
  const input = screen.getByLabelText("Backup file") as HTMLInputElement;
  const good = new File([JSON.stringify(BACKUP)], "backup.json", { type: "application/json" });
  fireEvent.change(input, { target: { files: [good] } });
  fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
  expect(await screen.findByRole("status")).toHaveTextContent("1 written, 2 skipped");
  expect(api).toHaveBeenCalledWith("/api/admin/restore", {
    json: { mode: "merge", backup: BACKUP },
  });

  const bad = new File(["not json"], "bad.json", { type: "application/json" });
  fireEvent.change(input, { target: { files: [bad] } });
  fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not a backup file");
});
