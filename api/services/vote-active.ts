import type { VoteManifest } from "../../shared/vote/manifest.ts";
import type { Deps } from "../middleware/context.ts";
import type { VoteRound } from "./vote-chain.ts";

/** db.meta key of the admins' round setting. */
export const VOTE_ROUND_KEY = "vote_round";

type SetRound = { manifest: VoteManifest; at: number; by: string };

/** What admins set on the Vote page: the round the site runs, read from its contract (a
 * test round on Sepolia, the real vote on Ethereum), and the pool's ETH while it waits to
 * be sold. No round set: no vote. */
export type VoteRoundSetting = {
  /** Read from the chain when set (or read again). */
  round?: SetRound;
  /** The same, as it was stored before real rounds were set this way too (test only). */
  test?: SetRound;
  /** The pool is this much ETH; the on-chain poolUsd is an estimate until `sold`. */
  pool?: { eth: number; sold: boolean };
};

/** The round a setting names: `round`, or one stored under its earlier name. */
export const roundOf = (s: VoteRoundSetting | null | undefined): SetRound | undefined =>
  s?.round ?? s?.test;

/** How long an isolate trusts its copy of the setting (admins on another isolate). */
const FRESH_MS = 5_000;

/**
 * The round the site runs now, as admins set it (none: no vote), with their pool note.
 * One VoteRound is built per manifest and kept, so its caches outlive requests; the
 * setting is re-read at most every few seconds.
 */
export function createActiveVote(o: {
  read: () => Promise<VoteRoundSetting | null>;
  build: (m: VoteManifest) => VoteRound;
  clock?: () => number;
}) {
  const clock = o.clock ?? Date.now;
  let setting: { at: number; value: Promise<VoteRoundSetting | null> } | null = null;
  const built = new Map<string, VoteRound>();
  const roundFor = (m: VoteManifest) => {
    const key = JSON.stringify(m);
    let r = built.get(key);
    if (!r) {
      r = o.build(m);
      built.set(key, r);
    }
    return r;
  };
  const active = async (): Promise<VoteRound | undefined> => {
    if (!setting || clock() - setting.at >= FRESH_MS) {
      const value = o.read().catch(() => null);
      setting = { at: clock(), value };
    }
    const s = await setting.value;
    const m = roundOf(s)?.manifest;
    if (!m) return undefined;
    const r = roundFor(m);
    return s?.pool ? { ...r, manifest: { ...r.manifest, pool: s.pool } } : r;
  };
  /** After an admin's change: this isolate reads it at once. */
  active.forget = () => {
    setting = null;
  };
  return active;
}

/** The vote round now, or undefined when none is deployed. */
export const currentVote = async (deps: Pick<Deps, "vote" | "voteRound">) =>
  deps.voteRound ? await deps.voteRound() : deps.vote;
