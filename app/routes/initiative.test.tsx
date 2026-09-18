import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { structuredRow } from "../../test/fixtures";
import type { InitiativePage } from "~/lib/api-types";
import { useInitiative } from "~/hooks/use-initiative";
import Initiative from "./initiative";

vi.mock("~/hooks/use-initiative", () => ({
  useInitiative: vi.fn(),
  initiativeKey: (slug: string) => ["initiative", slug],
}));
vi.mock("~/hooks/use-revision", () => ({
  useRevision: () => ({ data: undefined, error: null }),
}));
vi.mock("~/context/session", () => ({
  useSession: () => ({ session: null }),
  sessionKey: () => "anon",
}));
vi.mock("~/components/wallet/Identity", () => ({ default: () => <span>identity</span> }));
vi.mock("~/components/comments/CommentsSection", () => ({ default: () => null }));

const page = (): InitiativePage => ({
  initiative: { ...structuredRow(), status: "approved", proposer: "0x1111" },
  revisions: [],
  pledges: [],
  donations: [],
  summary: {
    pledged: 0,
    donated: 0,
    total: 0,
    live: false,
    ledger: 0,
    paidOut: 0,
    refreshDue: false,
  },
  pct: 0,
  funded: false,
  donationsEnabled: false,
  ledger: null,
});

function feed(isPlaceholderData: boolean) {
  vi.mocked(useInitiative).mockReturnValue({
    data: page(),
    isLoading: false,
    isPlaceholderData,
    error: null,
    isUpdatingLedger: false,
  } as unknown as ReturnType<typeof useInitiative>);
}

function tree(qc: QueryClient) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/initiative/audit-tooling"]}>
        <Routes>
          <Route path="/initiative/:slug" element={<Initiative />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

it("a placeholder page shows the card's identity and skeletons in place of the body", () => {
  feed(true);
  const qc = new QueryClient();
  const { rerender } = render(tree(qc));
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Audit tooling for rollups");
  expect(screen.getByText(/A summary long enough/)).toBeInTheDocument();
  expect(screen.queryByText("Only milestone")).not.toBeInTheDocument();
  expect(screen.queryByText(/Proposed by/)).not.toBeInTheDocument();
  feed(false);
  rerender(tree(qc));
  expect(screen.getByText("Only milestone")).toBeInTheDocument();
  expect(screen.getByText(/Proposed by/)).toBeInTheDocument();
});
