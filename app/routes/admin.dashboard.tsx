import { useAdminApi } from "~/hooks/use-admin-api";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Bell, Search } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import { CATEGORIES } from "~/lib/categories";
import { Button, LinkButton } from "~/components/ui/Button";
import { sessionKey, useSession } from "~/context/session";
import { api, errorMessage } from "~/lib/api";
import type { AdminComment, AdminDashboard } from "~/lib/api-types";
import { approvedCounts, filterAdminRows } from "~/lib/admin-rows";
import TypeGlyph from "~/components/board/filters/TypeGlyph";
import { dt, plural, shortAddr, truncate, usd } from "~/lib/format";
import { cn } from "~/lib/utils";

const dashKey = ["admin", "dashboard"] as const;

const CAT_FILTER_ITEMS = [
  { value: "all", label: "All categories" },
  { value: "untagged", label: "Untagged" },
  ...CATEGORIES.map((c) => ({ value: c.slug as string, label: c.label as string })),
];

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
  const maintenance = useSiteSettings().data?.maintenance;
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
  const [catFilter, setCatFilter] = useState("all");
  const [search, setSearch] = useState("");
  const rows = useMemo(
    () => filterAdminRows(data?.rows ?? [], catFilter, search),
    [data?.rows, catFilter, search],
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
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">Search by project or contact</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40"
            aria-hidden="true"
          />
          <input
            type="search"
            className="field min-h-[38px] py-1.5 pl-9 text-[13px]"
            placeholder="Search project or contact"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Select
          value={catFilter}
          items={CAT_FILTER_ITEMS}
          onValueChange={(v) => setCatFilter(String(v))}
        >
          <SelectTrigger size="sm" aria-label="Category" className="min-h-[38px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CAT_FILTER_ITEMS.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="small dim">
          {rows.length} of {data.rows.length}
          {" · "}
          {data.rows.filter((x) => !x.initiative.categories.length).length} untagged
        </span>
      </div>
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
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-8">
                <HeadCheck selection={rowSel} label="Select every initiative" />
              </th>
              <th>Status</th>
              <th>Title</th>
              <th className="amt">Goal</th>
              <th className="amt">Raised</th>
              <th>Contact</th>
              <th>Safe sync</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-muted">
                  No initiatives match.{" "}
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 text-dao-green underline"
                    onClick={() => {
                      setSearch("");
                      setCatFilter("all");
                    }}
                  >
                    Clear search and category
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
                  <StatusChip status={r.status} /> <TypeBadge type={r.type} inline />
                  {r.sortRank
                    ? <span title={`Pinned to board position ${r.sortRank}`}>📌{r.sortRank}</span>
                    : null}
                </td>
                <td>
                  {r.title}
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
                <td className="small">
                  {!r.safeAddress
                    ? <span className="dim">no Safe</span>
                    : !safeSync
                    ? <span className="dim">never</span>
                    : safeSync.ok
                    ? (
                      <span className="text-dao-green">
                        {safeSync.backfilled ? "ok" : "backfilling"} · {dt(safeSync.at)}
                      </span>
                    )
                    : <span className="text-[#ffb3b1]" title={safeSync.error}>error</span>}
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
