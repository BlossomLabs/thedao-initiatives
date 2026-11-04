/**
 * Live funding from Safe balances (docs/balance-funding-design-2026-09-12.md).
 *
 * The headline "raised" is what the Safe holds right now, priced with the
 * same Chainlink feeds the verifier uses, plus what the admin has recorded as
 * paid out. Page reads return the last saved balances immediately. A separate
 * request refreshes stale data while those values remain on screen. KV shares
 * both the snapshot and refresh lease across instances; no timer is needed.
 * The donation ledger is the fallback before the first successful read.
 */
import { type Address, hexToBigInt } from "viem";
import { balanceCall, multicall } from "../chain/multicall.ts";
import type { Chain } from "../chain/mod.ts";
import type { Db } from "../db/mod.ts";
import type { Donation, Initiative, Pledge } from "../db/types.ts";
import { K } from "../db/keys.ts";

/** How long one Safe's balance read is reused before the chain is asked again. */
export const BALANCE_TTL_SECS = 120;
export const BALANCE_RETRY_SECS = 60;
/** A crashed worker cannot hold the refresh lease indefinitely. */
export const BALANCE_LEASE_SECS = 120;

export interface Holding {
  symbol: string;
  amount: number;
  usd: number;
}

export interface SafeBalances {
  usd: number;
  holdings: Holding[];
  at: number;
}

interface CachedBalances {
  value: SafeBalances | null;
  /** Freshness deadline, retry cooldown, or an in-progress refresh's lease. */
  refreshAfter: number;
}

export interface FundingSummary {
  /** Open pledges only: not withdrawn, and not received. */
  pledged: number;
  /** Pledges the admin marked received. Their money arrived as a donation, so
   * it is inside `donated` and stays out of `total`. */
  received: number;
  /** Balance value + paid out when live; the ledger's confirmed total otherwise. */
  donated: number;
  total: number;
  /** True when `donated` comes from a saved chain balance, which may be stale. */
  live: boolean;
  /** A background client request may refresh this Safe (the server rechecks). */
  refreshDue: boolean;
  /** The ledger's confirmed total, for reconciliation. */
  ledger: number;
  paidOut: number;
}

