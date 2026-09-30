import { categoryOf } from "~/lib/categories";

/**
 * The admin list's one query: `type:grant status:pending cat:opsec,defi
 * funding:open` plus words that must all appear in the project name or the
 * contact ("quoted phrases" stay together). The pills edit the same text, so
 * the box, the pills and the URL (?q=) never disagree.
 */
export type AdminType = "all" | "grant" | "rfp";
export type AdminStatus = "all" | "pending" | "approved" | "rejected" | "archived";
export type AdminFunding = "all" | "open" | "funded";

export interface AdminQuery {
  type: AdminType;
  status: AdminStatus;
  /** Category slugs, or "untagged". */
  cats: string[];
  funding: AdminFunding;
  /** Lowercased words and phrases, all of which must match. */
  words: string[];
}

export const ADMIN_STATUSES = ["pending", "approved", "rejected", "archived"] as const;
const TYPES = ["grant", "rfp"] as const;
const FUNDING = ["open", "funded"] as const;
export const UNTAGGED = "untagged";

type Name = "type" | "status" | "cat" | "funding";
const QUALIFIER = /^(type|status|cat|funding):(.*)$/i;

/** Raw tokens: "quoted phrases" or runs of non-space, in order. */
const tokens = (q: string): string[] => q.match(/"[^"]*"?|\S+/g) ?? [];

const list = (xs: readonly string[]) =>
  xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}` : xs[0];

export function parseAdminQuery(q: string): { query: AdminQuery; problems: string[] } {
  const query: AdminQuery = { type: "all", status: "all", cats: [], funding: "all", words: [] };
  const problems: string[] = [];
  for (const raw of tokens(q)) {
    if (raw.startsWith('"')) {
      const phrase = raw.replace(/^"|"$/g, "").trim().toLowerCase();
      if (phrase) query.words.push(phrase);
      continue;
    }
    const m = QUALIFIER.exec(raw);
    if (!m) {
      query.words.push(raw.toLowerCase());
      continue;
    }
    const name = m[1].toLowerCase() as Name;
    const value = m[2].toLowerCase();
    if (name === "type") {
      if ((TYPES as readonly string[]).includes(value)) query.type = value as AdminType;
      else problems.push(`Unknown type: ${m[2]}. Try ${list(TYPES)}.`);
    } else if (name === "status") {
      if ((ADMIN_STATUSES as readonly string[]).includes(value)) {
        query.status = value as AdminStatus;
      } else problems.push(`Unknown status: ${m[2]}. Try ${list(ADMIN_STATUSES)}.`);
    } else if (name === "funding") {
      if ((FUNDING as readonly string[]).includes(value)) query.funding = value as AdminFunding;
      else problems.push(`Unknown funding: ${m[2]}. Try ${list(FUNDING)}.`);
    } else {
      for (const slug of value.split(",").filter(Boolean)) {
        if (slug === UNTAGGED || categoryOf(slug)) {
          if (!query.cats.includes(slug)) query.cats.push(slug);
        } else problems.push(`Unknown category: ${slug}.`);
      }
    }
  }
  return { query, problems };
}

/**
 * The query with one qualifier set (a pill picked): it replaces that qualifier
 * where it first stood, or is appended; "all" or no categories removes it.
 * Words, phrases and other qualifiers keep their text and order.
 */
export function setQualifier(q: string, name: Name, value: string | string[]): string {
  const text = Array.isArray(value) ? value.join(",") : value;
  const next = text && text !== "all" ? `${name}:${text}` : null;
  const out: string[] = [];
  let placed = false;
  for (const raw of tokens(q)) {
    const m = QUALIFIER.exec(raw);
    if (m && m[1].toLowerCase() === name) {
      if (next && !placed) out.push(next);
      placed = true;
      continue;
    }
    out.push(raw);
  }
  if (next && !placed) out.push(next);
  return out.join(" ");
}
