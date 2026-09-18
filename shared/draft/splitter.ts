import type { DraftType, Milestone, PageKey, SectionKey, SplitResult } from "./types.ts";
import { HEADING_RE, headingKey, PAGE_KEYS } from "./sections.ts";
import { parseAmount } from "./amount.ts";
import { parseMilestones } from "./milestones.ts";

const squeeze = (lines: string[]): string => lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** One pasted document -> page fields, sections, milestones, unsorted text. */
export function splitDraft(text: string, type: DraftType): SplitResult {
  const out: SplitResult = { page: {}, fields: {}, milestones: [], unsorted: "" };
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const buckets = new Map<string, string[]>();
  const msLines: string[] = [];
  const unsorted: string[] = [];
  let cur: string | null = null;
  for (const line of lines) {
    const h = HEADING_RE.exec(line);
    if (h) {
      const level = h[1].length;
      const name = h[2];
      if (level === 1 && !out.page.title) {
        out.page.title = name.replace(/^\s*(rfp|grant)\s*:\s*/i, "").trim();
        cur = null;
        continue;
      }
      if (cur === "milestones" && level >= 3) {
        msLines.push(line);
        continue;
      }
      const key = headingKey(name, type);
      if (key) {
        cur = key;
        const had = buckets.get(key);
        if (had && had.length && key !== "milestones") had.push("", `**${name.trim()}**`);
        if (!buckets.has(key)) buckets.set(key, []);
        continue;
      }
      if (cur && cur !== "milestones" && cur !== "unsorted" && level >= 3) {
        buckets.get(cur)!.push(`**${name}**`);
        continue;
      }
      cur = "unsorted";
      unsorted.push(line);
      continue;
    }
    if (cur === "milestones") msLines.push(line);
    else if (cur && cur !== "unsorted") buckets.get(cur)!.push(line);
    else unsorted.push(line);
  }
  for (const [k, v] of buckets) {
    if (k === "milestones") continue;
    const t = squeeze(v);
    if ((PAGE_KEYS as string[]).includes(k)) out.page[k as PageKey] = t;
    else out.fields[k as SectionKey] = t;
  }
  const { rows, preamble } = parseMilestones(msLines);
  out.milestones = rows;
  if (preamble) unsorted.push(preamble);
  out.unsorted = squeeze(unsorted);
  return out;
}

export interface PastedBacker {
  org: string;
  amountUsd: number;
  url: string;
  /** Optional 4th field: an image file name (content/initiatives/logos/<name>), pinned by the sync. */
  logo: string;
}

/** 'Org | $20,000 | https://...' lines -> backer rows (no logo: a pasted
 * draft never carries one, the proposer uploads the file). */
export function parseBackers(text: string): PastedBacker[] {
  const out: PastedBacker[] = [];
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/^[-*+]\s+/, "").trim();
    if (line.indexOf("|") <= 0) continue;
    const p = line.split("|");
    out.push({
      org: p[0].trim(),
      amountUsd: parseAmount(p[1] ?? ""),
      url: (p[2] ?? "").trim(),
      logo: (p[3] ?? "").trim(),
    });
  }
  return out;
}

export type { Milestone };
