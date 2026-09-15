/**
 * Donation discovery through the Safe Transaction Service.
 *
 * Page reads never call this. Only the cron and the admin button do, one
 * authenticated request per Safe, stopping at the first tx hash already
 * recorded. Each new hash is re-verified over RPC (amounts come from the
 * chain); only ETH sends the RPC path cannot see are credited from the
 * indexer's value.
 */
import { MIN_CONFIRMATIONS, SAFE_TX_SERVICE_BASE, TOKENS } from "../config.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/mod.ts";
import type { Chain } from "../chain/mod.ts";
import type { Rfp, SafeSyncState } from "../db/types.ts";
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
  rfp: Rfp,
  txHash: string,
  rows: SafeTransfer[],
): Promise<void> {
  const existing = await deps.db.donations.get(rfp.id, txHash);
  if (existing?.status === "confirmed") return;
  let v: Verification = await deps.chain.verifyDonation(txHash, rfp.safeAddress);
  if (v.ok || (v.found && v.pending)) {
    await deps.db.donations.record(rfp.id, txHash, v, "tx");
    return;
  }
  // RPC saw nothing creditable. Internal ETH transfers (Safe->Safe, exchange
  // contracts) never show as `tx.to == safe`, so trust the indexer for those.
  const eth = rows.filter((r) =>
    r.type === "ETHER_TRANSFER" && r.to.toLowerCase() === rfp.safeAddress.toLowerCase()
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
        await deps.db.donations.record(rfp.id, txHash, v, "safe-api");
        return;
      } catch (e) {
        v = {
          ...v,
          found: true,
          pending: true,
          detail: `price feed unavailable, will retry: ${String(e)}`,
        };
        await deps.db.donations.record(rfp.id, txHash, v, "safe-api");
        return;
      }
    }
  }
  if (v.found) await deps.db.donations.record(rfp.id, txHash, v, "tx");
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
  rfp: Rfp,
  budgetMs = DEFAULT_BUDGET_MS,
): Promise<SafeSyncState> {
  const prev = await deps.db.meta.safeSync(rfp.id);
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
    `${SAFE_TX_SERVICE_BASE}/safes/${rfp.safeAddress}/incoming-transfers/?limit=${PAGE_LIMIT}`;
  const resumed = Boolean(state.resumeUrl);
  let credited = 0;
  let requests = 0;
  try {
    let head = 0;
    try {
      head = await deps.chain.blockNumber();
    } catch { /* depth check degrades to "credit" */ }
    const safeHead = head ? head - (MIN_CONFIRMATIONS - 1) : Number.MAX_SAFE_INTEGER;
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
        // Too shallow: leave it for the next run. It must not advance the
        // cursor either, or it would be skipped forever once deep enough.
        if (row.blockNumber > safeHead) continue;
        if (!newest) newest = tx;
        if (
          row.type !== "ETHER_TRANSFER" &&
          !(row.tokenAddress && ACCEPTED.has(row.tokenAddress.toLowerCase()))
        ) {
          continue; // not an accepted token: skip, but it does not end the walk
        }
        if (state.backfilled && state.lastTxHash && tx === state.lastTxHash) {
          hitCursor = true;
          break;
        }
        // Pending rows wait on confirmations or a price; failed rows may be a
        // donor's manual paste of an internal ETH send the RPC path cannot
        // see, which the indexer fallback in creditTx can still credit.
        const known = await deps.db.donations.get(rfp.id, tx);
        if (known?.status !== "confirmed") {
          allKnown = false;
          const list = byTx.get(tx) ?? [];
          list.push(row);
          byTx.set(tx, list);
        }
      }
      let pageCredited = 0;
      for (const [tx, rows] of byTx) {
        if (overBudget()) break;
        await creditTx(deps, rfp, tx, rows);
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
      `safe sync ${rfp.slug}: ${requests} request(s), ${credited} tx credited${
        complete ? "" : ", continuing next run"
      }`,
    );
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    deps.log?.(`safe sync ${rfp.slug}: ${state.error}`);
  }
  await deps.db.meta.setSafeSync(rfp.id, state);
  return state;
}

