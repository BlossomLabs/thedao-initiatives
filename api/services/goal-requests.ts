/** A goal change on a ballot initiative, waiting for a round admin to set it on the round
 * (#149), like a pledge awaiting signature. One per initiative: a new one replaces it. It
 * settles when the round has its goal (`followRound`), however it got there. */
import type { Db } from "../db/mod.ts";
import type { Initiative } from "../db/types.ts";
import { onBallotSlugs, type VoteManifest } from "../../shared/vote/manifest.ts";
import { productionManifest } from "./ballot-lock.ts";
import { HttpError } from "../lib/errors.ts";

export type GoalRequest = {
  rfpId: string;
  /** The round it was asked of: another round's request is not this one's. */
  contract: string;
  goalUsd: number;
  by: string;
  at: number;
};

const key = (rfpId: string) => ["goal-request", rfpId];
const sameRound = (r: GoalRequest | null, m: VoteManifest | undefined) =>
  Boolean(r && m && r.contract.toLowerCase() === m.contract.toLowerCase());

/** 409 once the vote has closed: the round takes no more changes, so nobody could sign
 * the request. Checked before any write of the edit that asks for it. */
export function assertGoalOpen(m: VoteManifest | undefined, now: number): void {
  if (m && now >= m.closesAt) {
    throw new HttpError(409, "The vote has closed: the round's goal is final.");
  }
}

/** Ask for `goalUsd`; asking for the goal the row has drops any request (null). */
export async function requestGoal(
  db: Db,
  m: VoteManifest,
  row: Initiative,
  goalUsd: number,
  by: string,
): Promise<GoalRequest | null> {
  if (goalUsd === row.goalUsd) {
    await dropGoalRequest(db, row.id);
    return null;
  }
  assertGoalOpen(m, db.now());
  const r: GoalRequest = { rfpId: row.id, contract: m.contract, goalUsd, by, at: db.now() };
  await db.kv.set(key(row.id), r);
  return r;
}

export async function goalRequestOf(
  db: Db,
  m: VoteManifest | undefined,
  rfpId: string,
): Promise<GoalRequest | null> {
  const r = (await db.kv.get<GoalRequest>(key(rfpId))).value;
  return sameRound(r, m) ? r : null;
}

/** Every request asked of round `m`. */
export async function goalRequests(db: Db, m: VoteManifest): Promise<GoalRequest[]> {
  const out: GoalRequest[] = [];
  for await (const e of db.kv.list<GoalRequest>({ prefix: ["goal-request"] })) {
    if (sameRound(e.value, m)) out.push(e.value);
  }
  return out;
}

/** For a page read: the production round, its ballot, and this initiative's request,
 * read in one round trip. */
export async function ballotFor(db: Db, rfpId: string) {
  const [manifest, r] = await Promise.all([
    productionManifest(db),
    db.kv.get<GoalRequest>(key(rfpId)),
  ]);
  return {
    manifest,
    ballot: onBallotSlugs(manifest),
    goalRequest: sameRound(r.value, manifest) ? r.value : null,
  };
}

/** What a page shows of a request. */
export const goalRequestJson = (r: GoalRequest | null) =>
  r ? { goalUsd: r.goalUsd, by: r.by, at: r.at } : undefined;

export async function dropGoalRequest(db: Db, rfpId: string): Promise<void> {
  await db.kv.delete(key(rfpId));
}
