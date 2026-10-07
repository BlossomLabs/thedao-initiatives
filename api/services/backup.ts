/**
 * Whole-database backup as one JSON file: every KV entry under the prefixes
 * that hold the site's records, keys and values verbatim, so a restore puts
 * back exactly what was there. Sessions, nonces, rate-limit counters and
 * other rows that expire on their own stay out; the comment claim index is
 * rebuilt from the held comments a restore writes.
 */
import type { Db } from "../db/mod.ts";
import type { Comment } from "../db/types.ts";
import { K } from "../db/keys.ts";
import { STATUS_INDEX_MARK } from "../db/initiatives.ts";
import { CLAIM_TTL_SECS } from "../db/comments.ts";
import { HttpError } from "../lib/errors.ts";
import { MAINTENANCE_META_KEY } from "./maintenance.ts";

export const BACKUP_FORMAT = "thedao-kv-backup/1";

/** The prefixes a backup carries, alphabetical. Everything else is a TTL row,
 * a session secret, a derived index rebuilt on restore, or a dead shape. */
export const BACKUP_PREFIXES = [
  "checkbox_acceptance",
  "comment",
  "comment_ref",
  "content_logo",
  "donation",
  "donation_association",
  "donation_by_tx",
  "meta",
  "nick",
  "pending_association",
  "pledge",
  "profile",
  "reused_rfp_slug",
  "revision",
  "rfp",
  "rfp_by_safe",
  "rfp_by_slug",
  "rfp_by_source_slug",
  "safe_balances",
  "safe_sync",
  "vote",
  "watchlist",
] as const;

export type BackupKey = (string | number)[];
export interface BackupEntry {
  key: BackupKey;
  value: unknown;
}
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  exportedAt: string;
  /** Entries per prefix, for a quick look at what the file holds. */
  prefixes: Record<string, number>;
  entries: BackupEntry[];
}
export type RestoreMode = "merge" | "replace";
export interface RestoreResult {
  written: number;
  skipped: number;
  claimsRebuilt: number;
}

/** Deno KV caps: 64 KiB per value; keep commits well under 1000 mutations / 800 KiB. */
const MAX_VALUE_BYTES = 64 * 1024;
const BATCH_MUTATIONS = 500;
const BATCH_BYTES = 600 * 1024;
const GET_MANY_LIMIT = 10;

const isFlagKey = (key: BackupKey) => key[0] === "meta" && key[1] === MAINTENANCE_META_KEY;
const keyId = (key: BackupKey) => JSON.stringify(key);

/** JSON carries strings, finite numbers, booleans, null, arrays and plain objects. */
function jsonSafe(v: unknown): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(jsonSafe);
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    // An `undefined` property survives KV's structured clone (a spread of an
    // optional field writes it) and JSON simply drops the key; readers treat a
    // missing optional the same way, so the round trip loses nothing.
    return (proto === Object.prototype || proto === null) &&
      Object.values(v as Record<string, unknown>).every((x) => x === undefined || jsonSafe(x));
  }
  return false;
}

export async function exportBackup(db: Db, now: () => number): Promise<BackupFile> {
  const entries: BackupEntry[] = [];
  const prefixes: Record<string, number> = {};
  for (const prefix of BACKUP_PREFIXES) {
    let n = 0;
    for await (const e of db.kv.list({ prefix: [prefix] })) {
      const key = e.key.map((part) => {
        if (typeof part === "string" || typeof part === "number") return part;
        throw new HttpError(500, `backup: unsupported key under ${prefix}`);
      });
      if (isFlagKey(key)) continue;
      if (!jsonSafe(e.value)) throw new HttpError(500, `backup: unsupported value under ${prefix}`);
      entries.push({ key, value: e.value });
      n++;
    }
    prefixes[prefix] = n;
  }
  return {
    format: BACKUP_FORMAT,
    exportedAt: new Date(now() * 1000).toISOString(),
    prefixes,
    entries,
  };
}

