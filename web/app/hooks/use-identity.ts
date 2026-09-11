import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";
import type { EnsName, Profile } from "~/lib/api-types";
import { ensdataAvatar } from "~/lib/ens-avatar";
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
    queryFn: () => api<Profile>(`/api/nickname/${addr}`, { token: null }),
  });
  const ens = useQuery({
    queryKey: ["ens", addr.toLowerCase()],
    enabled,
    staleTime: 3600_000,
    queryFn: () => api<EnsName>(`/api/ens-name/${addr}`, { token: null }),
  });
  // A name whose avatar the server could not render (see lib/ens-avatar):
  // ask ensdata from the browser. Nothing waits for this answer; the picture
  // upgrades from the fallback when it arrives.
  const ensName = ens.data?.name ?? "";
  const needsAvatar = Boolean(ensName) && !ens.data?.avatar;
  const avatar = useQuery({
    queryKey: ["ens-avatar", ensName.toLowerCase()],
    enabled: needsAvatar,
    staleTime: 3600_000,
    retry: false,
    queryFn: () => ensdataAvatar(ensName),
  });
  const ensData = ens.data && needsAvatar && avatar.data
    ? { ...ens.data, avatar: avatar.data }
    : ens.data;
  // A wallet with both a nickname and a picture is complete whatever ENS
  // says, so only an incomplete profile waits for the (slower) ENS answer.
  const siteComplete = Boolean(profile.data?.nickname && profile.data?.pfp);
  return resolveIdentity(
    addr,
    profile.data,
    ensData,
    enabled && (profile.isLoading || (ens.isLoading && !siteComplete)),
  );
}
