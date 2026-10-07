import { useAdminApi } from "~/hooks/use-admin-api";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { Bell } from "lucide-react";
import PageMain from "~/components/layout/PageMain";
import DashboardSkeleton from "~/components/layout/DashboardSkeleton";
import Crumbs from "~/components/layout/Crumbs";
import SectionHeading from "~/components/layout/SectionHeading";
import SyncContent from "~/components/admin/SyncContent";
import Admins from "~/components/admin/Admins";
import BulkBar, { type BulkResult, HeadCheck, RowCheck } from "~/components/admin/BulkBar";
import { useSelection } from "~/hooks/use-selection";
import { useSiteSettings } from "~/hooks/use-site-settings";
import { StatusChip, TypeBadge } from "~/components/ui/Badge";
import { CategoryTag } from "~/components/ui/CategoryTag";
import { Button, LinkButton } from "~/components/ui/Button";
import { sessionKey, useSession } from "~/context/session";
import { api, errorMessage } from "~/lib/api";
import type { AdminComment, AdminDashboard } from "~/lib/api-types";
import { adminFacetCounts, approvedCounts, filterAdminRows } from "~/lib/admin-rows";
import { parseAdminQuery, setQualifier, UNTAGGED } from "~/lib/admin-query";
import AdminFilters from "~/components/admin/AdminFilters";
import SafeSyncIcon from "~/components/admin/SafeSyncIcon";
import TypeGlyph from "~/components/board/filters/TypeGlyph";
import { dt, plural, shortAddr, truncate, usd } from "~/lib/format";
import { cn } from "~/lib/utils";

const dashKey = ["admin", "dashboard"] as const;

function CommentCell({ c }: { c: AdminComment }) {
  return (
    <td>
      <b>{c.type}</b> on {c.initiative?.title ?? "?"}
      {c.reports > 0 && <>· {c.reports} report{c.reports === 1 ? "" : "s"}</>}
      <br />
      <span className="whitespace-pre-line text-[13px] text-white/75 [overflow-wrap:anywhere]">
        {truncate(c.body, 200)}
      </span>
    </td>
  );
}

