/**
 * An initiative as one markdown file in the content/initiatives format: the front
 * matter the sync reads, then the body under the site's headings. What the
 * sync imports comes back out the same way, so a page can be exported,
 * edited and pushed again.
 */
import type { Initiative, Pledge } from "../db/types.ts";
import { FIELDS, milestonesToMd, SECTIONS } from "../../shared/draft/mod.ts";
import { isStructured } from "../../shared/draft/normalise.ts";

/** A front-matter value: one line, or indented continuation lines. */
const value = (v: string) => v.replace(/\r?\n/g, " ").trim();

export interface MarkdownOptions {
  /** Admin export: status, proposer, and the private contact and funders. */
  privateFields?: boolean;
  /** Public facts for agents, as front-matter lines the content sync ignores. */
  extraFrontMatter?: string[];
}

export function initiativeMarkdown(
  r: Initiative,
  pledges: Pledge[],
  opts: MarkdownOptions = {},
): string {
  const fm: string[] = ["---", `title: ${value(r.title)}`, `type: ${r.type}`];
  if (opts.privateFields) {
    fm.push(`status: ${r.status}`);
    if (r.proposer) fm.push(`proposer: ${r.proposer}`);
  }
  if (r.type === "grant" && r.recipientTeam) {
    fm.push(`recipient: ${value(r.recipientTeam)}`);
    if (r.recipientUrl) fm.push(`recipient_url: ${r.recipientUrl}`);
  }
  fm.push(`goal: ${r.goalUsd}`);
  if (r.summary.trim()) fm.push(`summary: ${value(r.summary)}`);
  if (r.discourseUrl) fm.push(`forum: ${r.discourseUrl}`);
  if (r.durationMonths) fm.push(`duration: ${r.durationMonths}`);
  if (r.type === "grant" && r.topup) {
    fm.push("topup: true");
    if (r.milestoneReviewer) fm.push(`reviewer: ${value(r.milestoneReviewer)}`);
  }
  const backers = pledges.filter((p) => p.status !== "withdrawn" && p.company);
  if (backers.length) {
    fm.push("backers:");
    for (const p of backers) {
      fm.push(`  ${value(p.company)} | $${p.amountUsd}${p.url ? ` | ${p.url}` : ""}`);
    }
  }
  if (opts.privateFields) {
    // Never on the public file: the same two fields the admin JSON adds.
    if (r.contact.trim()) fm.push(`contact: ${value(r.contact)}`);
    if (r.funders.trim()) {
      fm.push("funders:");
      for (const line of r.funders.split(/\r?\n/)) if (line.trim()) fm.push(`  ${line.trim()}`);
    }
  }
  fm.push(...(opts.extraFrontMatter ?? []));
  fm.push("---");

  const body: string[] = [];
  if (isStructured(r)) {
    for (const key of SECTIONS[r.type]) {
      const text = (r.sections?.[key] ?? "").trim();
      if (text) body.push(`## ${FIELDS[key].heading}`, "", text, "");
    }
    if (r.milestones?.length) body.push("## Milestones", "", milestonesToMd(r.milestones), "");
    if (r.links?.length) body.push("## Links", "", ...r.links, "");
  } else if (r.details.trim()) {
    body.push(r.details.trim(), "");
  }
  return fm.join("\n") + "\n" + body.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
