/**
 * Live funding from Safe balances (docs/balance-funding-design-2026-09-12.md).
 *
 * The headline "raised" is what the Safe holds right now, priced with the
 * same Chainlink feeds the verifier uses, plus what the admin has recorded as
 * paid out. A balance moves the moment a transfer is mined, so the page never
 * waits for confirmations, the indexer or a trigger. The donation ledger
 * (who gave what) is a separate, slower layer; it is the fallback here when
 * the RPC read fails.
 */
import { encodeHex } from "@std/encoding";
import { abiWord, decodeHexInt, SEL_BALANCE_OF } from "../chain/abi.ts";
import { ethCall } from "../chain/rpc.ts";
import type { Chain } from "../chain/mod.ts";
import type { Db } from "../db/mod.ts";
import type { Rfp } from "../db/types.ts";

/** How long one Safe's balance read is reused before the chain is asked again. */
export const BALANCE_TTL_SECS = 15;

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

export interface FundingSummary {
  pledged: number;
  /** Balance value + paid out when live; the ledger's confirmed total otherwise. */
  donated: number;
  total: number;
  /** True when `donated` came from the chain just now (or a fresh cache). */
  live: boolean;
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

/**
 * Minutes between runs for the cron shapes this app uses (`*​/N * * * *`,
 * `0 * * * *`, `0 *​/N * * *`); null for anything else.
 */
export function cronIntervalMinutes(expr: string): number | null {
  const [min, hour, ...rest] = expr.trim().split(/\s+/);
  if (rest.length !== 3 || rest.some((f) => f !== "*")) return null;
  const every = (f: string) => {
    const m = /^\*\/(\d+)$/.exec(f);
    return m ? Number(m[1]) : f === "*" ? 1 : null;
  };
  if (/^\d+$/.test(min)) {
    const h = every(hour);
    return h ? h * 60 : null;
  }
  const m = every(min);
  return m && hour === "*" ? m : null;
}

export function createFunding(deps: FundingDeps) {
  const cache = new Map<string, SafeBalances>();
  const inflight = new Map<string, Promise<SafeBalances>>();

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

  /** What the Safe holds, in USD. Null when the chain cannot be read and nothing is cached. */
  async function balances(safe: string): Promise<SafeBalances | null> {
    const key = safe.toLowerCase();
    const hit = cache.get(key);
    if (hit && deps.now() - hit.at < BALANCE_TTL_SECS) return hit;
    let p = inflight.get(key);
    if (!p) {
      p = read(safe).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    try {
      const fresh = await p;
      cache.set(key, fresh);
      return fresh;
    } catch (e) {
      deps.log?.(`balances ${safe}: ${e instanceof Error ? e.message : String(e)}`);
      return hit ?? null; // a stale number beats a wrong one
    }
  }

  async function summary(rfp: Rfp): Promise<FundingSummary> {
    const [pledged, ledger] = await Promise.all([
      deps.db.pledges.totalActive(rfp.id),
      deps.db.donations.confirmedTotal(rfp.id),
    ]);
    const paidOut = rfp.paidOutUsd ?? 0;
    const b = rfp.safeAddress ? await balances(rfp.safeAddress) : null;
    const donated = cents(b ? b.usd + paidOut : ledger);
    return {
      pledged: cents(pledged),
      donated,
      total: cents(pledged + donated),
      live: Boolean(b),
      ledger: cents(ledger),
      paidOut: cents(paidOut),
    };
  }

  return { balances, summary };
}

export type Funding = ReturnType<typeof createFunding>;
