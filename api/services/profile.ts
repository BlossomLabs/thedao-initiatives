import {
  PRIVATE_BADGE_AVATAR,
  PRIVATE_BADGE_AVATAR_RULE,
  PRIVATE_BADGE_NAME_RULE,
  PRIVATE_BADGE_PFP,
} from "../../shared/profile.ts";
import { HttpError } from "../lib/errors.ts";
import { pfpUrl } from "../lib/json.ts";
import type { Deps } from "../middleware/context.ts";

async function hasPrivateBadge(deps: Deps, address: string, fresh = false) {
  try {
    return await deps.chain.hasVotingBadge(address, { throwOnError: true, fresh });
  } catch {
    throw new HttpError(503, "Could not check your voting badge. Try again in a moment.");
  }
}

/** Apply the fixed avatar to existing profiles too, without rewriting stored choices. */
export async function displayProfile(deps: Deps, address: string) {
  const [profile, privateBadge] = await Promise.all([
    deps.db.profiles.get(address),
    hasPrivateBadge(deps, address),
  ]);
  return {
    nickname: profile.nickname || null,
    pfp: privateBadge ? PRIVATE_BADGE_PFP : profile.pfp,
    pfpUrl: privateBadge ? PRIVATE_BADGE_AVATAR : pfpUrl(deps.config, profile.pfp),
  };
}

/** Fresh ownership check before accepting a preset or uploading any bytes. */
export async function assertAvatarEditable(deps: Deps, address: string) {
  if (await hasPrivateBadge(deps, address, true)) {
    throw new HttpError(403, PRIVATE_BADGE_AVATAR_RULE);
  }
}

/** The same fresh check before a display name is changed: voters keep theirs (#140). */
export async function assertNameEditable(deps: Deps, address: string) {
  if (await hasPrivateBadge(deps, address, true)) {
    throw new HttpError(403, PRIVATE_BADGE_NAME_RULE);
  }
}
