/** Request-driven donation discovery. Snapshots only read KV; explicit refresh
 * requests claim a shared lease and await persisted results before responding. */
import { K } from "../db/keys.ts";
import type { Rfp, SafeSyncState } from "../db/types.ts";
import {
  DEFAULT_BUDGET_MS,
  lazyBlockNumber,
  reverifyPending,
  type SafeApiDeps,
  syncSafe,
} from "./safe-api.ts";

export const LEDGER_RETRY_SECS = 60;
export const LEDGER_LEASE_SECS = 120;

const refreshAfter = (deps: SafeApiDeps, state: SafeSyncState | null): number =>
  state?.refreshAfter ??
    (state ? state.at + (state.ok ? deps.config.safeSyncTtlSecs : LEDGER_RETRY_SECS) : 0);

export async function ledgerStatus(deps: SafeApiDeps, rfp: Rfp) {
  if (!rfp.safeAddress) return null;
  const state = await deps.db.meta.safeSync(rfp.id);
  const due = refreshAfter(deps, state) <= deps.now();
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
  rfp: Rfp,
  force = false,
  getBlockNumber = lazyBlockNumber(deps),
): Promise<SafeSyncState | null> {
  if (!rfp.safeAddress) return null;
  const key = K.safeSync(rfp.id);
  const previous = await deps.db.kv.get<SafeSyncState>(key);
  if (refreshAfter(deps, previous.value) > deps.now() && (!force || previous.value?.updating)) {
    return previous.value;
  }
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
  if (!lease.ok) return await deps.db.meta.safeSync(rfp.id);

  let next: SafeSyncState;
  try {
    next = await syncSafe(deps, rfp, DEFAULT_BUDGET_MS, getBlockNumber, false);
    // Manual submissions may not be in the indexer's latest page. Only retry
    // this initiative's pending rows, reusing this request's confirmation head.
    await reverifyPending(deps, getBlockNumber, rfp);
  } catch (e) {
    next = { ...saved, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  next.at = deps.now();
  next.updating = false;
  next.refreshAfter = deps.now() +
    (next.ok && next.backfilled && !next.resumeUrl
      ? deps.config.safeSyncTtlSecs
      : LEDGER_RETRY_SECS);
  // A worker whose lease expired cannot overwrite a newer result or cursor.
  await deps.db.kv.atomic().check({ key, versionstamp: lease.versionstamp }).set(key, next)
    .commit();
  return await deps.db.meta.safeSync(rfp.id);
}

/** Only the initiatives included in the visible page; bounded upstream concurrency. */
export async function refreshLedgers(
  deps: SafeApiDeps,
  rfps: Rfp[],
  force = false,
): Promise<number> {
  const getBlockNumber = lazyBlockNumber(deps);
  const queue = rfps.filter((rfp) => rfp.safeAddress);
  let checked = 0;
  let limited = false;
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length && !limited) {
      const rfp = queue.shift()!;
      const state = await refreshLedger(deps, rfp, force, getBlockNumber);
      if (state?.error && /HTTP 429/.test(state.error)) limited = true;
      else checked++;
    }
  }));
  return checked;
}
