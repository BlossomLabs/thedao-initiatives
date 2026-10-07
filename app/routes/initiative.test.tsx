import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { structuredRow } from "../../test/fixtures";
import type { InitiativePage } from "~/lib/api-types";
import { useInitiative } from "~/hooks/use-initiative";
import Initiative from "./initiative";

vi.mock("~/hooks/use-initiative", () => ({
  useInitiative: vi.fn(),
  initiativeKey: (slug: string) => ["initiative", slug],
}));
const revs = vi.hoisted(() => ({ byN: {} as Record<number, unknown> }));
vi.mock("~/hooks/use-revision", () => ({
  useRevision: (_slug: string, n: number | null) => ({
    data: n ? revs.byN[n] : undefined,
    error: null,
  }),
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
    received: 0,
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

function tree(qc: QueryClient, at = "/initiative/audit-tooling") {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
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

it("an older revision shows its own categories, and the changes view marks added and removed ones", () => {
  const meta = (n: number) => ({
    n,
    author: "",
    source: "admin" as const,
    archived: false,
    createdAt: n,
  });
  const row = {
    ...structuredRow(),
    status: "approved" as const,
    revision: 2,
    categories: ["defi"],
  };
  revs.byN = { 1: { ...row, ...meta(1), structured: true, categories: ["opsec"] } };
  vi.mocked(useInitiative).mockReturnValue({
    data: { ...page(), initiative: row, revisions: [meta(1), meta(2)] },
    isLoading: false,
    isPlaceholderData: false,
    error: null,
    isUpdatingLedger: false,
  } as unknown as ReturnType<typeof useInitiative>);
  const tags = () => document.querySelector("[data-categories]") as HTMLElement;

  const old = render(tree(new QueryClient(), "/initiative/audit-tooling?rev=1"));
  expect(tags()).toHaveTextContent("OpSec");
  expect(tags()).not.toHaveTextContent("DeFi");
  old.unmount();

  render(tree(new QueryClient()));
  expect(tags()).toHaveTextContent("DeFi");
  expect(tags().querySelector("ins, del")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "changes" }));
  expect(tags().querySelector("ins")).toHaveTextContent("DeFi");
  expect(tags().querySelector("del")).toHaveTextContent("OpSec");
  revs.byN = {};
});