export default function Dashboard() {
  const adminApi = useAdminApi();
  const { signOut, session } = useSession();
  const qc = useQueryClient();
  // The banner's query, so the button costs no request of its own.
  const site = useSiteSettings().data;
  const maintenance = site?.maintenance;
  const vote = site?.vote;
  const { data, isLoading, error } = useQuery({
    queryKey: [...dashKey, sessionKey(session)],
    queryFn: ({ signal }) => api<AdminDashboard>("/api/admin/dashboard", { signal }),
    enabled: Boolean(session?.isAdmin),
  });
  // A failed row action says so in that row, under the button that ran it.
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const act = async (id: string, action: string) => {
    if (action === "discard" && !confirm("Discard this comment?")) return;
    setRowError(null);
    try {
      await api(`/api/admin/comments/${id}/${action}`, { method: "POST" });
    } catch (e) {
      setRowError({ id, text: errorMessage(e, "That did not work.") });
    }
    void qc.invalidateQueries({ queryKey: dashKey });
  };
  const rowSaid = (id: string) =>
    rowError?.id === id && (
      <p className="fld-msg fld-err whitespace-normal" role="alert">{rowError.text}</p>
    );
  // Bulk actions: one request per table, then refetch. Selections live on ids so
  // a row that leaves a list (published, archived) drops out on its own.
  const heldIds = useMemo(() => (data?.held ?? []).map((c) => c.id), [data?.held]);
  const reportedIds = useMemo(() => (data?.reported ?? []).map((c) => c.id), [data?.reported]);
  // "all", "untagged" or a category slug.
  // One query for the list (`type:grant status:pending First QA`), kept in the URL.
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const setQ = (next: string) =>
    setParams(next.trim() ? { q: next } : {}, { replace: true, preventScrollReset: true });
  const parsed = useMemo(() => parseAdminQuery(q), [q]);
  const rows = useMemo(
    () => filterAdminRows(data?.rows ?? [], parsed.query),
    [data?.rows, parsed],
  );
  const inReview = (data?.rows ?? []).filter((x) => x.initiative.pendingRevision).length;
  const facetCounts = useMemo(
    () => adminFacetCounts(data?.rows ?? [], parsed.query),
    [data?.rows, parsed],
  );
  const counts = approvedCounts(data?.rows ?? []);
  const rowIds = useMemo(() => rows.map((r) => r.initiative.id), [rows]);
  const heldSel = useSelection(heldIds);
  const reportedSel = useSelection(reportedIds);
  const rowSel = useSelection(rowIds);
  const bulk = (path: string) => async (action: string, ids: string[]) => {
    const r = await adminApi<BulkResult>(path, { json: { ids, action } });
    await qc.invalidateQueries({ queryKey: dashKey });
    return r;
  };
  const bulkComments = bulk("/api/admin/comments/bulk");
  const bulkInitiatives = bulk("/api/admin/initiatives/bulk");
  if (isLoading) return <DashboardSkeleton />;
  if (error || !data) {
    return (
      <PageMain detail>
        <p className="alert" role="alert">
          The dashboard could not be loaded. {errorMessage(error, "")}
        </p>
      </PageMain>
    );
  }

  return (
    <PageMain detail>
      <Crumbs items={[{ label: "Initiatives", to: "/" }]} />
      <div className="flex items-center justify-between gap-5">
        <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
          Admin dashboard
          {data.bell > 0 && (
            <a
              className="relative ml-2.5 align-middle text-[18px] no-underline"
              href="#moderation"
              title={`${data.bell} items need attention`}
            >
              <Bell className="inline size-[18px] align-[-4px]" />
              <span className="ml-0.5 rounded-full bg-dao-red px-1.5 py-px align-top font-inter-tight text-[11px] font-bold text-white">
                {data.bell}
              </span>
            </a>
          )}
        </h1>
        <div className="flex items-center gap-2.5">
          <LinkButton
            variant="ghost"
            sm
            to="/admin/leads"
            title="Who is likely to fund each initiative (private)"
          >
            Funder leads
          </LinkButton>
          <LinkButton
            variant="ghost"
            sm
            to="/admin/vote"
            title="The first goal, and whether the site shows it"
          >
            {vote && (
              <span
                className={cn(
                  "size-[9px] flex-none rounded-full",
                  vote.show ? "bg-dao-green shadow-[0_0_10px_rgba(92,183,90,.6)]" : "bg-white/30",
                )}
                aria-hidden="true"
              />
            )}
            Vote
            {vote && <span className="sr-only">{vote.show ? ", on the site" : ", hidden"}</span>}
          </LinkButton>
          <LinkButton
            variant="ghost"
            sm
            to="/admin/maintenance"
            title="Pause writes, download or restore the database"
          >
            {maintenance && (
              <span
                className={cn(
                  "size-[9px] flex-none rounded-full",
                  maintenance.on
                    ? "bg-dao-red shadow-[0_0_10px_rgba(255,59,56,.6)]"
                    : "bg-dao-green shadow-[0_0_10px_rgba(92,183,90,.6)]",
                )}
                aria-hidden="true"
              />
            )}
            Maintenance mode{maintenance ? (maintenance.on ? " on" : " off") : ""}
          </LinkButton>
          <Button variant="ghost" sm onClick={() => void signOut()}>Log out</Button>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-4 gap-3 max-[1100px]:grid-cols-2 max-[640px]:grid-cols-1">
        {/* The same approved rows the board shows, so the numbers match it. */}
        <div className="flex items-center gap-3 rounded-2xl border border-edge bg-card px-[18px] py-3.5">
          <span
            className="size-[9px] flex-none rounded-full bg-dao-green shadow-[0_0_10px_rgba(92,183,90,.6)]"
            aria-hidden="true"
          />
          <div>
            <b className="block font-inter-tight text-[14px] font-semibold">
              {counts.total} approved
            </b>
            <small className="flex items-center gap-3 text-[12px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <TypeGlyph type="grant" />
                {plural(counts.grants, "grant")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <TypeGlyph type="rfp" />
                {plural(counts.rfps, "RFP")}
              </span>
            </small>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-edge bg-card px-[18px] py-3.5">
          <span
            className={cn(
              "size-[9px] flex-none rounded-full",
              data.pendingCount
                ? "bg-dao-amber shadow-[0_0_10px_rgba(240,180,41,.55)]"
                : "bg-dao-sky shadow-[0_0_10px_rgba(90,200,250,.55)]",
            )}
          />
          <div>
            <b className="block font-inter-tight text-[14px] font-semibold">
              {data.pendingCount} pending submission{data.pendingCount === 1 ? "" : "s"}
            </b>
            <small className="block text-[12px] text-muted">awaiting review below</small>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-edge bg-card px-[18px] py-3.5">
          <span
            className={cn(
              "size-[9px] flex-none rounded-full",
              data.safeApi.configured
                ? "bg-dao-green shadow-[0_0_10px_rgba(92,183,90,.6)]"
                : "bg-dao-red",
            )}
          />
          <div>
            <b className="block font-inter-tight text-[14px] font-semibold">
              Safe API {data.safeApi.configured ? "authenticated" : "NOT configured"}
            </b>
            <small className="block text-[12px] text-muted">
              Refreshes when viewed after {data.safeApi.refreshMinutes} minutes
              {data.safeApi.quota ? ` · ${data.safeApi.quota.remaining} requests left` : ""}
            </small>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-edge bg-card px-[18px] py-3.5">
          <span
            className={cn(
              "size-[9px] flex-none rounded-full",
              data.signers.ok
                ? "bg-dao-green shadow-[0_0_10px_rgba(92,183,90,.6)]"
                : "bg-dao-amber",
            )}
          />
          <div>
            <b className="block font-inter-tight text-[14px] font-semibold">
              Safe deploys {data.signers.ok ? "enabled" : "disabled"}
            </b>
            <small className="block text-[12px] text-muted">
              {data.signers.detail} · {data.chain.detail}
            </small>
          </div>
        </div>
      </div>

      <SectionHeading id="moderation">Community moderation</SectionHeading>
      {/* Admins sit beside the queues on wide screens, under them on narrow ones. */}
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-5 max-[1100px]:grid-cols-1">
        <div className="min-w-0">
          <h3 className="h3">
            Waiting for review{" "}
            <span className="ml-2 text-[12px] text-muted">({data.held.length})</span>
          </h3>
          {data.held.length
            ? (
              <div className="tblbox">
                <BulkBar
                  selection={heldSel}
                  noun="entry"
                  actions={[
                    { key: "publish", label: "Publish", variant: "primary" },
                    {
                      key: "discard",
                      label: "Discard",
                      variant: "ghost",
                      confirm: "Discard {n} {noun}?",
                    },
                  ]}
                  onAct={bulkComments}
                />
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="w-8">
                        <HeadCheck selection={heldSel} label="Select every held entry" />
                      </th>
                      <th>Entry</th>
                      <th>AI summary</th>
                      <th>Identity</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.held.map((c) => (
                      <tr
                        key={c.id}
                        className={cn(c.reports > 0 && "[&>td]:bg-[rgba(255,59,56,.06)]")}
                      >
                        <td>
                          <RowCheck
                            selection={heldSel}
                            id={c.id}
                            label={`Select ${c.type} on ${c.initiative?.title ?? "?"}`}
                          />
                        </td>
                        <CommentCell c={c} />
                        <td className="small dim">{c.aiSummary}</td>
                        <td className="small">
                          {c.displayName || "(no name)"}
                          {c.email && ` · ${c.email}`}
                          {c.address && (
                            <>
                              <br />
                              {shortAddr(c.address)}
                            </>
                          )}
                        </td>
                        <td className="whitespace-nowrap">
                          <Button
                            sm
                            className="mr-1.5"
                            onClick={() => act(c.id, "publish")}
                          >
                            Publish
                          </Button>
                          <Button
                            sm
                            variant="ghost"
                            onClick={() => act(c.id, "discard")}
                          >
                            Discard
                          </Button>
                          {rowSaid(c.id)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
            : <p className="text-muted">Nothing waiting for review.</p>}

          <h3 className="h3">
            Unanswered questions{" "}
            <span className="ml-2 text-[12px] text-muted">({data.unanswered.length})</span>
          </h3>
          {data.unanswered.length
            ? (
              <div className="tblbox">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Question</th>
                      <th>Asked</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unanswered.map((c) => (
                      <tr
                        key={c.id}
                        className={cn(
                          c.createdAt < data.weekAgo && "[&>td]:bg-[rgba(255,59,56,.06)]",
                        )}
                      >
                        <CommentCell c={c} />
                        <td>
                          {dt(c.createdAt)}
                          {c.createdAt < data.weekAgo && (
                            <>
                              · <b>7+ days</b>
                            </>
                          )}
                        </td>
                        <td>
                          {c.initiative && (
                            <LinkButton
                              sm
                              variant="ghost"
                              to={`/initiative/${c.initiative.slug}#qa-${c.parentId ?? c.id}`}
                            >
                              Open
                            </LinkButton>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
            : <p className="text-muted">Every question has a reply.</p>}

          {data.reported.length > 0 && (
            <>
              <h3 className="h3">
                Reported entries{" "}
                <span className="ml-2 text-[12px] text-muted">({data.reported.length})</span>
              </h3>
              <div className="tblbox">
                <BulkBar
                  selection={reportedSel}
                  noun="entry"
                  actions={[
                    { key: "unreport", label: "Dismiss reports" },
                    {
                      key: "discard",
                      label: "Discard",
                      variant: "ghost",
                      confirm: "Discard {n} {noun}?",
                    },
                  ]}
                  onAct={bulkComments}
                />
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="w-8">
                        <HeadCheck selection={reportedSel} label="Select every reported entry" />
                      </th>
                      <th>Entry</th>
                      <th>Reports</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reported.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <RowCheck
                            selection={reportedSel}
                            id={c.id}
                            label={`Select ${c.type} on ${c.initiative?.title ?? "?"}`}
                          />
                        </td>
                        <CommentCell c={c} />
                        <td>{c.reports}</td>
                        <td className="whitespace-nowrap">
                          {c.initiative && (
                            <LinkButton
                              sm
                              variant="ghost"
                              className="mr-1.5"
                              to={`/initiative/${c.initiative.slug}#qa-${c.parentId ?? c.id}`}
                            >
                              Open
                            </LinkButton>
                          )}
                          <Button
                            sm
                            variant="ghost"
                            className="mr-1.5"
                            onClick={() => act(c.id, "unreport")}
                          >
                            Dismiss reports
                          </Button>
                          <Button sm variant="ghost" onClick={() => act(c.id, "discard")}>
                            Discard
                          </Button>
                          {rowSaid(c.id)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <aside className="mt-5 max-[1100px]:mt-0">
          <Admins />
        </aside>
      </div>

      <SectionHeading>All initiatives</SectionHeading>
      <AdminFilters
        q={q}
        query={parsed.query}
        problems={parsed.problems}
        counts={facetCounts}
        onChange={setQ}
        aside={
          <span className="small dim tnum">
            {rows.length} of {data.rows.length}
            {" · "}
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline decoration-white/25 underline-offset-2 hover:text-white"
              onClick={() => setQ(setQualifier(q, "cat", [UNTAGGED]))}
            >
              {data.rows.filter((x) => !x.initiative.categories.length).length} untagged
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
            { key: "reject", label: "Reject", variant: "ghost", confirm: "Reject {n} {noun}?" },
          ]}
          onAct={bulkInitiatives}
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
                      <span className="ml-1" title={`Pinned to board position ${r.sortRank}`}>
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
                    ? <span className="chip st-pending ml-2 align-middle">edit in review</span>
                    : null}
                  {r.categories.length > 0 && (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {r.categories.map((slug) => <CategoryTag key={slug} slug={slug} sm />)}
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
                <td className="small [overflow-wrap:anywhere]">{r.contact || "–"}</td>
                <td className="text-center">
                  <SafeSyncIcon safeAddress={r.safeAddress} sync={safeSync} />
                </td>
                <td>
                  <Link className="btn btn-ghost btn-sm" to={`/admin/initiatives/${r.slug}`}>
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SyncContent />
    </PageMain>
  );
}
