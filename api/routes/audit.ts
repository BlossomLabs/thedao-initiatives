import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAdmin, requireRecentAuth } from "../middleware/auth.ts";
import { jsonBody } from "../lib/body.ts";

export function auditRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  r.use("*", requireAdmin, requireRecentAuth(deps.now));
  // A harmless, fixed event for testing downstream collection/alert routing.
  r.post("/test", async (c) => {
    await jsonBody(c, []);
    return c.json({ ok: true });
  });
  return r;
}
