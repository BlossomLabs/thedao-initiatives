/**
 * Donation discovery from the chain's event logs (DONATION_DISCOVERY=logs):
 * one cursor for every approved Safe, no Safe API and no key.
 *
 * Each run scans the blocks after the cursor up to the confirmed head, credits
 * every incoming tx through the same RPC verification manual pastes use, and
 * moves the cursor only past ranges it finished. A Safe the scan has not seen
 * yet is backfilled from the block it was deployed in, so its whole history is
 * read from the chain too. That needs an archive RPC (the keyed dRPC in
 * production); on a public one the backfill falls back to the initiative's
 * creation time, and logs reach only about a day back.
 */
import { MIN_CONFIRMATIONS } from "../config.ts";
import { incomingTxs } from "../chain/incoming.ts";
import type { Rpc } from "../chain/rpc.ts";
import type { SafeApiDeps, SafeRow } from "./safe-api.ts";

export const SCAN_STATE_KEY = "donation_scan";
const SCAN_LOCK = "donation_scan";
const SCAN_LOCK_SECS = 60;
/** Blocks per eth_getLogs range; halved on a refusal down to MIN_SPAN, regrown on success. */
export const MAX_SPAN = 10_000;
export const MIN_SPAN = 50;
export const SCAN_BUDGET_MS = 25_000;
/** A run within this many seconds of the last finished one does nothing. */
export const SCAN_FRESH_SECS = 30;
/** No Safe that emits SafeReceived (v1.3.0+, mid-2021) was deployed before this block. */
export const SAFE_V130_FLOOR_BLOCK = 12_000_000;
/** Without an archive RPC, start a new Safe's backfill this long before its initiative. */
const BACKFILL_MARGIN_BLOCKS = 7_200;
const SECS_PER_BLOCK = 12;
const PROBE_LANES = 8;

type Row = SafeRow & { createdAt?: number };

export interface DonationScanState {
  /** The last block fully scanned and credited, for every Safe in `known`. */
  cursor: number;
  /** Safes (lowercase) whose history up to `cursor` is covered or being backfilled. */
  known: string[];
  /** A Safe added after the first run: blocks [next, until] still to scan for it alone. */
  backfills: Record<string, { next: number; until: number }>;
  /** Before the first scan: the oldest history start among the Safes probed so far. */
  firstStart?: number;
  at: number;
  ok: boolean;
  error: string;
  /** Confirmed blocks still to scan when the run ended, backfills included. */
  behind: number;
  /** Transactions credited (or recorded pending) by the last run. */
  credited: number;
}

export interface ScanResult {
  state: DonationScanState | null;
  /** Initiatives that got a new or updated donation row. */
  touched: string[];
  skipped?: "fresh" | "locked";
}

/** The block a contract was deployed in, by binary search on eth_getCode (archive
 * reads). Null when the RPC cannot read old state. */
