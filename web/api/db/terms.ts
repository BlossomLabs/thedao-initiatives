import { K } from "./keys.ts";

/**
 * One donation-terms acceptance per donation: what the donor saw and ticked,
 * bound to the transaction they then sent. Written by the donate confirm the
 * moment the tx hash exists (before the chain has verified anything), never
 * read publicly, never changed. A tx that never confirms simply leaves a
 * record whose donation row never reaches "confirmed"; the two join by hash.
 *
 * The terms text is not in the API: `version` is the content hash minted by
 * app/data/terms.ts from content/donation-terms/<date>.md, so the accepted
 * text is recoverable from git for any record.
 */
export interface TermsAcceptance {
  /** Lowercase 0x + 64 hex. */
  txHash: string;
  /** Terms version id: 64 hex, sha256(effective date + "\n" + text). */
  version: string;
  /** Checksummed wallet connected when the donation was sent, or "" for none. */
  address: string;
  /** ISO 8601 (UTC) timestamp of the checkbox tick, as reported by the widget. */
  acceptedAt: string;
  /** Unix seconds when the API wrote the record. */
  recordedAt: number;
}

export function termsRepo(kv: Deno.Kv, now: () => number) {
  /** First write wins: returns false when a record for this tx already exists. */
  async function record(rec: Omit<TermsAcceptance, "recordedAt">): Promise<boolean> {
    const key = K.termsAcceptance(rec.txHash);
    const row: TermsAcceptance = { ...rec, txHash: rec.txHash.toLowerCase(), recordedAt: now() };
    const res = await kv.atomic().check({ key, versionstamp: null }).set(key, row).commit();
    return res.ok;
  }

  const get = async (txHash: string): Promise<TermsAcceptance | null> =>
    (await kv.get<TermsAcceptance>(K.termsAcceptance(txHash))).value;

  return { record, get };
}
