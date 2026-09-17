import type { DraftType, Milestone, SectionKey, Sections, Structured } from "./types.ts";
import { SECTION_KEYS, SECTIONS, stripInlineHeadings } from "./sections.ts";
import { parseAmount } from "./amount.ts";

/** Caps on the structured body. A row and each of its revisions is one Deno
 * KV value (64 KiB), so the byte cap is what really bounds it; the per-field
 * caps keep single answers readable. */
export const LIMITS = {
  SECTION_CHARS: 8000,
  SECTIONS_TOTAL_CHARS: 30_000,
  TITLE_CHARS: 140,
  SUMMARY_CHARS: 4000,
  FUNDERS_CHARS: 4000,
  CONTACT_CHARS: 200,
  RECIPIENT_CHARS: 120,
  REVIEWER_CHARS: 200,
  MILESTONES: 24,
  MILESTONE_NAME: 150,
  CRITERIA_PER_MILESTONE: 20,
  CRITERION_CHARS: 1000,
  LINK_CHARS: 300,
  LINKS: 20,
  BACKERS: 12,
  BACKER_ORG: 120,
  BACKER_URL: 300,
  LOGO_CID: 100,
  STRUCTURED_BYTES: 40_000,
} as const;

export const TOO_LONG_MSG =
  "The sections, milestones and links together are too long (limit about 40,000 characters).";

/** The one "too long" wording for every capped field. Normalisers keep one
 * character past the cap so the checks can report this instead of the field
 * losing its tail in silence (2026-09-17: 19 criteria cut at 300). */
export const tooLong = (label: string, cap: number): string =>
  `${label} is too long (${cap.toLocaleString("en-US")} characters at most).`;

export const criterionTooLong = (letter: string, j: number): string =>
  `Milestone ${letter}, criterion ${j + 1} is too long (${
    LIMITS.CRITERION_CHARS.toLocaleString("en-US")
  } characters at most). Split it into two rows.`;

const clip = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);

/** Trim, strip inline headings, clip, drop empty and other-type keys.
 * Keys come out in SECTION_KEYS order so equality is stable. */
export function normaliseSections(raw: unknown, type: DraftType): Sections {
  const out: Sections = {};
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const allowed = new Set<SectionKey>(SECTIONS[type]);
  for (const key of SECTION_KEYS) {
    if (!allowed.has(key)) continue;
    const text = stripInlineHeadings(String(src[key] ?? "")).slice(0, LIMITS.SECTION_CHARS + 1);
    if (text) out[key] = text;
  }
  return out;
}

export function normaliseMilestones(raw: unknown): Milestone[] {
  if (!Array.isArray(raw)) return [];
  const out: Milestone[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const m = r as Record<string, unknown>;
    out.push({
      name: clip(m.name, LIMITS.MILESTONE_NAME + 1),
      amount: Math.round(parseAmount(m.amount) * 100) / 100,
      adoption: Boolean(m.adoption),
      done: Boolean(m.done),
      link: clip(m.link, LIMITS.LINK_CHARS + 1),
      month: clip(m.month, 7),
      criteria: (Array.isArray(m.criteria) ? m.criteria : [])
        .map((c) => clip(c, LIMITS.CRITERION_CHARS + 1))
        .filter(Boolean)
        .slice(0, LIMITS.CRITERIA_PER_MILESTONE + 1),
    });
  }
  return out.slice(0, LIMITS.MILESTONES + 1);
}

/** A newline-separated string or an array; trimmed, deduped, clipped. */
export function normaliseLinks(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split("\n");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of list) {
    const t = l.trim().slice(0, LIMITS.LINK_CHARS + 1);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, LIMITS.LINKS + 1);
}

export function normaliseStructured(
  raw: { sections?: unknown; milestones?: unknown; links?: unknown },
  type: DraftType,
): Structured {
  return {
    sections: normaliseSections(raw.sections, type),
    milestones: normaliseMilestones(raw.milestones),
    links: normaliseLinks(raw.links),
  };
}

const enc = new TextEncoder();

/** UTF-8 size of the structured body as stored. */
export function structuredBytes(s: Structured): number {
  return enc.encode(JSON.stringify(canonical(s))).length;
}

const canonical = (s: Structured) => ({
  sections: SECTION_KEYS.filter((k) => s.sections?.[k]).map((k) => [k, s.sections[k]]),
  milestones: (s.milestones ?? []).map((m) => [
    m.name,
    m.amount,
    m.adoption,
    m.done,
    m.link,
    m.month,
    m.criteria,
  ]),
  links: s.links ?? [],
});

/** Deep equality on the canonical shape (key order and empties ignored). */
export function sameStructured(a: Structured, b: Structured): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export const isStructured = (s: Pick<Structured, "sections" | "milestones"> | null | undefined) =>
  Boolean(
    s && (Object.values(s.sections ?? {}).some((v) => v && v.trim()) ||
      (s.milestones?.length ?? 0) > 0),
  );
