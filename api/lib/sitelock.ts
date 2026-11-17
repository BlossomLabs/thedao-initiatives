/**
 * Private-preview gate applied once by Hono to pages, assets and the API.
 *
 * HTTP Basic Auth unlocks the site; a stateless HMAC cookie keeps it unlocked
 * so the browser's later API calls (which can never carry Basic credentials as
 * well) keep working. A live session also passes, whether it arrives as the
 * browser's session cookie or as a bearer, since it could only have been
 * created by someone who was already let in: that is what keeps a signed-in
 * browser and the token-based dev scripts working.
 */
import { decodeHex, encodeHex } from "@std/encoding";
import type { Config } from "../config.ts";
import { readCookie, readSessionCookie } from "./session-cookie.ts";

export type LockVerdict = "open" | "basic" | "cookie" | "session" | "denied";

export const LOCK_COOKIE = "__Host-site_lock";
export const LOCK_REALM = 'Basic realm="TheDAO RFP board"';
export const LOCK_MESSAGE =
  "This site is in private preview. Enter the username and password you were given to continue.";
const COOKIE_MAX_AGE = 30 * 86400;

export interface SiteLock {
  enabled: boolean;
  check(req: Request): Promise<LockVerdict>;
  /** `Set-Cookie` value to send after a successful Basic login. */
  cookie(req: Request): Promise<string>;
}

const enc = new TextEncoder();
function same(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export function createSiteLock(
  config: Pick<Config, "siteUsername" | "sitePassword" | "siteCookieKey">,
  hasSession: (token: string) => Promise<boolean>,
  now: () => number = () => Math.floor(Date.now() / 1000),
): SiteLock {
  const user = config.siteUsername;
  const pass = config.sitePassword;
  const enabled = Boolean(user && pass);
  if (enabled && !/^[a-f0-9]{64}$/i.test(config.siteCookieKey)) {
    throw new Error(
      "Private preview requires SITE_COOKIE_KEY: 32 cryptographically random bytes in hex.",
    );
  }

  // Expiry is authenticated and checked by the server, not just the browser.
  // Bind tokens to this origin and account; rotating the secret revokes them.
  let keyPromise: Promise<CryptoKey> | undefined;
  const key = () =>
    keyPromise ??= crypto.subtle.importKey(
      "raw",
      decodeHex(config.siteCookieKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  const message = (req: Request, payload: string) =>
    // Password rotation also revokes cookies, without using the password as key material.
    enc.encode(JSON.stringify(["site-lock", new URL(req.url).origin, user, pass, payload]));

  async function validCookie(req: Request, value: string): Promise<boolean> {
    const match = /^(v1\.(\d{10})\.[a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value);
    if (!match) return false;
    const expires = Number(match[2]);
    const current = now();
    if (expires <= current || expires > current + COOKIE_MAX_AGE) return false;
    return await crypto.subtle.verify(
      "HMAC",
      await key(),
      decodeHex(match[3]),
      message(req, match[1]),
    );
  }

  async function check(req: Request): Promise<LockVerdict> {
    if (!enabled) return "open";
    if (req.method === "OPTIONS" || new URL(req.url).pathname === "/healthz") return "open";
    const h = req.headers.get("authorization") ?? "";
    const basic = /^Basic\s+(.+)$/i.exec(h);
    if (basic) {
      try {
        const [u, ...rest] = atob(basic[1]).split(":");
        if (same(u ?? "", user) && same(rest.join(":"), pass)) return "basic";
      } catch { /* malformed base64 */ }
    }
    const ck = readCookie(req.headers.get("cookie"), LOCK_COOKIE);
    if (ck && await validCookie(req, ck)) return "cookie";
    const token = /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim() ||
      readSessionCookie(req);
    if (token && await hasSession(token)) return "session";
    return "denied";
  }

  const cookie = async (req: Request) => {
    const nonce = encodeHex(crypto.getRandomValues(new Uint8Array(16)));
    const payload = `v1.${Math.floor(now()) + COOKIE_MAX_AGE}.${nonce}`;
    const signature = encodeHex(
      await crypto.subtle.sign("HMAC", await key(), message(req, payload)),
    );
    return `${LOCK_COOKIE}=${payload}.${signature}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
  };

  return { enabled, check, cookie };
}
