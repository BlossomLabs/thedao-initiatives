import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { writeContract } from "wagmi/actions";
import type { GoalToSignJson } from "~/lib/api-types";
import { api } from "~/lib/api";
import GoalsToSign from "./GoalsToSign";

const ADMIN = "0x1111111111111111111111111111111111111111";
const CONTRACT = vi.hoisted(() => "0x52B7bcF6FDdb608Dd0D2F4F75f577Bc191350d80");
const SAFE = "0x6440Fe905e3507696deB43184eB51806cC26598C";
const HASH = ("0x" + "12".repeat(32)) as `0x${string}`;

vi.mock("~/context/wallet", () => ({
  useWallet: () => ({ address: ADMIN, isConnected: true, config: {}, connectors: [] }),
}));
const role = vi.hoisted(() => ({ admin: true }));
vi.mock("~/hooks/use-round-admin", () => ({
  useRoundAdmin: () => ({ hasAdminRole: role.admin, loading: false }),
}));
vi.mock("~/hooks/use-vote-chain", () => ({ useEnsureVoteChain: () => () => Promise.resolve() }));
vi.mock("wagmi/actions", () => ({ writeContract: vi.fn() }));
const waitReceipt = vi.hoisted(() => vi.fn());
const revision = vi.hoisted(() => ({ value: 130n }));
vi.mock("~/hooks/use-vote-send", () => ({
  voteClient: () => ({
    waitForTransactionReceipt: waitReceipt,
    readContract: () => Promise.resolve(revision.value),
  }),
}));
vi.mock("~/lib/vote-round", () => ({ useRound: () => ({ contract: CONTRACT, chainId: 1 }) }));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

const goal: GoalToSignJson = {
  rfpId: "rfp23",
  slug: "valos",
  title: "ValOS",
  fromUsd: 108_000,
  toUsd: 78_000,
  by: ADMIN,
  at: 1_795_521_533,
  call: { id: "23", account: SAFE, goalUsd: "78000000000", rfp: false, groups: "2097152" },
  batch: { version: "1.0", transactions: [] },
  configRevision: "130",
};

const mount = (items: GoalToSignJson[] = [goal], qc = new QueryClient()) =>
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GoalsToSign items={items} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  role.admin = true;
  revision.value = 130n;
  vi.mocked(writeContract).mockReset().mockResolvedValue(HASH);
  waitReceipt.mockReset().mockResolvedValue({ status: "success" });
  vi.mocked(api).mockReset().mockResolvedValue({ ok: true } as never);
});

it("shows the change, who asked for it, and signs setInitiative from an admin wallet", async () => {
  mount();
  expect(screen.getByText("$108,000 → $78,000")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Sign ValOS's goal change" }));
  await waitFor(() => expect(writeContract).toHaveBeenCalledOnce());
  expect(vi.mocked(writeContract).mock.calls[0][1]).toMatchObject({
    address: CONTRACT,
    functionName: "setInitiative",
    args: [23n, SAFE, 78_000_000_000n, false, 2_097_152n],
    chainId: 1,
  });
  await waitFor(() =>
    expect(waitReceipt).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH }))
  );
});

it("without the admin role it offers the Safe batch instead of Sign", () => {
  role.admin = false;
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  globalThis.URL.createObjectURL ??= () => "blob:x";
  mount();
  expect(screen.queryByRole("button", { name: "Sign ValOS's goal change" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Download ValOS's goal change for the Safe" }),
  );
  expect(click).toHaveBeenCalledOnce();
  expect(screen.getByText("The page follows once the Safe runs it.")).toBeTruthy();
});

it("Discard drops the request", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Discard ValOS's goal change" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/admin/initiatives/rfp23/goal-request", {
      method: "DELETE",
    })
  );
});

it("does not sign when the round's settings changed since the list was read", async () => {
  revision.value = 131n;
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Sign ValOS's goal change" }));
  expect(
    await screen.findByText("The round's settings changed since this list was read. Try again."),
  ).toBeTruthy();
  expect(writeContract).not.toHaveBeenCalled();
});

it("a settled initiative's Sign is off, saying why", () => {
  mount([{ ...goal, blocked: { kind: "settled", tier: "S" } }]);
  const sign = screen.getByRole("button", { name: "Sign ValOS's goal change" });
  expect(sign).toBeDisabled();
  expect(sign.closest("[title]")?.getAttribute("title")).toBe(
    "Settled in S-Tier: its award is final, so its goal stays.",
  );
});

it("a withdrawn initiative's Sign is off, saying why", () => {
  mount([{ ...goal, blocked: { kind: "withdrawn" } }]);
  const sign = screen.getByRole("button", { name: "Sign ValOS's goal change" });
  expect(sign).toBeDisabled();
  expect(sign.closest("[title]")?.getAttribute("title")).toBe(
    "Withdrawn from the vote: undo the withdrawal to change its goal.",
  );
});

it("after signing, Sign stays off and the list refreshes until the change settles", async () => {
  const qc = new QueryClient();
  const refresh = vi.spyOn(qc, "invalidateQueries");
  mount([goal], qc);
  const sign = screen.getByRole("button", { name: "Sign ValOS's goal change" });
  fireEvent.click(sign);
  await screen.findByText("Set on the round. The list updates once the site has it.");
  expect(screen.getByRole("button", { name: "Sign ValOS's goal change" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Discard ValOS's goal change" })).toBeDisabled();
  const before = refresh.mock.calls.length;
  await waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThan(before), {
    timeout: 4_000,
  });
});
