import type { MiddlewareHandler } from "hono";
import type { Vars } from "./context.ts";
import type { Db } from "../db/mod.ts";
import type { Admins } from "../services/admins.ts";
import { HttpError } from "../lib/errors.ts";

/** Reads `Authorization: Bearer <token>` into c.var.user (null when absent/invalid).
 * The admin flag follows the current admin list (ADMIN_ADDRESSES plus the
 * dashboard's additions), not the one at sign-in, so a wallet added to (or
 * removed from) the list needs no new session. */
export function sessionLoader(db: Db, admins?: Admins): MiddlewareHandler<Vars> {
  return async (c, next) => {
    const h = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim() ?? "";
    c.set("token", token);
    const user = token ? await db.sessions.get(token) : null;
    c.set(
      "user",
      user && admins ? { ...user, isAdmin: await admins.isAdmin(user.address) } : user,
    );
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
