/**
 * Donation terms, every published version, bundled at build time from
 * content/donation-terms/<effective-date>.md. Nothing is stored in the API:
 * git history is the audit trail and adding a file is how a version is
 * published (see web/README.md, "Publishing a new terms version").
 *
 * File header: leading `key: value` lines up to the first blank line.
 *   version: YYYY-MM-DD    the effective date; must equal the file name
 *   material: true         optional; labels the version a material change
 *
 * A version's id is the SHA-256 of `<effective date>\n<body>` (the same
 * canonicalisation as api/lib/ids.ts sha256Hex). The material flag is not part
 * of it, so the flag can be corrected without minting a new version. The
 * donate widget remembers acceptance per id, so every new version re-asks.
 */
import { sha256, stringToBytes } from "viem";

export interface TermsVersion {
  /** YYYY-MM-DD, from the `version:` header line. */
  effectiveDate: string;
  /** 64 lowercase hex chars: sha256(effectiveDate + "\n" + body). */
  id: string;
  /** `material: true` in the header. */
  material: boolean;
  /** Markdown after the header lines. */
  body: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEADER_RE = /^([a-z]+):[ \t]*(.*?)[ \t]*$/;

/** Rejects day overflow such as 2026-02-30, which Date.parse would accept. */
function isRealDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const t = Date.parse(d + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

export function termsVersionId(effectiveDate: string, body: string): string {
  return sha256(stringToBytes(effectiveDate + "\n" + body)).slice(2);
}

export function parseTermsFile(text: string, name: string): TermsVersion {
  const where = `content/donation-terms/${name}`;
  const lines = text.split(/\r?\n/);
  let effectiveDate = "";
  let material = false;
  let i = 0;
  for (; i < lines.length && lines[i].trim() !== ""; i++) {
    const m = HEADER_RE.exec(lines[i]);
    if (!m) break;
    const [, key, value] = m;
    if (key === "version") effectiveDate = value;
    else if (key === "material") material = value === "true";
    else throw new Error(`${where}: unknown header \`${key}:\``);
  }
  if (!effectiveDate) throw new Error(`${where}: first line must be \`version: YYYY-MM-DD\``);
  if (!DATE_RE.test(effectiveDate)) {
    throw new Error(`${where}: version must be the effective date, YYYY-MM-DD`);
  }
  if (!isRealDate(effectiveDate)) throw new Error(`${where}: ${effectiveDate} is not a date`);
  if (name !== effectiveDate + ".md") {
    throw new Error(`${where}: file name must be ${effectiveDate}.md`);
  }
  const body = lines.slice(i).join("\n").trim();
  if (!body) throw new Error(`${where}: terms body is empty`);
  return { effectiveDate, id: termsVersionId(effectiveDate, body), material, body };
}

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
