import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import type { Deps, Vars } from "./middleware/context.ts";
import { HttpError } from "./lib/errors.ts";
import { clientIp } from "./middleware/ip.ts";
import { sessionLoader } from "./middleware/auth.ts";
import { MARKDOWN_PATHS, markdownRoutes } from "./routes/markdown.ts";
import { apiHeaders, originGuard, securityHeaders, siteLock } from "./middleware/headers.ts";
import { authRoutes } from "./routes/auth.ts";
import { boardRoutes, createBoardCache } from "./routes/board.ts";
import { initiativeRoutes } from "./routes/initiatives.ts";
import { donateRoutes } from "./routes/donate.ts";
import { profileRoutes } from "./routes/profile.ts";
import { commentRoutes } from "./routes/comments.ts";
import { aiRoutes } from "./routes/ai.ts";
import { supportRoutes } from "./routes/support.ts";
import { adminRoutes } from "./routes/admin.ts";
import { cspRoutes } from "./routes/csp.ts";
import { watchlistRoutes } from "./routes/watchlist.ts";
import { healthRoutes } from "./routes/health.ts";
import { uploadRoutes } from "./routes/uploads.ts";
import { createFeedCache, FEED_PATHS, feedRoutes } from "./routes/feeds.ts";
import { createSiteLock, type SiteLock } from "./lib/sitelock.ts";
import { auditIntent, securityAudit } from "./services/audit.ts";
import { maintenanceGate } from "./services/maintenance.ts";
import { auditRoutes } from "./routes/audit.ts";
import type { StaticSite } from "./site.ts";

/** The public initiative Markdown file (not the admin -PRIVATE one): open CORS like the feeds. */
const PUBLIC_MD = /^\/initiative\/[a-z0-9-]+\.md$/;

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
    ? [
      "/api/*",
      "/healthz",
      ...Object.values(MARKDOWN_PATHS).map((p) => `/initiative${p}`),
      ...FEED_PATHS.filter((p) => !p.startsWith("/api/")),
    ]
    : ["*"];
  const feedPaths = new Set<string>(FEED_PATHS);
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
  // JSON bodies gzip to about a fifth (the board is the one that matters) and
  // the built site's scripts and styles to a third; serveDir sends them raw.
  // Hono skips HEAD, 206, bodiless answers (304), already encoded and
  // non-compressible types, and file bodies under 1 KB (a c.json() body has
  // no Content-Length, so small JSON is compressed as it always was).
  app.use("*", compress());
  useApi(
    apiHeaders,
    securityAudit(deps),
  );
  // A tab left open keeps running the build it loaded; every API answer names
  // the build now being served so the app can reload itself (app/lib/app-upgrade.ts).
  const version = site?.version ?? null;
  if (version) {
    useApi(async (c, next) => {
      await next();
      c.header("X-App-Version", version);
    });
  }
  // The feeds are open to any origin without credentials; everything else is not.
  const apiCors = cors({
    origin: deps.config.webOrigins,
    allowHeaders: ["Authorization", "Content-Type", "X-Session-Activity"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 600,
  });
  const feedCors = cors({ origin: "*", allowMethods: ["GET", "HEAD", "OPTIONS"], maxAge: 600 });
  const isFeed = (path: string) => feedPaths.has(path) || PUBLIC_MD.test(path);
  useApi((c, next) => (isFeed(c.req.path) ? feedCors : apiCors)(c, next));
  app.use("*", siteLock(lock));
  // A backup restore carries the whole database; it sets its own, larger cap.
  const limit = bodyLimit({
    maxSize: 2 * 1024 * 1024,
    onError: (c) => c.json({ error: "Request body too large (2 MB max)." }, 413),
  });
  useApi(
    clientIp(),
    originGuard(deps.config),
    (c, next) => c.req.path === "/api/admin/restore" ? next() : limit(c, next),
  );
  // Reports never load or refresh an authenticated session.
  app.route("/api/csp-report", cspRoutes(deps));
  // The app's version check: before the session loader, so it never reads or extends a session.
  app.get("/api/version", (c) => c.json({ version }));
  useApi(
    sessionLoader(deps.db, deps.admins),
    auditIntent(deps),
    maintenanceGate(deps),
  );

  // Any write may change a card (pledge, donation, approval, pin), so the next
  // board read in this isolate is rebuilt; other isolates wait out their window.
  // The feed's shared KV copy goes too, so every isolate rebuilds it once.
  const boardCache = createBoardCache(deps);
  const feedCache = createFeedCache(deps, boardCache);
  useApi(async (c, next) => {
    try {
      await next();
    } finally {
      if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
        boardCache.clear();
        await feedCache.clear();
      }
    }
  });

  app.route("/healthz", healthRoutes(deps));
  // Before /api/initiatives, so /api/initiatives.json is never read as a slug.
  app.route("/", feedRoutes(feedCache));
  app.route("/api/auth", authRoutes(deps));
  app.route("/api/board", boardRoutes(deps, boardCache));
  app.route("/api/initiatives", initiativeRoutes(deps));
  app.route("/api/donate", donateRoutes(deps));
  app.route("/api/uploads", uploadRoutes(deps));
  app.route("/api/watchlist", watchlistRoutes(deps));
  app.route("/api", profileRoutes(deps));
  app.route("/api", commentRoutes(deps));
  app.route("/api", aiRoutes(deps));
  app.route("/api", supportRoutes(deps));
  app.route("/api/admin/audit", auditRoutes(deps));
  app.route("/api/admin", adminRoutes(deps));
  app.route("/initiative", markdownRoutes(deps, feedCache));

  if (site) {
    for (const path of apiPaths) app.all(path, (c) => c.notFound());
    app.all("*", (c) => site.serve(c.req.raw));
  }

  return app;
}
