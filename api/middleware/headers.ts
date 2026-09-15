import type { MiddlewareHandler } from "hono";
import type { Vars } from "./context.ts";
import type { Config } from "../config.ts";
import { HttpError } from "../lib/errors.ts";
import { LOCK_MESSAGE, LOCK_REALM, type SiteLock } from "../lib/sitelock.ts";
import { selfOrigin } from "../lib/origin.ts";

export const securityHeaders: MiddlewareHandler<Vars> = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
};

/**
 * State-changing requests must come from an allowed browser origin, the
 * platform origin they were served on, or a non-browser client that sends no
 * Origin at all. Ports same_origin_only.
 */
export function originGuard(config: Config): MiddlewareHandler<Vars> {
  const allowed = new Set(config.webOrigins);
  return async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (
        origin && !allowed.has(origin) && origin !== selfOrigin(c.req.raw, config)
      ) {
        throw new HttpError(403, "cross-site request refused");
      }
    }
    await next();
  };
}

/** Private-preview gate (see lib/sitelock.ts). */
export function siteLock(lock: SiteLock): MiddlewareHandler<Vars> {
  return async (c, next) => {
    const verdict = await lock.check(c.req.raw);
    if (verdict === "denied") {
      c.header("WWW-Authenticate", LOCK_REALM);
      return c.json({ error: LOCK_MESSAGE }, 401);
    }
    await next();
    if (verdict === "basic") c.header("Set-Cookie", await lock.cookie());
  };
}
