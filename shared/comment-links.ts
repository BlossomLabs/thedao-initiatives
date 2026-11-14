/** The links in a comment, for the moderation queue and the AI screen. */

/** Domains a link in a comment can point at without a warning: the board,
 * code hosts and the Ethereum forums. A subdomain counts as its parent. */
export const KNOWN_LINK_DOMAINS = [
  "thedao.fund",
  "github.com",
  "gist.github.com",
  "gitlab.com",
  "ethresear.ch",
  "ethereum-magicians.org",
  "ethereum.org",
  "eips.ethereum.org",
  "discourse.thedao.fund",
];

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+|\bwww\.[^\s<>"'`)\]]+/gi;

export interface CommentLink {
  url: string;
  /** Lowercase host without a leading "www.". "" when it does not parse. */
  domain: string;
  known: boolean;
}

function hostOf(raw: string): string {
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw).hostname;
    return host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isKnownDomain(domain: string): boolean {
  return Boolean(domain) &&
    KNOWN_LINK_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

/** Every link in the text, in order, repeats kept once. */
export function commentLinks(text: string): CommentLink[] {
  const seen = new Set<string>();
  const out: CommentLink[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    const domain = hostOf(url);
    out.push({ url, domain, known: isKnownDomain(domain) });
  }
  return out;
}

/** The comment is mostly links: fewer than 40 characters of its own once the
 * links are taken out. */
export function mostlyLinks(text: string): boolean {
  const links = commentLinks(text);
  if (!links.length) return false;
  const rest = text.replace(URL_RE, "").replace(/\s+/g, " ").trim();
  return rest.length < 40;
}
