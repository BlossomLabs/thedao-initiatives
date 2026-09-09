/**
 * Private-preview gate shared by the API middleware and the static server.
 *
 * HTTP Basic Auth unlocks the site; a stateless HMAC cookie keeps it unlocked
 * so the browser's `Authorization: Bearer` calls (which can never carry Basic
 * credentials as well) keep working. A live bearer session also passes, since
 * it could only have been created by someone who was already let in: that is
 * what keeps the token-based dev scripts working.
 */
import { encodeHex } from "@std/encoding";
import type { Config } from "../config.ts";

export type LockVerdict = "open" | "basic" | "cookie" | "session" | "denied";

export const LOCK_COOKIE = "site_lock";
export const LOCK_REALM = 'Basic realm="TheDAO RFP board"';
export const LOCK_MESSAGE =
  "This site is in private preview. Enter the username and password you were given to continue.";
const COOKIE_MAX_AGE = 30 * 86400;

export interface SiteLock {
  enabled: boolean;
  check(req: Request): Promise<LockVerdict>;
  /** `Set-Cookie` value to send after a successful Basic login. */
  cookie(): Promise<string>;
}

const enc = new TextEncoder();
function same(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

function readCookie(header: string | null, name: string): string {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

export function createSiteLock(
  config: Pick<Config, "siteUsername" | "sitePassword">,
  hasSession: (token: string) => Promise<boolean>,
): SiteLock {
  const user = config.siteUsername;
  const pass = config.sitePassword;
  const enabled = Boolean(user && pass);

  // HMAC(password, username): nothing stored, changing the password logs
  // every browser out at once.
  let value: Promise<string> | null = null;
  const cookieValue = () =>
    value ??= (async () => {
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(pass),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      return encodeHex(await crypto.subtle.sign("HMAC", key, enc.encode("site-lock:" + user)));
    })();

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
    if (ck && same(ck, await cookieValue())) return "cookie";
    const token = /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim();
    if (token && await hasSession(token)) return "session";
    return "denied";
  }

  const cookie = async () =>
    `${LOCK_COOKIE}=${await cookieValue()}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;

  return { enabled, check, cookie };
}
