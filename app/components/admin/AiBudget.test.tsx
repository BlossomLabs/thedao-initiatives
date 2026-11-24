import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import AiBudget from "./AiBudget";
import type { AiBudgetState } from "~/lib/api-types";

vi.mock("~/context/session", () => ({
  useSession: () => ({ session: { address: "admin", isAdmin: true }, signIn: vi.fn() }),
  sessionKey: () => "admin:true",
}));

const api = vi.fn();
vi.mock("~/lib/api", async (orig) => ({
  ...(await orig<typeof import("~/lib/api")>()),
  api: (...args: unknown[]) => api(...args),
}));

const FULL: AiBudgetState = {
  day: "2026-11-24",
  used: 1000,
  cap: 1000,
  supportUsed: 12,
  supportCap: 200,
};

function mount(initial: AiBudgetState) {
  let state = initial;
  api.mockReset();
  api.mockImplementation((path: string) => {
    if (path === "/api/admin/ai-budget") return Promise.resolve(state);
    if (path === "/api/admin/ai-budget/reset") {
      state = { ...state, used: 0, supportUsed: 0 };
      return Promise.resolve(state);
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AiBudget />
    </QueryClientProvider>,
  );
}

test("a used-up day says search is resting, and Reset gives the calls back", async () => {
  mount(FULL);
  expect(await screen.findByText("1,000 of 1,000")).toBeInTheDocument();
  expect(screen.getByText(/Search is resting/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Reset AI caps/ }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/admin/ai-budget/reset", { json: {} }));
  expect(await screen.findByText(/caps are back in full/)).toBeInTheDocument();
  expect(screen.getByText("0 of 1,000")).toBeInTheDocument();
  expect(screen.queryByText(/Search is resting/)).toBeNull();
  expect(screen.getByRole("button", { name: /Reset AI caps/ })).toBeDisabled();
});