export async function deployBlock(rpc: Rpc, address: string, head: number): Promise<number | null> {
  const hasCode = async (block: number) => {
    const code = await rpc("eth_getCode", [address, "0x" + block.toString(16)]);
    return typeof code === "string" && code !== "0x" && code !== "0x0";
  };
  try {
    if (!await hasCode(head)) return null;
    let lo = SAFE_V130_FLOOR_BLOCK, hi = head; // no code at lo - 1 is assumed; code at hi
    if (await hasCode(lo)) return lo;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (await hasCode(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  } catch {
    return null;
  }
}

/** Where a new Safe's history starts: its deploy block, else (no archive RPC)
 * a margin before its initiative was created. */
async function historyStart(deps: SafeApiDeps, row: Row, head: number): Promise<number> {
  const deployed = await deployBlock(deps.chain.rpc, row.safeAddress, head);
  if (deployed !== null) return deployed;
  const age = Math.max(0, deps.now() - (row.createdAt ?? deps.now()));
  return Math.max(0, head - Math.ceil(age / SECS_PER_BLOCK) - BACKFILL_MARGIN_BLOCKS);
}

/** Scans for every approved Safe: the cursor is shared, so a Safe left out of
 * a run would lose the blocks that run moves past. */
export async function scanDonations(
  deps: SafeApiDeps,
  opts: { force?: boolean; budgetMs?: number } = {},
): Promise<ScanResult> {
  const prev = await deps.db.meta.get<DonationScanState>(SCAN_STATE_KEY);
  if (!opts.force && prev?.ok && prev.behind === 0 && deps.now() - prev.at < SCAN_FRESH_SECS) {
    return { state: prev, touched: [], skipped: "fresh" };
  }
  if (!await deps.db.meta.lock(SCAN_LOCK, SCAN_LOCK_SECS)) {
    return { state: prev, touched: [], skipped: "locked" };
  }
  const started = Date.now();
  const overBudget = () => Date.now() - started > (opts.budgetMs ?? SCAN_BUDGET_MS);
  const rows: Row[] = await deps.db.initiatives.cards("approved");
  const bySafe = new Map(
    rows.filter((i) => i.safeAddress).map((i) => [i.safeAddress.toLowerCase(), i]),
  );
  const state: DonationScanState = {
    cursor: prev?.cursor ?? 0,
    // A Safe no longer approved drops out; if it comes back it is backfilled again.
    known: (prev?.known ?? []).filter((s) => bySafe.has(s)),
    backfills: Object.fromEntries(
      Object.entries(prev?.backfills ?? {}).filter(([s]) => bySafe.has(s)),
    ),
    at: deps.now(),
    ok: true,
    error: "",
    behind: 0,
    credited: 0,
  };
  const touched = new Set<string>();
  let safeHead = 0;
  const save = () => deps.db.meta.set(SCAN_STATE_KEY, state);

  try {
    const head = await deps.chain.blockNumber();
    safeHead = head - (MIN_CONFIRMATIONS - 1);
    const tokens = Object.values(await deps.chain.activeTokens()).map(([a]) => a);
    const getBlockNumber = () => Promise.resolve(head);

    /** Scan [from, to] for `safes` in ranges; returns the last block finished. */
    const scan = async (safes: string[], from: number, to: number): Promise<number> => {
      let done = from - 1;
      let span = MAX_SPAN;
      while (done < to && !overBudget()) {
        const end = Math.min(done + span, to);
        let found;
        try {
          found = await incomingTxs(deps.chain.rpc, safes, tokens, done + 1, end);
        } catch (e) {
          if (span <= MIN_SPAN) throw e;
          span = Math.max(MIN_SPAN, Math.floor(span / 2));
          continue;
        }
        for (const { txHash, safe } of found) {
          const initiative = bySafe.get(safe)!;
          const known = await deps.db.donations.get(initiative.id, txHash);
          if (known?.status === "confirmed") continue;
          const v = await deps.chain.verifyDonation(txHash, initiative.safeAddress, {
            getBlockNumber,
          });
          if (v.found) {
            await deps.db.donations.record(initiative.id, txHash, v, "tx");
            touched.add(initiative.id);
            state.credited++;
          }
        }
        done = end;
        span = Math.min(MAX_SPAN, span * 2);
      }
      return done;
    };

    // New Safes: on the very first run they all start the shared cursor at the
    // oldest deploy block; later ones get a backfill of their own up to it.
    const known = new Set(state.known);
    const fresh = [...bySafe.keys()].filter((s) => !known.has(s));
    const firstRun = !prev?.cursor;
    let oldest = prev?.firstStart ?? safeHead;
    // About 25 eth_getCode reads per Safe: a few lanes at once, so 100+ new Safes fit a run or two.
    const queue = [...fresh];
    await Promise.all(Array.from({ length: Math.min(PROBE_LANES, queue.length) }, async () => {
      while (queue.length && !overBudget()) {
        const safe = queue.shift()!;
        const start = await historyStart(deps, bySafe.get(safe)!, head);
        if (firstRun) oldest = Math.min(oldest, start);
        else if (start <= state.cursor) {
          state.backfills[safe] = { next: start, until: state.cursor };
        }
        known.add(safe);
      }
    }));
    state.known = [...known];
    const unprobed = fresh.filter((s) => !known.has(s)).length;
    if (firstRun && unprobed) {
      // Wait for every Safe before the first scan, so none needs a backfill of its own.
      state.firstStart = oldest;
      state.error = `${unprobed} Safe(s) not probed yet`;
      await save();
      return await finish();
    }
    if (firstRun) {
      state.cursor = oldest - 1;
      delete state.firstStart;
    }
    await save();

    // The shared cursor, for every known Safe; saved after each call so a cut-short run keeps it.
    while (state.cursor < safeHead && !overBudget()) {
      const to = Math.min(state.cursor + MAX_SPAN, safeHead);
      state.cursor = await scan(state.known, state.cursor + 1, to);
      await save();
    }
    for (const [safe, b] of Object.entries(state.backfills)) {
      if (overBudget()) break;
      const done = await scan([safe], b.next, b.until);
      if (done >= b.until) delete state.backfills[safe];
      else state.backfills[safe] = { next: done + 1, until: b.until };
      await save();
    }
    // Safes the budget left unprobed stay out of `known`: the next run backfills them.
    if (unprobed) state.error = `${unprobed} new Safe(s) not probed yet`;
  } catch (e) {
    state.ok = false;
    state.error = e instanceof Error ? e.message : String(e);
  }
  return await finish();

  async function finish(): Promise<ScanResult> {
    await deps.db.meta.unlock(SCAN_LOCK);
    state.at = deps.now();
    state.behind = (state.cursor ? Math.max(0, safeHead - state.cursor) : safeHead) +
      Object.values(state.backfills).reduce((n, b) => n + b.until - b.next + 1, 0);
    await save();
    deps.log?.(
      `donation scan: to block ${state.cursor}, ${state.credited} tx credited` +
        (state.behind ? `, ${state.behind} block(s) behind` : "") +
        (state.error ? `: ${state.error}` : ""),
    );
    return { state, touched: [...touched] };
  }
}
