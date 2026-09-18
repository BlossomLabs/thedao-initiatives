import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "~/lib/api";
import type { Board, InitiativePage } from "~/lib/api-types";
import { sessionKey, useSession } from "~/context/session";
import { boardKey } from "./use-board";
import { cachedFunding } from "~/lib/cached-funding";

export const initiativeKey = (slug: string) => ["initiative", slug] as const;
export const PAGE_POLL_MS = 15_000;

const fetchPage = (slug: string, qc: QueryClient, signal: AbortSignal, who: string | null) =>
  cachedFunding<InitiativePage>(
    qc,
    [...initiativeKey(slug), who],
    `/api/initiatives/${encodeURIComponent(slug)}`,
    (p) => p.refreshDue === true || p.summary.refreshDue === true || p.ledger?.refreshDue === true,
    signal,
    !who,
  );

/** The board card holds the identity, the pitch and the funding numbers:
 * enough to paint the head of the page at once. The text and the page facts
 * arrive with the page; until then they are empty and the route shows
 * skeletons in their place (`isPlaceholderData`). */
function fromBoard(board: Board | undefined, slug: string): InitiativePage | undefined {
  const card = board?.cards.find((c) => c.initiative.slug === slug);
  if (!card) return undefined;
  return {
    initiative: {
      ...card.initiative,
      details: "",
      discourseUrl: "",
      paidOutUsd: 0,
      proposer: "",
      durationMonths: null,
      recipientTeam: "",
      recipientUrl: "",
      topup: false,
      milestoneReviewer: "",
      sections: {},
      milestones: [],
      links: [],
      structured: true,
      revision: 0,
    },
    summary: card.summary,
    pct: card.pct,
    funded: card.funded,
    donationsEnabled: card.donationsEnabled,
    revisions: [],
    pledges: [],
    donations: [],
    ledger: null,
  };
}

export function useInitiative(slug: string) {
  const qc = useQueryClient();
  const who = sessionKey(useSession().session);
  const query = useQuery<InitiativePage>({
    queryKey: [...initiativeKey(slug), who],
    queryFn: ({ signal }) => fetchPage(slug, qc, signal, who),
    retry: false,
    // Poll the saved snapshot while visible; RPC runs only when the shared
    // server cache is stale. Fresh numbers animate without replacing the page.
    // A different visitor may own the refresh. Read KV more often until its
    // result arrives; these snapshot polls never duplicate the upstream work.
    refetchInterval: (q) => q.state.data?.ledger?.updating ? 2_000 : PAGE_POLL_MS,
    placeholderData: () => fromBoard(qc.getQueryData<Board>(boardKey), slug),
  });
  return {
    ...query,
    isUpdatingLedger: Boolean(
      query.data?.ledger?.updating ||
        (query.isFetching && query.data?.ledger?.refreshDue),
    ),
  };
}

/** Warm the initiative query on hover/focus so the click lands on cached data. */
export function usePrefetchInitiative(slug: string) {
  const qc = useQueryClient();
  const who = sessionKey(useSession().session);
  return useCallback(() => {
    void qc.prefetchQuery({
      queryKey: [...initiativeKey(slug), who],
      // Hover only warms the saved snapshot, without triggering RPC work.
      queryFn: ({ signal }) =>
        api<InitiativePage>(`/api/initiatives/${encodeURIComponent(slug)}`, {
          signal,
          anonymous: !who,
        }),
      staleTime: 30_000,
    });
  }, [qc, slug, who]);
}
