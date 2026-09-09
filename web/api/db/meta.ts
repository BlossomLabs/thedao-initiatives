import { K } from "./keys.ts";
import type { SafeSyncState } from "./types.ts";
import { AI_DAILY_CALL_CAP } from "../config.ts";
import { bumpCounter } from "./ratelimit.ts";

export function metaRepo(kv: Deno.Kv, now: () => number) {
  const get = async <T = unknown>(key: string): Promise<T | null> =>
    (await kv.get<T>(K.meta(key))).value;
  const set = (key: string, value: unknown) => kv.set(K.meta(key), value);

  /** Short-lived lock; true if acquired. Expires on its own. */
  async function lock(name: string, ttlSecs: number): Promise<boolean> {
    const res = await kv.atomic()
      .check({ key: K.lock(name), versionstamp: null })
      .set(K.lock(name), now(), { expireIn: ttlSecs * 1000 })
      .commit();
    return res.ok;
  }
  const unlock = (name: string) => kv.delete(K.lock(name));

  /** Count one upstream AI call against today's cap; false = cap reached. */
  async function aiBudgetOk(): Promise<boolean> {
    const day = new Date(now() * 1000).toISOString().slice(0, 10);
    const key = K.aiBudget(day);
    const cur = (await kv.get<number>(key)).value ?? 0;
    if (cur >= AI_DAILY_CALL_CAP) return false;
    await bumpCounter(kv, key, 2 * 86400 * 1000);
    return true;
  }

  const safeSync = async (rfpId: string) => (await kv.get<SafeSyncState>(K.safeSync(rfpId))).value;
  const setSafeSync = (rfpId: string, s: SafeSyncState) => kv.set(K.safeSync(rfpId), s);

  return { get, set, lock, unlock, aiBudgetOk, safeSync, setSafeSync };
}
