import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "~/lib/api";
import { sendTransaction, signMessage, switchChain } from "wagmi/actions";
import { TERMS } from "~/data/terms";
import { useDonation } from "./useDonation";

const walletState = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
  isConnected: false,
}));
vi.mock("wagmi/actions", () => ({
  signMessage: vi.fn(),
  sendTransaction: vi.fn(),
  switchChain: vi.fn(),
  getBalance: vi.fn(),
  readContract: vi.fn(),
}));
vi.mock("~/context/wallet", () => ({
  useWallet: () => ({ ...walletState, connectors: [], connect: vi.fn() }),
  useWalletStore: () => ({ load: () => Promise.resolve({ config: {} }) }),
}));
vi.mock("./Celebration", () => ({ confettiBurst: vi.fn() }));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(signMessage).mockReset();
  vi.mocked(sendTransaction).mockReset();
  vi.mocked(switchChain).mockResolvedValue({ id: 1 } as never);
  sessionStorage.clear();
  walletState.address = undefined;
  walletState.isConnected = false;
});

afterEach(() => vi.useRealTimers());

it("binds confirmations to the displayed ID even when two proposals share a slug", async () => {
  vi.mocked(api).mockResolvedValue({ status: "failed", detail: "Test transaction", amount: 0 });
  const { result, rerender } = renderHook(({ initiativeId }) =>
    useDonation({
      initiativeId,
      slug: "reused-slug",
      safeAddress: "",
      params: undefined,
    }), { initialProps: { initiativeId: "original-id" } });
  await act(() => result.current.confirmTx("original-tx"));
  expect(api).toHaveBeenLastCalledWith("/api/donate/confirm", {
    json: { initiativeId: "original-id", slug: "reused-slug", txHash: "original-tx" },
  });
  rerender({ initiativeId: "replacement-id" });
  await act(() => result.current.confirmTx("replacement-tx"));
  expect(api).toHaveBeenLastCalledWith("/api/donate/confirm", {
    json: { initiativeId: "replacement-id", slug: "reused-slug", txHash: "replacement-tx" },
  });
});

it("shows a stale-URL conflict without retrying or polling the replacement", async () => {
  vi.mocked(api).mockRejectedValue(new ApiError(409, "Refresh the page before continuing."));
  const { result } = renderHook(() =>
    useDonation({
      initiativeId: "original-id",
      slug: "reused-slug",
      safeAddress: "",
      params: undefined,
    })
  );
  await act(() => result.current.confirmTx("tx"));
  expect(api).toHaveBeenCalledTimes(1);
  expect(result.current.status).toEqual({
    kind: "err",
    text: "Refresh the page before continuing.",
  });
  expect(result.current.busy).toBeNull();
});

const TX = "0x" + "ab".repeat(32);
const ADDRESS = "0x1563915e194D8CfBA1943570603F7606A3115508";
const SAFE = "0x3333333333333333333333333333333333333333";
const TOKEN = "0x4444444444444444444444444444444444444444";
const ID = "a".repeat(43);
const params = {
  enabled: true as const,
  chainId: 1,
  tokens: { USDC: { address: TOKEN, decimals: 6 } },
  rates: { USDC: 1 },
  minTokenUnits: 1,
  minEth: 0.001,
};
const args = {
  initiativeId: "initiative-id",
  slug: "proposal",
  safeAddress: SAFE,
  params,
  accepted: true,
};
const confirmed = { status: "confirmed", detail: "", amount: 5, token: "USDC", amountUsd: 5 };

it("records agreement before sending and never asks for a terms signature", async () => {
  walletState.address = ADDRESS;
  walletState.isConnected = true;
  vi.mocked(api).mockResolvedValueOnce({ attemptId: ID, recordedAt: 1 }).mockResolvedValueOnce(
    confirmed,
  );
  vi.mocked(sendTransaction).mockResolvedValue(TX as `0x${string}`);
  const { result } = renderHook(() => useDonation(args));
  await act(() => result.current.donate("USDC", "5", {}));
  expect(api).toHaveBeenNthCalledWith(1, "/api/donate/accept", {
    json: {
      initiativeId: args.initiativeId,
      slug: args.slug,
      recipient: SAFE,
      chainId: 1,
      version: TERMS.id,
      agreed: true,
      method: "wallet",
      wallet: { address: ADDRESS, token: TOKEN, amountRaw: "5000000" },
    },
  });
  expect(vi.mocked(api).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(sendTransaction).mock.invocationCallOrder[0],
  );
  expect(signMessage).not.toHaveBeenCalled();
  expect(sendTransaction).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenLastCalledWith("/api/donate/confirm", {
    json: { initiativeId: args.initiativeId, slug: args.slug, txHash: TX, attemptId: ID },
  });
  expect(sessionStorage.getItem("thedao:donation:" + args.initiativeId)).toBeNull();
});

