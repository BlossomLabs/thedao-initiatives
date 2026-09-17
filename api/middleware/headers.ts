import type { MiddlewareHandler } from "hono";
import type { Vars } from "./context.ts";
import type { Config } from "../config.ts";
import { HttpError } from "../lib/errors.ts";
import { LOCK_MESSAGE, LOCK_REALM, type SiteLock } from "../lib/sitelock.ts";
import { selfOrigin } from "../lib/origin.ts";
import type { SitePolicy } from "../lib/site-headers.ts";

const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/** Shared by pages, assets and API responses, including early denials and errors. */
export function securityHeaders(policy?: SitePolicy): MiddlewareHandler<Vars> {
  return async (c, next) => {
    await next();
    // API middleware has already selected its policy. Otherwise apply the site's policy
    // here, after static handlers return a raw Response (which can replace earlier headers).
    if (!c.res.headers.has("Content-Security-Policy")) {
      c.header("Content-Security-Policy", policy?.enforced ?? API_CSP);
      if (policy?.reportOnly) c.header("Content-Security-Policy-Report-Only", policy.reportOnly);
    }
    c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  };
}

export const apiHeaders: MiddlewareHandler<Vars> = async (c, next) => {
  await next();
  c.header("Content-Security-Policy", API_CSP);
  c.header("Content-Security-Policy-Report-Only", undefined);
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
      c.header("Cache-Control", "no-store");
      return c.json({ error: LOCK_MESSAGE }, 401);
    }
    await next();
    if (verdict === "basic") c.header("Set-Cookie", await lock.cookie(), { append: true });
  };
}
