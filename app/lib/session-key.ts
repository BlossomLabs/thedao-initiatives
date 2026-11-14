/** Where this browser remembers who is signed in (context/session.tsx); the page's head
 * script reads it too (early-fetch.ts), before any module loads. */
export const SESSION_KEY = "thedao:session";
