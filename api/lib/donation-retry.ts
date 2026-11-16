/** Unknown hashes are retried for a week; observed transactions can recover later. */
export const UNKNOWN_DONATION_MAX_AGE_SECS = 7 * 86400;
export const DONATION_RETRY_MAX_SECS = 3600;

/** The initial submission allows one immediate retry; later checks back off. */
export const donationRetryDelay = (attempts: number): number =>
  attempts === 0 ? 0 : Math.min(60 * 2 ** Math.min(attempts - 1, 6), DONATION_RETRY_MAX_SECS);
