import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ADMIN_ROLE_ID, PLEDGE_ROLE_ID } from "../../shared/vote/roles";
import { NO_ROUND } from "../../shared/vote/manifest";
import { useRoundAdmin } from "./use-round-admin";

const WALLET = "0x1111111111111111111111111111111111111111";
const CONTRACT = "0x1000000000000000000000000000000000000001";
const state = vi.hoisted(() => ({
  address: undefined as string | undefined,
  round: undefined as unknown,
  roles: new Set<string>(),
}));
const readContract = vi.hoisted(() => vi.fn());

vi.mock("~/context/wallet", () => ({ useWallet: () => ({ address: state.address }) }));
vi.mock("~/lib/vote-round", () => ({ useRound: () => state.round }));
vi.mock("~/hooks/use-vote-send", () => ({ voteClient: () => ({ readContract }) }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

beforeEach(() => {
  state.address = WALLET;
  state.round = { ...NO_ROUND, kind: "real", chainId: 1, contract: CONTRACT };
  state.roles = new Set([ADMIN_ROLE_ID, PLEDGE_ROLE_ID]);
  readContract.mockReset().mockImplementation(({ args }: { args: [string, string] }) =>
    Promise.resolve(state.roles.has(args[0]))
  );
});

it("is a round admin when the wallet holds both roles on the round's contract", async () => {
  const { result } = renderHook(() => useRoundAdmin(), { wrapper });
  await waitFor(() =>
    expect(result.current).toEqual({
      isRoundAdmin: true,
      canSignPledges: true,
      hasAdminRole: true,
      loading: false,
    })
  );
  expect(readContract).toHaveBeenCalledWith(
    expect.objectContaining({ address: CONTRACT, functionName: "hasRole" }),
  );
});

it("is not one with only the admin role", async () => {
  state.roles = new Set([ADMIN_ROLE_ID]);
  const { result } = renderHook(() => useRoundAdmin(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.isRoundAdmin).toBe(false);
});

it("can sign pledges with only the pledge role, without being a round admin", async () => {
  state.roles = new Set([PLEDGE_ROLE_ID]);
  const { result } = renderHook(() => useRoundAdmin(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current).toEqual({
    isRoundAdmin: false,
    canSignPledges: true,
    hasAdminRole: false,
    loading: false,
  });
});

it("is not one without a wallet, and reads nothing", () => {
  state.address = undefined;
  const { result } = renderHook(() => useRoundAdmin(), { wrapper });
  expect(result.current).toEqual({
    isRoundAdmin: false,
    canSignPledges: false,
    hasAdminRole: false,
    loading: false,
  });
  expect(readContract).not.toHaveBeenCalled();
});

it("is not one without a deployed round, and reads nothing", () => {
  state.round = NO_ROUND;
  const { result } = renderHook(() => useRoundAdmin(), { wrapper });
  expect(result.current).toEqual({
    isRoundAdmin: false,
    canSignPledges: false,
    hasAdminRole: false,
    loading: false,
  });
  expect(readContract).not.toHaveBeenCalled();
});

it("a failed read is not a round admin", async () => {
  readContract.mockRejectedValue(new Error("rpc down"));
  const { result } = renderHook(() => useRoundAdmin(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.isRoundAdmin).toBe(false);
});
