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

export function voteBriefsRepo(kv: Deno.Kv, read: ReadOptions = undefined) {
  /** Set once the old record is known to be gone, so later calls skip the look. */
  let legacyGone = false;

  /** Copy the old shared record to one key per initiative, then delete it. A brief already
   * under its own key is newer and stays. One atomic write; if anything moved meanwhile it
   * fails and the next call tries again. */
  async function moveLegacy(): Promise<void> {
    if (legacyGone) return;
    const old = await kv.get<StoredBriefs>(K.meta(LEGACY_BRIEFS_META));
    if (!old.value) {
      legacyGone = true;
      return;
    }
    const ids = Object.keys(old.value);
    const have = new Set<string>();
    for await (const e of kv.list<StoredBrief>({ prefix: K.voteBriefs })) {
      have.add(String(e.key[1]));
    }
    const op = kv.atomic().check(old);
    for (const id of ids) {
      if (have.has(id)) continue;
      op.check({ key: K.voteBrief(id), versionstamp: null }).set(K.voteBrief(id), old.value[id]);
    }
    if ((await op.delete(old.key).commit()).ok) legacyGone = true;
  }

  return {
    /** Every stored brief, by initiative id. */
    async all(): Promise<StoredBriefs> {
      await moveLegacy();
      const out: StoredBriefs = {};
      for await (const e of kv.list<StoredBrief>({ prefix: K.voteBriefs }, read)) {
        out[String(e.key[1])] = e.value;
      }
      return out;
    },
    async get(id: string): Promise<StoredBrief | null> {
      await moveLegacy();
      return (await kv.get<StoredBrief>(K.voteBrief(id))).value;
    },
    async set(id: string, brief: StoredBrief): Promise<void> {
      await moveLegacy();
      await kv.set(K.voteBrief(id), brief);
    },
  };
}
