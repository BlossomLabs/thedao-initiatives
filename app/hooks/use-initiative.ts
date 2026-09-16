import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { api } from "~/lib/api";
import type { Board, InitiativePage } from "~/lib/api-types";
import { sessionKey, useSession } from "~/context/session";
import { boardKey } from "./use-board";
import { cachedFunding } from "~/lib/cached-funding";

export const initiativeKey = (slug: string) => ["initiative", slug] as const;
export const PAGE_POLL_MS = 15_000;

const fetchPage = (slug: string, qc: QueryClient, signal: AbortSignal) =>
  cachedFunding<InitiativePage>(
    qc,
    initiativeKey(slug),
    `/api/initiatives/${encodeURIComponent(slug)}`,
    (p) => p.refreshDue === true || p.summary.refreshDue === true || p.ledger?.refreshDue === true,
    signal,
  );

/** The board card holds everything but pledges and donations: enough to paint the page at once. */
function fromBoard(board: Board | undefined, slug: string): InitiativePage | undefined {
  const card = board?.cards.find((c) => c.initiative.slug === slug);
  if (!card) return undefined;
  return {
    initiative: card.initiative,
    summary: card.summary,
    pct: card.pct,
    funded: card.funded,
    donationsEnabled: card.donationsEnabled,
    onramp: card.onramp ?? { url: "", prefilled: false },
    revisions: [],
    pledges: [],
    donations: [],
    ledger: null,
  };
}

export function useInitiative(slug: string) {
  const qc = useQueryClient();
  // What the API answers depends on who asks (a pending initiative is only
  // visible to its proposer and admins, archived revisions only to admins),
  // so a sign-in or sign-out refetches the page.
  const who = sessionKey(useSession().session);
  const seen = useRef(who);
  useEffect(() => {
    if (seen.current === who) return;
    seen.current = who;
    void qc.invalidateQueries({ queryKey: initiativeKey(slug) });
  }, [who, slug, qc]);
  const query = useQuery<InitiativePage>({
    queryKey: initiativeKey(slug),
    queryFn: ({ signal }) => fetchPage(slug, qc, signal),
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
  return useCallback(() => {
    void qc.prefetchQuery({
      queryKey: initiativeKey(slug),
      // Hover only warms the saved snapshot, without triggering RPC work.
      queryFn: ({ signal }) =>
        api<InitiativePage>(`/api/initiatives/${encodeURIComponent(slug)}`, { signal }),
      staleTime: 30_000,
    });
  }, [qc, slug]);
}
