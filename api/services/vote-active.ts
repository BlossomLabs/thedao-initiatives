import type { VoteManifest } from "../../shared/vote/manifest.ts";
import type { Deps } from "../middleware/context.ts";
import type { VoteRound } from "./vote-chain.ts";

/** db.meta key of the admins' round setting. */
export const VOTE_ROUND_KEY = "vote_round";

/** What admins set on the Vote page: a Sepolia test round in place of the built-in one,
 * and the pool's ETH while it waits to be sold. */
export type VoteRoundSetting = {
  /** Read from the chain when added (or refreshed): replaces the built-in round. */
  test?: { manifest: VoteManifest; at: number; by: string };
  /** The pool is this much ETH; the on-chain poolUsd is an estimate until `sold`. */
  pool?: { eth: number; sold: boolean };
};

/** How long an isolate trusts its copy of the setting (admins on another isolate). */
const FRESH_MS = 5_000;

/**
 * The round the site runs now: the admins' test round if one is set, else the built-in
 * manifest; with the admins' pool note. One VoteRound is built per manifest and kept, so
 * its caches outlive requests; the setting is re-read at most every few seconds.
 */
export function createActiveVote(o: {
  baked: VoteManifest | undefined;
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
    const m = s?.test?.manifest ?? o.baked;
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