it("does not send if acceptance cannot be recorded or the checkbox is unchecked", async () => {
  walletState.address = ADDRESS;
  walletState.isConnected = true;
  vi.mocked(api).mockRejectedValue(new ApiError(503, "Unavailable"));
  const { result, rerender } = renderHook(({ accepted }) => useDonation({ ...args, accepted }), {
    initialProps: { accepted: false },
  });
  await act(() => result.current.donate("USDC", "5", {}));
  expect(api).not.toHaveBeenCalled();
  rerender({ accepted: true });
  await act(() => result.current.donate("USDC", "5", {}));
  expect(sendTransaction).not.toHaveBeenCalled();
  expect(signMessage).not.toHaveBeenCalled();
  expect(result.current.status?.kind).toBe("err");
});

it("retains the attempt during pending confirmation and network retries", async () => {
  vi.useFakeTimers();
  vi.mocked(api).mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(
    new Error("offline"),
  )
    .mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(confirmed);
  const { result } = renderHook(() => useDonation(args));
  await act(async () => {
    const confirmation = result.current.confirmTx(TX, ID);
    await vi.advanceTimersByTimeAsync(4500);
    await confirmation;
  });
  expect(api).toHaveBeenCalledTimes(3);
  expect(JSON.parse(sessionStorage.getItem("thedao:donation:" + args.initiativeId)!)).toMatchObject(
    { txHash: TX, attemptId: ID },
  );
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(api).toHaveBeenCalledTimes(4);
  expect(
    vi.mocked(api).mock.calls.every(([path, opts]) =>
      path === "/api/donate/confirm" && (opts?.json as { attemptId: string }).attemptId === ID
    ),
  ).toBe(true);
  expect(signMessage).not.toHaveBeenCalled();
});

it("resubmits a saved hash after reload without inventing a new checkbox event", async () => {
  sessionStorage.setItem(
    "thedao:donation:" + args.initiativeId,
    JSON.stringify({ initiativeId: args.initiativeId, slug: args.slug, txHash: TX, attemptId: ID }),
  );
  vi.mocked(api).mockResolvedValue(confirmed);
  renderHook(() => useDonation({ ...args, accepted: false }));
  await act(() => Promise.resolve());
  expect(api).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledWith("/api/donate/confirm", {
    json: { initiativeId: args.initiativeId, slug: args.slug, txHash: TX, attemptId: ID },
  });
  expect(signMessage).not.toHaveBeenCalled();
});

it("records an exchange acceptance with no optional fields and never uses the connected wallet", async () => {
  walletState.address = ADDRESS;
  walletState.isConnected = true;
  vi.mocked(api).mockResolvedValue({ attemptId: ID, recordedAt: 1 });
  const { result } = renderHook(() => useDonation(args));
  await act(() => result.current.recordAcceptance("exchange", {}));
  expect(api).toHaveBeenCalledWith("/api/donate/accept", {
    json: {
      initiativeId: args.initiativeId,
      slug: args.slug,
      recipient: SAFE,
      chainId: 1,
      version: TERMS.id,
      agreed: true,
      method: "exchange",
      details: {},
    },
  });
  expect(sendTransaction).not.toHaveBeenCalled();
  expect(signMessage).not.toHaveBeenCalled();
});

it("manually confirms a public hash without creating an acceptance", async () => {
  vi.mocked(api).mockResolvedValue(confirmed);
  const { result } = renderHook(() => useDonation(args));
  await act(() => result.current.confirmTx(TX));
  expect(signMessage).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledWith("/api/donate/confirm", {
    json: { initiativeId: args.initiativeId, slug: args.slug, txHash: TX },
  });
});
