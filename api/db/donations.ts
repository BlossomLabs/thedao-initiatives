import { collect, K, type ReadOptions } from "./keys.ts";
import type { Donation, DonationStatus } from "./types.ts";
import type { Verification } from "../chain/verify.ts";

export function donationsRepo(kv: Deno.Kv, now: () => number, read: ReadOptions = undefined) {
  const get = async (rfpId: string, tx: string) =>
    (await kv.get<Donation>(K.donation(rfpId, tx))).value;

  /**
   * Insert or update a donation row from a chain verification result.
   * confirmed = verified transfer to the RFP's Safe; failed = mined but wrong;
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
    const status: DonationStatus = v.ok
      ? "confirmed"
      : v.found && !v.pending
      ? "failed"
      : "pending";
    for (let i = 0; i < 5; i++) {
      const cur = await kv.get<Donation>(K.donation(rfpId, tx));
      if (cur.value?.status === "confirmed") return [cur.value, "already-confirmed"];
      const t = now();
      const row: Donation = {
        rfpId,
        txHash: tx,
        tokenSymbol: v.tokenSymbol,
        tokenAddress: v.tokenAddress,
        amountRaw: v.amountRaw,
        amountUsd: v.amountUsd,
        donor: v.donor,
        status,
        detail: v.detail,
        source,
        createdAt: cur.value?.createdAt ?? t,
        confirmedAt: status === "confirmed" ? t : null,
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

  return { get, record, list, byHash, pending, confirmedTotal, totalFor };
}
