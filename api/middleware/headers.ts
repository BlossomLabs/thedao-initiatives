import type { MiddlewareHandler } from "hono";
import type { Vars } from "./context.ts";
import type { Config } from "../config.ts";
import { HttpError } from "../lib/errors.ts";

export const securityHeaders: MiddlewareHandler<Vars> = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
};

/**
 * State-changing requests must come from an allowed browser origin (or from
 * a non-browser client that sends no Origin at all). Ports same_origin_only.
 */
export function originGuard(config: Config): MiddlewareHandler<Vars> {
  const allowed = new Set(config.webOrigins);
  return async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin && !allowed.has(origin)) {
        throw new HttpError(403, "cross-site request refused");
      }
    }
    await next();
  };
}

/** Private-beta gate: HTTP Basic Auth on everything except /healthz. */
export function siteLock(config: Config): MiddlewareHandler<Vars> {
  const enc = new TextEncoder();
  const same = (a: string, b: string) => {
    const x = enc.encode(a), y = enc.encode(b);
    if (x.length !== y.length) return false;
    let d = 0;
    for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
    return d === 0;
  };
  return async (c, next) => {
    if (
      !config.siteUsername || !config.sitePassword || c.req.path === "/healthz" ||
      c.req.method === "OPTIONS"
    ) {
      return await next();
    }
    const h = c.req.header("authorization") ?? "";
    const m = /^Basic\s+(.+)$/i.exec(h);
    if (m) {
      try {
        const [u, p] = atob(m[1]).split(":");
        if (same(u ?? "", config.siteUsername) && same(p ?? "", config.sitePassword)) {
          return await next();
        }
      } catch { /* fall through */ }
    }
    c.header("WWW-Authenticate", 'Basic realm="TheDAO RFP board"');
    return c.json({ error: "This site is in private preview." }, 401);
  };
}
