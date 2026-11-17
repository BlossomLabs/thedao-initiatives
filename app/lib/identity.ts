/** Display identity for an address. Private voting badges have a fixed avatar.
 * Otherwise, precedence is ENS name and avatar first,
 * then the site profile (nickname, chosen/uploaded picture), then a short
 * address and the deterministic default picture. */
import type { EnsName, Profile } from "./api-types";
import { avatarSrc } from "./avatar";
import { shortAddr } from "./format";
import { PRIVATE_BADGE_AVATAR, PRIVATE_BADGE_PFP } from "@shared/profile";

export interface Identity {
  address: string;
  /** What to show. */
  name: string;
  avatar: string;
  /** ENS primary name / avatar record, when the address has them. */
  ens: string | null;
  ensAvatar: string | null;
  /** Site profile. `pfp` is "" while nothing was ever chosen. */
  nickname: string | null;
  pfp: string;
  /** ENS-sourced fields cannot be edited on the site. */
  nameFromEns: boolean;
  avatarFromEns: boolean;
  avatarFromBadge: boolean;
  /** Locked for badgeholders, ENS avatars, and until the profile check succeeds. */
  avatarLocked: boolean;
  /** False while nothing but the fallbacks is available. */
  hasName: boolean;
  hasAvatar: boolean;
  loading: boolean;
}

export function resolveIdentity(
  address: string,
  profile: Profile | undefined,
  ens: EnsName | undefined,
  loading = false,
): Identity {
  const ensName = ens?.name || null;
  const ensAvatar = (ensName && ens?.avatar) || null;
  const nickname = profile?.nickname || null;
  const pfp = profile?.pfp ?? "";
  const avatarFromBadge = pfp === PRIVATE_BADGE_PFP;
  const avatarFromEns = Boolean(profile && !avatarFromBadge && ensAvatar);
  return {
    address,
    name: ensName || nickname || shortAddr(address),
    avatar: avatarFromBadge
      ? PRIVATE_BADGE_AVATAR
      : (avatarFromEns ? ensAvatar! : avatarSrc(address, pfp, profile?.pfpUrl)),
    ens: ensName,
    ensAvatar,
    nickname,
    pfp,
    nameFromEns: Boolean(ensName),
    avatarFromEns,
    avatarFromBadge,
    avatarLocked: !profile || avatarFromBadge || avatarFromEns,
    hasName: Boolean(ensName || nickname),
    hasAvatar: Boolean(avatarFromEns || pfp),
    loading,
  };
}
