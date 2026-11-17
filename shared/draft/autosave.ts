/** Incomplete form drafts are private, wallet-owned records, not submissions. */
export const AUTOSAVE_MAX_BYTES = 256 * 1024;
export const AUTOSAVE_TTL_SECS = 30 * 24 * 3600;
export interface SavedDraft {
  version: string | null;
  data: Record<string, unknown> | null;
}

/** Bounded plain JSON only. Form-specific revival supplies missing defaults. */
export function validAutosave(value: unknown): value is Record<string, unknown> {
  const visit = (v: unknown, depth: number): boolean => {
    if (depth > 8) return false;
    if (v === null || typeof v === "string" || typeof v === "boolean") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (Array.isArray(v)) return v.length <= 128 && v.every((x) => visit(x, depth + 1));
    if (typeof v !== "object") return false;
    return Object.keys(v).length <= 64 &&
      Object.entries(v).every(([key, x]) =>
        !["__proto__", "constructor", "prototype"].includes(key) && visit(x, depth + 1)
      );
  };
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) =>
      [
        "type",
        "topup",
        "categories",
        "milestoneReviewer",
        "page",
        "sections",
        "milestones",
        "backers",
        "priv",
        "unsorted",
      ].includes(key)
    ) && visit(value, 0);
}
