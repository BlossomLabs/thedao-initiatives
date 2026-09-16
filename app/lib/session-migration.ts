/**
 * One-time migration of a session stored before the HttpOnly cookie existed.
 *
 * Until 2026-09-15 the browser kept the bearer token in localStorage. A
 * record that still carries `token` is sent once to `POST /api/auth/cookie`,
 * which answers with the same session as a cookie; the record is then saved
 * without the token. The API also upgrades older server-side session metadata
 * without changing its original authentication time or absolute expiry.
 * A token the API no longer knows (expired, revoked)
 * clears the record, exactly as a stale session would. Delete this module,
 * its call in context/session.tsx and the endpoint once every pre-cookie
 * session has expired (a week after that deploy).
 */
import { API_URL } from "~/lib/api";
import type { SessionInfo } from "~/lib/api-types";

export const SESSION_KEY = "thedao:session";

/** The legacy bearer in the stored record, or "" when there is none. */
export function legacyToken(raw: string | null): string {
  try {
    const s = JSON.parse(raw || "null") as { token?: unknown } | null;
    return s && typeof s.token === "string" ? s.token : "";
  } catch {
    return "";
  }
}

export type MigrationResult =
  | { kind: "none" }
  | { kind: "migrated"; session: SessionInfo }
  | { kind: "cleared" }
  | { kind: "retry" };

/**
 * Exchanges a stored bearer for the cookie. "none": nothing to migrate;
 * "migrated": the cookie is set and the token-less record saved; "cleared":
 * the API refused the token and the record is gone; "retry": a network or
 * server error, the record is left as it was for the next load.
 */
export async function migrateLegacySession(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  f: typeof fetch = fetch,
): Promise<MigrationResult> {
  const token = legacyToken(storage.getItem(SESSION_KEY));
  if (!token) return { kind: "none" };
  let res: Response;
  try {
    res = await f(API_URL + "/api/auth/cookie", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      credentials: "include",
    });
  } catch {
    return { kind: "retry" };
  }
  if (res.status === 401) {
    storage.removeItem(SESSION_KEY);
    return { kind: "cleared" };
  }
  if (!res.ok) return { kind: "retry" };
  const s = await res.json() as SessionInfo;
  const session: SessionInfo = {
    address: s.address,
    isAdmin: Boolean(s.isAdmin),
    expiresAt: s.expiresAt,
  };
  storage.setItem(SESSION_KEY, JSON.stringify(session));
  return { kind: "migrated", session };
}
