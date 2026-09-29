/**
 * The paste box and the fields mirror each other. This file is the two
 * conversions: a draft rendered as the guide's paste format, and a draft
 * with its text half replaced from that format (categories included).
 * Everything the text cannot carry (type, top-up, reviewer, recipient URL, forum link, logos, the other
 * type's sections) is kept from the draft as it was.
 */
import {
  FIELDS,
  milestonesToMd,
  parseAmount,
  parseBackers,
  SECTIONS,
  type Sections,
  splitDraft,
  usd,
} from "@shared/draft/mod";
import { categoriesText, readCategoryText } from "@shared/categories";
import type { Draft, DraftBacker, DraftMilestone } from "./types";
import { draftMilestone, emptyBacker, emptyMilestone, money } from "./useDraft";

const intText = (raw: string): string => {
  const n = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
};

/** A heading the splitter does not know, so leftover lines that start with
 * plain text do not join the section above them on the way back. */
export const UNSORTED_HEADING = "## Unsorted";

const isBlankRow = (m: DraftMilestone): boolean =>
  !m.name.trim() && !parseAmount(m.amount) && !m.criteria.some((c) => c.text.trim());

/** The draft as one markdown document in the guide's order: what the box
 * shows once the fields hold something. Empty fields have no heading, so an
 * empty draft renders as "". */
export function renderDraft(d: Draft): string {
  const out: string[] = [];
  const put = (heading: string, body: string) => {
    if (body.trim()) out.push(`## ${heading}`, "", body.trim(), "");
  };
  put("Title", d.page.title);
  put("Short summary", d.page.summary);
  put("Categories", categoriesText(d.categories));
  const goal = parseAmount(d.page.goal);
  put("Funding goal (USD)", goal ? usd(goal) : "");
  put("Expected duration (months)", d.page.duration);
  if (d.type === "grant") put("Recipient team", d.page.recipientTeam);
  put(
    "Backers already committed",
    d.backers
      .filter((b) => b.org.trim() || parseAmount(b.amount) > 0)
      .map((b) => `${b.org.trim()} | ${usd(parseAmount(b.amount))} | ${b.url.trim()}`.trim())
      .join("\n"),
  );
  put("Links", d.page.links);
  for (const key of SECTIONS[d.type]) put(FIELDS[key].heading, d.sections[key] ?? "");
  const rows = d.milestones.filter((m) => !isBlankRow(m)).map((m) => ({
    name: m.name.trim(),
    amount: parseAmount(m.amount),
    adoption: m.adoption,
    done: d.topup && m.done,
    link: d.topup && m.done ? m.link.trim() : "",
    month: d.topup && !m.done ? m.month.trim() : "",
    criteria: m.criteria.map((c) => c.text.trim()).filter(Boolean),
  }));
  put("Milestones", milestonesToMd(rows));
  put("Who is likely to fund this", d.priv.funders);
  put("Contact", d.priv.contact);
  const stray = d.unsorted.trim();
  if (stray) {
    if (!/^#{1,6}\s/.test(stray)) out.push(UNSORTED_HEADING, "");
    out.push(stray, "");
  }
  return out.join("\n").trim();
}

/** Backer rows from the text, keeping the id and logo of a row the draft
 * already had for the same organization. */
function mergeBackers(had: DraftBacker[], text: string): DraftBacker[] {
  const pool = [...had];
  return parseBackers(text).map((b) => {
    const i = pool.findIndex((h) => h.org.trim().toLowerCase() === b.org.trim().toLowerCase());
    const base = i >= 0 ? pool.splice(i, 1)[0] : emptyBacker();
    return { ...base, org: b.org, amount: money(b.amountUsd), url: b.url };
  });
}

/** Milestone rows from the text, keeping ids by position so the rows and
 * their criteria inputs keep their identity while the text is edited. */
function mergeMilestones(had: DraftMilestone[], rows: DraftMilestone[]): DraftMilestone[] {
  return rows.map((m, i) => {
    const h = had[i];
    if (!h) return m;
    return {
      ...m,
      id: h.id,
      criteria: m.criteria.map((c, j) => h.criteria[j] ? { ...c, id: h.criteria[j].id } : c),
    };
  });
}

/** The draft with its text half replaced by what the box holds: a heading
 * that is missing from the text empties its field. */
export function replaceFromText(d: Draft, text: string): Draft {
  const res = splitDraft(text, d.type);
  const p = res.page;
  const page = {
    ...d.page,
    title: p.title ?? "",
    summary: p.summary ?? "",
    goal: money(parseAmount(p.goal ?? "")),
    duration: intText(p.duration ?? ""),
    links: p.links ?? "",
    recipientTeam: d.type === "grant" ? p.recipient ?? "" : d.page.recipientTeam,
  };
  const priv = { funders: p.funders ?? "", contact: p.contact ?? "" };
  const sections: Sections = { ...d.sections };
  for (const key of SECTIONS[d.type]) {
    const t = res.fields[key];
    if (t) sections[key] = t;
    else delete sections[key];
  }
  const rows = res.milestones.map(draftMilestone);
  const milestones = rows.length ? mergeMilestones(d.milestones, rows) : [emptyMilestone()];
  const backers = mergeBackers(d.backers, p.backers ?? "");
  const categories = readCategoryText(p.categories ?? "").slugs;
  return { ...d, page, priv, categories, sections, milestones, backers, unsorted: res.unsorted };
}

/** Whether the box text already says what the draft says, so a draft change
 * that came from the box itself does not rewrite the box. */
export function textMatchesDraft(d: Draft, text: string): boolean {
  return renderDraft(replaceFromText(d, text)) === renderDraft(d);
}
