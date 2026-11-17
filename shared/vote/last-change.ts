/** What caused the last change to TheDAO's ballot (#118): the newest chain input (a
 * ballot, a donation, the pool, a withdrawal, a settlement) after which the ballot (the
 * settled tiers and the live tally: each initiative's tier and award) differs from just
 * before it. Found by replaying the round just before each input, newest first, until one
 * differs from the ballot after it. Pure: the server and the replay script share it. */
import type { Tier } from "./ballot.ts";
import { replay, type RoundState } from "./quiet-ending.ts";

export type ChangeCause =
  /** A badge's ballot: its first (a new voter, which also shrinks every other badge's
   * share of the pool until S-Tier settles) or a revision. */
  | { kind: "ballot"; tokenId: string; first: boolean }
  /** A badge's ballot taken back (its badge burned or revoked). */
  | { kind: "revoked"; tokenId: string }
  /** A project's ask on-chain: lower after a donation or pledge, up from $0 when added. */
  | { kind: "ask"; project: number; from: bigint; to: bigint }
  | { kind: "pool"; from: bigint; to: bigint }
  | { kind: "withdrawn"; project: number; withdrawn: boolean }
  | { kind: "settled"; tier: Tier };

export type LastChange = {
  /** When it happened (unix seconds): the block time of the ballot or chain state, or the
   * cutoff a tier settled at. */
  at: number;
  causes: ChangeCause[];
  /** Initiatives whose tier changed (null: in no tier). */
  moved: { project: number; from: Tier | null; to: Tier | null }[];
  /** Initiatives in the same tier with another award. */
  amounts: number[];
};

type Input = Parameters<typeof replay>[0];

/** How far back to look: each step is a replay (milliseconds each). */
export const LAST_CHANGE_STEPS = 24;

/** TheDAO's ballot as one picture: each initiative's tier and award. */
function ballotOf(st: RoundState): Map<number, { tier: Tier; award: bigint }> {
  const out = new Map<number, { tier: Tier; award: bigint }>();
  for (const t of st.tiers) {
    if (t.status !== "settled") continue;
    for (const c of t.funded) out.set(c, { tier: t.tier, award: t.awards.get(c) ?? 0n });
  }
  for (const [c, tier] of st.live.tiers) out.set(c, { tier, award: st.live.awards.get(c) ?? 0n });
  return out;
}

function diff(before: RoundState, after: RoundState) {
  const a = ballotOf(before);
  const b = ballotOf(after);
  const moved: LastChange["moved"] = [];
  const amounts: number[] = [];
  for (const c of [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y)) {
    const x = a.get(c);
    const y = b.get(c);
    if (x?.tier !== y?.tier) moved.push({ project: c, from: x?.tier ?? null, to: y?.tier ?? null });
    else if (x && y && x.award !== y.award) amounts.push(c);
  }
  return { moved, amounts };
}

/** The causes that take effect at `at`: what a replay at `at` sees and one at `at - 1`
 * doesn't (a receipt or a chain state stamped `at - 1`, a tier settled at `at`). */
function causesAt(input: Input, st: RoundState, at: number, firstSeen: Map<string, number>) {
  const causes: ChangeCause[] = [];
  for (const r of input.receipts) {
    if (r.timestamp !== at - 1) continue;
    if (r.ballot === null) causes.push({ kind: "revoked", tokenId: r.tokenId });
    else {
      causes.push({
        kind: "ballot",
        tokenId: r.tokenId,
        first: firstSeen.get(r.tokenId) === r.timestamp,
      });
    }
  }
  const { states } = input;
  for (let i = 1; i < states.length; i++) {
    const [p, x] = [states[i - 1], states[i]];
    if (!x.event || x.timestamp !== at - 1) continue;
    if (p.poolUsd !== x.poolUsd) causes.push({ kind: "pool", from: p.poolUsd, to: x.poolUsd });
    for (let c = 0; c < Math.max(p.asks.length, x.asks.length); c++) {
      const [from, to] = [p.asks[c] ?? 0n, x.asks[c] ?? 0n];
      if (from !== to) causes.push({ kind: "ask", project: c, from, to });
    }
    for (let c = 0; c < Math.max(p.withdrawn.length, x.withdrawn.length); c++) {
      const [was, is] = [p.withdrawn[c] === true, x.withdrawn[c] === true];
      if (was !== is) causes.push({ kind: "withdrawn", project: c, withdrawn: is });
    }
  }
  for (const t of st.tiers) {
    if (t.status === "settled" && t.at === at) causes.push({ kind: "settled", tier: t.tier });
  }
  return causes;
}

/** A caller's memo of its last answer: the answer stands while no input was added and no
 * tier settled (the walk back reads nothing else). */
export type LastChangeMemo = { key?: string; value?: LastChange | null };

/** The last change to TheDAO's ballot at `now` (`st` is the replay at `now`), or null
 * when none is found within LAST_CHANGE_STEPS inputs back. */
export function lastChange(
  input: Input,
  now: number,
  st: RoundState,
  steps = LAST_CHANGE_STEPS,
  memo?: LastChangeMemo,
): LastChange | null {
  const seen = (t: number) => t < now;
  const receipts = input.receipts.filter((r) => seen(r.timestamp));
  const events = input.states.filter((x) => x.event && seen(x.timestamp));
  const key = JSON.stringify([
    input.schedule,
    input.m,
    receipts.length,
    receipts.at(-1) && [receipts.at(-1)!.tokenId, receipts.at(-1)!.block, receipts.at(-1)!.nonce],
    events.length,
    events.at(-1)?.block,
    st.tiers.map((t) => t.status === "settled" ? t.at : null),
  ]);
  if (memo && memo.key === key && memo.value !== undefined) return memo.value;
  const value = walkBack(input, now, st, steps);
  if (memo) Object.assign(memo, { key, value });
  return value;
}

function walkBack(input: Input, now: number, st: RoundState, steps: number): LastChange | null {
  // Each input's first moment: a receipt or state stamped t shows from t + 1 (the replay
  // counts what is strictly before `now`), a settlement from its cutoff.
  // Moment → when it happened (the earliest of what takes effect then).
  const moments = new Map<number, number>();
  const add = (moment: number, time: number) => {
    if (moment <= now) moments.set(moment, Math.min(time, moments.get(moment) ?? time));
  };
  for (const r of input.receipts) add(r.timestamp + 1, r.timestamp);
  for (const x of input.states) if (x.event) add(x.timestamp + 1, x.timestamp);
  for (const t of st.tiers) if (t.status === "settled") add(t.at, t.at);
  const firstSeen = new Map<string, number>();
  for (const r of input.receipts) {
    if (r.ballot !== null && !firstSeen.has(r.tokenId)) firstSeen.set(r.tokenId, r.timestamp);
  }
  let after = st;
  for (const at of [...moments.keys()].sort((a, b) => b - a).slice(0, steps)) {
    let before: RoundState;
    try {
      before = replay(input, at - 1);
    } catch {
      return null; // No chain state that early: nothing before it to compare with.
    }
    const { moved, amounts } = diff(before, after);
    if (moved.length || amounts.length) {
      return {
        at: moments.get(at)!,
        causes: causesAt(input, after, at, firstSeen),
        moved,
        amounts,
      };
    }
    after = before;
  }
  return null;
}
