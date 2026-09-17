import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/deno";
import { isIP } from "node:net";
import type { Ctx, Vars } from "./context.ts";
import { HttpError } from "../lib/errors.ts";

/** Plain IP literals only; equivalent IPv6 and IPv4-mapped forms share a quota.
 * An IPv6 client is identified by its /64 (`2001:db8::/64`): one subscriber
 * typically owns the whole prefix, so per-address buckets would be free to rotate. */
export function canonicalIp(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 45 || raw.includes("%")) return null;
  const address = raw.trim();
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return null;
  const ipv6 = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ipv6);
  if (!mapped) return ipv6Prefix64(ipv6);
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
}

/** `ipv6` is already URL-normalized (lower case, `::` compressed). */
function ipv6Prefix64(ipv6: string): string {
  const [head, tail = ""] = ipv6.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const hextets = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  const prefix = new URL(`http://[${hextets.slice(0, 4).join(":")}::]/`).hostname.slice(1, -1);
  return `${prefix}/64`;
}

/** Deno supplies the client address. Caller-provided forwarding headers never
 * establish an identity, and missing metadata never uses a shared '?' quota. */
export function clientIp(): MiddlewareHandler<Vars> {
  return async (c, next) => {
    let ip: string | null = null;
    try {
      ip = canonicalIp(getConnInfo(c).remote.address);
    } catch { /* Missing runtime metadata is an unknown identity. */ }
    c.set("ip", ip);
    await next();
  };
}

/** Call at the actual IP quota: public/cache-only or account-only routes can
 * remain available without inventing or sharing a client identity. */
export function requireClientIp(c: Ctx): string {
  if (!c.var.ip) {
    throw new HttpError(503, "Client network identity is unavailable. Try again later.");
  }
  return c.var.ip;
}
