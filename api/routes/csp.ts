import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireClientIp } from "../middleware/ip.ts";

/** Browser reports are untrusted telemetry. Never retain URLs, samples or credentials. */
export function cspRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  r.post(
    "/",
    bodyLimit({ maxSize: 16_384, onError: (c) => c.json({ error: "Report too large." }, 413) }),
    async (c) => {
      const ip = requireClientIp(c);
      if (
        !await deps.db.rateLimit(`csp:${ip}`, 20, 60) ||
        !await deps.db.rateLimit("csp:global", 200, 60)
      ) return c.body(null, 429);
      const data = await c.req.json().catch(() => null);
      const reports = Array.isArray(data)
        ? data.slice(0, 10).map((r) => r?.body)
        : [data?.["csp-report"]];
      const directives = new Set([
        "script-src-elem",
        "script-src-attr",
        "script-src",
        "connect-src",
        "img-src",
        "frame-src",
        "style-src",
        "style-src-elem",
        "font-src",
        "worker-src",
        "base-uri",
        "object-src",
        "form-action",
        "frame-ancestors",
      ]);
      for (const report of reports) {
        if (!report || typeof report !== "object") continue;
        const directive = report["effective-directive"] ?? report.effectiveDirective;
        if (!directives.has(directive)) continue;
        // Only the resource category is retained: even hostnames may contain private identifiers.
        const blocked = report["blocked-uri"] ?? report.blockedURL;
        const resource = ["inline", "eval", "data", "blob"].includes(blocked)
          ? blocked
          : "external";
        try {
          deps.log(JSON.stringify({ securityCsp: true, directive, resource, at: deps.now() }));
        } catch { /* best effort */ }
      }
      return c.body(null, 204);
    },
  );
  return r;
}
