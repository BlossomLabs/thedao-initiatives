import { DEVCON } from "../../shared/devcon/manifest";

/**
 * The code of the badge whose ballot this browser last opened, so /devcon can
 * link back to it. Kept per round, in this browser only.
 */
const myCodeKey = `devcon-my-code:${DEVCON.contract}`;

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
