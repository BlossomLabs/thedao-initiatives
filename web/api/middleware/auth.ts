import type { MiddlewareHandler } from "hono";
import type { Vars } from "./context.ts";
import type { Db } from "../db/mod.ts";
import { HttpError } from "../lib/errors.ts";

/** Reads `Authorization: Bearer <token>` into c.var.user (null when absent/invalid). */
export function sessionLoader(db: Db): MiddlewareHandler<Vars> {
  return async (c, next) => {
    const h = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim() ?? "";
    c.set("token", token);
    c.set("user", token ? await db.sessions.get(token) : null);
    await next();
  };
}

export const requireAuth: MiddlewareHandler<Vars> = async (c, next) => {
  if (!c.var.user) throw new HttpError(401, "sign in with your wallet first");
  await next();
};

export const requireAdmin: MiddlewareHandler<Vars> = async (c, next) => {
  if (!c.var.user) throw new HttpError(401, "sign in with your wallet first");
  if (!c.var.user.isAdmin) throw new HttpError(403, "admin only");
  await next();
};
