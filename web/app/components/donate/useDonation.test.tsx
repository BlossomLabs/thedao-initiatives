import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "~/lib/api";
import { useDonation } from "./useDonation";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
  useConfig: () => ({}),
  useConnect: () => ({ connectors: [], connectAsync: vi.fn() }),
}));
vi.mock("./Celebration", () => ({ confettiBurst: vi.fn() }));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(api).mockReset();
});

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
    token: null,
    json: { initiativeId: "original-id", slug: "reused-slug", txHash: "original-tx" },
  });
  rerender({ initiativeId: "replacement-id" });
  await act(() => result.current.confirmTx("replacement-tx"));
  expect(api).toHaveBeenLastCalledWith("/api/donate/confirm", {
    token: null,
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