export interface FundingDeps {
  db: Db;
  chain: Chain;
  now: () => number;
  log?: (msg: string) => void;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function createFunding(deps: FundingDeps) {
  const inflight = new Map<string, Promise<CachedBalances | null>>();
  const kv = deps.db.kv;

  /** Every Safe's balance of every donor token in one Multicall3 batch (chunked),
   * then one price per symbol held. A Safe with any failed read is an Error, so
   * its last good snapshot stays rather than dropping to a partial total. */
  async function readMany(safes: string[]): Promise<(SafeBalances | Error)[]> {
    const tokens = Object.entries(await deps.chain.donorTokens());
    const calls = safes.flatMap((safe) =>
      tokens.map(([symbol, [address]]) =>
        balanceCall(symbol === "ETH" ? "native" : address as Address, safe as Address)
      )
    );
    const results = await multicall(deps.chain.rpc, calls);
    const amounts = safes.map((_, s) =>
      tokens.map(([symbol, [, decimals]], t) => {
        const r = results[s * tokens.length + t];
        // A token address without code answers "0x": zero, as a direct balanceOf did.
        const raw = r.data === "0x" ? 0n : hexToBigInt(r.data);
        return r.ok ? { symbol, amount: Number(raw) / 10 ** decimals } : null;
      })
    );
    const held = new Set(amounts.flat().filter((a) => a && a.amount > 0).map((a) => a!.symbol));
    const rates = new Map<string, number | Error>(
      await Promise.all(
        [...held].map(async (symbol): Promise<[string, number | Error]> => {
          try {
            return [symbol, await deps.chain.usdRate(symbol)];
          } catch (e) {
            return [symbol, e instanceof Error ? e : new Error(String(e))];
          }
        }),
      ),
    );
    return amounts.map((row, s) => {
      if (row.some((a) => a === null)) {
        return new Error(`balance read reverted for ${safes[s]}`);
      }
      const holdings: Holding[] = [];
      for (const { symbol, amount } of row as { symbol: string; amount: number }[]) {
        if (amount <= 0) continue;
        const rate = rates.get(symbol)!;
        if (rate instanceof Error) return rate;
        holdings.push({ symbol, amount, usd: cents(amount * rate) });
      }
      holdings.sort((a, b) => b.usd - a.usd);
      return { usd: cents(holdings.reduce((n, h) => n + h.usd, 0)), holdings, at: deps.now() };
    });
  }

  /** Refreshes every given Safe that is due and not leased elsewhere, with one
   * batched chain read for all of them. Each Safe keeps its own KV snapshot and lease. */
  async function refreshMany(safes: string[]): Promise<void> {
    const leased = (await Promise.all(
      [...new Set(safes.map((s) => s.toLowerCase()))].map(async (safe) => {
        const key = K.safeBalances(safe);
        const previous = await kv.get<CachedBalances>(key);
        if (previous.value && previous.value.refreshAfter > deps.now()) return null;
        const value = previous.value?.value ?? null;
        const lease = await kv.atomic().check(previous)
          .set(key, { value, refreshAfter: deps.now() + BALANCE_LEASE_SECS })
          .commit();
        return lease.ok ? { safe, key, value, versionstamp: lease.versionstamp } : null;
      }),
    )).filter((x) => x !== null);
    if (!leased.length) return;

    let read: (SafeBalances | Error)[];
    try {
      read = await readMany(leased.map((l) => l.safe));
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      read = leased.map(() => err);
    }
    await Promise.all(leased.map(async ({ safe, key, value, versionstamp }, i) => {
      const got = read[i];
      if (got instanceof Error) deps.log?.(`balances ${safe}: ${got.message}`);
      const next: CachedBalances = got instanceof Error
        ? { value, refreshAfter: deps.now() + BALANCE_RETRY_SECS }
        : { value: got, refreshAfter: deps.now() + BALANCE_TTL_SECS };
      // A late worker must not overwrite a newer refresh or a donation invalidation.
      await kv.atomic().check({ key, versionstamp }).set(key, next).commit();
    }));
  }

  async function refresh(safe: string): Promise<CachedBalances | null> {
    await refreshMany([safe]);
    return (await kv.get<CachedBalances>(K.safeBalances(safe))).value;
  }

  async function cached(safe: string, revalidate: boolean): Promise<CachedBalances | null> {
    const key = safe.toLowerCase();
    if (!revalidate) return (await kv.get<CachedBalances>(K.safeBalances(key), deps.db.read)).value;
    let p = inflight.get(key);
    if (!p) {
      p = refresh(key).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return await p;
  }

  /** Snapshot only by default; an explicit refresh still respects freshness and the lease. */
  async function balances(safe: string, revalidate = false): Promise<SafeBalances | null> {
    return (await cached(safe, revalidate))?.value ?? null;
  }

  /** Verified donations can make this Safe eligible for an earlier refresh. */
  async function invalidate(safe: string): Promise<void> {
    const key = K.safeBalances(safe);
    for (let i = 0; i < 8; i++) {
      const entry = await kv.get<CachedBalances>(key);
      if (!entry.value) return;
      if (
        (await kv.atomic().check(entry)
          .set(key, { value: entry.value.value, refreshAfter: 0 }).commit()).ok
      ) return;
    }
  }

  /** The summary from rows the caller already holds (active pledges and
   * confirmed donations, as the repos list them), so a page that shows the
   * rows too reads them once. Only the Safe balance snapshot is fetched here. */
  function summaryFrom(
    initiative: Initiative,
    pledges: Pledge[],
    donations: Donation[],
    revalidate = false,
  ): Promise<FundingSummary> {
    const sumOf = (status: Pledge["status"]) =>
      pledges.filter((p) => p.status === status).reduce((s, p) => s + p.amountUsd, 0);
    const ledger = donations.filter((d) => d.status === "confirmed")
      .reduce((s, d) => s + d.amountUsd, 0);
    return summaryOf(initiative, {
      pledged: sumOf("pledged"),
      received: sumOf("received"),
      ledger,
    }, revalidate);
  }

  /** The summary from totals already summed (the board's card summary, db/cards.ts):
   * open pledges, received pledges and confirmed donation rows in USD. */
  async function summaryOf(
    initiative: Pick<Initiative, "safeAddress" | "paidOutUsd">,
    rows: { pledged: number; received: number; ledger: number },
    revalidate = false,
  ): Promise<FundingSummary> {
    const { pledged, received, ledger } = rows;
    const paidOut = initiative.paidOutUsd ?? 0;
    const snapshot = initiative.safeAddress
      ? await cached(initiative.safeAddress, revalidate)
      : null;
    const b = snapshot?.value;
    const donated = cents(b ? b.usd + paidOut : ledger);
    return {
      pledged: cents(pledged),
      received: cents(received),
      donated,
      total: cents(pledged + donated),
      live: Boolean(b),
      refreshDue: Boolean(
        initiative.safeAddress && (!snapshot || snapshot.refreshAfter <= deps.now()),
      ),
      ledger: cents(ledger),
      paidOut: cents(paidOut),
    };
  }

  async function summary(initiative: Initiative, revalidate = false): Promise<FundingSummary> {
    const [pledges, donations] = await Promise.all([
      deps.db.pledges.list(initiative.id),
      deps.db.donations.list(initiative.id),
    ]);
    return summaryFrom(initiative, pledges, donations, revalidate);
  }

  return { balances, refreshMany, summary, summaryFrom, summaryOf, invalidate };
}

export type Funding = ReturnType<typeof createFunding>;
