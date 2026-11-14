/** Ballots as YAML, one key per tier, project ids are the round's slugs:
 *
 *     S-Tier:
 *       - evm
 *       - vyper
 *     A-Tier: []
 *     B-Tier:
 *       - wallets
 *
 * No voter id and no project names. Anything not listed is unranked. Reading a paste
 * also takes `S`, `A` and `B` as keys, the flow form (`S-Tier: [evm, vyper]`), comments,
 * and a code fence around it (an LLM's answer often comes in one). When it isn't YAML
 * (prose around it, or copied from a rendered chat that dropped the `- ` bullets), each
 * tier heading line collects the slugs below it, and a note after a slug is ignored. */
import { type Tier, tierName, TIERS } from "./ballot.ts";

type Tiers = Partial<Record<string, Tier>>;
type Read = { tiers: Tiers } | { error: string };

/** `S-Tier`, `S tier`, `S`, `**S-Tier**`, `## S-Tier`; `C-Tier` is a tier, just not ours. */
const TIER_KEY = /^([a-z])(?:[-\s]*tier)?$/i;
const tierOf = (key: string): Tier | null | undefined => {
  const m = TIER_KEY.exec(key.replace(/^#+\s*|[*_`]/g, "").trim());
  if (!m) return undefined;
  const t = m[1].toUpperCase();
  return (TIERS as readonly string[]).includes(t) ? t as Tier : null;
};
/** Markdown or punctuation an LLM might wrap a slug in. */
const cleanSlug = (s: string) => s.trim().replace(/^[`*_"']+|[`*_"',;.:]+$/g, "");

/** The first fenced block's body, or the whole text. */
function unfence(text: string): string {
  const m = /```[^\n]*\n([\s\S]*?)```/.exec(text);
  return m ? m[1] : text;
}

function collect(groups: [string, unknown[]][], slugs: string[]): Read {
  const known = new Set(slugs);
  const tiers: Tiers = {};
  for (const [key, items] of groups) {
    const tier = tierOf(key);
    if (!tier) return { error: `Unknown tier: ${key}. Use S-Tier, A-Tier or B-Tier.` };
    for (const item of items) {
      const id = cleanSlug(String(item));
      if (!id) continue;
      if (!known.has(id)) return { error: `Unknown project: ${id}` };
      if (tiers[id]) return { error: `${id} is listed twice` };
      tiers[id] = tier;
    }
  }
  if (!Object.keys(tiers).length) return { error: "No vote found." };
  return { tiers };
}

/** A tier's value: a list, one slug, `a, b` in one string, or nothing. */
const items = (v: unknown): unknown[] =>
  v == null ? [] : Array.isArray(v) ? v : String(v).split(",");

/** Not YAML: tier heading lines (`S-Tier:`, `## S-Tier`, `S-Tier: evm, vyper`), each
 * followed by its slugs, one per line, with or without a bullet. Lines before the first
 * heading, and lines of several words that aren't `slug — note`, are skipped. */
function readLoose(text: string, slugs: string[]): Read {
  const groups: [string, string[]][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("```")) continue;
    // The heading alone, or followed right away by `:` and its slugs.
    const head = /^(#*\s*\**\s*[a-z](?:[-\s]*tier)?(?![a-z0-9])\s*\**)\s*(:?)\s*(.*)$/i.exec(line);
    if (head && tierOf(head[1]) !== undefined && (head[3] === "" || head[2])) {
      const inline = head[3].replace(/^\[|\]$/g, "");
      groups.push([head[1].replace(/^#+\s*|[*_`]/g, "").trim(), inline ? inline.split(",") : []]);
      continue;
    }
    if (!groups.length) continue;
    const item = /^(?:(?:[-*•]|\d+[.)])\s+)?(\S+)(?:\s+(?:[—–-]|#|\().*)?$/.exec(line);
    if (item) groups[groups.length - 1][1].push(item[1]);
  }
  return groups.length ? collect(groups, slugs) : { error: "No vote found." };
}

/** Reads a pasted ballot. Async: the YAML parser loads only when someone pastes. */
export async function parseBallotText(text: string, slugs: string[]): Promise<Read> {
  const body = unfence(text.replace(/\r/g, ""));
  if (!body.trim()) return { error: "No vote found." };
  const { parse } = await import("yaml");
  let doc: unknown;
  try {
    doc = parse(body);
  } catch {
    doc = undefined;
  }
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const entries = Object.entries(doc as Record<string, unknown>);
    // Every key a tier (ours or not): it's a ballot. Otherwise prose got mixed in.
    if (entries.length && entries.every(([k]) => tierOf(k) !== undefined)) {
      return collect(entries.map(([k, v]) => [k, items(v)]), slugs);
    }
  }
  return readLoose(body, slugs);
}

/** A paste-ready ballot: every tier, S-Tier first, round order within a tier. */
export function formatBallotText(tiers: Tiers, slugs: string[]): string {
  return TIERS.map((t) => {
    const ids = slugs.filter((s) => tiers[s] === t);
    const key = `${tierName(t)}:`;
    return ids.length ? [key, ...ids.map((s) => `  - ${s}`)].join("\n") : `${key} []`;
  }).join("\n");
}
