import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "~/lib/api";
import { useAdminRatings, useReviews } from "./use-admin-ratings";

const address = "0x1111111111111111111111111111111111111111";
vi.mock("~/context/session", () => ({
  useSession: () => ({
    session: { address: "0x1111111111111111111111111111111111111111", isAdmin: false },
  }),
}));
vi.mock("~/lib/api", () => ({ api: vi.fn() }));
afterEach(cleanup);

it("a non-admin NFT holder can read and submit with the NFT ID; losing it hides cached reviews", async () => {
  const summary = { avg: 4, count: 1, mine: 4, dist: [0, 0, 0, 1, 0] };
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/api/reviews/identity") return { tokenIds: ["42"], canReview: true };
    if (path === "/api/reviews/ratings") return { ratings: { i1: summary } };
    return { reviews: [], summary };
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(
    () => ({ ratings: useAdminRatings(), reviews: useReviews("i1") }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.ratings?.i1).toEqual(summary));
  await waitFor(() => expect(result.current.reviews.summary).toEqual(summary));
  expect(result.current.reviews.enabled).toBe(true);
  await act(() => result.current.reviews.post(5, "Looks good"));
  expect(api).toHaveBeenCalledWith("/api/reviews/initiatives/i1/reviews", {
    json: { stars: 5, body: "Looks good", tokenId: "42" },
  });
  act(() =>
    qc.setQueryData(["admin", "review-identity", address], { tokenIds: [], canReview: false })
  );
  await waitFor(() => expect(result.current.reviews.enabled).toBe(false));
  expect(result.current.ratings).toBeUndefined();
  expect(result.current.reviews.summary).toBeUndefined();
  unmount();
  qc.clear();
});
