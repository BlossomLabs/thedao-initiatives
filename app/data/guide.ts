/**
 * The proposer's guide (public/submit.md, served as-is at /submit.md), bundled
 * so the copy button needs no fetch, and its two ```markdown blocks sorted
 * with the real splitter: the gold-standard RFP gives every RFP section, the
 * funding goal and the milestones their example; the second block gives the
 * three grant-only sections theirs.
 */
import raw from "../../public/submit.md?raw";
import {
  type Milestone,
  type PageKey,
  SECTION_KEYS,
  type SectionKey,
  type Sections,
  splitDraft,
} from "@shared/draft/mod";

export const GUIDE_TEXT: string = raw;

const FENCE_RE = /```markdown\r?\n([\s\S]*?)```/g;

/** The ```markdown blocks of the guide, in order. */
export function markdownBlocks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FENCE_RE)) out.push(m[1].trim());
  return out;
}

const blocks = markdownBlocks(raw);
const rfp = splitDraft(blocks[0] ?? "", "rfp");
const grant = splitDraft(blocks[1] ?? "", "grant");

/** One example per section key, both types. */
export const EXAMPLES: Sections = (() => {
  const out: Sections = {};
  for (const key of SECTION_KEYS) {
    const t = rfp.fields[key] || grant.fields[key];
    if (t) out[key] = t;
  }
  return out;
})();

export const EXAMPLE_PAGE: Partial<Record<PageKey, string>> = rfp.page;
export const EXAMPLE_MILESTONES: Milestone[] = rfp.milestones;

export const EXAMPLE_FALLBACK =
  "The gold-standard example is an RFP; see the guide for a grant example of this section.";

/** The example text for a section, or the fallback line. */
export function exampleFor(key: SectionKey): { text: string; fallback: boolean } {
  const t = EXAMPLES[key];
  return t ? { text: t, fallback: false } : { text: EXAMPLE_FALLBACK, fallback: true };
}
