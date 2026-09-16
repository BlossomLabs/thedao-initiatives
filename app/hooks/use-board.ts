import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cachedFunding } from "~/lib/cached-funding";
import type { Board } from "~/lib/api-types";

export const boardKey = ["board"] as const;

export const BOARD_POLL_MS = 30_000;

export function useBoard() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: boardKey,
    queryFn: ({ signal }) =>
      cachedFunding<Board>(
        qc,
        boardKey,
        "/api/board",
        (b) =>
          b.refreshDue === true ||
          b.cards.some((c) => c.summary.refreshDue === true || c.ledger?.refreshDue === true),
        signal,
      ),
    refetchInterval: (q) =>
      q.state.data?.cards.some((c) => c.ledger?.updating) ? 2_000 : BOARD_POLL_MS,
  });
  return {
    ...query,
    isUpdatingLedger: Boolean(
      query.data?.cards.some((c) =>
        c.ledger?.updating || (query.isFetching && c.ledger?.refreshDue)
      ),
    ),
  };
}
