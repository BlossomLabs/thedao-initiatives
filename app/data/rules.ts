/**
 * The process rules ("How RFPs work", "How grants work", "How top-up grants
 * work") live in content/boilerplate/*.md, one file per kind, and render as a
 * panel on every initiative page. Same file shape as donation-terms.md: a
 * `version:` first line, then markdown whose first heading is the panel title.
 * Bundled at build time (Vite ?raw), like app/data/terms.ts.
 */
import rfpRaw from "../../content/boilerplate/rfp.md?raw";
import grantRaw from "../../content/boilerplate/grant.md?raw";
import topupRaw from "../../content/boilerplate/topup.md?raw";
import type { Initiative } from "~/lib/api-types";

export type RulesKind = "rfp" | "grant" | "topup";

export interface RulesPanel {
  kind: RulesKind;
  title: string;
  version: string;
  body: string;
}

const VERSION_RE = /^version:[ \t]*(\S+)[ \t]*\r?\n/i;
const TITLE_RE = /^\s*#\s*(.+?)\s*\n/;

export function parseRulesFile(kind: RulesKind, text: string): RulesPanel {
  const v = VERSION_RE.exec(text);
  if (!v) throw new Error(`content/boilerplate/${kind}.md: first line must be \`version: <id>\``);
  let rest = text.slice(v[0].length);
  const t = TITLE_RE.exec(rest);
  if (!t) throw new Error(`content/boilerplate/${kind}.md: a \`# Title\` heading must follow`);
  rest = rest.slice(t[0].length);
  const body = rest.trim();
  if (!body) throw new Error(`content/boilerplate/${kind}.md: rules body is empty`);
  return { kind, title: t[1], version: v[1].slice(0, 40), body };
}

export const RULES: Record<RulesKind, RulesPanel> = {
  rfp: parseRulesFile("rfp", rfpRaw),
  grant: parseRulesFile("grant", grantRaw),
  topup: parseRulesFile("topup", topupRaw),
};

/** Which panel an initiative gets: top-up / grant / rfp. */
export function rulesKindFor(r: Pick<Initiative, "type" | "topup">): RulesKind {
  if (r.type === "grant") return r.topup ? "topup" : "grant";
  return "rfp";
}
