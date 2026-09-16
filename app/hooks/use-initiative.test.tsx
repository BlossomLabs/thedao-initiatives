import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useInitiative } from "./use-initiative";
import DonationsTable from "~/components/initiative/DonationsTable";
import type { Donation, InitiativePage } from "~/lib/api-types";
import { structuredRow } from "../../test/fixtures";

vi.mock(
  "~/context/session",
  () => ({ useSession: () => ({ session: null }), sessionKey: () => "anon" }),
);
vi.mock("~/components/wallet/Identity", () => ({ default: () => null }));

const clients: QueryClient[] = [];
const donation = (n: number): Donation => ({
  txHash: "0x" + String(n).repeat(64),
  tokenSymbol: "USDC",
  tokenAddress: "",
  amount: n,
  amountRaw: String(n * 1e6),
  amountUsd: n,
  donor: "",
  status: "confirmed",
  detail: "",
  source: "tx",
  createdAt: 1_800_000_000,
  confirmedAt: 1_800_000_000,
});
const page = (refreshDue: boolean, count = 1, updating = false): InitiativePage => ({
  initiative: structuredRow(),
  revisions: [],
  pledges: [],
  donations: Array.from({ length: count }, (_, i) => donation(i + 1)),
  summary: {
    pledged: 0,
    donated: 1,
    total: 1,
    live: true,
    ledger: count,
    paidOut: 0,
    refreshDue: false,
  },
  pct: 1,
  funded: false,
  donationsEnabled: true,
  onramp: { url: "", prefilled: false },
  ledger: { checkedAt: 1_800_000_000, ok: true, intervalMinutes: 10, refreshDue, updating },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => resolve = r);
  return { promise, resolve };
}
function View() {
  const { data, isLoading, isUpdatingLedger } = useInitiative("audit-tooling");
  return isLoading ? <p>Loading</p> : (
    <DonationsTable
      donations={data!.donations}
      ledger={data!.ledger}
      updating={isUpdatingLedger}
    />
  );
}
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(qc);
  render(
    <QueryClientProvider client={qc}>
      <View />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((qc) => qc.clear());
  vi.unstubAllGlobals();
});

it("keeps old rows visible with an updating indicator until persisted donations arrive", async () => {
  const fresh = deferred<Response>();
  const fetchMock = vi.fn((url: string) =>
    url.includes("?refresh=1") ? fresh.promise : Promise.resolve(Response.json(page(true)))
  );
  vi.stubGlobal("fetch", fetchMock);
  mount();
  const original = await screen.findByText("$1.00");
  await screen.findByRole("status");
  expect(screen.getByRole("status")).toHaveTextContent("Updating donations…");
  expect(screen.queryByText("Loading")).not.toBeInTheDocument();
  expect(screen.queryByText("$2.00")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  act(() => fresh.resolve(Response.json(page(false, 2))));
  await screen.findByText("$2.00");
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(screen.getByText("$1.00")).toBe(original);
  expect(screen.getByText("$2.00").closest("tr")).toHaveClass("motion-safe:animate-in");
});

it("fresh donations render without an updating indicator or refresh request", async () => {
  const fetchMock = vi.fn(() => Promise.resolve(Response.json(page(false))));
  vi.stubGlobal("fetch", fetchMock);
  mount();
  await screen.findByText("$1.00");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("a failed refresh retains old donations and stops the updating indicator", async () => {
  const fresh = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.includes("?refresh=1") ? fresh.promise : Promise.resolve(Response.json(page(true)))
    ),
  );
  mount();
  await screen.findByText("$1.00");
  await screen.findByRole("status");
  act(() => fresh.resolve(new Response("{}", { status: 503 })));
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(screen.getByText("$1.00")).toBeInTheDocument();
});

it("polls saved results while another visitor refreshes and stops showing updating when KV is ready", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(page(false, 1, true)))
    .mockImplementation(() => Promise.resolve(Response.json(page(false, 2))));
  vi.stubGlobal("fetch", fetchMock);
  mount();
  await screen.findByText("$1.00");
  expect(screen.getByRole("status")).toHaveTextContent("Updating donations…");
  await screen.findByText("$2.00", {}, { timeout: 3500 });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("refresh=1"))).toBe(true);
});
