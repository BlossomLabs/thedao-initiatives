/** Affiliations: projects sharing a affiliation are related for the ballot rules (the affiliation is its
 * own name, e.g. "Seal"). Admin-only, never on an RFP, never shown on the site except
 * in a ballot error; listed in /vote/llms.txt. */

const MAX = 32;

/** Trimmed, no empties, 1–32 characters, deduped ignoring case (first spelling wins). */
export function normalizeAffiliations(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw.map((x) => x.trim()).filter(Boolean)) {
    if (t.length > MAX) throw new Error("Affiliations are 1–32 characters");
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** A comma-separated list ("Seal, Wallets"), normalized. */
export const parseAffiliations = (raw: string): string[] => normalizeAffiliations(raw.split(","));
