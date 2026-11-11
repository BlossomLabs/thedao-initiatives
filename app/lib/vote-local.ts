import { ROUND } from "../../shared/vote/manifest";

/**
 * The code of the badge whose ballot this browser last opened, so /vote can
 * link back to it. Kept per round, in this browser only.
 */
const myCodeKey = `vote-my-code:${ROUND.contract}`;

export function rememberMyCode(code: string) {
  try {
    localStorage.setItem(myCodeKey, code);
  } catch { /* storage unavailable */ }
}

export function myCode(): string | null {
  try {
    return localStorage.getItem(myCodeKey);
  } catch {
    return null;
  }
}
