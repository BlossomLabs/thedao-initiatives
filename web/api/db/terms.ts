import { K } from "./keys.ts";
import { newId } from "../lib/ids.ts";

export interface DonationTerms {
  /** The gate version (`version:` line of content/donation-terms.md). */
  version: string;
  /** Markdown body without the version line. */
  body: string;
  updatedAt: number;
}

export interface TermsAcceptance {
  createdAt: number;
  version: string;
  address: string;
  ip: string;
}

/** Donation terms document + the acceptance paper trail (never rendered publicly). */
export function termsRepo(kv: Deno.Kv, now: () => number) {
  const get = async (): Promise<DonationTerms | null> =>
    (await kv.get<DonationTerms>(K.meta("donation_terms"))).value;

  const set = (version: string, body: string) =>
    kv.set(K.meta("donation_terms"), { version, body, updatedAt: now() } as DonationTerms);

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

  return { get, set, logAcceptance };
}
