import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import type { Deps, Vars } from "./middleware/context.ts";
import { HttpError } from "./lib/errors.ts";
import { clientIp } from "./middleware/ip.ts";
import { sessionLoader } from "./middleware/auth.ts";
import { MARKDOWN_PATHS, markdownRoutes } from "./routes/markdown.ts";
import { apiHeaders, originGuard, securityHeaders, siteLock } from "./middleware/headers.ts";
import { authRoutes } from "./routes/auth.ts";
import { boardRoutes } from "./routes/board.ts";
import { initiativeRoutes } from "./routes/initiatives.ts";
import { donateRoutes } from "./routes/donate.ts";
import { profileRoutes } from "./routes/profile.ts";
import { commentRoutes } from "./routes/comments.ts";
import { aiRoutes } from "./routes/ai.ts";
import { supportRoutes } from "./routes/support.ts";
import { adminRoutes } from "./routes/admin.ts";
import { healthRoutes } from "./routes/health.ts";
import { uploadRoutes } from "./routes/uploads.ts";
import { createSiteLock, type SiteLock } from "./lib/sitelock.ts";
import { auditIntent, securityAudit } from "./services/audit.ts";
import { auditRoutes } from "./routes/audit.ts";
import type { StaticSite } from "./site.ts";

/** One preview gate covers pages, assets and API routes. */
export function siteLockFor(deps: Deps): SiteLock {
  return createSiteLock(deps.config, async (t) => Boolean(await deps.db.sessions.get(t, false)));
}

export function createApp(
  deps: Deps,
  lock: SiteLock = siteLockFor(deps),
  site?: StaticSite,
) {
  const app = new Hono<Vars>();
  // These namespaces must never fall through to the SPA, even for unknown API routes.
  // /api/* also matches /api itself in Hono.
  const apiPaths = site
    ? ["/api/*", "/healthz", ...Object.values(MARKDOWN_PATHS).map((p) => `/initiative${p}`)]
    : ["*"];
  const useApi = (...handlers: MiddlewareHandler<Vars>[]) => {
    for (const path of apiPaths) app.use(path, ...handlers);
  };

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, ...err.extra }, err.status as 400);
    }
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.use("*", securityHeaders(site?.policy));
  useApi(
    apiHeaders,
    securityAudit(deps),
    cors({
      origin: deps.config.webOrigins,
      allowHeaders: ["Authorization", "Content-Type", "X-Session-Activity"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      maxAge: 600,
    }),
  );
  app.use("*", siteLock(lock));
  useApi(
    clientIp(),
    originGuard(deps.config),
    bodyLimit({ maxSize: 2 * 1024 * 1024 }),
    sessionLoader(deps.db, deps.admins),
    auditIntent(deps),
  );

  app.route("/healthz", healthRoutes(deps));
  app.route("/api/auth", authRoutes(deps));
  app.route("/api/board", boardRoutes(deps));
  app.route("/api/initiatives", initiativeRoutes(deps));
  app.route("/api/donate", donateRoutes(deps));
  app.route("/api/uploads", uploadRoutes(deps));
  app.route("/api", profileRoutes(deps));
  app.route("/api", commentRoutes(deps));
  app.route("/api", aiRoutes(deps));
  app.route("/api", supportRoutes(deps));
  app.route("/api/admin/audit", auditRoutes(deps));
  app.route("/api/admin", adminRoutes(deps));
  app.route("/initiative", markdownRoutes(deps));

  if (site) {
    for (const path of apiPaths) app.all(path, (c) => c.notFound());
    app.all("*", (c) => site.serve(c.req.raw));
  }

  return app;
}
