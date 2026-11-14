import { useId, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import ConfirmPrivateFields from "~/components/admin/ConfirmPrivateFields";
import BulkBar, { type BulkResult, HeadCheck, RowCheck } from "~/components/admin/BulkBar";
import AdminFilters from "~/components/admin/AdminFilters";
import SafeSyncIcon from "~/components/admin/SafeSyncIcon";
import { StatusChip, TypeBadge } from "~/components/ui/Badge";
import { CategoryTag } from "~/components/ui/CategoryTag";
import Skeleton from "~/components/ui/Skeleton";
import { useAdminApi } from "~/hooks/use-admin-api";
import { useSelection } from "~/hooks/use-selection";
import { errorMessage } from "~/lib/api";
import { adminFacetCounts, filterAdminRows } from "~/lib/admin-rows";
import { parseAdminQuery, setQualifier, UNTAGGED } from "~/lib/admin-query";
import { usd } from "~/lib/format";
import { listKey, useAdminList } from "./queries";

/**
 * Every initiative with the filters and bulk actions. Its rows come from their
 * own request, after the to-do list has painted; a skeleton holds the place.
 */
/** The table's place while its rows load: the search bar, then a few rows. */
function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Loading initiatives">
      <Skeleton className="h-10 rounded-[14px]" />
      <Skeleton className="h-7 w-2/3" />
      {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-9" />)}
    </div>
  );
}

