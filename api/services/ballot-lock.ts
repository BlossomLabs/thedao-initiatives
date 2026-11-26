/** On the ballot, the round leads (#149): the facts its contract stores (goal, RFP or
 * grant, affiliations) change only on the round, and the site follows it
 * (`ballot-follow.ts`). Every write path asks here first. */
import type { Db } from "../db/mod.ts";
import { HttpError } from "../lib/errors.ts";
import { onBallotSlugs, type VoteManifest } from "../../shared/vote/manifest.ts";
import { roundOf, type VoteRoundSetting, voteSettingKey } from "./vote-active.ts";

import { ON_BALLOT } from "../../shared/vote/ballot-facts.ts";

export { ON_BALLOT };

/** The production round as admins last stored it (KV only, no chain read). */
export const productionManifest = async (db: Db): Promise<VoteManifest | undefined> =>
  roundOf(await db.meta.get<VoteRoundSetting>(voteSettingKey("production")))?.manifest;

/** The slugs on the production ballot; none without a production round. */
export const ballotSlugs = async (db: Db): Promise<Set<string>> =>
  onBallotSlugs(await productionManifest(db));

/** 409 when `changed` touches a round fact of an initiative on the ballot. */
export function assertOffBallot(ballot: Set<string>, slug: string, changed: boolean): void {
  if (changed && ballot.has(slug)) throw new HttpError(409, ON_BALLOT);
}
