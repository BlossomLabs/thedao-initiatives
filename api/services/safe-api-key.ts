/**
 * The Safe Transaction Service key: an admin's override from the dashboard
 * (Admin → Services) wins over SAFE_API_KEY from the environment, so a key
 * that ran out or leaked can be swapped without a redeploy. Stored under its
 * own KV prefix, out of backups and the versioned dataset; the status shows
 * only its last four characters.
 */
import type { Config } from "../config.ts";
import type { Db } from "../db/mod.ts";
import { K } from "../db/keys.ts";
import { HttpError } from "../lib/errors.ts";

export const SAFE_API_KEY_SECRET = "safe_api_key";
const MAX_KEY_CHARS = 4096;

export interface SafeApiKeyOverride {
  key: string;
  by: string;
  at: number;
}

interface KeyDeps {
  db: Db;
  config: Config;
}

async function override(db: Db): Promise<SafeApiKeyOverride | null> {
  return (await db.kv.get<SafeApiKeyOverride>(K.secret(SAFE_API_KEY_SECRET))).value;
}

/** The key every Safe API request sends, or "" for none. */
export async function safeApiKey(deps: KeyDeps): Promise<string> {
  return (await override(deps.db))?.key || deps.config.safeApiKey;
}

export interface SafeApiKeyInfo {
  /** "admin" when the dashboard override is in use, "env" for SAFE_API_KEY, "none" for neither. */
  source: "admin" | "env" | "none";
  /** The last four characters of the key in use. */
  hint: string | null;
  /** Who set the override and when (unix seconds). */
  setBy: string | null;
  setAt: number | null;
  /** Whether SAFE_API_KEY is set, so the admin knows what clearing falls back to. */
  envConfigured: boolean;
}

export async function safeApiKeyInfo(deps: KeyDeps): Promise<SafeApiKeyInfo> {
  const o = await override(deps.db);
  const env = deps.config.safeApiKey;
  const key = o?.key || env;
  return {
    source: o?.key ? "admin" : env ? "env" : "none",
    hint: key ? key.slice(-4) : null,
    setBy: o?.by ?? null,
    setAt: o?.at ?? null,
    envConfigured: Boolean(env),
  };
}

/** Set the override; an empty key clears it and SAFE_API_KEY applies again. */
export async function setSafeApiKey(
  db: Db,
  input: unknown,
  by: string,
  now: number,
): Promise<void> {
  if (typeof input !== "string") throw new HttpError(400, "key must be a string");
  const key = input.trim();
  if (key.length > MAX_KEY_CHARS || /\s/.test(key)) {
    throw new HttpError(400, "That does not look like a Safe API key.");
  }
  const op = db.kv.atomic()
    // The quota last seen belonged to the old key.
    .delete(K.meta("safe_api_quota"));
  if (key) op.set(K.secret(SAFE_API_KEY_SECRET), { key, by, at: now } satisfies SafeApiKeyOverride);
  else op.delete(K.secret(SAFE_API_KEY_SECRET));
  await op.commit();
}
