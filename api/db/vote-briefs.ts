/** The vote briefs (#96), one key per initiative: a write touches only its own small value,
 * so parallel rewrites never conflict, and the board reads them all with one prefix list.
 * They used to share one value under meta, which outgrew Deno KV's 64 KiB value cap at
 * about a hundred briefs; the first read or write moves that record over and deletes it. */
import { K, type ReadOptions } from "./keys.ts";
import type { WhatBullet } from "../../shared/vote/brief.ts";

/** The old shared record, `meta/vote_briefs`: every brief by initiative id. */
export const LEGACY_BRIEFS_META = "vote_briefs";

export interface StoredBrief {
  /** sha-256 of the model's input and BRIEF_FORMAT: the bullets stand for exactly this
   * text, written this way. */
  hash: string;
  what: WhatBullet[];
  adoption: string[];
  at: number;
}
export type StoredBriefs = Record<string, StoredBrief>;

/** Briefs moved per atomic write: each carries a check, and Deno KV allows 100 checks per
 * write (ours adds the old record's and the dataset head's). */
const MOVE_BATCH = 40;

export function voteBriefsRepo(kv: Deno.Kv, read: ReadOptions = undefined) {
  /** Set once the old record is known to be gone, so later calls skip the look. */
  let legacyGone = false;

  /** Copy the old shared record to one key per initiative, in batches, then delete it. A
   * brief already under its own key is newer and stays. Never throws: until the move
   * finishes, the old record is returned so callers can still read from it. */
  async function moveLegacy(): Promise<StoredBriefs | null> {
    if (legacyGone) return null;
    const old = await kv.get<StoredBriefs>(K.meta(LEGACY_BRIEFS_META));
    if (!old.value) {
      legacyGone = true;
      return null;
    }
    try {
      const have = new Set<string>();
      for await (const e of kv.list<StoredBrief>({ prefix: K.voteBriefs })) {
        have.add(String(e.key[1]));
      }
      const todo = Object.keys(old.value).filter((id) => !have.has(id));
      for (let i = 0; i < todo.length; i += MOVE_BATCH) {
        const op = kv.atomic().check(old);
        for (const id of todo.slice(i, i + MOVE_BATCH)) {
          op.check({ key: K.voteBrief(id), versionstamp: null })
            .set(K.voteBrief(id), old.value[id]);
        }
        // Someone wrote a brief meanwhile: the next call carries on from what is there.
        if (!(await op.commit()).ok) return old.value;
      }
      if ((await kv.atomic().check(old).delete(old.key).commit()).ok) {
        legacyGone = true;
        return null;
      }
    } catch (e) {
      console.error(`vote briefs: moving the old record failed: ${String(e).slice(0, 160)}`);
    }
    return old.value;
  }

  return {
    /** Every stored brief, by initiative id. */
    async all(): Promise<StoredBriefs> {
      const legacy = await moveLegacy();
      const out: StoredBriefs = { ...legacy };
      for await (const e of kv.list<StoredBrief>({ prefix: K.voteBriefs }, read)) {
        out[String(e.key[1])] = e.value;
      }
      return out;
    },
    async get(id: string): Promise<StoredBrief | null> {
      const legacy = await moveLegacy();
      return (await kv.get<StoredBrief>(K.voteBrief(id))).value ?? legacy?.[id] ?? null;
    },
    async set(id: string, brief: StoredBrief): Promise<void> {
      await moveLegacy();
      await kv.set(K.voteBrief(id), brief);
    },
  };
}
