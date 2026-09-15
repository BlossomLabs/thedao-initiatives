import type { Milestone, Sections } from "./types.ts";
import { SECTION_KEYS } from "./sections.ts";

/** The duplicate check compares the concatenated section text plus the
 * milestone names and criteria, whitespace-normalized. */
export function bodyKey(sections: Sections, milestones: Milestone[]): string {
  const parts: string[] = SECTION_KEYS.map((k) => sections[k] ?? "");
  for (const m of milestones ?? []) {
    parts.push(m.name ?? "");
    parts.push(...(m.criteria ?? []));
  }
  return parts.join("\n").replace(/\s+/g, " ").trim().toLowerCase();
}
