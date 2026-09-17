import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { api, ApiError } from "~/lib/api";
import { useRevision } from "./use-revision";
const state = vi.hoisted(() => ({
  session: { address: "admin", isAdmin: true } as { address: string; isAdmin: boolean } | null,
}));
vi.mock(
  "~/context/session",
  () => ({
    useSession: () => state,
    sessionKey: (s: typeof state.session) => s ? `${s.address}:${s.isAdmin}` : null,
  }),
);
vi.mock(
  "~/lib/api",
  async (original) => ({ ...await original<typeof import("~/lib/api")>(), api: vi.fn() }),
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("never serves the previous viewer's restricted revision and rechecks permission on remount", async () => {
  state.session = { address: "admin", isAdmin: true };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api).mockResolvedValue({ revision: { title: "private" } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useRevision("restricted", 1), { wrapper });
  await waitFor(() => expect(hook.result.current.data?.title).toBe("private"));
  vi.mocked(api).mockRejectedValue(new ApiError(403, "forbidden"));
  act(() => {
    state.session = null;
    hook.rerender();
  });
  expect(hook.result.current.data).toBeUndefined();
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(api).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ anonymous: true, signal: expect.any(AbortSignal) }),
  );
  hook.unmount();
  const again = renderHook(() => useRevision("restricted", 1), { wrapper });
  await waitFor(() => expect(again.result.current.isError).toBe(true));
  expect(api).toHaveBeenCalledTimes(3);
  again.unmount();
  qc.clear();
});
it("erases a revision the same viewer can no longer read, on refetch and on remount", async () => {
  state.session = null;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api).mockResolvedValue({ revision: { title: "formerly public" } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  // Spread so every field is read: the result must not depend on which props a render tracked.
  const hook = renderHook(() => ({ ...useRevision("initiative", 1) }), { wrapper });
  await waitFor(() => expect(hook.result.current.data?.title).toBe("formerly public"));
  // An admin archives the revision: the same anonymous viewer's revalidation now gets a 404.
  vi.mocked(api).mockRejectedValue(new ApiError(404, "not found"));
  await act(async () => {
    await hook.result.current.refetch();
  });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.data).toBeUndefined();
  hook.unmount();
  const again = renderHook(() => ({ ...useRevision("initiative", 1) }), { wrapper });
  expect(again.result.current.data).toBeUndefined();
  await waitFor(() => expect(again.result.current.isError).toBe(true));
  expect(again.result.current.data).toBeUndefined();
  expect(api).toHaveBeenCalledTimes(3);
  again.unmount();
  qc.clear();
});
