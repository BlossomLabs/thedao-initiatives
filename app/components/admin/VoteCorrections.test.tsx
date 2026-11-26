import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import VoteCorrections from "./VoteCorrections";
import type { CorrectionView } from "../../../shared/vote/corrections";

const ACCOUNT = "0x1000000000000000000000000000000000000001";
const view: CorrectionView = {
  supported: true,
  now: 1100,
  final: false,
  settled: [],
  poolUsd: "100000000",
  pendingPoolUsd: null,
  poolUpdateNonce: "0",
  manifest: {
    kind: "test",
    chainId: 11155111,
    contract: "0x2000000000000000000000000000000000000002",
    deployBlock: 1,
    configRevision: "7",
    opensAt: 1009,
    closesAt: 4109,
    schedule: {
      opensAt: 1009,
      firstTallyAt: [2009, 3009, 4009],
      initialWindow: 100,
      maxWindows: 1,
    },
    poolUsd: "100000000",
    slugs: ["alpha"],
    accounts: [ACCOUNT],
    projects: [{ goalUsd: "10000000", rfp: false, groups: [] }],
    groups: [],
    independentTiers: 1,
  },
};
const post = vi.fn();
vi.mock("~/hooks/use-admin-api", () => ({ useAdminApi: () => post }));
vi.mock(
  "~/lib/api",
  async (o) => ({ ...await o<typeof import("~/lib/api")>(), api: () => Promise.resolve(view) }),
);
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  post.mockReset().mockResolvedValue({
    summary: "Set alpha's goal to $12.345678.",
    batch: { version: "1.0", transactions: [] },
  });
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:batch"), revokeObjectURL: vi.fn() }),
  );
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <VoteCorrections />
    </QueryClientProvider>,
  );
  return client;
};

it("reviews exact correction values before downloading and clears a review when the form changes", async () => {
  mount();
  fireEvent.click(await screen.findByText("Initiative details"));
  const goal = screen.getByLabelText("Dollar goal");
  fireEvent.change(goal, { target: { value: "12.345678" } });
  expect(screen.queryByText("Download reviewed Safe batch")).toBeNull();
  fireEvent.click(within(goal.closest("form")!).getByRole("button", { name: "Review change" }));
  await screen.findByText("Set alpha's goal to $12.345678.");
  expect(post).toHaveBeenCalledWith("/api/admin/vote-round/corrections", {
    json: {
      action: "initiative",
      revision: "7",
      id: "0",
      goalUsd: "12.345678",
      rfp: false,
      groups: [],
    },
  });
  expect(click).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Download reviewed Safe batch"));
  expect(click).toHaveBeenCalledOnce();
  fireEvent.change(goal, { target: { value: "13" } });
  expect(screen.queryByText("Download reviewed Safe batch")).toBeNull();
});

it("preserves unchanged date seconds without exposing seconds in date inputs", async () => {
  mount();
  fireEvent.click(await screen.findByText("Dates and windows"));
  const opening = screen.getByLabelText("Voting opens");
  fireEvent.click(within(opening.closest("form")!).getByRole("button", { name: "Review change" }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][1].json).toEqual({
    action: "schedule",
    revision: "7",
    opensAt: "1009",
    firstTallyAt: [2009, 3009, 4009],
    initialWindow: "100",
    maxWindows: "1",
  });
});

it("disables settled initiative corrections", async () => {
  const client = mount();
  await screen.findByText("Initiative details");
  client.setQueryData(["production", "admin", "vote-corrections"], { ...view, settled: [0] });
  fireEvent.click(screen.getByText("Initiative details"));
  await screen.findByText("This initiative has settled and cannot be corrected here.");
  expect(
    within(screen.getByLabelText("Dollar goal").closest("form")!).getByRole("button", {
      name: "Review change",
    }),
  ).toBeDisabled();
});

it("discards an in-flight review when an admin changes the inputs", async () => {
  let resolve!: (value: unknown) => void;
  post.mockReturnValue(new Promise((done) => resolve = done));
  mount();
  fireEvent.click(await screen.findByText("Initiative details"));
  const goal = screen.getByLabelText("Dollar goal");
  fireEvent.click(within(goal.closest("form")!).getByRole("button", { name: "Review change" }));
  fireEvent.change(goal, { target: { value: "13" } });
  await act(() => Promise.resolve(resolve({ summary: "Old value", batch: {} })));
  expect(screen.queryByText("Download reviewed Safe batch")).toBeNull();
});

it("keeps other correction controls available before any initiative is registered", async () => {
  const client = mount();
  await screen.findByText("Initiative details");
  await act(() =>
    Promise.resolve(client.setQueryData(["production", "admin", "vote-corrections"], {
      ...view,
      manifest: { ...view.manifest, configRevision: "8", projects: [], slugs: [], accounts: [] },
    }))
  );
  expect(screen.queryByText("Initiative details")).toBeNull();
  expect(screen.getByText("Pool funding")).toBeInTheDocument();
});
