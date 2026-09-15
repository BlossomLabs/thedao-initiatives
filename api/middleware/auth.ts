import type { MiddlewareHandler } from "hono";
import type { Vars } from "./context.ts";
import type { Db } from "../db/mod.ts";
import type { Admins } from "../services/admins.ts";
import { HttpError } from "../lib/errors.ts";
import { type CookieConfig, readSessionCookie } from "../lib/session-cookie.ts";

/** Reads the session token into c.var.user (null when absent/invalid): from
 * `Authorization: Bearer <token>` (scripts), else from the HttpOnly session
 * cookie (the browser, see lib/session-cookie.ts). c.var.token keeps whichever
 * was used so logout can revoke it. The admin flag follows the current admin
 * list (ADMIN_ADDRESSES plus the dashboard's additions), not the one at
 * sign-in, so a wallet added to (or removed from) the list needs no new session. */
export function sessionLoader(
  db: Db,
  admins?: Admins,
  config: CookieConfig = { trustProxy: false },
): MiddlewareHandler<Vars> {
  return async (c, next) => {
    // Behind the preview lock the browser may resend its cached Basic
    // credentials with every fetch, so anything but a bearer defers to the cookie.
    const h = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim() ||
      readSessionCookie(c.req.raw, config);
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
