import { K } from "./keys.ts";

/** Optimistic increment of a KV counter that expires on its own.
 * Returns the new count. */
export async function bumpCounter(
  kv: Deno.Kv,
  key: Deno.KvKey,
  expireInMs: number,
  maxAttempts = 8,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const cur = await kv.get<number>(key);
    const next = (cur.value ?? 0) + 1;
    const res = await kv.atomic().check(cur).set(key, next, { expireIn: expireInMs })
      .commit();
    if (res.ok) return next;
  }
  // Heavily contended bucket: treat as over the limit rather than fail open.
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Fixed-window counter in KV so limits hold across isolates. The key
 * expires with its window. Returns true when the call is allowed.
 * `bump: false` only asks whether one more would be allowed, without counting
 * it: a route checks first and counts after the request actually succeeded, so
 * refused attempts do not eat the budget (Griff, 2026-09-14).
 */
export function rateLimiter(kv: Deno.Kv, now: () => number) {
  return async (bucket: string, max: number, windowSecs: number, bump = true): Promise<boolean> => {
    const start = Math.floor(now() / windowSecs) * windowSecs;
    const key = K.rl(bucket, start);
    if (!bump) return ((await kv.get<number>(key)).value ?? 0) < max;
    const count = await bumpCounter(kv, key, (windowSecs + 5) * 1000);
    return count <= max;
  };
}
