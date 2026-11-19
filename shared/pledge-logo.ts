/** A pledge's logo shows from this amount up. Below it the logo stays saved,
 * but every public view draws the silhouette, as if none was uploaded. */
export const PLEDGE_LOGO_MIN_USD = 10000;

/** The logo the public sees: the saved one at or above the threshold, else none. */
export const shownLogoCid = (p: { amountUsd: number; logoCid: string }): string =>
  p.amountUsd >= PLEDGE_LOGO_MIN_USD ? p.logoCid : "";
