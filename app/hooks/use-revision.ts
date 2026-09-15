import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";
import type { Revision } from "~/lib/api-types";

export const revisionKey = (slug: string, n: number) => ["revision", slug, n] as const;

/** One published version of an initiative's text. Pass null to skip. */
export function useRevision(slug: string, n: number | null) {
  return useQuery({
    queryKey: revisionKey(slug, n ?? 0),
    enabled: n !== null && n > 0,
    retry: false,
    // A revision's text never changes once written.
    staleTime: Infinity,
    queryFn: () =>
      api<{ revision: Revision }>(
        `/api/initiatives/${encodeURIComponent(slug)}/revisions/${n}`,
      ).then((r) => r.revision),
  });
}
