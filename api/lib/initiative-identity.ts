import type { Db, Initiative } from "../db/mod.ts";
import { HttpError } from "./errors.ts";

export const INITIATIVE_CHANGED =
  "This initiative URL has changed. Refresh the page before continuing.";

/** Bind a write to the proposal the client actually displayed. Old clients can
 * still write by slug until that URL has been reassigned or released. */
export async function assertInitiativeIdentity(
  db: Db,
  slug: string,
  rfp: Initiative,
  initiativeId: unknown,
): Promise<void> {
  if (
    (initiativeId !== undefined && initiativeId !== rfp.id) ||
    (initiativeId === undefined && await db.initiatives.isReusedSlug(slug))
  ) throw new HttpError(409, INITIATIVE_CHANGED);
}
