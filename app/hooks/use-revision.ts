import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sessionKey, useSession } from "~/context/session";
import { api, ApiError } from "~/lib/api";
import type { Revision } from "~/lib/api-types";

export const revisionKey = (slug: string, n: number) => ["revision", slug, n] as const;

/** One published version of an initiative's text. Pass null to skip. */
export function useRevision(slug: string, n: number | null) {
  const who = sessionKey(useSession().session);
  const qc = useQueryClient();
  const key = [...revisionKey(slug, n ?? 0), who];
  return useQuery({
    queryKey: key,
    enabled: n !== null && n > 0,
    retry: false,
    // Content is immutable, but permission is not. Recheck on every mount/focus.
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: ({ signal }) =>
      api<{ revision: Revision }>(
        `/api/initiatives/${encodeURIComponent(slug)}/revisions/${n}`,
        { signal, anonymous: !who },
      ).then((r) => r.revision).catch((error) => {
        if (
          !signal.aborted && error instanceof ApiError && [401, 403, 404].includes(error.status)
        ) {
          // A failed background refetch normally retains old data. An access denial must erase it.
          qc.getQueryCache().find({ queryKey: key, exact: true })?.setState({
            data: undefined,
            dataUpdatedAt: 0,
          });
        }
        throw error;
      }),
  });
}
