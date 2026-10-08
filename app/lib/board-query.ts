import type { BoardStatus, BoardType, BoardView } from "~/lib/board-view";
import { categoryOf } from "~/lib/categories";
import { orList, qualifierOf, setQualifier, tokens, withWords, wordOf } from "~/lib/query-text";

/**
 * The board's search box as filters: `type:grant cat:opsec,defi funding:open`
 * move the pills, every other word must match (the keyword filter). The same
 * shape as the admin list's box.
 */
export interface BoardQuery {
  type: BoardType;
  cats: string[];
  status: BoardStatus;
  words: string[];
}

type Name = "type" | "cat" | "funding";
export const BOARD_QUALIFIERS: readonly Name[] = ["type", "cat", "funding"];
const TYPES = ["grant", "rfp"] as const;
const FUNDING = ["open", "funded", "qualified"] as const;

export function parseBoardQuery(q: string): { query: BoardQuery; problems: string[] } {
  const query: BoardQuery = { type: "all", cats: [], status: "all", words: [] };
  const problems: string[] = [];
  for (const raw of tokens(q)) {
    const m = qualifierOf(raw, BOARD_QUALIFIERS);
    if (!m) {
      const word = wordOf(raw);
      if (word) query.words.push(word);
      continue;
    }
    if (m.name === "type") {
      if ((TYPES as readonly string[]).includes(m.value)) query.type = m.value as BoardType;
      else problems.push(`Unknown type: ${m.rawValue}. Try ${orList(TYPES)}.`);
    } else if (m.name === "funding") {
      if ((FUNDING as readonly string[]).includes(m.value)) query.status = m.value as BoardStatus;
      else problems.push(`Unknown funding: ${m.rawValue}. Try ${orList(FUNDING)}.`);
    } else {
      for (const slug of m.value.split(",").filter(Boolean)) {
        if (!categoryOf(slug)) problems.push(`Unknown category: ${slug}.`);
        else if (!query.cats.includes(slug)) query.cats.push(slug);
      }
    }
  }
  return { query, problems };
}

/** The box text with one qualifier set (a pill picked); words and the rest stay. */
export const setBoardQualifier = (q: string, name: Name, value: string | string[]): string =>
  setQualifier(q, name, value, BOARD_QUALIFIERS);

/** The box text with its words replaced (the keyword filter changed elsewhere). */
export const setBoardWords = (q: string, words: string): string =>
  withWords(q, words, BOARD_QUALIFIERS);

/** The box text for a view: its keyword words, then its qualifiers. */
export function boardQueryText(v: Pick<BoardView, "q" | "type" | "cats" | "status">): string {
  let text = v.q.trim();
  text = setBoardQualifier(text, "type", v.type);
  text = setBoardQualifier(text, "cat", v.cats);
  return setBoardQualifier(text, "funding", v.status);
}