/** The whole file is checked before anything is written; the first problem names its entry. */
export function validateBackup(input: unknown): BackupFile {
  const file = input as Partial<BackupFile> | null;
  if (
    !file || typeof file !== "object" || file.format !== BACKUP_FORMAT ||
    !Array.isArray(file.entries)
  ) {
    throw new HttpError(400, `Not a ${BACKUP_FORMAT} file.`);
  }
  const seen = new Set<string>();
  const entries: BackupEntry[] = file.entries.map((raw, i) => {
    const e = raw as Partial<BackupEntry> | null;
    const key = e && typeof e === "object" ? e.key : undefined;
    if (!Array.isArray(key) || key.length < 2) {
      throw new HttpError(400, `entry ${i}: key parts must be strings or numbers`);
    }
    const prefix = String(key[0]);
    if (!(BACKUP_PREFIXES as readonly string[]).includes(prefix)) {
      throw new HttpError(
        400,
        `entry ${i}: key prefix ${JSON.stringify(prefix)} is not restorable`,
      );
    }
    for (const part of key) {
      if (typeof part !== "string" && !(typeof part === "number" && Number.isFinite(part))) {
        throw new HttpError(400, `entry ${i}: key parts must be strings or numbers`);
      }
    }
    if (!("value" in e!) || e!.value === undefined) {
      throw new HttpError(400, `entry ${i}: value is missing`);
    }
    if (!jsonSafe(e!.value) || JSON.stringify(e!.value).length > MAX_VALUE_BYTES) {
      throw new HttpError(400, `entry ${i}: value exceeds 64 KiB`);
    }
    const id = keyId(key as BackupKey);
    if (seen.has(id)) throw new HttpError(400, `entry ${i}: duplicate key`);
    seen.add(id);
    return { key: key as BackupKey, value: e!.value };
  });
  return {
    format: BACKUP_FORMAT,
    exportedAt: String(file.exportedAt ?? ""),
    prefixes: file.prefixes && typeof file.prefixes === "object" ? file.prefixes : {},
    entries,
  };
}

function* batches(entries: BackupEntry[]): Generator<BackupEntry[]> {
  let batch: BackupEntry[] = [];
  let bytes = 0;
  for (const e of entries) {
    const size = JSON.stringify(e.value).length;
    if (batch.length && (batch.length >= BATCH_MUTATIONS || bytes + size > BATCH_BYTES)) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(e);
    bytes += size;
  }
  if (batch.length) yield batch;
}

/**
 * Merge writes only the keys that do not exist yet; replace overwrites them.
 * Neither deletes anything, and the maintenance flag inside a file is ignored.
 */
export async function restoreBackup(
  db: Db,
  backup: BackupFile,
  mode: RestoreMode,
  now: () => number,
): Promise<RestoreResult> {
  const kv = db.kv;
  const result: RestoreResult = { written: 0, skipped: 0, claimsRebuilt: 0 };
  const held: Comment[] = [];
  const note = (items: BackupEntry[]) => {
    result.written += items.length;
    for (const e of items) {
      const c = e.value as Partial<Comment>;
      if (e.key[0] === "comment" && c?.status === "held" && c.claimToken && c.id) {
        held.push(c as Comment);
      }
    }
  };
  const commit = async (items: BackupEntry[]): Promise<boolean> => {
    const op = kv.atomic();
    for (const e of items) {
      if (mode === "merge") op.check({ key: e.key, versionstamp: null });
      op.set(e.key, e.value);
    }
    return (await op.commit()).ok;
  };

  const entries = backup.entries.filter((e) => {
    if (isFlagKey(e.key)) result.skipped++;
    return !isFlagKey(e.key);
  });
  for (const batch of batches(entries)) {
    let pending = batch;
    if (mode === "merge") {
      const existing = new Set<string>();
      for (let i = 0; i < batch.length; i += GET_MANY_LIMIT) {
        const group = batch.slice(i, i + GET_MANY_LIMIT);
        const got = await kv.getMany(group.map((e) => e.key));
        got.forEach((g, n) => {
          if (g.versionstamp !== null) existing.add(keyId(group[n].key));
        });
      }
      pending = batch.filter((e) => !existing.has(keyId(e.key)));
      result.skipped += batch.length - pending.length;
    }
    if (!pending.length) continue;
    if (await commit(pending)) {
      note(pending);
      continue;
    }
    // A key appeared between the read and the commit: settle one by one.
    for (const e of pending) {
      if (await commit([e])) note([e]);
      else result.skipped++;
    }
  }

  for (const c of held) {
    const expiresAt = c.claimExpiresAt ?? c.createdAt + CLAIM_TTL_SECS;
    const ttlMs = (expiresAt - now()) * 1000;
    if (ttlMs <= 0) continue;
    await kv.set(K.claim(c.claimToken), c.id, { expireIn: ttlMs });
    result.claimsRebuilt++;
  }
  // The rows came in without their derived copies' bookkeeping: the status
  // index is rebuilt on the next board read, and every card summary from its rows.
  await kv.delete(K.meta(STATUS_INDEX_MARK));
  await deleteAll(kv, ["card_summary"]);
  return result;
}

async function deleteAll(kv: Deno.Kv, prefix: Deno.KvKey): Promise<void> {
  let op = kv.atomic();
  let n = 0;
  for await (const e of kv.list({ prefix })) {
    op.delete(e.key);
    if (++n % 500 === 0) {
      await op.commit();
      op = kv.atomic();
    }
  }
  if (n % 500) await op.commit();
}
