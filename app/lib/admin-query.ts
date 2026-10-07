import { categoryOf } from "~/lib/categories";
import {
  orList,
  qualifierOf,
  setQualifier as setQualifierIn,
  tokens,
  wordOf,
} from "~/lib/query-text";

/**
 * The admin list's one query: `type:grant status:pending cat:opsec,defi
 * funding:open edit:review` plus words that must all appear in the project name or the
 * contact ("quoted phrases" stay together). The pills edit the same text, so
 * the box, the pills and the URL (?q=) never disagree.
 */
export type AdminType = "all" | "grant" | "rfp";
export type AdminStatus = "all" | "pending" | "approved" | "rejected" | "archived";
export type AdminFunding = "all" | "open" | "funded";
/** `review`: a proposer's edit to the approved text is waiting. */
export type AdminEdit = "all" | "review";

export interface AdminQuery {
  type: AdminType;
  status: AdminStatus;
  /** Category slugs, or "untagged". */
  cats: string[];
  funding: AdminFunding;
  edit: AdminEdit;
  /** Lowercased words and phrases, all of which must match. */
  words: string[];
}

export const ADMIN_STATUSES = ["pending", "approved", "rejected", "archived"] as const;
const TYPES = ["grant", "rfp"] as const;
const FUNDING = ["open", "funded"] as const;
export const UNTAGGED = "untagged";

const EDIT = ["review"] as const;

type Name = "type" | "status" | "cat" | "funding" | "edit";
const NAMES: readonly Name[] = ["type", "status", "cat", "funding", "edit"];

export function parseAdminQuery(q: string): { query: AdminQuery; problems: string[] } {
  const query: AdminQuery = {
    type: "all",
    status: "all",
    cats: [],
    funding: "all",
    edit: "all",
    words: [],
  };
  const problems: string[] = [];
  for (const raw of tokens(q)) {
    const m = qualifierOf(raw, NAMES);
    if (!m) {
      const word = wordOf(raw);
      if (word) query.words.push(word);
      continue;
    }
    const name = m.name as Name;
    const value = m.value;
    if (name === "type") {
      if ((TYPES as readonly string[]).includes(value)) query.type = value as AdminType;
      else problems.push(`Unknown type: ${m.rawValue}. Try ${orList(TYPES)}.`);
    } else if (name === "status") {
      if ((ADMIN_STATUSES as readonly string[]).includes(value)) {
        query.status = value as AdminStatus;
      } else problems.push(`Unknown status: ${m.rawValue}. Try ${orList(ADMIN_STATUSES)}.`);
    } else if (name === "funding") {
      if ((FUNDING as readonly string[]).includes(value)) query.funding = value as AdminFunding;
      else problems.push(`Unknown funding: ${m.rawValue}. Try ${orList(FUNDING)}.`);
    } else if (name === "edit") {
      if ((EDIT as readonly string[]).includes(value)) query.edit = value as AdminEdit;
      else problems.push(`Unknown edit: ${m.rawValue}. Try ${orList(EDIT)}.`);
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

/** The query with one qualifier set (a pill picked); see query-text's setQualifier. */
export const setQualifier = (q: string, name: Name, value: string | string[]): string =>
  setQualifierIn(q, name, value, NAMES);
