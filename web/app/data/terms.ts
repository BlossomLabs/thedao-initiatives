/**
 * Donation terms, bundled at build time from content/donation-terms.md (the
 * file is the only source; nothing is stored in the API). The first line
 * `version: YYYY-MM-DD` is the donate widget's gate version: acceptance is
 * remembered and logged per version, so bumping it re-asks every donor. It is
 * stripped from the body, which carries its own effective date.
 */
import raw from "../../../content/donation-terms.md?raw";

const VERSION_RE = /^version:[ \t]*(\S+)[ \t]*\r?\n/i;

export interface DonationTerms {
  version: string;
  body: string;
}

export function parseTermsFile(text: string): DonationTerms {
  const m = VERSION_RE.exec(text);
  if (!m) throw new Error("content/donation-terms.md: first line must be `version: <id>`");
  const body = text.slice(m[0].length).trim();
  if (!body) throw new Error("content/donation-terms.md: terms body is empty");
  return { version: m[1].slice(0, 40), body };
}

export const TERMS: DonationTerms = parseTermsFile(raw);
