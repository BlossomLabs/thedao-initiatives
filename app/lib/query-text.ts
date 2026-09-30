/**
 * The text behind the search boxes that take qualifiers (`type:grant cat:opsec
 * First QA`), shared by the admin list and the board: tokens, which of them are
 * qualifiers, and rewriting one qualifier or the words without touching the rest.
 */

/** Raw tokens: "quoted phrases" or runs of non-space, in order. */
export const tokens = (q: string): string[] => q.match(/"[^"]*"?|\S+/g) ?? [];

/** A token read as `name:value` when `name` is one of `names` (any case), else null. */
export function qualifierOf(
  raw: string,
  names: readonly string[],
): { name: string; value: string; rawValue: string } | null {
  const i = raw.indexOf(":");
  if (i < 1 || raw.startsWith('"')) return null;
  const name = raw.slice(0, i).toLowerCase();
  if (!names.includes(name)) return null;
  const rawValue = raw.slice(i + 1);
  return { name, value: rawValue.toLowerCase(), rawValue };
}

/** A word or "quoted phrase", lowercased, quotes dropped; "" for an empty phrase. */
export const wordOf = (raw: string): string =>
  raw.startsWith('"') ? raw.replace(/^"|"$/g, "").trim().toLowerCase() : raw.toLowerCase();

/** "a, b or c" for the hints under a box. */
export const orList = (xs: readonly string[]) =>
  xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}` : xs[0];

/**
 * The query with one qualifier set (a pill picked): it replaces that qualifier
 * where it first stood, or is appended; "all" or an empty list removes it.
 * Words, phrases and other qualifiers keep their text and order.
 */
export function setQualifier(
  q: string,
  name: string,
  value: string | string[],
  names: readonly string[],
): string {
  const text = Array.isArray(value) ? value.join(",") : value;
  const next = text && text !== "all" ? `${name}:${text}` : null;
  const out: string[] = [];
  let placed = false;
  for (const raw of tokens(q)) {
    if (qualifierOf(raw, names)?.name === name) {
      if (next && !placed) out.push(next);
      placed = true;
      continue;
    }
    out.push(raw);
  }
  if (next && !placed) out.push(next);
  return out.join(" ");
}

/** The query's qualifiers kept as they are, its words replaced by `words` (at the start). */
export function withWords(q: string, words: string, names: readonly string[]): string {
  const quals = tokens(q).filter((raw) => qualifierOf(raw, names));
  return [words.trim(), ...quals].filter(Boolean).join(" ");
}
