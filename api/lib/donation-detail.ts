/** Public donation diagnostics never include upstream exception text. */
export const PRICE_UNAVAILABLE_DETAIL = "price feed unavailable, will retry";

/** Older pending rows may contain an RPC URL or provider message after this prefix. */
export function donationDetail(detail: string): string {
  return detail.startsWith(PRICE_UNAVAILABLE_DETAIL) ? PRICE_UNAVAILABLE_DETAIL : detail;
}
