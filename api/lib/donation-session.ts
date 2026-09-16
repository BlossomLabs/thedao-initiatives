import type { Ctx, Deps } from "../middleware/context.ts";
import { HttpError } from "./errors.ts";
import { isSecureRequest, readCookie } from "./session-cookie.ts";
import { selfOrigin } from "./origin.ts";
import { CHECKBOX_SESSION_SECS } from "../db/terms.ts";

/** Mandatory browser Origin + JSON blocks CSRF, including missing/null Origins. */
export function requireDonationOrigin(c: Ctx, deps: Deps) {
  const origin = c.req.header("origin");
  if (
    !origin ||
    (!deps.config.webOrigins.includes(origin) && origin !== selfOrigin(c.req.raw, deps.config))
  ) {
    throw new HttpError(403, "Donation acceptance requires an allowed site origin.");
  }
  if (c.req.header("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "JSON required");
  }
}

export async function donationSession(c: Ctx, deps: Deps, create = false) {
  const secure = isSecureRequest(c.req.raw);
  const name = secure ? "__Host-donation" : "donation";
  const token = readCookie(c.req.header("cookie") ?? null, name);
  const existing = await deps.db.terms.session(token);
  if (existing) return existing;
  if (!create) throw new HttpError(403, "Donation session expired. Start a new attempt.");
  const session = await deps.db.terms.createSession();
  c.header(
    "Set-Cookie",
    `${name}=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CHECKBOX_SESSION_SECS}${
      secure ? "; Secure" : ""
    }`,
    { append: true },
  );
  return session.hash;
}
