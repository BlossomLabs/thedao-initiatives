import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";
import type { SiteSettings } from "~/lib/api-types";

export const siteSettingsKey = ["site-settings"] as const;

/** Global UI needs configuration, not a subscription to every Safe's balances.
 * The maintenance flag rides along, so it is re-read every minute. */
export function useSiteSettings() {
  return useQuery({
    queryKey: siteSettingsKey,
    queryFn: () => api<SiteSettings>("/api/board/settings"),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
