/** The board's data request, started by a head script before any module loads
 * so it overlaps the JavaScript download; `api()` picks the response up on its
 * first read of the same path and the cards paint as soon as the app hydrates.
 * Only the prerendered board page ("/") starts one. The request is the app's
 * own board read: credentials included, marked passive so it does not extend
 * the session's inactivity deadline. */
import { API_URL } from "./api-url";

declare global {
  var __early: Record<string, Promise<Response>> | undefined;
}

const BOARD_PATH = "/api/board";

export const EARLY_FETCH_SCRIPT = "if(location.pathname==='/')window.__early={" +
  JSON.stringify(BOARD_PATH) + ":fetch(" + JSON.stringify(API_URL + BOARD_PATH) +
  ",{credentials:'include',headers:{'X-Session-Activity':'passive'}})};";

/** The started request for `path`, handed over once; nothing after the first taker. */
export function takeEarly(path: string): Promise<Response> | undefined {
  const early = globalThis.__early?.[path];
  if (early) delete globalThis.__early![path];
  return early;
}
