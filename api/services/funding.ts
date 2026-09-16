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
import { encodeHex } from "@std/encoding";
import { abiWord, decodeHexInt, SEL_BALANCE_OF } from "../chain/abi.ts";
import { ethCall } from "../chain/rpc.ts";
import type { Chain } from "../chain/mod.ts";
import type { Db } from "../db/mod.ts";
import type { Rfp } from "../db/types.ts";
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
  pledged: number;
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

  async function read(safe: string): Promise<SafeBalances> {
    const tokens = await deps.chain.donorTokens();
    const data = SEL_BALANCE_OF + encodeHex(abiWord(safe));
    const holdings: Holding[] = [];
    for (const [symbol, [address, decimals]] of Object.entries(tokens)) {
      const raw = symbol === "ETH"
        ? await deps.chain.rpc("eth_getBalance", [safe, "latest"])
        : await ethCall(deps.chain.rpc, address, data);
      const amount = Number(decodeHexInt(raw)) / 10 ** decimals;
      if (amount <= 0) continue;
      const rate = await deps.chain.usdRate(symbol);
      holdings.push({ symbol, amount, usd: cents(amount * rate) });
    }
    holdings.sort((a, b) => b.usd - a.usd);
    return { usd: cents(holdings.reduce((s, h) => s + h.usd, 0)), holdings, at: deps.now() };
  }

  async function refresh(safe: string): Promise<CachedBalances | null> {
    const key = K.safeBalances(safe);
    const previous = await kv.get<CachedBalances>(key);
    if (previous.value && previous.value.refreshAfter > deps.now()) return previous.value;
    const value = previous.value?.value ?? null;
    const lease = await kv.atomic().check(previous)
      .set(key, { value, refreshAfter: deps.now() + BALANCE_LEASE_SECS })
      .commit();
    if (!lease.ok) return (await kv.get<CachedBalances>(key)).value;

    let next: CachedBalances;
    try {
      next = { value: await read(safe), refreshAfter: deps.now() + BALANCE_TTL_SECS };
    } catch (e) {
      deps.log?.(`balances ${safe}: ${e instanceof Error ? e.message : String(e)}`);
      next = { value, refreshAfter: deps.now() + BALANCE_RETRY_SECS };
    }
    // A late worker must not overwrite a newer refresh or a donation invalidation.
    await kv.atomic().check({ key, versionstamp: lease.versionstamp }).set(key, next).commit();
    return (await kv.get<CachedBalances>(key)).value;
  }

  async function cached(safe: string, revalidate: boolean): Promise<CachedBalances | null> {
    const key = safe.toLowerCase();
    if (!revalidate) return (await kv.get<CachedBalances>(K.safeBalances(key))).value;
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

  async function summary(rfp: Rfp, revalidate = false): Promise<FundingSummary> {
    const [pledged, ledger] = await Promise.all([
      deps.db.pledges.totalActive(rfp.id),
      deps.db.donations.confirmedTotal(rfp.id),
    ]);
    const paidOut = rfp.paidOutUsd ?? 0;
    const snapshot = rfp.safeAddress ? await cached(rfp.safeAddress, revalidate) : null;
    const b = snapshot?.value;
    const donated = cents(b ? b.usd + paidOut : ledger);
    return {
      pledged: cents(pledged),
      donated,
      total: cents(pledged + donated),
      live: Boolean(b),
      refreshDue: Boolean(rfp.safeAddress && (!snapshot || snapshot.refreshAfter <= deps.now())),
      ledger: cents(ledger),
      paidOut: cents(paidOut),
    };
  }

  return { balances, summary, invalidate };
}

export type Funding = ReturnType<typeof createFunding>;
