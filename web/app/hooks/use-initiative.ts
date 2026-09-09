import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "~/lib/api";
import type { Board, InitiativePage } from "~/lib/api-types";
import { boardKey } from "./use-board";

export const initiativeKey = (slug: string) => ["initiative", slug] as const;

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
    pledges: [],
    donations: [],
  };
}

export function useInitiative(slug: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: initiativeKey(slug),
    queryFn: () => fetchPage(slug),
    retry: false,
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
