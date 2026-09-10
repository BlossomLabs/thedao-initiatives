/** Word-level diff between two revisions, computed in the browser. */
import { diffWordsWithSpace } from "diff";
import type { RevisionText } from "./api-types";

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

export interface TextDiff {
  title: Chunk[];
  summary: Chunk[];
  details: Chunk[];
}

/** Diff of the three revisioned fields; `before` null means everything is new. */
export function diffRevisions(before: RevisionText | null, after: RevisionText): TextDiff {
  const b = before ?? { title: "", summary: "", details: "" };
  return {
    title: diffText(b.title, after.title),
    summary: diffText(b.summary, after.summary),
    details: diffText(b.details, after.details),
  };
}
