import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "~/context/session";
import { api } from "~/lib/api";
import type { Ratings } from "~/lib/board-view";
import type { RatingSummary, Stars } from "@shared/ratings";

/** A private NFT-backed review, as /api/reviews/initiatives/:id/reviews lists it. */
export interface AdminReview {
  id: string;
  address: string;
  tokenId: string;
  stars: Stars;
  body: string;
  createdAt: number;
  /** The NFT's latest: the one their rating counts. */
  current: boolean;
}

// Under "admin": signing out clears them with the other private queries.
export const ratingsKey = (address: string) =>
  ["admin", "nft-ratings-v1", address.toLowerCase()] as const;
export const reviewsKey = (initiativeId: string, address: string) =>
  ["admin", "nft-reviews-v1", initiativeId, address.toLowerCase()] as const;

/** Server-verified voting NFT ownership; refreshed on focus and every minute. */
export function useReviewIdentity() {
  const { session } = useSession();
  const q = useQuery({
    queryKey: ["admin", "review-identity", session?.address.toLowerCase() ?? ""],
    queryFn: ({ signal }) =>
      api<{ tokenIds: string[]; canReview: boolean }>(
        "/api/reviews/identity",
        { signal, passive: true },
      ),
    enabled: Boolean(session),
    staleTime: 0,
    refetchInterval: 60_000,
  });
  return session && !q.isError ? q.data : undefined;
}

/** Every initiative's NFT rating, for the board; only fetched for voting NFT holders. */
export function useAdminRatings(): Ratings | undefined {
  const { session } = useSession();
  const identity = useReviewIdentity();
  const q = useQuery({
    queryKey: [...ratingsKey(session?.address ?? ""), identity?.tokenIds ?? []],
    queryFn: ({ signal }) =>
      api<{ ratings: Ratings }>("/api/reviews/ratings", { signal, passive: true }).then((r) =>
        r.ratings
      ),
    enabled: Boolean(session && identity?.canReview),
  });
  return session && identity?.canReview ? q.data : undefined;
}

/** Post a private review (the NFT's rating from now on), then refetch the ratings. */
export function usePostReview() {
  const { session } = useSession();
  const identity = useReviewIdentity();
  const qc = useQueryClient();
  const address = session?.address ?? "";
  return async (initiativeId: string, stars: Stars, body: string) => {
    await api(`/api/reviews/initiatives/${encodeURIComponent(initiativeId)}/reviews`, {
      json: { stars, body, tokenId: identity?.tokenIds[0] },
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey: reviewsKey(initiativeId, address) }),
      qc.invalidateQueries({ queryKey: ratingsKey(address) }),
    ]);
  };
}

/** One initiative's reviews and summary; only fetched for a voting NFT holder. */
export function useReviews(initiativeId: string) {
  const { session } = useSession();
  const qc = useQueryClient();
  const address = session?.address ?? "";
  const identity = useReviewIdentity();
  const key = reviewsKey(initiativeId, address);
  const q = useQuery({
    queryKey: [...key, identity?.tokenIds ?? []],
    queryFn: ({ signal }) =>
      api<{ reviews: AdminReview[]; summary: RatingSummary }>(
        `/api/reviews/initiatives/${encodeURIComponent(initiativeId)}/reviews`,
        { signal, passive: true },
      ),
    enabled: Boolean(session && identity?.canReview && initiativeId),
  });
  const postReview = usePostReview();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: key }),
      qc.invalidateQueries({ queryKey: ratingsKey(address) }),
    ]);
  return {
    enabled: Boolean(session && identity?.canReview),
    tokenIds: identity?.tokenIds ?? [],
    reviews: identity?.canReview ? q.data?.reviews ?? [] : [],
    summary: identity?.canReview ? q.data?.summary : undefined,
    post: (stars: Stars, body: string) => postReview(initiativeId, stars, body),
    remove: async (id: string) => {
      await api(
        `/api/reviews/initiatives/${encodeURIComponent(initiativeId)}/reviews/${
          encodeURIComponent(id)
        }`,
        { method: "DELETE" },
      );
      await refresh();
    },
  };
}
