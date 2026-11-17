import { transientVoteKey } from "../db/dataset.ts";
import { type VoteEnvironment, voteEnvironment } from "../../shared/vote/environment.ts";
import { roundKey } from "../../shared/vote/keys.ts";
import type { Db } from "../db/mod.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import type { Deps } from "../middleware/context.ts";
import type { VoteRound } from "./vote-chain.ts";

/** db.meta key of the admins' round setting. */
export const VOTE_ROUND_KEY = "vote_round";
export const voteSettingKey = (env: VoteEnvironment) => `vote_round_${env}`;

/** Copy legacy state once per environment. The original remains available for rollback. */
export async function migrateVoteSettings(db: Db) {
  const legacy = await db.meta.get<VoteRoundSetting>(VOTE_ROUND_KEY);
  const set = roundOf(legacy);
  if (!set) return;
  const env = voteEnvironment(set.manifest);
  const key = voteSettingKey(env);
  await db.meta.update<VoteRoundSetting>(key, (cur) => cur ?? { ...legacy, round: set });
  const marker = `${key}_records_migrated`;
  if (await db.meta.get(marker)) return;
  const old = ["vote", set.manifest.chainId, set.manifest.contract.toLowerCase()];
  for await (const entry of db.kv.list({ prefix: old })) {
    if (transientVoteKey(entry.key)) continue;
    const target = [...roundKey(set.manifest), ...entry.key.slice(old.length)];
    const current = await db.kv.get(target);
    if (current.versionstamp === null) {
      await db.kv.atomic().check(current).set(target, entry.value).commit();
    }
  }
  await db.meta.set(marker, true);
}

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
  environment?: VoteEnvironment;
  read: () => Promise<VoteRoundSetting | null>;
  build: (m: VoteManifest) => VoteRound;
  refresh?: (m: VoteManifest) => Promise<VoteManifest>;
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
      if (built.size >= 4) built.delete(built.keys().next().value!);
      built.set(key, r);
    }
    return r;
  };
  const active = async (): Promise<VoteRound | undefined> => {
    if (!setting || clock() - setting.at >= FRESH_MS) {
      const value = o.read().then(async (s) => {
        const set = roundOf(s);
        if (!s || !set || !o.refresh) return s;
        const manifest = await o.refresh(set.manifest);
        return { ...s, round: { ...set, manifest } };
      });
      setting = { at: clock(), value };
    }
    const s = await setting.value;
    const m = roundOf(s)?.manifest;
    if (!m) return undefined;
    if (o.environment && voteEnvironment(m) !== o.environment) {
      throw new Error("Vote environment mismatch");
    }
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
export const currentVote = async (deps: Pick<Deps, "vote" | "voteRound" | "voteEnvironment">) => {
  const round = deps.voteRound ? await deps.voteRound() : deps.vote;
  if (round && deps.voteEnvironment && voteEnvironment(round.manifest) !== deps.voteEnvironment) {
    return undefined;
  }
  return round;
};
