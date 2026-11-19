/** Display-name rules the nickname dialog and the API agree on. */
export const NICKNAME_MAX = 40;
export const NICK_RE = /^[A-Za-z0-9 ._-]{1,40}$/;
export const NICKNAME_RULE = "Names are 1-40 letters, numbers, spaces or . _ -";

/** The shared, fixed picture for private voting badge wallets. */
export const PRIVATE_BADGE_PFP = "private-badge";
export const PRIVATE_BADGE_AVATAR = "/avatars/daotoshi-avatar-flat-cartoon.webp";
export const PRIVATE_BADGE_AVATAR_RULE =
  "Private voting badgeholders use this shared avatar. It cannot be changed.";
/** Voters' names are set for them too (#140). */
export const PRIVATE_BADGE_NAME_RULE =
  "Private voting badgeholders keep the name they were given. It cannot be changed.";
