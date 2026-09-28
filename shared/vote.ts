/**
 * Vote eligibility (flagged, numbers not final): an initiative whose raised
 * total (pledges plus donations) reaches the floor share of its goal can go to
 * the vote; one whose remaining gap is still above the cap is eligible but
 * flagged. Settings live in the database so the team changes them without a deploy.
 */
export interface VoteSettings {
  show: boolean;
  floorPct: number;
  capUsd: number;
}

/** Locked on the 23 Sep Curator call: 25% floor, $200,000 cap. Off until the copy is final. */
export const DEFAULT_VOTE: VoteSettings = { show: false, floorPct: 25, capUsd: 200_000 };

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
  return [{ show: r.show, floorPct, capUsd: Math.round(capUsd) }, null];
}

export type VoteState =
  | { kind: "eligible" }
  | { kind: "gap"; gapUsd: number; capUsd: number }
  | { kind: "below"; toFloorUsd: number };

export function voteState(raisedUsd: number, goalUsd: number, s: VoteSettings): VoteState {
  const floor = (goalUsd * s.floorPct) / 100;
  if (raisedUsd < floor) return { kind: "below", toFloorUsd: Math.ceil(floor - raisedUsd) };
  const gap = Math.max(0, goalUsd - raisedUsd);
  return gap > s.capUsd ? { kind: "gap", gapUsd: gap, capUsd: s.capUsd } : { kind: "eligible" };
}
