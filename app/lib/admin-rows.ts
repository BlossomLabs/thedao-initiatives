import type { AdminInitiative, Summary } from "~/lib/api-types";
import { type AdminQuery, UNTAGGED } from "~/lib/admin-query";

type Row = { initiative: AdminInitiative; summary?: Pick<Summary, "total"> };
type Facet = "type" | "status" | "cats" | "funding";

/** Fully funded, as the board says it: raised at least the goal. */
const funded = ({ initiative: r, summary }: Row) =>
  Boolean(r.goalUsd && (summary?.total ?? 0) >= r.goalUsd);

/** One row against the query; `skip` leaves one facet out (for that pill's counts). */
function matches(row: Row, q: AdminQuery, skip?: Facet): boolean {
  const r = row.initiative;
  if (skip !== "type" && q.type !== "all" && r.type !== q.type) return false;
  if (skip !== "status" && q.status !== "all" && r.status !== q.status) return false;
  if (skip !== "funding" && q.funding !== "all" && funded(row) !== (q.funding === "funded")) {
    return false;
  }
  if (
    skip !== "cats" && q.cats.length &&
    !q.cats.some((c) => c === UNTAGGED ? !r.categories.length : r.categories.includes(c))
  ) return false;
  if (q.edit === "review" && !r.pendingRevision) return false;
  const text = `${r.title} ${r.contact ?? ""}`.toLowerCase();
  return q.words.every((w) => text.includes(w));
}

/**
 * The admin list: every qualifier (type, status, categories OR'd among
 * themselves, funding, an edit in review) and every word or phrase, matched against the project
 * name and the contact (name, email or handle).
 */
export const filterAdminRows = <T extends Row>(rows: T[], q: AdminQuery): T[] =>
  rows.filter((row) => matches(row, q));

/** Live counts for the pills: each facet counted with the other filters applied. */
export function adminFacetCounts(rows: Row[], q: AdminQuery) {
  const type = { all: 0, grant: 0, rfp: 0 };
  const status: Record<string, number> = {
    all: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    archived: 0,
  };
  const cats: Record<string, number> = {};
  for (const row of rows) {
    const r = row.initiative;
    if (matches(row, q, "type")) {
      type.all++;
      type[r.type]++;
    }
    if (matches(row, q, "status")) {
      status.all++;
      status[r.status] = (status[r.status] ?? 0) + 1;
    }
    if (matches(row, q, "cats")) {
      for (const c of r.categories) cats[c] = (cats[c] ?? 0) + 1;
    }
  }
  return { type, status, cats };
}

/** Approved initiatives by type: the same rows the board shows, so the numbers match it. */
export function approvedCounts(rows: Row[]) {
  const approved = rows.filter((x) => x.initiative.status === "approved");
  const grants = approved.filter((x) => x.initiative.type === "grant").length;
  return { total: approved.length, grants, rfps: approved.length - grants };
}
