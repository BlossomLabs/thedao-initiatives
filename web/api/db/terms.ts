import { collect, K } from "./keys.ts";
import { newId, sha256Hex } from "../lib/ids.ts";
import type { TermsAcceptance, TermsVersion } from "./types.ts";

/** meta key holding the id of the version in force. */
export const CURRENT_TERMS_META = "terms_current";

/** The version identifier: a content hash of the effective date plus the terms text. */
export const termsVersionId = (text: string, effectiveDate: string): string =>
  sha256Hex(effectiveDate + "\n" + text);

export type TermsVersionMeta = Omit<TermsVersion, "text">;
export const versionMeta = (v: TermsVersion): TermsVersionMeta => ({
  id: v.id,
  effectiveDate: v.effectiveDate,
  material: v.material,
  publishedAt: v.publishedAt,
  publishedBy: v.publishedBy,
});

/**
 * Donation terms: every published version is kept (keyed by content hash, never
 * overwritten) and one acceptance record is written per checkbox acceptance.
 * An acceptance record is immutable except for the transaction hash, which is
 * filled in once when the donation is confirmed.
 */
export function termsRepo(kv: Deno.Kv, now: () => number) {
  /**
   * Publish a version and make it current. Publishing the same text with the
   * same effective date again is the same version: nothing is written except
   * the current pointer.
   */
  async function publish(
    text: string,
    effectiveDate: string,
    material: boolean,
    publishedBy: string,
  ): Promise<[TermsVersion, "published" | "existing"]> {
    const id = termsVersionId(text, effectiveDate);
    const key = K.termsVersion(id);
    const have = await kv.get<TermsVersion>(key);
    if (have.value) {
      await kv.set(K.meta(CURRENT_TERMS_META), id);
      return [have.value, "existing"];
    }
    const row: TermsVersion = {
      id,
      effectiveDate,
      material,
      text,
      publishedAt: now(),
      publishedBy,
    };
    const res = await kv.atomic()
      .check({ key, versionstamp: null })
      .set(key, row)
      .set(K.meta(CURRENT_TERMS_META), id)
      .commit();
    if (!res.ok) {
      const again = await kv.get<TermsVersion>(key);
      if (again.value) return [again.value, "existing"];
      throw new Error("terms publish conflict");
    }
    return [row, "published"];
  }

  const get = async (id: string): Promise<TermsVersion | null> =>
    (await kv.get<TermsVersion>(K.termsVersion(id))).value;

  async function current(): Promise<TermsVersion | null> {
    const id = (await kv.get<string>(K.meta(CURRENT_TERMS_META))).value;
    return id ? await get(id) : null;
  }

  /** Every version, newest effective date first (then latest published first). */
  async function list(): Promise<TermsVersionMeta[]> {
    const rows = await collect(kv.list<TermsVersion>({ prefix: K.termsVersions() }));
    return rows.map(versionMeta).sort((a, b) =>
      b.effectiveDate.localeCompare(a.effectiveDate) || b.publishedAt - a.publishedAt
    );
  }

  /**
   * One record per acceptance (anonymous or with a wallet). The per-address
   * index keeps the first acceptance of a version for that wallet.
   */
  async function logAcceptance(version: string, address: string, ip: string): Promise<string> {
    const id = newId();
    const t = now();
    const row: TermsAcceptance = {
      id,
      version,
      address,
      acceptedAt: new Date(t * 1000).toISOString(),
      createdAt: t,
      ip,
      txHash: null,
    };
    const tx = kv.atomic().set(K.termsAcceptance(id), row).set(K.termsAccept(version, id), row);
    if (address) {
      const first = await kv.get(K.termsAcceptByAddr(version, address));
      if (!first.value) tx.set(K.termsAcceptByAddr(version, address), row);
    }
    await tx.commit();
    return id;
  }

  const acceptance = async (id: string): Promise<TermsAcceptance | null> =>
    (await kv.get<TermsAcceptance>(K.termsAcceptance(id))).value;

  /** Attach the transaction hash once. A record that already has one is never changed. */
  async function linkTx(id: string, txHash: string): Promise<"linked" | "already" | "missing"> {
    const cur = await kv.get<TermsAcceptance>(K.termsAcceptance(id));
    if (!cur.value) return "missing";
    if (cur.value.txHash) return "already";
    const row: TermsAcceptance = { ...cur.value, txHash: txHash.toLowerCase(), txLinkedAt: now() };
    const res = await kv.atomic()
      .check(cur)
      .set(K.termsAcceptance(id), row)
      .set(K.termsAccept(row.version, id), row)
      .commit();
    return res.ok ? "linked" : "already";
  }

  return { publish, get, current, list, logAcceptance, acceptance, linkTx };
}
