import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Bell } from "lucide-react";
import PageMain from "~/components/layout/PageMain";
import Crumbs from "~/components/layout/Crumbs";
import SectionHeading from "~/components/layout/SectionHeading";
import SyncContent from "~/components/admin/SyncContent";
import { StatusChip, TypeBadge } from "~/components/ui/Badge";
import { Button, LinkButton } from "~/components/ui/Button";
import { useSession } from "~/context/session";
import { api } from "~/lib/api";
import type { AdminComment, AdminDashboard } from "~/lib/api-types";
import { dt, shortAddr, truncate, usd } from "~/lib/format";
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
  const { signOut } = useSession();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: dashKey,
    queryFn: () => api<AdminDashboard>("/api/admin/dashboard"),
  });
  const act = async (id: string, action: string) => {
    if (action === "discard" && !confirm("Discard this comment?")) return;
    try {
      await api(`/api/admin/comments/${id}/${action}`, { method: "POST" });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
    void qc.invalidateQueries({ queryKey: dashKey });
  };
  if (isLoading) {
    return (
      <PageMain detail>
        <p className="text-muted">Loading…</p>
      </PageMain>
    );
  }
  if (error || !data) {
    return (
      <PageMain detail>
        <p className="alert">
          {error instanceof Error ? error.message : "Could not load the dashboard."}
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
          <Button variant="ghost" sm onClick={() => void signOut()}>Log out</Button>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-3 gap-3 max-[860px]:grid-cols-1">
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
              cron {data.safeApi.cron}
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

      <SyncContent />

      <SectionHeading id="moderation">Community moderation</SectionHeading>
      <h3 className="h3">
        Waiting for review <span className="ml-2 text-[12px] text-muted">({data.held.length})</span>
      </h3>
      {data.held.length
        ? (
          <div className="tblbox">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>AI summary</th>
                  <th>Identity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.held.map((c) => (
                  <tr key={c.id} className={cn(c.reports > 0 && "[&>td]:bg-[rgba(255,59,56,.06)]")}>
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
                        onClick={() =>
                          act(c.id, "publish")}
                      >
                        Publish
                      </Button>
                      <Button
                        sm
                        variant="ghost"
                        onClick={() =>
                          act(c.id, "discard")}
                      >
                        Discard
                      </Button>
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
                    className={cn(c.createdAt < data.weekAgo && "[&>td]:bg-[rgba(255,59,56,.06)]")}
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
            <table className="tbl">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Reports</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.reported.map((c) => (
                  <tr key={c.id}>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <SectionHeading>All initiatives</SectionHeading>
      <div className="tblbox">
        <table className="tbl">
          <thead>
            <tr>
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
            {data.rows.map(({ initiative: r, summary, safeSync }) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">
                  <StatusChip status={r.status} /> <TypeBadge type={r.type} inline />
                  {r.sortRank
                    ? <span title={`Pinned to board position ${r.sortRank}`}>📌{r.sortRank}</span>
                    : null}
                </td>
                <td>{r.title}</td>
                <td className="amt">{usd(r.goalUsd)}</td>
                <td className="amt">{usd(summary.total)}</td>
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
                  <Link className="btn btn-ghost btn-sm" to={`/admin/initiatives/${r.id}`}>
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionHeading>Content files</SectionHeading>
      <p className="small dim">
        Initiatives in <code className="mono">content/rfps/*.md</code>{" "}
        are published by pushing them to the API from the repo:{" "}
        <code className="mono">cd api && deno task sync-content</code> (with{" "}
        <code className="mono">ADMIN_TOKEN</code> or <code className="mono">ADMIN_PRIVATE_KEY</code>
        {" "}
        set). Files own the words and the goal; this panel owns status, Safes and money.
      </p>
    </PageMain>
  );
}
