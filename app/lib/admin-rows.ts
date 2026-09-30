import type { AdminInitiative } from "~/lib/api-types";

type Row = { initiative: AdminInitiative };

/**
 * The admin list's filters: the category ("all", "untagged" or a slug) and one
 * search box that matches, word by word and case-insensitively, the project name
 * and the contact (name, email or handle).
 */
export function filterAdminRows<T extends Row>(rows: T[], category: string, search: string): T[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(({ initiative: r }) =>
    (category === "all" ||
      (category === "untagged" ? !r.categories.length : r.categories.includes(category))) &&
    words.every((w) => `${r.title} ${r.contact ?? ""}`.toLowerCase().includes(w))
  );
}

/** Approved initiatives by type: the same rows the board shows, so the numbers match it. */
export function approvedCounts(rows: Row[]) {
  const approved = rows.filter((x) => x.initiative.status === "approved");
  const grants = approved.filter((x) => x.initiative.type === "grant").length;
  return { total: approved.length, grants, rfps: approved.length - grants };
}
