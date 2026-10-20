import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "~/context/session";
import { api } from "~/lib/api";
import type { Ratings } from "~/lib/board-view";
import type { RatingSummary, Stars } from "@shared/ratings";

/** A private admin review, as /api/admin/initiatives/:id/reviews lists it. */
export interface AdminReview {
  id: string;
  address: string;
  stars: Stars;
  body: string;
  createdAt: number;
  /** The author's latest: the one their rating counts. */
  current: boolean;
}

// Under "admin": signing out clears them with the other private queries.
export const ratingsKey = (address: string) => ["admin", "ratings", address.toLowerCase()] as const;
export const reviewsKey = (initiativeId: string, address: string) =>
  ["admin", "reviews", initiativeId, address.toLowerCase()] as const;

/** Every initiative's admin rating, for the board; undefined for anyone not an admin. */
export function useAdminRatings(): Ratings | undefined {
  const { session } = useSession();
  const q = useQuery({
    queryKey: ratingsKey(session?.address ?? ""),
    queryFn: ({ signal }) =>
      api<{ ratings: Ratings }>("/api/admin/ratings", { signal, passive: true }).then((r) =>
        r.ratings
      ),
    enabled: Boolean(session?.isAdmin),
  });
  return session?.isAdmin ? q.data : undefined;
}

/** Post a private review (the admin's rating from now on), then refetch the ratings. */
export function usePostReview() {
  const { session } = useSession();
  const qc = useQueryClient();
  const address = session?.address ?? "";
  return async (initiativeId: string, stars: Stars, body: string) => {
    await api(`/api/admin/initiatives/${encodeURIComponent(initiativeId)}/reviews`, {
      json: { stars, body },
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey: reviewsKey(initiativeId, address) }),
      qc.invalidateQueries({ queryKey: ratingsKey(address) }),
    ]);
  };
}

/** One initiative's reviews and summary; only fetched for an admin. */
export function useReviews(initiativeId: string) {
  const { session } = useSession();
  const qc = useQueryClient();
  const address = session?.address ?? "";
  const key = reviewsKey(initiativeId, address);
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<{ reviews: AdminReview[]; summary: RatingSummary }>(
        `/api/admin/initiatives/${encodeURIComponent(initiativeId)}/reviews`,
        { signal, passive: true },
      ),
    enabled: Boolean(session?.isAdmin && initiativeId),
  });
  const postReview = usePostReview();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: key }),
      qc.invalidateQueries({ queryKey: ratingsKey(address) }),
    ]);
  return {
    enabled: Boolean(session?.isAdmin),
    reviews: q.data?.reviews ?? [],
    summary: q.data?.summary,
    post: (stars: Stars, body: string) => postReview(initiativeId, stars, body),
    remove: async (id: string) => {
      await api(
        `/api/admin/initiatives/${encodeURIComponent(initiativeId)}/reviews/${
          encodeURIComponent(id)
        }`,
        { method: "DELETE" },
      );
      await refresh();
    },
  };
}
