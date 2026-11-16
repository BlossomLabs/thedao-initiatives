/** A vote event of the signed-in badge holder's own (their ballot counted): the badge
 * holder mark on their avatar in the top bar glows gold once, as when the page loads. */
export const BADGE_GLOW_EVENT = "thedao:badge-glow";

export function glowBadge() {
  globalThis.dispatchEvent?.(new Event(BADGE_GLOW_EVENT));
}
