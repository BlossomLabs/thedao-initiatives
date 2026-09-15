import type { DraftType, Structured } from "./types.ts";
import { FIELDS, SECTIONS } from "./sections.ts";
import { renderMilestonesMd } from "./milestones.ts";

/** The structured body as one markdown document, in page order: used for
 * previews, revision diffs and anywhere a single text is easier to handle. */
export function renderStructuredMd(s: Structured, type: DraftType, topup: boolean): string {
  const out: string[] = [];
  for (const key of SECTIONS[type]) {
    const text = (s.sections[key] ?? "").trim();
    if (!text) continue;
    out.push(`## ${FIELDS[key].heading}`, "", text, "");
  }
  if (s.milestones.length) {
    out.push(`## ${type === "grant" ? "Milestones" : "Milestones (draft)"}`, "");
    out.push(renderMilestonesMd(s.milestones, topup), "");
  }
  if (s.links.length) {
    out.push("## Links", "");
    for (const l of s.links) out.push(`- <${l}>`);
  }
  return out.join("\n").trim();
}
