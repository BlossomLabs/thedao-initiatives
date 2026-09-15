import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { api } from "~/lib/api";
import type { Board, InitiativePage } from "~/lib/api-types";
import { sessionKey, useSession } from "~/context/session";
import { boardKey } from "./use-board";

export const initiativeKey = (slug: string) => ["initiative", slug] as const;
export const PAGE_POLL_MS = 15_000;

const fetchPage = (slug: string) =>
  api<InitiativePage>(`/api/initiatives/${encodeURIComponent(slug)}`);

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
  return useQuery({
    queryKey: initiativeKey(slug),
    queryFn: () => fetchPage(slug),
    retry: false,
    // "raised" is the Safe's balance, so a poll is enough to keep it live
    // while the page is open (paused in background tabs by default).
    refetchInterval: PAGE_POLL_MS,
    placeholderData: () => fromBoard(qc.getQueryData<Board>(boardKey), slug),
  });
}

/** Warm the initiative query on hover/focus so the click lands on cached data. */
export function usePrefetchInitiative(slug: string) {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.prefetchQuery({
      queryKey: initiativeKey(slug),
      queryFn: () => fetchPage(slug),
      staleTime: 30_000,
    });
  }, [qc, slug]);
}
