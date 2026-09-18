/**
 * Donation discovery through the Safe Transaction Service.
 *
 * Snapshot reads never call this. Stale refreshes and the admin button do, one
 * authenticated request per Safe, stopping at the first tx hash already
 * recorded. Each new hash is re-verified over RPC (amounts come from the
 * chain); only ETH sends the RPC path cannot see are credited from the
 * indexer's value.
 */
import { MIN_CONFIRMATIONS, SAFE_TX_SERVICE_BASE, TOKENS } from "../config.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/mod.ts";
import type { Chain } from "../chain/mod.ts";
import type { Initiative, SafeSyncState } from "../db/types.ts";
import type { Verification } from "../chain/verify.ts";
import { toChecksum } from "../chain/address.ts";

export interface SafeTransfer {
  type: "ERC20_TRANSFER" | "ETHER_TRANSFER" | "ERC721_TRANSFER" | string;
  executionDate: string;
  blockNumber: number;
  transactionHash: string;
  to: string;
  from: string;
  value: string | null;
  tokenAddress: string | null;
  transferId: string;
  tokenInfo?: { symbol?: string; decimals?: number } | null;
}

interface Page {
  count: number;
  next: string | null;
  results: SafeTransfer[];
}

export interface SafeApiDeps {
  db: Db;
  chain: Chain;
  config: Config;
  fetch: typeof fetch;
  now: () => number;
  log?: (msg: string) => void;
}

export const PAGE_LIMIT = 20;
/** Safe API requests per Safe per run: bounds quota use and wall-clock. */
export const MAX_PAGES_PER_RUN = 10;
/** Wall-clock budget per Safe per run; the next run picks up where this stopped. */
export const DEFAULT_BUDGET_MS = 20_000;

/** Nothing calls RPC until needed; reuse successes and failures for this run. */
export function lazyBlockNumber(deps: SafeApiDeps): () => Promise<number> {
  let head: Promise<number> | undefined;
  return () => head ??= Promise.resolve().then(() => deps.chain.blockNumber());
}

export class SafeApiError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

async function fetchPage(deps: SafeApiDeps, url: string): Promise<Page> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "thedao-rfps/2.0",
  };
  if (deps.config.safeApiKey) headers.Authorization = "Bearer " + deps.config.safeApiKey;
  const res = await deps.fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining !== null) {
    await deps.db.meta.set("safe_api_quota", {
      remaining: Number(remaining),
      at: deps.now(),
    });
  }
  if (!res.ok) throw new SafeApiError(res.status, `Safe API HTTP ${res.status}`);
  return await res.json() as Page;
}

/** Credit one tx hash to an initiative: RPC verification first, indexer fallback for ETH. */
async function creditTx(
  deps: SafeApiDeps,
  initiative: Initiative,
  txHash: string,
  rows: SafeTransfer[],
  getBlockNumber: () => Promise<number>,
): Promise<void> {
  const existing = await deps.db.donations.get(initiative.id, txHash);
  if (existing?.status === "confirmed") return;
  let v: Verification = await deps.chain.verifyDonation(txHash, initiative.safeAddress, {
    getBlockNumber,
  });
  if (v.ok || (v.found && v.pending)) {
    await deps.db.donations.record(initiative.id, txHash, v, "tx");
    return;
  }
  // RPC saw nothing creditable. Internal ETH transfers (Safe->Safe, exchange
  // contracts) never show as `tx.to == safe`, so trust the indexer for those.
  const eth = rows.filter((r) =>
    r.type === "ETHER_TRANSFER" && r.to.toLowerCase() === initiative.safeAddress.toLowerCase()
  );
  if (eth.length) {
    const wei = eth.reduce((s, r) => s + BigInt(r.value ?? "0"), 0n);
    const amount = Number(wei) / 1e18;
    if (amount > 0) {
      try {
        const rate = await deps.chain.usdRate("ETH");
        v = {
          found: true,
          pending: false,
          ok: true,
          tokenSymbol: "ETH",
          tokenAddress: "",
          amountRaw: wei.toString(),
          amount,
          amountUsd: Math.round(amount * rate * 100) / 100,
          donor: safeChecksum(eth[0].from),
          detail: `credited from Safe indexer: ${amount} ETH received (internal transfer)`,
        };
        await deps.db.donations.record(initiative.id, txHash, v, "safe-api");
        return;
      } catch (e) {
        v = {
          ...v,
          found: true,
          pending: true,
          detail: `price feed unavailable, will retry: ${String(e)}`,
        };
        await deps.db.donations.record(initiative.id, txHash, v, "safe-api");
        return;
      }
    }
  }
  if (v.found) await deps.db.donations.record(initiative.id, txHash, v, "tx");
}

function safeChecksum(a: string): string {
  try {
    return toChecksum(a);
  } catch {
    return a;
  }
}

const ACCEPTED = new Set(Object.values(TOKENS).map(([a]) => a.toLowerCase()));

