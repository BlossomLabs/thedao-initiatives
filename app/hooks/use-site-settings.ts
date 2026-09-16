import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";

/** Global UI needs configuration, not a subscription to every Safe's balances. */
export function useSiteSettings() {
  return useQuery({
    queryKey: ["site-settings"],
    queryFn: () => api<{ uploads: boolean; support: boolean }>("/api/board/settings"),
    staleTime: 5 * 60_000,
  });
}
