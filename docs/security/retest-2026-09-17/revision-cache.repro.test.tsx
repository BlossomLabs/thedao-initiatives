/** Audit reproduction: passes when rejected revalidation retains restricted content. */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "~/lib/api";
import { useRevision } from "~/hooks/use-revision";

vi.mock("~/context/session", () => ({
  useSession: () => ({ session: null }),
  sessionKey: () => null,
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(), api: vi.fn(),
}));
afterEach(cleanup);

it("REPRO: an archived revision stays readable after the API rejects revalidation", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  vi.mocked(api).mockResolvedValue({ revision: { title: "Formerly public, now restricted" } });
  const first = renderHook(() => ({ ...useRevision("initiative", 1) }), { wrapper });
  await waitFor(() => expect(first.result.current.data?.title).toBe("Formerly public, now restricted"));
  // The administrator archives this version; the same anonymous viewer's API now returns 404.
  vi.mocked(api).mockRejectedValue(new ApiError(404, "not found"));
  await act(async () => { await first.result.current.refetch(); });
  await waitFor(() => expect(first.result.current.isError).toBe(true));
  expect(first.result.current.data?.title).toBe("Formerly public, now restricted");
  first.unmount();
  const again = renderHook(() => ({ ...useRevision("initiative", 1) }), { wrapper });
  await waitFor(() => expect(again.result.current.isError).toBe(true));
  expect(again.result.current.data?.title).toBe("Formerly public, now restricted");
  again.unmount();
  qc.clear();
});
