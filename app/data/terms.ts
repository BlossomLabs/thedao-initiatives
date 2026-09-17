/** Donation terms bundled from the same content files recognized by the API. */
import { parseTermsFile, type TermsVersion } from "../../shared/terms.ts";
export { parseTermsFile, type TermsVersion, termsVersionId } from "../../shared/terms.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const files = import.meta.glob<string>("../../content/donation-terms/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function loadVersions(): TermsVersion[] {
  const out = Object.entries(files).map(([path, text]) =>
    parseTermsFile(text, path.split("/").pop() ?? path)
  );
  if (!out.length) throw new Error("content/donation-terms/: no terms file found");
  out.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  return out;
}

/** Every published version, newest effective date first. */
export const TERMS_VERSIONS: readonly TermsVersion[] = loadVersions();

/** The version in force: the latest effective date. */
export const TERMS: TermsVersion = TERMS_VERSIONS[0];

export const termsById = (id: string): TermsVersion | undefined =>
  TERMS_VERSIONS.find((v) => v.id === id);

export const shortTermsId = (id: string): string => id.slice(0, 8);

/** "2026-09-06" -> "September 6, 2026" (UTC, so the date never shifts by timezone). */
export function formatEffectiveDate(date: string): string {
  if (!DATE_RE.test(date)) return date;
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
