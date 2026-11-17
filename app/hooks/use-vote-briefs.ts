import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";
import type { VoteBrief } from "../../shared/vote/brief";

/** Every approved initiative's vote brief (#96), by slug: the bullets of its card on
 * /vote. Loaded once a card opens; the server keeps it half a minute. */
export function useVoteBriefs(enabled = true) {
  return useQuery({
    queryKey: ["vote-briefs"],
    queryFn: async () =>
      (await api<{ briefs: Record<string, VoteBrief> }>("/api/board/vote-briefs", {
        passive: true,
      })).briefs,
    staleTime: 60_000,
    retry: 1,
    enabled,
  });
}
