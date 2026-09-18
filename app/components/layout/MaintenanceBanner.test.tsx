import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MaintenanceBanner from "./MaintenanceBanner";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

function mount(maintenance: { on: boolean; at: number; note: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url === "/api/board/settings"
          ? json({ uploads: false, support: false, maintenance })
          : json({ error: "no" }),
      )
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MaintenanceBanner />
    </QueryClientProvider>,
  );
}

it("renders nothing while the site is open", async () => {
  mount({ on: false, at: 0, note: "" });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("shows the note and what is paused while maintenance is on", async () => {
  mount({ on: true, at: 1, note: "Moving the database" });
  const banner = await screen.findByRole("status");
  expect(banner).toHaveTextContent("Maintenance in progress: Moving the database.");
  expect(banner).toHaveTextContent("posting, editing and donating are paused");
});
