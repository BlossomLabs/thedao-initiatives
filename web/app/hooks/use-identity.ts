import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";
import type { Profile } from "~/lib/api-types";
import { avatarSrc } from "~/lib/avatar";
import { shortAddr } from "~/lib/format";

export interface Identity {
  name: string;
  nickname: string | null;
  ens: string | null;
  avatar: string;
  loading: boolean;
}

/** Display identity for an address: nickname, else ENS, else short address. */
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
    enabled: enabled && profile.isSuccess && !profile.data?.nickname,
    staleTime: 3600_000,
    queryFn: () => api<{ name: string | null }>(`/api/ens-name/${addr}`, { token: null }),
  });
  const nickname = profile.data?.nickname ?? null;
  const ensName = ens.data?.name ?? null;
  return {
    name: nickname || ensName || shortAddr(addr),
    nickname,
    ens: ensName,
    avatar: avatarSrc(addr, profile.data?.pfp, profile.data?.pfpUrl),
    loading: enabled && (profile.isLoading || ens.isLoading),
  };
}
