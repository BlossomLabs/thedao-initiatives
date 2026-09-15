import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/deno";
import type { Vars } from "./context.ts";

/**
 * Best-effort client IP for rate limiting. X-Forwarded-For is
 * attacker-controlled unless a trusted proxy sets it, so it is ignored unless
 * TRUST_PROXY is on; then the right-most hop (appended by the proxy) wins.
 */
export function clientIp(trustProxy: boolean): MiddlewareHandler<Vars> {
  return async (c, next) => {
    let ip = "";
    if (trustProxy) {
      const xff = c.req.header("x-forwarded-for") ?? "";
      if (xff) ip = xff.split(",").pop()!.trim();
    }
    if (!ip) {
      try {
        ip = getConnInfo(c).remote.address ?? "";
      } catch {
        ip = "";
      }
    }
    c.set("ip", ip || "?");
    await next();
  };
}
