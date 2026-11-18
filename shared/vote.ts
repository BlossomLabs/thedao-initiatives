/**
 * Vote eligibility (behind a flag, numbers not final): an initiative qualifies
 * for TheDAO's vote once its raised total (pledges plus donations) reaches the
 * floor share of its goal and what is left is no more than the cap (what TheDAO
 * would top up at most). So a large goal's floor sits further along: the goal
 * less the cap. Settings live in the database so the team changes them without
 * a deploy.
 */
export interface VoteSettings {
  show: boolean;
  floorPct: number;
  capUsd: number;
  /** The deadline to qualify (unix seconds): from then on no initiative joins the ballot,
   * and only those on it stay in the vote. null: none. */
  qualifyBy: number | null;
}

/** Locked on the 23 Sep Curator call: 25% floor, $200,000 cap. Off until the copy is final. */
export const DEFAULT_VOTE: VoteSettings = {
  show: false,
  floorPct: 25,
  capUsd: 200_000,
  qualifyBy: null,
};

export function readVoteSettings(raw: unknown): [VoteSettings, null] | [null, string] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const floorPct = Number(r.floorPct);
  const capUsd = Number(r.capUsd);
  if (typeof r.show !== "boolean") return [null, "show must be true or false."];
  if (!Number.isFinite(floorPct) || floorPct < 0 || floorPct > 100) {
    return [null, "The vote floor is a percentage from 0 to 100."];
  }
  if (!Number.isFinite(capUsd) || capUsd < 0) {
    return [null, "The cap is a USD amount of 0 or more."];
  }
  // Settings saved before the deadline existed have none.
  const qualifyBy = (r.qualifyBy ?? null) as number | null;
  // Seconds, not milliseconds: 1e11 seconds is the year 5138, so a larger one is ms by mistake.
  if (
    qualifyBy !== null && !(Number.isSafeInteger(qualifyBy) && qualifyBy > 0 && qualifyBy < 1e11)
  ) {
    return [null, "The deadline to qualify is a moment in unix seconds, or none."];
  }
  return [{ show: r.show, floorPct, capUsd: Math.round(capUsd), qualifyBy }, null];
}

/** Past the deadline to qualify (`now` in unix seconds): no initiative joins the ballot. */
export const ballotClosed = (s: VoteSettings, now: number): boolean =>
  s.qualifyBy !== null && now >= s.qualifyBy;

/** What an initiative raises to qualify: the floor share of its goal, or the goal less the cap when that is more. */
export const voteFloorUsd = (goalUsd: number, s: VoteSettings): number =>
  Math.max((goalUsd * s.floorPct) / 100, goalUsd - s.capUsd);

/** The same as a percentage of the goal: where the tick sits on the funding bar. */
export const voteFloorPct = (goalUsd: number, s: VoteSettings): number =>
  goalUsd > 0 ? (100 * voteFloorUsd(goalUsd, s)) / goalUsd : s.floorPct;

export type VoteState =
  | { kind: "eligible" }
  | { kind: "below"; toFloorUsd: number };

export function voteState(raisedUsd: number, goalUsd: number, s: VoteSettings): VoteState {
  const floor = voteFloorUsd(goalUsd, s);
  return raisedUsd < floor
    ? { kind: "below", toFloorUsd: Math.ceil(floor - raisedUsd) }
    : { kind: "eligible" };
}