export default function AllInitiatives({ total }: { total: number }) {
  const id = useId();
  const adminApi = useAdminApi();
  const qc = useQueryClient();
  const { data, isLoading, error } = useAdminList();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const setQ = (next: string) =>
    setParams((p) => {
      const out = new URLSearchParams(p);
      if (next.trim()) out.set("q", next);
      else out.delete("q");
      return out;
    }, { replace: true, preventScrollReset: true });
  const parsed = useMemo(() => parseAdminQuery(q), [q]);
  const all = useMemo(() => data?.rows ?? [], [data?.rows]);
  const rows = useMemo(() => filterAdminRows(all, parsed.query), [all, parsed]);
  const facetCounts = useMemo(() => adminFacetCounts(all, parsed.query), [all, parsed]);
  const inReview = all.filter((x) => x.initiative.pendingRevision).length;
  const rowIds = useMemo(() => rows.map((r) => r.initiative.id), [rows]);
  const rowSel = useSelection(rowIds);
  const bulk = async (action: string, ids: string[]) => {
    const r = await adminApi<BulkResult>("/api/admin/initiatives/bulk", { json: { ids, action } });
    await qc.invalidateQueries({ queryKey: ["admin"] });
    return r;
  };
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-edge bg-card">
      <div className="flex flex-wrap items-center gap-2.5 px-4 py-3.5">
        <h2 id={id} className="m-0 font-inter-tight text-[15px] font-semibold">All initiatives</h2>
        <span className="small dim tnum">{total}</span>
      </div>
      <div className="px-4 pb-4">
        {isLoading ? <TableSkeleton /> : error || !data
          ? (
            <p className="alert" role="alert">
              The initiatives could not be loaded. {errorMessage(error, "")}
            </p>
          )
          : (
            <>
              <AdminFilters
                q={q}
                query={parsed.query}
                problems={parsed.problems}
                counts={facetCounts}
                onChange={setQ}
                aside={
                  <span className="small dim tnum">
                    {rows.length} of {all.length}
                    {" · "}
                    <button
                      type="button"
                      className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline decoration-white/25 underline-offset-2 hover:text-white"
                      onClick={() => setQ(setQualifier(q, "cat", [UNTAGGED]))}
                    >
                      {all.filter((x) => !x.initiative.categories.length).length} untagged
                    </button>
                    {inReview > 0 && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-dao-amber underline decoration-[rgba(240,180,41,.4)] underline-offset-2 hover:text-white"
                          title="Proposer edits to approved initiatives, waiting for the team"
                          onClick={() => setQ(setQualifier(q, "edit", "review"))}
                        >
                          {inReview} edit{inReview === 1 ? "" : "s"} in review
                        </button>
                      </>
                    )}
                  </span>
                }
              />
              <div className="tblbox">
                <BulkBar
                  selection={rowSel}
                  noun="initiative"
                  actions={[
                    { key: "approve", label: "Approve", variant: "primary" },
                    { key: "unarchive", label: "Unarchive" },
                    {
                      key: "archive",
                      label: "Archive",
                      variant: "ghost",
                      confirm: "Archive {n} {noun}? They leave the board.",
                    },
                    {
                      key: "reject",
                      label: "Reject",
                      variant: "ghost",
                      confirm: "Reject {n} {noun}?",
                    },
                  ]}
                  onAct={bulk}
                />
                <table className="tbl [&_td]:align-middle">
                  <thead>
                    <tr>
                      <th className="w-8">
                        <HeadCheck selection={rowSel} label="Select every initiative" />
                      </th>
                      <th>Status</th>
                      <th>Type</th>
                      <th>Title</th>
                      <th className="amt">Goal</th>
                      <th className="amt">Raised</th>
                      <th>Contact</th>
                      <th className="whitespace-nowrap text-center">Safe sync</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {!rows.length && (
                      <tr>
                        <td colSpan={9} className="py-6 text-center text-muted">
                          No initiatives match.{" "}
                          <button
                            type="button"
                            className="cursor-pointer border-0 bg-transparent p-0 text-dao-green underline"
                            onClick={() => setQ("")}
                          >
                            Clear the search
                          </button>
                        </td>
                      </tr>
                    )}
                    {rows.map(({ initiative: r, summary, safeSync }) => (
                      <tr key={r.id}>
                        <td>
                          <RowCheck selection={rowSel} id={r.id} label={`Select ${r.title}`} />
                        </td>
                        <td className="whitespace-nowrap">
                          <StatusChip status={r.status} />
                          {r.sortRank
                            ? (
                              <span
                                className="ml-1"
                                title={`Pinned to board position ${r.sortRank}`}
                              >
                                📌{r.sortRank}
                              </span>
                            )
                            : null}
                        </td>
                        <td className="whitespace-nowrap">
                          <TypeBadge type={r.type} inline />
                        </td>
                        <td>
                          {r.title}
                          {r.pendingRevision
                            ? (
                              <span className="chip st-pending ml-2 align-middle">
                                edit in review
                              </span>
                            )
                            : null}
                          {r.categories.length > 0 && (
                            <span className="mt-1.5 flex flex-wrap gap-1">
                              {r.categories.map((slug) => (
                                <CategoryTag key={slug} slug={slug} sm />
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="amt">{usd(r.goalUsd)}</td>
                        <td
                          className="amt"
                          title={summary.live
                            ? `Safe balance; ledger rows total ${usd(summary.ledger)}`
                            : "Ledger total (balance read unavailable)"}
                        >
                          {usd(summary.total)}
                          {!summary.live && r.safeAddress
                            ? <span className="dim ml-1">(ledger)</span>
                            : null}
                        </td>
                        <td className="small [overflow-wrap:anywhere]">
                          {r.contact === undefined
                            ? (
                              // The hidden value is the button: its title says why, a click signs.
                              <ConfirmPrivateFields
                                inline
                                onConfirm={() => qc.invalidateQueries({ queryKey: listKey })}
                              />
                            )
                            : r.contact || "–"}
                        </td>
                        <td className="text-center">
                          <SafeSyncIcon safeAddress={r.safeAddress} sync={safeSync} />
                        </td>
                        <td>
                          <Link
                            className="btn btn-ghost btn-sm"
                            to={`/admin/initiatives/${r.slug}`}
                          >
                            Manage
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
      </div>
    </section>
  );
}
