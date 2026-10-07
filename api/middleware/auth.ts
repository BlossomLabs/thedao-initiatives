import type { Context, MiddlewareHandler } from "hono";
import type { Vars } from "./context.ts";
import type { Db } from "../db/mod.ts";
import type { Admins } from "../services/admins.ts";
import { HttpError } from "../lib/errors.ts";
import { readSessionCookie } from "../lib/session-cookie.ts";
import { hasRecentAuth } from "../lib/private-fields.ts";

/** Reads the session token into c.var.user (null when absent/invalid): from
 * `Authorization: Bearer <token>` (scripts), else from the HttpOnly session
 * cookie (the browser, see lib/session-cookie.ts). c.var.token keeps whichever
 * was used so logout can revoke it. Admin access requires both privilege at
 * authentication and current membership: promotion always needs a new signature. */
export function sessionLoader(
  db: Db,
  admins?: Admins,
): MiddlewareHandler<Vars> {
  return async (c, next) => {
    // Behind the preview lock the browser may resend its cached Basic
    // credentials with every fetch, so anything but a bearer defers to the cookie.
    const h = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim() ||
      readSessionCookie(c.req.raw);
    c.set("token", token);
    // Funding polls carry the cookie for authorization, but an unattended tab
    // must not indefinitely refresh its inactivity deadline.
    const user = token
      ? await db.sessions.get(token, c.req.header("X-Session-Activity") !== "passive")
      : null;
    c.set(
      "user",
      user && admins
        ? { ...user, isAdmin: user.isAdmin && await admins.isAdmin(user.address) }
        : user,
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

export function assertRecentAuth(c: Context<Vars>, now: () => number) {
  if (!c.var.user) throw new HttpError(401, "sign in with your wallet first");
  if (!hasRecentAuth(c.var.user, now())) {
    throw new HttpError(403, "Sign in again to confirm this sensitive change.", {
      reauthenticate: true,
    });
  }
}

/** Check before any side effects; callers may reauthenticate and retry once. */
export function requireRecentAuth(now: () => number): MiddlewareHandler<Vars> {
  return async (c, next) => {
    assertRecentAuth(c, now);
    await next();
  };
}
