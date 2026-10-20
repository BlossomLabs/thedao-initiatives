/** The comment box is the one place to rate on the initiative page; the side
 * card's Rate it sends the viewer there with this event. */
export const RATE_HERE = "rate-here";

export function goRate() {
  globalThis.dispatchEvent(new Event(RATE_HERE));
}