/**
 * One sync pass for one Safe, page by page under a time budget. Each page's
 * new tx hashes are credited before the next page is fetched, so progress
 * persists even when the budget or the page cap cuts the run short; the
 * state then carries `resumeUrl` and the next run continues from there.
 * `backfilled` becomes true once a walk reaches the end of the history; from
 * then on a walk stops at the stored cursor or at a page of known hashes.
 */
export async function syncSafe(
  deps: SafeApiDeps,
  initiative: Initiative,
  budgetMs = DEFAULT_BUDGET_MS,
  getBlockNumber = lazyBlockNumber(deps),
  persist = true,
): Promise<SafeSyncState> {
  const prev = await deps.db.meta.safeSync(initiative.id);
  const started = Date.now();
  const overBudget = () => Date.now() - started > budgetMs;
  const state: SafeSyncState = {
    at: deps.now(),
    lastTxHash: prev?.lastTxHash ?? "",
    ok: false,
    error: "",
    backfilled: prev?.backfilled ?? false,
    resumeUrl: prev?.resumeUrl ?? "",
  };
  const firstUrl =
    `${SAFE_TX_SERVICE_BASE}/safes/${initiative.safeAddress}/incoming-transfers/?limit=${PAGE_LIMIT}`;
  const resumed = Boolean(state.resumeUrl);
  let credited = 0;
  let requests = 0;
  try {
    let url: string | null = state.resumeUrl || firstUrl;
    let newest = "";
    let complete = false;
    for (let page = 0; url && page < MAX_PAGES_PER_RUN; page++) {
      if (overBudget()) break;
      const data = await fetchPage(deps, url);
      requests++;
      const byTx = new Map<string, SafeTransfer[]>();
      let allKnown = data.results.length > 0;
      let hitCursor = false;
      for (const row of data.results) {
        const tx = row.transactionHash.toLowerCase();
        if (
          row.type !== "ETHER_TRANSFER" &&
          !(row.tokenAddress && ACCEPTED.has(row.tokenAddress.toLowerCase()))
        ) {
          continue; // not an accepted token: skip, but it does not end the walk
        }
        if (state.backfilled && state.lastTxHash && tx === state.lastTxHash) {
          if (!newest) newest = tx;
          hitCursor = true;
          break;
        }
        // Pending rows wait on confirmations or a price; failed rows may be a
        // donor's manual paste of an internal ETH send the RPC path cannot
        // see, which the indexer fallback in creditTx can still credit.
        const known = await deps.db.donations.get(initiative.id, tx);
        if (known?.status !== "confirmed") {
          allKnown = false;
          // Only unknown/pending accepted transfers need a confirmation check.
          // Too-shallow transfers must not advance the cursor. A failed head
          // lookup aborts this Safe's pass without crediting or advancing it.
          const safeHead = await getBlockNumber() - (MIN_CONFIRMATIONS - 1);
          if (row.blockNumber > safeHead) continue;
          const list = byTx.get(tx) ?? [];
          list.push(row);
          byTx.set(tx, list);
        }
        if (!newest) newest = tx;
      }
      let pageCredited = 0;
      for (const [tx, rows] of byTx) {
        if (overBudget()) break;
        await creditTx(deps, initiative, tx, rows, getBlockNumber);
        credited++;
        pageCredited++;
      }
      if (pageCredited < byTx.size) {
        state.resumeUrl = url; // budget cut this page short: redo it next run
        break;
      }
      // Incremental: once backfilled, a page of only known hashes means
      // everything older is known too.
      if (hitCursor || (state.backfilled && allKnown) || !data.next) {
        complete = true;
        break;
      }
      state.resumeUrl = data.next;
      url = data.next;
    }
    state.ok = true;
    if (complete) {
      state.backfilled = true;
      state.resumeUrl = "";
      // A resumed walk started deep in the history; the cursor is only
      // trustworthy when the walk began at the newest page.
      if (!resumed && newest) state.lastTxHash = newest;
    }
    deps.log?.(
      `safe sync ${initiative.slug}: ${requests} request(s), ${credited} tx credited${
        complete ? "" : ", continuing next run"
      }`,
    );
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    deps.log?.(`safe sync ${initiative.slug}: ${state.error}`);
  }
  if (persist) await deps.db.meta.setSafeSync(initiative.id, state);
  return state;
}

/** Re-verify pending rows (price feed hiccups, shallow confirmations). */
export async function reverifyPending(
  deps: SafeApiDeps,
  getBlockNumber = lazyBlockNumber(deps),
  only?: Initiative,
): Promise<void> {
  const pending = only
    ? (await deps.db.donations.list(only.id, false)).filter((d) => d.status === "pending")
    : await deps.db.donations.pending();
  for (const d of pending) {
    const initiative = only ?? await deps.db.initiatives.get(d.rfpId);
    if (!initiative?.safeAddress) continue;
    try {
      const v = await deps.chain.verifyDonation(d.txHash, initiative.safeAddress, {
        getBlockNumber,
      });
      if (v.found && !v.pending) {
        await deps.db.donations.record(initiative.id, d.txHash, v, d.source);
      }
    } catch { /* transient; next cycle */ }
  }
}
