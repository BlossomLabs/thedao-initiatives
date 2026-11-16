import { collect, K, type ReadOptions } from "./keys.ts";
import type { Donation, DonationStatus } from "./types.ts";
import type { Verification } from "../chain/verify.ts";
import { donationDetail } from "../lib/donation-detail.ts";
import { donationRetryDelay, UNKNOWN_DONATION_MAX_AGE_SECS } from "../lib/donation-retry.ts";

export function donationsRepo(kv: Deno.Kv, now: () => number, read: ReadOptions = undefined) {
  const get = async (rfpId: string, tx: string) =>
    (await kv.get<Donation>(K.donation(rfpId, tx))).value;

  /**
   * Insert or update a donation row from a chain verification result.
   * confirmed = verified transfer to the RFP's Safe; failed = rejected or an expired unknown hash;
   * pending = in the mempool, too shallow, or unpriceable right now.
   * Idempotent: an already-confirmed row is never touched.
   */
  async function record(
    rfpId: string,
    txHash: string,
    v: Verification,
    source: Donation["source"] = "tx",
  ): Promise<[Donation, DonationStatus | "already-confirmed"]> {
    const tx = txHash.toLowerCase();
    const verifiedStatus: DonationStatus = v.ok
      ? "confirmed"
      : v.found && !v.pending
      ? "failed"
      : "pending";
    for (let i = 0; i < 5; i++) {
      const cur = await kv.get<Donation>(K.donation(rfpId, tx));
      if (cur.value?.status === "confirmed") return [cur.value, "already-confirmed"];
      const t = now();
      const createdAt = cur.value?.createdAt ?? t;
      // Legacy price/confirmation/mempool rows were observed. Only the exact
      // old not-found result is safe to retire as a never-seen transaction.
      const seenOnChain = v.found || cur.value?.seenOnChain === true || Boolean(
        cur.value && cur.value.seenOnChain === undefined &&
          cur.value.detail !== "transaction not found on mainnet",
      );
      const expired = !v.ok && !v.found && !seenOnChain &&
        t - createdAt >= UNKNOWN_DONATION_MAX_AGE_SECS;
      const status = expired ? "failed" : verifiedStatus;
      const retryAttempts = status === "pending" && cur.value?.status === "pending"
        ? (cur.value.retryAttempts ?? 0) + 1
        : 0;
      const row: Donation = {
        rfpId,
        txHash: tx,
        tokenSymbol: v.tokenSymbol,
        tokenAddress: v.tokenAddress,
        amountRaw: v.amountRaw,
        amountUsd: v.amountUsd,
        donor: v.donor,
        status,
        detail: expired
          ? "transaction not found; automatic verification window expired"
          : donationDetail(v.detail),
        source,
        createdAt,
        confirmedAt: status === "confirmed" ? t : null,
        seenOnChain,
        retryAttempts,
        retryAfter: status === "pending" ? t + donationRetryDelay(retryAttempts) : undefined,
      };
      const res = await kv.atomic().check(cur)
        .set(K.donation(rfpId, tx), row)
        .set(K.donationByTx(tx, rfpId), true)
        // The card summary (db/cards.ts) is rebuilt after this write.
        .set(K.cardVersion(rfpId), crypto.randomUUID())
        .commit();
      if (res.ok) return [row, status];
    }
    throw new Error("donation write conflict");
  }

  /** Bound reads as well as RPC work, resuming after a stable transaction key.
   * Includes final rows so old databases need no unbounded index backfill. */
  async function scan(rfpId: string, after: string, limit: number): Promise<Donation[]> {
    const rows: Donation[] = [];
    for await (
      const e of kv.list<Donation>({
        prefix: K.donations(rfpId),
        ...(after ? { start: K.donation(rfpId, after) } : {}),
      }, { limit: limit + 1 })
    ) {
      if (after && e.value.txHash === after) continue;
      rows.push(e.value);
      if (rows.length === limit) break;
    }
    return rows;
  }

  /** Transport failures back off without pretending the chain rejected a tx. */
  async function defer(rfpId: string, tx: string): Promise<void> {
    const key = K.donation(rfpId, tx);
    for (let i = 0; i < 5; i++) {
      const cur = await kv.get<Donation>(key);
      if (cur.value?.status !== "pending") return;
      const retryAttempts = (cur.value.retryAttempts ?? 0) + 1;
      if (
        (await kv.atomic().check(cur).set(key, {
          ...cur.value,
          retryAttempts,
          retryAfter: now() + donationRetryDelay(retryAttempts),
        }).commit()).ok
      ) return;
    }
  }

  /** `strong` for a copy built from the rows (db/cards.ts): never from a replica behind a write. */
  async function list(rfpId: string, onlyConfirmed = true, strong = false): Promise<Donation[]> {
    const all = await collect(
      kv.list<Donation>({ prefix: K.donations(rfpId) }, strong ? undefined : read),
    );
    const rows = onlyConfirmed ? all.filter((d) => d.status === "confirmed") : all;
    return rows.sort((a, b) => (b.confirmedAt ?? b.createdAt) - (a.confirmedAt ?? a.createdAt));
  }

  /** Any donation row for this tx (a tx may credit several RFPs). */
  async function byHash(tx: string): Promise<Donation | null> {
    for await (const e of kv.list({ prefix: K.donationsByTx(tx) })) {
      const rfpId = String(e.key[2]);
      const d = await get(rfpId, tx);
      if (d) return d;
    }
    return null;
  }

  async function pending(): Promise<Donation[]> {
    const all = await collect(kv.list<Donation>({ prefix: ["donation"] }));
    return all.filter((d) => d.status === "pending");
  }

  async function confirmedTotal(rfpId: string): Promise<number> {
    return (await list(rfpId)).reduce((s, d) => s + d.amountUsd, 0);
  }

  /** Confirmed USD this address donated to THIS initiative (vote eligibility). */
  async function totalFor(rfpId: string, address: string): Promise<number> {
    const low = address.toLowerCase();
    return (await list(rfpId)).filter((d) => d.donor.toLowerCase() === low)
      .reduce((s, d) => s + d.amountUsd, 0);
  }

  /** Confirmed donations from these wallets, any initiative, keyed lowercase: one scan. */
  async function byDonors(addresses: string[]): Promise<Map<string, Donation[]>> {
    const want = new Set(addresses.filter(Boolean).map((a) => a.toLowerCase()));
    const out = new Map<string, Donation[]>();
    if (!want.size) return out;
    for (const d of await collect(kv.list<Donation>({ prefix: ["donation"] }))) {
      const low = d.donor.toLowerCase();
      if (d.status !== "confirmed" || !want.has(low)) continue;
      const list = out.get(low) ?? [];
      list.push(d);
      out.set(low, list);
    }
    return out;
  }

  return { get, record, scan, defer, list, byHash, pending, confirmedTotal, totalFor, byDonors };
}
