/** Request-driven donation discovery. Snapshots only read KV; explicit refresh
 * requests claim a shared lease and await persisted results before responding. */
import { retryDonationMatches } from "./donation-matching.ts";
import { K } from "../db/keys.ts";
import type { SafeSyncState } from "../db/types.ts";
import {
  DEFAULT_BUDGET_MS,
  lazyBlockNumber,
  reverifyPending,
  type SafeApiDeps,
  type SafeRow,
  syncSafe,
} from "./safe-api.ts";

export const LEDGER_RETRY_SECS = 60;
export const LEDGER_LEASE_SECS = 120;
/** The longest a failing ledger, or a rate-limited Safe API, waits between tries. */
export const LEDGER_MAX_BACKOFF_SECS = 30 * 60;
/** Under meta: while the Safe API answers 429, no Safe's ledger is tried or reported due. */
export const SAFE_API_PAUSE_KEY = "safe_api_pause";

/** 60 s after the first failure, doubling with each one in a row, at most 30 minutes. */
export const ledgerBackoff = (failures: number): number =>
  Math.min(LEDGER_RETRY_SECS * 2 ** Math.max(0, failures - 1), LEDGER_MAX_BACKOFF_SECS);

interface SafeApiPause {
  until: number;
  /** 429 pauses in a row; the next pause doubles. */
  strikes: number;
}

const rateLimited = (state: SafeSyncState | null) =>
  Boolean(state?.error && /HTTP 429/.test(state.error));

/** When the shared Safe API pause ends (0 when there is none). */
export async function safeApiPausedUntil(deps: SafeApiDeps): Promise<number> {
  return (await deps.db.meta.getPublic<SafeApiPause>(SAFE_API_PAUSE_KEY))?.until ?? 0;
}

/** After a 429: pause every ledger, twice as long as the last pause if that one
 * ended less than an hour ago. After a success: forget an ended pause, so the
 * next 429 starts from one minute again. Parallel lanes share one strike: a
 * 429 while a pause is active keeps it, and a success never lifts it. */
async function recordSafeApi(deps: SafeApiDeps, limited: boolean): Promise<void> {
  const prev = await deps.db.meta.get<SafeApiPause>(SAFE_API_PAUSE_KEY);
  const active = Boolean(prev && prev.until > deps.now());
  if (!limited) {
    if (prev && !active) await deps.db.kv.delete(K.meta(SAFE_API_PAUSE_KEY));
    return;
  }
  if (active) return;
  const strikes = prev && deps.now() - prev.until < 3600 ? prev.strikes + 1 : 1;
  await deps.db.meta.set(
    SAFE_API_PAUSE_KEY,
    {
      until: deps.now() + ledgerBackoff(strikes),
      strikes,
    } satisfies SafeApiPause,
  );
}

const refreshAfter = (deps: SafeApiDeps, state: SafeSyncState | null): number =>
  state?.refreshAfter ??
    (state ? state.at + (state.ok ? deps.config.safeSyncTtlSecs : LEDGER_RETRY_SECS) : 0);

/** `pausedUntil` (safeApiPausedUntil): while the Safe API is paused, nothing is due. */
export async function ledgerStatus(deps: SafeApiDeps, initiative: SafeRow, pausedUntil = 0) {
  if (!initiative.safeAddress) return null;
  const state = await deps.db.meta.safeSync(initiative.id);
  const due = refreshAfter(deps, state) <= deps.now() && pausedUntil <= deps.now();
  return {
    checkedAt: state?.at || null,
    ok: state?.ok ?? true,
    intervalMinutes: deps.config.safeSyncTtlSecs / 60,
    refreshDue: due,
    updating: Boolean(state?.updating && !due),
  };
}

/** Forced admin refreshes still respect a lease held by another request. */
export async function refreshLedger(
  deps: SafeApiDeps,
  initiative: SafeRow,
  force = false,
  getBlockNumber = lazyBlockNumber(deps),
): Promise<SafeSyncState | null> {
  if (!initiative.safeAddress) return null;
  const key = K.safeSync(initiative.id);
  const previous = await deps.db.kv.get<SafeSyncState>(key);
  if (refreshAfter(deps, previous.value) > deps.now() && (!force || previous.value?.updating)) {
    return previous.value;
  }
  // The Safe API is rate limiting us: only an admin's forced sync tries anyway.
  if (!force && await safeApiPausedUntil(deps) > deps.now()) return previous.value;
  const saved = previous.value ?? {
    at: 0,
    lastTxHash: "",
    ok: true,
    error: "",
    backfilled: false,
    resumeUrl: "",
  };
  const lease = await deps.db.kv.atomic().check(previous).set(key, {
    ...saved,
    updating: true,
    refreshAfter: deps.now() + LEDGER_LEASE_SECS,
  }).commit();
  if (!lease.ok) return await deps.db.meta.safeSync(initiative.id);

  let next: SafeSyncState;
  try {
    next = await syncSafe(deps, initiative, DEFAULT_BUDGET_MS, getBlockNumber, false);
    // Manual submissions may not be in the indexer's latest page. Only retry
    // this initiative's pending rows, reusing this request's confirmation head.
    await reverifyPending(deps, getBlockNumber, initiative);
    await retryDonationMatches(deps.db, deps.chain, initiative.id);
  } catch (e) {
    next = { ...saved, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  next.at = deps.now();
  next.updating = false;
  // A failure waits longer each time in a row; an incomplete backfill that is
  // making progress resumes after a minute.
  next.failures = next.ok ? 0 : (saved.failures ?? 0) + 1;
  next.refreshAfter = deps.now() +
    (!next.ok
      ? ledgerBackoff(next.failures)
      : next.backfilled && !next.resumeUrl
      ? deps.config.safeSyncTtlSecs
      : LEDGER_RETRY_SECS);
  // A worker whose lease expired cannot overwrite a newer result or cursor.
  await deps.db.kv.atomic().check({ key, versionstamp: lease.versionstamp }).set(key, next)
    .commit();
  await recordSafeApi(deps, rateLimited(next));
  return await deps.db.meta.safeSync(initiative.id);
}

/** Only the initiatives included in the visible page; bounded upstream concurrency. */
export async function refreshLedgers(
  deps: SafeApiDeps,
  initiatives: SafeRow[],
  force = false,
): Promise<number> {
  const getBlockNumber = lazyBlockNumber(deps);
  const queue = initiatives.filter((initiative) => initiative.safeAddress);
  if (!force && await safeApiPausedUntil(deps) > deps.now()) return 0;
  let checked = 0;
  let limited = false;
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length && !limited) {
      const initiative = queue.shift()!;
      const state = await refreshLedger(deps, initiative, force, getBlockNumber);
      if (rateLimited(state)) limited = true;
      else checked++;
    }
  }));
  return checked;
}
