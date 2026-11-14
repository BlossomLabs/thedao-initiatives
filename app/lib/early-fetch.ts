/** A page's main data request, started by a head script before any module loads
 * so it overlaps the JavaScript download; `api()` picks the response up on its
 * first read of the same path and the page paints as soon as the app hydrates.
 * The board page ("/") starts the board; an initiative's page
 * ("/initiative/<slug>") starts that initiative. Each request is sent as the app
 * would send it: marked passive so it does not extend the session's inactivity
 * deadline, and with the cookie only while this browser remembers a session
 * (the initiative read is anonymous otherwise, see use-initiative.ts). A failure
 * is held quietly (no unhandled rejection in the console) until the app takes it
 * and sends its own request. In `deno task dev` StrictMode's double mount
 * discards the early response and sends a second request; production has no
 * StrictMode, so verify the single request on a built site. */
import { API_URL } from "./api-url";
import { SESSION_KEY } from "./session-key";

/** A started request, and whether it went without the cookie. */
type Early = { p: Promise<Response>; anonymous: boolean };

declare global {
  var __early: Record<string, Early> | undefined;
}

const BOARD_PATH = "/api/board";

/** The head script. Kept to plain ES5: it runs before anything else on the page.
 * The session check is context/session.tsx's `load()`: an address and an expiry
 * still ahead. Only plain slugs are matched, so the path is the one the app builds. */
export const EARLY_FETCH_SCRIPT = "(function(){var l=location.pathname,path,anon=false;" +
  "var m=/^\\/initiative\\/([a-z0-9-]+)\\/?$/i.exec(l);" +
  "if(l==='/')path=" + JSON.stringify(BOARD_PATH) + ";" +
  "else if(m){path='/api/initiatives/'+m[1];" +
  "try{var s=JSON.parse(localStorage.getItem(" + JSON.stringify(SESSION_KEY) + ")||'null');" +
  "anon=!(s&&typeof s.address==='string'&&typeof s.expiresAt==='number'&&s.expiresAt*1000>=Date.now())}" +
  "catch(e){anon=true}}" +
  "else return;" +
  "var p=fetch(" + JSON.stringify(API_URL) + "+path," +
  "{credentials:anon?'omit':'include',headers:{'X-Session-Activity':'passive'}});" +
  "p.catch(function(){});window.__early={};window.__early[path]={p:p,anonymous:anon}})()";

/** The started request for `path`, handed over once, and only to a read sent the
 * same way (with or without the cookie); nothing after the first taker. */
export function takeEarly(path: string, anonymous = false): Promise<Response> | undefined {
  const early = globalThis.__early?.[path];
  if (!early || early.anonymous !== anonymous) return undefined;
  delete globalThis.__early![path];
  return early.p;
}
