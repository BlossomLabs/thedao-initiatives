/** Word-level diff between two revisions, computed in the browser. */
import { diffWordsWithSpace } from "diff";
import {
  FIELDS,
  isStructured,
  milestonesToMd,
  SECTION_KEYS,
  type SectionKey,
  SECTIONS,
} from "@shared/draft/mod";
import type { InitiativeType, RevisionText } from "./api-types";

export interface Chunk {
  value: string;
  added: boolean;
  removed: boolean;
}

export function diffText(before: string, after: string): Chunk[] {
  return diffWordsWithSpace(before, after).map((c) => ({
    value: c.value,
    added: Boolean(c.added),
    removed: Boolean(c.removed),
  }));
}

export const changed = (chunks: Chunk[]): boolean => chunks.some((c) => c.added || c.removed);

export interface SectionDiff {
  key: SectionKey;
  heading: string;
  chunks: Chunk[];
}

export interface TextDiff {
  title: Chunk[];
  summary: Chunk[];
  details: Chunk[];
  /** Type order first, then keys only one side had (after a type switch). */
  sections: SectionDiff[];
  /** Diff of the milestones in their edit format (`milestonesToMd`). */
  milestones: Chunk[];
  /** One line per link. */
  links: Chunk[];
  /** Either side is a structured row. */
  structured: boolean;
}

const EMPTY: RevisionText = {
  title: "",
  summary: "",
  details: "",
  sections: {},
  milestones: [],
  links: [],
};

/** Diff of the revisioned fields; `before` null means everything is new. */
export function diffRevisions(
  before: RevisionText | null,
  after: RevisionText,
  type: InitiativeType = "rfp",
): TextDiff {
  const b = { ...EMPTY, ...(before ?? {}) };
  const a = { ...EMPTY, ...after };
  const bs = b.sections ?? {};
  const as = a.sections ?? {};
  const present = (k: SectionKey) => Boolean(bs[k]?.trim() || as[k]?.trim());
  const keys: SectionKey[] = [
    ...SECTIONS[type],
    ...SECTION_KEYS.filter((k) => !SECTIONS[type].includes(k)),
  ].filter(present);
  return {
    title: diffText(b.title ?? "", a.title ?? ""),
    summary: diffText(b.summary ?? "", a.summary ?? ""),
    details: diffText(b.details ?? "", a.details ?? ""),
    sections: keys.map((key) => ({
      key,
      heading: FIELDS[key].heading,
      chunks: diffText(bs[key] ?? "", as[key] ?? ""),
    })),
    milestones: diffText(milestonesToMd(b.milestones ?? []), milestonesToMd(a.milestones ?? [])),
    links: diffText((b.links ?? []).join("\n"), (a.links ?? []).join("\n")),
    structured: isStructured(b) || isStructured(a),
  };
}
