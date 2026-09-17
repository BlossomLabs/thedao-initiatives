/**
 * The browser's session cookie.
 *
 * `POST /api/auth/verify` with `cookie: true` puts the session token in an
 * HttpOnly cookie instead of the JSON body, so a script running on the page
 * (an XSS, a compromised third-party bundle) cannot read it. Non-browser
 * clients (the dev scripts) keep the bearer. The cookie is the same opaque
 * token: hashed in KV, same TTL, same revocation.
 *
 * Over HTTPS the cookie is `__Host-session` with `Secure`: the prefix makes
 * the browser refuse it unless it is Secure, has no Domain and Path=/, so a
 * sibling host cannot plant one. Plain-http local dev (Vite on :5173 proxying
 * /api to :8000) cannot use either, so it gets a bare `session` cookie. Both
 * sides, setting and reading, derive the name from the same request, so the
 * two never mix.
 */
export const SECURE_SESSION_COOKIE = "__Host-session";
export const PLAIN_SESSION_COOKIE = "session";

/** Value of one cookie from a `Cookie` request header ("" when absent). */
export function readCookie(header: string | null, name: string): string {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/** Deno supplies the public request scheme; forwarding headers are ignored. */
export function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === "https:";
}

export function sessionCookieName(req: Request): string {
  return isSecureRequest(req) ? SECURE_SESSION_COOKIE : PLAIN_SESSION_COOKIE;
}

function attrs(req: Request, maxAge: number): string {
  const secure = isSecureRequest(req);
  return `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax` + (secure ? "; Secure" : "");
}

/** `Set-Cookie` value carrying the session token for `ttlSecs`. */
export function setSessionCookie(
  req: Request,
  token: string,
  ttlSecs: number,
): string {
  // Max-Age is an integer; the clock (Date.now()/1000) is not.
  return `${sessionCookieName(req)}=${token}; ${attrs(req, Math.max(0, Math.floor(ttlSecs)))}`;
}

/** `Set-Cookie` value that removes the session cookie. */
export function clearSessionCookie(req: Request): string {
  return `${sessionCookieName(req)}=; ${attrs(req, 0)}`;
}

/** The session token from the cookie, "" when the request carries none. */
export function readSessionCookie(req: Request): string {
  return readCookie(req.headers.get("cookie"), sessionCookieName(req));
}
