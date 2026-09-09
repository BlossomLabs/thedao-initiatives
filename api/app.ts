import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import type { Deps, Vars } from "./middleware/context.ts";
import { HttpError } from "./lib/errors.ts";
import { clientIp } from "./middleware/ip.ts";
import { sessionLoader } from "./middleware/auth.ts";
import { originGuard, securityHeaders, siteLock } from "./middleware/headers.ts";
import { authRoutes } from "./routes/auth.ts";
import { boardRoutes } from "./routes/board.ts";
import { initiativeRoutes } from "./routes/initiatives.ts";
import { donateRoutes } from "./routes/donate.ts";
import { profileRoutes } from "./routes/profile.ts";
import { commentRoutes } from "./routes/comments.ts";
import { aiRoutes } from "./routes/ai.ts";
import { adminRoutes } from "./routes/admin.ts";
import { healthRoutes } from "./routes/health.ts";

export function createApp(deps: Deps) {
  const app = new Hono<Vars>();

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, ...err.extra }, err.status as 400);
    }
    deps.log(`unhandled: ${err.stack ?? err}`);
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.use("*", securityHeaders);
  app.use(
    "*",
    cors({
      origin: deps.config.webOrigins,
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("*", siteLock(deps.config));
  app.use("*", clientIp(deps.config.trustProxy));
  app.use("*", originGuard(deps.config));
  app.use("*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
  app.use("*", sessionLoader(deps.db));

  app.route("/healthz", healthRoutes(deps));
  app.route("/api/auth", authRoutes(deps));
  app.route("/api/board", boardRoutes(deps));
  app.route("/api/initiatives", initiativeRoutes(deps));
  app.route("/api/donate", donateRoutes(deps));
  app.route("/api", profileRoutes(deps));
  app.route("/api", commentRoutes(deps));
  app.route("/api", aiRoutes(deps));
  app.route("/api/admin", adminRoutes(deps));

  return app;
}