/** Re-verify pending rows (price feed hiccups, shallow confirmations). */
export async function reverifyPending(deps: SafeApiDeps): Promise<void> {
  for (const d of await deps.db.donations.pending()) {
    const rfp = await deps.db.rfps.get(d.rfpId);
    if (!rfp?.safeAddress) continue;
    try {
      const v = await deps.chain.verifyDonation(d.txHash, rfp.safeAddress);
      if (v.found && !v.pending) {
        await deps.db.donations.record(rfp.id, d.txHash, v, d.source);
      }
    } catch { /* transient; next cycle */ }
  }
}

/**
 * Give the initiative its donation Safe: the CREATE2 address its deploy
 * lands on, which the chain confirms (the factory's own simulation, or the
 * Safe itself if a deploy already happened). Donations open on it right
 * away; deploying is only needed for the first payout. The signers are
 * frozen with it so a later rotation cannot move the deploy elsewhere.
 * Throws when the chain disagrees or another initiative holds the address
 * (a manual mix-up, left to the admin). Idempotent once assigned.
 */
export async function assignSafe(deps: SafeApiDeps, rfp: Rfp): Promise<Rfp> {
  if (rfp.safeAddress) return rfp;
  const signers = deps.config.operationalSigners;
  const { address, deployed } = await deps.chain.resolveSafe(
    signers,
    rfp.safeDeploymentKey ?? rfp.slug,
  );
  const holder = await deps.db.rfps.bySafe(address);
  if (holder && holder.id !== rfp.id) {
    throw new Error(`Safe ${address} is assigned to another initiative (${holder.slug})`);
  }
  return await deps.db.rfps.update(rfp.id, {
    safeAddress: address,
    safeSigners: signers,
    safeDeployedAt: deployed ? deps.now() : 0,
  });
}

/**
 * Record the deploy once code is at the assigned address and the Safe
 * verifies (owners, threshold, canonical proxy). Returns the verification
 * detail when deployed, null while there is nothing on-chain yet; throws
 * when what is there is not our Safe.
 */
export async function activateSafe(deps: SafeApiDeps, rfp: Rfp): Promise<string | null> {
  if (!rfp.safeAddress) return null;
  if (rfp.safeDeployedAt) return "verified earlier";
  if (!(await deps.chain.hasCode(rfp.safeAddress))) return null;
  const [ok, detail] = await deps.chain.verifySafe(
    rfp.safeAddress,
    rfp.safeSigners ?? deps.config.operationalSigners,
  );
  if (!ok) throw new Error(`Safe at ${rfp.safeAddress} REJECTED: ${detail}`);
  await deps.db.rfps.update(rfp.id, { safeDeployedAt: deps.now() });
  return detail;
}

/** Cron entry: every approved initiative with a deployed Safe, under one
 * lock. Rows without an address get one here (the backfill), and a deploy
 * that finished after the admin's tab closed is noticed here too. */
export async function syncAll(deps: SafeApiDeps): Promise<number> {
  if (!(await deps.db.meta.lock("safe-sync", 60))) return 0;
  let n = 0;
  try {
    for (let rfp of await deps.db.rfps.list(["approved"])) {
      try {
        rfp = await assignSafe(deps, rfp);
        if (!(await activateSafe(deps, rfp))) continue; // not deployed yet: nothing to index
      } catch (e) {
        deps.log?.(`safe ${rfp.slug}: ${e instanceof Error ? e.message : String(e)}`);
        continue; // rpc blip or a mix-up for the admin; next cycle
      }
      const s = await syncSafe(deps, rfp);
      if (s.error && /HTTP 429/.test(s.error)) break; // quota: stop the cycle
      n++;
    }
    await reverifyPending(deps);
  } finally {
    await deps.db.meta.unlock("safe-sync");
  }
  return n;
}
