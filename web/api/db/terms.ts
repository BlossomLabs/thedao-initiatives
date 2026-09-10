import { K } from "./keys.ts";
import { newId } from "../lib/ids.ts";

export interface TermsAcceptance {
  createdAt: number;
  version: string;
  address: string;
  ip: string;
}

/**
 * Donation-terms acceptance paper trail (never rendered publicly). The terms
 * document itself is content/donation-terms.md, bundled into the site at
 * build time; only the version accepted is recorded here.
 */
export function termsRepo(kv: Deno.Kv, now: () => number) {
  /**
   * Anonymous acceptances (no wallet yet) are always appended; once a wallet
   * is connected the (address, version) pair is recorded at most once.
   */
  async function logAcceptance(version: string, address: string, ip: string): Promise<boolean> {
    const row: TermsAcceptance = { createdAt: now(), version, address, ip };
    if (!address) {
      await kv.set(K.termsAccept(version, newId()), row);
      return true;
    }
    const res = await kv.atomic()
      .check({ key: K.termsAcceptByAddr(version, address), versionstamp: null })
      .set(K.termsAcceptByAddr(version, address), row)
      .set(K.termsAccept(version, newId()), row)
      .commit();
    return res.ok;
  }

  return { logAcceptance };
}
