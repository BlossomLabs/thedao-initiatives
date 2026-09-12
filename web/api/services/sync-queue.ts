/**
 * Event-driven Safe syncs over the KV queue.
 *
 * A webhook says "this Safe just received something". The receiver must
 * answer at once, and the transfer is not creditable yet anyway: the sync
 * wants MIN_CONFIRMATIONS blocks and the Safe indexer needs a moment. So the
 * sync is queued with a delay, and if the hashes the webhook named are still
 * not on the ledger afterwards it is queued once more. Beyond that the cron
 * remains the safety net.
 */
import { type SafeApiDeps, syncSafe } from "./safe-api.ts";

export interface SafeSyncMessage {
  kind: "safe-sync";
  rfpId: string;
  /** Tx hashes the trigger named (lowercase); empty when unknown. */
  hashes: string[];
  attempt: number;
}

export interface SyncDelays {
  /** Trigger -> first sync: ~3 blocks plus indexer lag. */
  firstMs: number;
  /** First sync -> retry when the named hashes are still missing. */
  retryMs: number;
}

export const DEFAULT_SYNC_DELAYS: SyncDelays = { firstMs: 60_000, retryMs: 180_000 };
/** Syncs per trigger, the first one included. */
export const MAX_ATTEMPTS = 2;
const LOCK_TTL_SECS = 60;

export interface SafeSyncQueue {
  /** Queue a sync for one initiative's Safe. */
  trigger(rfpId: string, hashes: string[]): Promise<void>;
  /** Handle one queue value (exported for tests; ignores foreign messages). */
  handle(value: unknown): Promise<void>;
  /** Start consuming the KV queue. Resolves when the KV store closes. */
  listen(): Promise<void>;
}

function isSafeSync(v: unknown): v is SafeSyncMessage {
  const m = v as Partial<SafeSyncMessage> | null;
  return Boolean(
    m && typeof m === "object" && m.kind === "safe-sync" && typeof m.rfpId === "string" &&
      Array.isArray(m.hashes) && typeof m.attempt === "number",
  );
}

export function createSafeSyncQueue(
  deps: SafeApiDeps,
  delays: SyncDelays = DEFAULT_SYNC_DELAYS,
): SafeSyncQueue {
  const { db } = deps;
  const enqueue = (msg: SafeSyncMessage, delay: number) =>
    db.kv.enqueue(msg, { delay }).then(() => {});

  const trigger = (rfpId: string, hashes: string[]) =>
    enqueue({ kind: "safe-sync", rfpId, hashes, attempt: 0 }, delays.firstMs);

  async function handle(value: unknown): Promise<void> {
    if (!isSafeSync(value)) return;
    const msg = value;
    const rfp = await db.rfps.get(msg.rfpId);
    if (!rfp?.safeAddress || rfp.status !== "approved") return;
    const lock = "safe-sync:" + rfp.id;
    if (!(await db.meta.lock(lock, LOCK_TTL_SECS))) {
      // Another sync for this Safe is running; try again later (counts as an attempt).
      if (msg.attempt + 1 < MAX_ATTEMPTS) {
        await enqueue({ ...msg, attempt: msg.attempt + 1 }, delays.retryMs);
      }
      return;
    }
    try {
      await syncSafe(deps, rfp);
    } finally {
      await db.meta.unlock(lock);
    }
    if (msg.attempt + 1 >= MAX_ATTEMPTS || !msg.hashes.length) return;
    const missing: string[] = [];
    for (const h of msg.hashes) {
      const row = await db.donations.get(rfp.id, h);
      if (!row || row.status === "pending") missing.push(h);
    }
    if (missing.length) {
      deps.log?.(
        `safe sync ${rfp.slug}: ${missing.length} triggered tx not credited yet, retrying`,
      );
      await enqueue({ ...msg, hashes: missing, attempt: msg.attempt + 1 }, delays.retryMs);
    }
  }

  const listen = () =>
    db.kv.listenQueue(async (value) => {
      try {
        await handle(value);
      } catch (e) {
        deps.log?.(`safe sync queue: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

  return { trigger, handle, listen };
}
