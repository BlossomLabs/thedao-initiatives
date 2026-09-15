import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";
import type { EnsName, Profile } from "~/lib/api-types";
import { type Identity, resolveIdentity } from "~/lib/identity";

export type { Identity };

/**
 * Display identity for an address: ENS name/avatar first, then the site
 * profile, then a short address. Both lookups run in parallel; the server
 * caches ENS answers so repeated addresses are cheap.
 */
export function useIdentity(address: string | undefined | null): Identity {
  const addr = address ?? "";
  const enabled = /^0x[0-9a-fA-F]{40}$/.test(addr);
  const profile = useQuery({
    queryKey: ["profile", addr.toLowerCase()],
    enabled,
    staleTime: 60_000,
    queryFn: () => api<Profile>(`/api/nickname/${addr}`),
  });
  const ens = useQuery({
    queryKey: ["ens", addr.toLowerCase()],
    enabled,
    staleTime: 3600_000,
    queryFn: () => api<EnsName>(`/api/ens-name/${addr}`),
  });
  // A wallet with both a nickname and a picture is complete whatever ENS
  // says, so only an incomplete profile waits for the (slower) ENS answer.
  const siteComplete = Boolean(profile.data?.nickname && profile.data?.pfp);
  return resolveIdentity(
    addr,
    profile.data,
    ens.data,
    enabled && (profile.isLoading || (ens.isLoading && !siteComplete)),
  );
}
