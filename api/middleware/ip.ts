import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/deno";
import { isIP } from "node:net";
import type { Ctx, Vars } from "./context.ts";
import { HttpError } from "../lib/errors.ts";

/** Plain IP literals only; equivalent IPv6 and IPv4-mapped forms share a quota. */
export function canonicalIp(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 45 || raw.includes("%")) return null;
  const address = raw.trim();
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return null;
  const ipv6 = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ipv6);
  if (!mapped) return ipv6;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
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
