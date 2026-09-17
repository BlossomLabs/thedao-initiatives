import { K } from "./keys.ts";
import type { RateLimitMode } from "../config.ts";
import { sha256Hex } from "../lib/ids.ts";

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

export interface RateLimiterOptions {
  /** `enforce` (default) refuses over the cap; `observe` allows but reports; `off` skips counting. */
  mode?: RateLimitMode;
  /** Receives one JSON line per reported breach (see `breachLine`). */
  log?: (line: string) => void;
  /** Bucket prefixes (`"submit:"`) that refuse even in observe mode. */
  alwaysEnforce?: readonly string[];
}

/** A breach is reported when the count first passes the cap and again at every
 * 10x multiple, so a flood stays visible without one line per request. */
function reportable(count: number, max: number): boolean {
  if (count === Number.MAX_SAFE_INTEGER) return true; // contended bucket, failed closed
  if (count === max + 1) return true;
  const step = Math.max(1, max) * 10;
  return count > max && count % step === 0;
}

/** `bucket` is `<name>` or `<name>:<client key>`; the client key (an IP or a
 * wallet) is hashed so logs never carry the raw identity. */
function breachLine(
  bucket: string,
  max: number,
  windowSecs: number,
  count: number,
  mode: RateLimitMode,
  enforced: boolean,
  atSecs: number,
): string {
  const colon = bucket.indexOf(":");
  const name = colon === -1 ? bucket : bucket.slice(0, colon);
  const key = colon === -1 ? undefined : sha256Hex(bucket.slice(colon + 1));
  return JSON.stringify({
    rateLimit: true,
    schema: 1,
    event: "ratelimit.breach",
    at: new Date(atSecs * 1000).toISOString(),
    bucket: name,
    ...(key ? { key } : {}),
    cap: max,
    window: windowSecs,
    count,
    mode,
    enforced,
  });
}

/**
 * Fixed-window counter in KV so limits hold across isolates. The key
 * expires with its window. Returns true when the call is allowed.
 */
export function rateLimiter(kv: Deno.Kv, now: () => number, opts: RateLimiterOptions = {}) {
  const mode = opts.mode ?? "enforce";
  const log = opts.log ?? (() => {});
  const alwaysEnforce = opts.alwaysEnforce ?? [];
  return async (bucket: string, max: number, windowSecs: number): Promise<boolean> => {
    if (mode === "off") return true;
    const start = Math.floor(now() / windowSecs) * windowSecs;
    const count = await bumpCounter(kv, K.rl(bucket, start), (windowSecs + 5) * 1000);
    if (count <= max) return true;
    const enforced = mode === "enforce" || alwaysEnforce.some((p) => bucket.startsWith(p));
    if (reportable(count, max)) {
      try {
        log(breachLine(bucket, max, windowSecs, count, mode, enforced, now()));
      } catch { /* Log delivery must not change the request's outcome. */ }
    }
    return !enforced;
  };
}
