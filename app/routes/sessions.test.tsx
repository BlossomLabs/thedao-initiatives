import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "~/lib/api";
import Sessions from "./sessions";

const state = vi.hoisted(() => ({
  session: {
    address: "0x1111111111111111111111111111111111111111",
    isAdmin: false,
    expiresAt: 9999999999,
  } as {
    address: string;
    isAdmin: boolean;
    expiresAt: number;
  } | null,
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("~/context/session", () => ({
  useSession: () => state,
  sessionKey: (s: typeof state.session) => s?.address ?? null,
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));
vi.mock(
  "~/components/wallet/ConnectInline",
  () => ({ default: () => <button type="button">Connect wallet</button> }),
);

const rows = [
  { id: "current", current: true, isAdmin: false, createdAt: 100, lastSeenAt: 200, expiresAt: 300 },
  { id: "remote", current: false, isAdmin: false, createdAt: 101, lastSeenAt: 201, expiresAt: 301 },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Sessions />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.session = {
    address: "0x1111111111111111111111111111111111111111",
    isAdmin: false,
    expiresAt: 9999999999,
  };
  state.signIn.mockReset().mockResolvedValue(state.session);
  state.signOut.mockReset().mockResolvedValue(undefined);
  vi.mocked(api).mockReset().mockImplementation((path) => {
    if (path === "/api/auth/sessions") return Promise.resolve({ sessions: rows });
    return Promise.resolve({ ok: true });
  });
});
afterEach(cleanup);

it("waits for fresh wallet authentication before revoking another session", async () => {
  let finish!: () => void;
  state.signIn.mockImplementation(() =>
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "End session" }));
  expect(state.signIn).toHaveBeenCalledOnce();
  expect(api).not.toHaveBeenCalledWith("/api/auth/sessions/remote", expect.anything());
  finish();
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/auth/sessions/remote", { method: "DELETE" })
  );
  expect(state.signOut).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Administrator controls" })).not.toBeInTheDocument();
});

it("keeps sessions intact if the wallet refuses reauthentication", async () => {
  state.signIn.mockRejectedValue(new Error("Signature rejected"));
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "End session" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Signature rejected");
  expect(api).not.toHaveBeenCalledWith("/api/auth/sessions/remote", expect.anything());
});

it("requires the explicit global scope and signs out after administrator global revocation", async () => {
  state.session!.isAdmin = true;
  renderPage();
  const button = await screen.findByRole("button", { name: "Revoke all sessions" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Revoke every session on the site/), {
    target: { value: "revoke all sessions" },
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/admin/sessions/revoke-all", {
      json: { confirmation: "revoke all sessions" },
    })
  );
  expect(state.signIn).toHaveBeenCalledOnce();
  await waitFor(() => expect(state.signOut).toHaveBeenCalledOnce());
});

it("does not render session inventory when signed out", () => {
  state.session = null;
  renderPage();
  expect(screen.queryByRole("list", { name: "Active sessions" })).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});
