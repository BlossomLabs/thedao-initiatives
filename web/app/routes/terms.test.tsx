import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TermsPage from "./terms";
import TermsVersionPage from "./terms.version";
import { TERMS } from "~/data/terms";

const V1 = "1".repeat(64);
const V2 = "2".repeat(64);
const now = Date.now() / 1000;
const current = {
  id: V2,
  effectiveDate: "2026-10-01",
  material: true,
  publishedAt: now - 86400,
  text: "# Terms v2\n\nThe new text.",
};
const versions = {
  current: V2,
  versions: [
    { id: V2, effectiveDate: "2026-10-01", material: true, publishedAt: now - 86400 },
    { id: V1, effectiveDate: "2026-09-06", material: false, publishedAt: now - 30 * 86400 },
  ],
};
const v1 = { ...versions.versions[1], text: "# Terms v1\n\nThe old text." };

function mockApi(map: Record<string, unknown | number>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = String(input);
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const hit = map[path];
      if (hit === undefined || typeof hit === "number") {
        return Promise.resolve(new Response("{}", { status: typeof hit === "number" ? hit : 404 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(hit), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
}

const mount = (path: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/donation-terms" element={<TermsPage />} />
          <Route path="/donation-terms/v/:id" element={<TermsVersionPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("Donation terms page", () => {
  it("shows the effective date, the material-change banner and the previous versions", async () => {
    mockApi({ "/api/terms": current, "/api/terms/versions": versions });
    mount("/donation-terms");
    await waitFor(() => expect(screen.getByText("Effective October 1, 2026")).toBeInTheDocument());
    expect(screen.getByRole("status").textContent).toContain("Notice of material change");
    expect(screen.getByRole("heading", { name: "Terms v2" })).toBeInTheDocument();
    const prev = await screen.findByRole("link", { name: "Effective September 6, 2026" });
    expect(prev).toHaveAttribute("href", "/donation-terms/v/" + V1);
    expect(screen.queryByRole("link", { name: "Effective October 1, 2026" })).toBeNull();
  });

  it("falls back to the bundled file when nothing is published", async () => {
    mockApi({ "/api/terms": 404, "/api/terms/versions": 404 });
    mount("/donation-terms");
    await waitFor(() =>
      expect(screen.getByText("Effective September 6, 2026")).toBeInTheDocument()
    );
    expect(TERMS.version).toBe("2026-09-06");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/No earlier versions/)).toBeInTheDocument();
  });

  it("serves an earlier version as it was, marked superseded", async () => {
    mockApi({ "/api/terms": current, ["/api/terms/versions/" + V1]: v1 });
    mount("/donation-terms/v/" + V1);
    await waitFor(() =>
      expect(screen.getByText("Was effective September 6, 2026")).toBeInTheDocument()
    );
    expect(screen.getByRole("heading", { name: "Terms v1" })).toBeInTheDocument();
    expect(screen.getByText(/Superseded by the current version/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Current donation terms" })).toHaveAttribute(
      "href",
      "/donation-terms",
    );
  });
});
