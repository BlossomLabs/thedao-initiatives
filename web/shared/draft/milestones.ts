import type { Milestone } from "./types.ts";
import { parseAmount, usd } from "./amount.ts";
import { letter } from "./sections.ts";

export const emptyMilestone = (): Milestone => ({
  name: "",
  amount: 0,
  adoption: false,
  done: false,
  link: "",
  month: "",
  criteria: [],
});

/** The amount in a heading segment: the first number in it, so
 * "$85,500 (target: March 2027)" reads 85500, not 855002027. */
const segmentAmount = (seg: string): number => {
  const m = /\d[\d.,]*/.exec(seg);
  return m ? parseAmount(m[0]) : 0;
};

/** '### Agreed standard - $50,000 (adoption)' -> a milestone row. A leading
 * 'A - ' from the old format is accepted and dropped. */
export function rowFromHeading(s: string): Milestone {
  const row = emptyMilestone();
  let t = String(s).trim();
  if (/\(adoption( milestone)?\)/i.test(t)) {
    row.adoption = true;
    t = t.replace(/\(adoption( milestone)?\)/gi, "").trim();
  }
  if (/\(done\)/i.test(t)) {
    row.done = true;
    t = t.replace(/\(done\)/gi, "").trim();
  }
  t = t.replace(/[*_`]/g, "").trim();
  const parts = t.split(/\s+-\s+/);
  const lastAmount = parts.length >= 2 ? segmentAmount(parts[parts.length - 1]) : 0;
  if (parts.length >= 3 && parts[0].trim().length <= 3) {
    row.amount = lastAmount;
    row.name = parts.slice(1, -1).join(" - ").trim();
  } else if (parts.length >= 2 && lastAmount > 0) {
    row.amount = lastAmount;
    row.name = parts.slice(0, -1).join(" - ").trim();
  } else row.name = t;
  return row;
}

/** Milestone headings (## or deeper) become rows; bullet lines under them
 * become criteria. Lines before the first heading are the preamble. */
export function parseMilestones(lines: string[]): { rows: Milestone[]; preamble: string } {
  const rows: Milestone[] = [];
  const preamble: string[] = [];
  let cur: Milestone | null = null;
  for (const line of lines) {
    const h = /^#{2,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      cur = rowFromHeading(h[1]);
      rows.push(cur);
      continue;
    }
    const t = line.trim();
    if (!t) continue;
    if (!cur) {
      preamble.push(line);
      continue;
    }
    const mm = /^target month:\s*(\d{4}-\d{2})\b/i.exec(t);
    if (mm) {
      cur.month = mm[1];
      continue;
    }
    const dl = /^delivered:\s*<?([^\s>]+)>?/i.exec(t);
    if (dl) {
      cur.link = dl[1];
      continue;
    }
    const crit = t.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/^\[[ xX]\]\s*/, "")
      .trim();
    if (crit) cur.criteria.push(crit);
  }
  return { rows, preamble: preamble.join("\n").trim() };
}

/** The paste/edit format (what the guide asks for), the inverse of
 * parseMilestones: '### Name - $50,000 (adoption)', Target month, Delivered,
 * one bullet per criterion. */
export function milestonesToMd(rows: Milestone[]): string {
  const out: string[] = [];
  for (const m of rows) {
    let head = `### ${m.name || "Unnamed"} - ${usd(m.amount || 0)}`;
    if (m.adoption) head += " (adoption)";
    if (m.done) head += " (done)";
    out.push(head);
    if (m.month) out.push(`Target month: ${m.month}`);
    if (m.link) out.push(`Delivered: ${m.link}`);
    for (const c of m.criteria) out.push(`- ${c}`);
    out.push("");
  }
  return out.join("\n").trim();
}

/** The public page markdown: '### A - Name - $50,000 (adoption milestone)',
 * a checkbox list, target months on top-ups, done rows checked with their
 * link. Used for previews and revision diffs; the page itself renders rows. */
export function renderMilestonesMd(rows: Milestone[], topup: boolean): string {
  const out: string[] = [];
  rows.forEach((m, i) => {
    let head = `### ${letter(i)} - ${m.name || "Unnamed"} - ${usd(m.amount || 0)}`;
    if (m.adoption) head += " (adoption milestone)";
    if (topup && m.done) head += " (done)";
    out.push(head, "");
    if (topup && !m.done && m.month) out.push(`Target month: ${m.month}`, "");
    const box = topup && m.done ? "[x]" : "[ ]";
    for (const c of m.criteria) out.push(`- ${box} ${c}`);
    if (topup && m.done && m.link) out.push("", `Delivered: <${m.link}>`);
    out.push("");
  });
  return out.join("\n").trim();
}

export const milestonesTotal = (rows: Milestone[]): number =>
  rows.reduce((a, m) => a + (Number(m.amount) || 0), 0);

export const adoptionTotal = (rows: Milestone[]): number =>
  rows.reduce((a, m) => a + (m.adoption ? Number(m.amount) || 0 : 0), 0);
