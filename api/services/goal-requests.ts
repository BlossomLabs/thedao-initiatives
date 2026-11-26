/** A ballot initiative's goal change waiting for a round admin to set it on the round
 * (#149), like a pledge awaiting signature. One per initiative: a new one replaces it.
 * The site leads: the page takes the goal only once the round has it (`settleIfOnChain`),
 * however it got there. */
import type { Db } from "../db/mod.ts";
import type { Initiative } from "../db/types.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { HttpError } from "../lib/errors.ts";
import { ballotSlot, productionManifest } from "./ballot-lock.ts";

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

/** The round's goal for a slot, in the site's dollars (cents kept). */
export const roundGoalUsd = (m: VoteManifest, slot: number) =>
  Number(BigInt(m.projects[slot].goalUsd) / 10_000n) / 100;

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

/** For a page read: the production round, the row's slot on it (-1 off the ballot), and
 * its waiting request, read in one round trip. */
export async function ballotFor(db: Db, row: Initiative) {
  const [manifest, r] = await Promise.all([
    productionManifest(db),
    db.kv.get<GoalRequest>(key(row.id)),
  ]);
  const slot = ballotSlot(manifest, row);
  return {
    manifest,
    slot,
    goalRequest: slot >= 0 && sameRound(r.value, manifest) ? r.value : null,
  };
}

/** What a page shows of a request; `by` (an admin's wallet) for the team and the proposer. */
export const goalRequestJson = (r: GoalRequest | null, withBy = true) =>
  r ? { goalUsd: r.goalUsd, ...(withBy ? { by: r.by } : {}), at: r.at } : undefined;

/** Remove `r` only if it is still the waiting request, so one asked for meanwhile stays.
 * False when another took its place. */
export async function settleGoalRequest(db: Db, r: GoalRequest): Promise<boolean> {
  const cur = await db.kv.get<GoalRequest>(key(r.rfpId));
  const v = cur.value;
  if (!v || v.at !== r.at || v.goalUsd !== r.goalUsd || v.contract !== r.contract) return false;
  return (await db.kv.atomic().check(cur).delete(key(r.rfpId)).commit()).ok;
}

/** The round has the requested goal: the page takes it and the request goes. Returns the
 * row as it is after; unchanged when the round doesn't have it yet. */
export async function settleIfOnChain(
  db: Db,
  m: VoteManifest | undefined,
  row: Initiative,
  r: GoalRequest | null,
): Promise<{ row: Initiative; request: GoalRequest | null }> {
  const slot = ballotSlot(m, row);
  if (!m || !r || slot < 0 || roundGoalUsd(m, slot) !== r.goalUsd) return { row, request: r };
  const next = row.goalUsd === r.goalUsd
    ? row
    : await db.initiatives.update(row.id, { goalUsd: r.goalUsd });
  await settleGoalRequest(db, r);
  return { row: next, request: null };
}

/** `settleIfOnChain` from a page read: best-effort, never during maintenance, and a
 * failure (a write conflict, a dataset swap) leaves the row and the request as they were
 * instead of failing the read. */
export async function settleOnRead(
  db: Db,
  maintenanceOn: () => Promise<boolean>,
  m: VoteManifest | undefined,
  row: Initiative,
  r: GoalRequest | null,
): Promise<{ row: Initiative; request: GoalRequest | null }> {
  if (!r) return { row, request: r };
  try {
    if (await maintenanceOn()) return { row, request: r };
    return await settleIfOnChain(db, m, row, r);
  } catch (e) {
    console.error("goal request settle failed", row.id, e);
    return { row, request: r };
  }
}

export async function dropGoalRequest(db: Db, rfpId: string): Promise<void> {
  await db.kv.delete(key(rfpId));
}
