/** On the ballot (#149): the production round holds the initiative's Safe. Its type and
 * affiliations change only with the round, and a goal change waits for a round admin
 * (`goal-requests.ts`). Matched by Safe, never by slug: a slug can be reclaimed, the Safe
 * is unique and never changes. */
import type { Db } from "../db/mod.ts";
import { HttpError } from "../lib/errors.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { ON_BALLOT } from "../../shared/vote/ballot-facts.ts";
import { roundOf, type VoteRoundSetting, voteSettingKey } from "./vote-active.ts";

export { ON_BALLOT };

/** The production round as admins last stored it (KV only, no chain read). */
export const productionManifest = async (db: Db): Promise<VoteManifest | undefined> =>
  roundOf(await db.meta.get<VoteRoundSetting>(voteSettingKey("production")))?.manifest;

/** The row's slot on the production ballot, or -1 when it isn't on it. */
export function ballotSlot(
  m: VoteManifest | undefined,
  row: { safeAddress: string },
): number {
  if (!m || m.kind !== "real" || !row.safeAddress) return -1;
  const safe = row.safeAddress.toLowerCase();
  return (m.accounts ?? []).findIndex((a) => a.toLowerCase() === safe);
}

/** 409 when `changed` touches a round fact of an initiative on the ballot. */
export function assertOffBallot(onBallot: boolean, changed: boolean): void {
  if (changed && onBallot) throw new HttpError(409, ON_BALLOT);
}
