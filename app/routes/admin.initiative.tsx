import { useAdminApi } from "~/hooks/use-admin-api";
import { sessionKey, useSession } from "~/context/session";
import { useEffect, useState } from "react";
import PageSkeleton from "~/components/layout/PageSkeleton";
import StickyAside from "~/components/layout/StickyAside";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { useWallet } from "~/context/wallet";
import { Download, ExternalLink, FileText, MessageSquare } from "lucide-react";
import PageMain from "~/components/layout/PageMain";
import Crumbs from "~/components/layout/Crumbs";
import SectionHeading from "~/components/layout/SectionHeading";
import { StatusChip, TypeBadge } from "~/components/ui/Badge";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import FundingHead from "~/components/initiative/FundingHead";
import Donations from "~/components/admin/initiative/Donations";
import InitiativeText from "~/components/admin/initiative/InitiativeText";
import OpenPoints from "~/components/admin/initiative/OpenPoints";
import PendingEdit from "~/components/admin/initiative/PendingEdit";
import Pledges from "~/components/admin/initiative/Pledges";
import Revisions from "~/components/admin/initiative/Revisions";
import type { Msg, Run } from "~/components/admin/initiative/run";
import SafeCard, { useSafeDeploy } from "~/components/admin/initiative/SafeCard";
import SettingsForm from "~/components/admin/initiative/SettingsForm";
import CategoriesPanel from "~/components/admin/initiative/CategoriesPanel";
import { CategoryTag } from "~/components/ui/CategoryTag";
import { api, ApiError, apiText, errorMessage } from "~/lib/api";
import type { AdminInitiativePage } from "~/lib/api-types";
import { walletErrorMessage } from "~/lib/donate";
import { dt } from "~/lib/format";
import { discussionKind } from "~/lib/discussion";

const STATUS_HELP: Record<string, string> = {
  pending: "Submitted and waiting for review. It is not on the board yet.",
  approved: "Live on the board; its Safe takes donations.",
  rejected: "Hidden from the board. Approve it to publish it after all.",
  archived: "Hidden from the board; its public page stays reachable.",
};

/**
 * The team's page for one initiative: its text to read, status, Safe,
 * settings, pledges, donations and revisions. Its text and facts are edited
 * on the edit page the proposer uses.
 */
export default function ManageInitiative() {
  const adminApi = useAdminApi();
  const { session } = useSession();
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const key = ["admin", "initiative", slug, sessionKey(session)] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<AdminInitiativePage>(`/api/admin/initiatives/${slug}`, { signal }),
    enabled: Boolean(session?.isAdmin),
  });
  // Once resolved, keep the editor on this ID even if its public URL is reused.
  const initiativeId = data?.initiative.id;
  useEffect(() => {
    if (initiativeId && slug !== initiativeId) {
      navigate(`/admin/initiatives/${initiativeId}`, { replace: true });
    }
  }, [initiativeId, slug, navigate]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });
  // Each section gets its own `run`, and the answer renders in that section
  // (`said`): the page is long, and a box under the title is off screen for
  // someone pressing "Add pledge" or "Recheck" far below it.
  const [msg, setMsg] = useState<(NonNullable<Msg> & { at: string }) | null>(null);
  const { isConnected } = useWallet();
  const safe = useSafeDeploy(data?.initiative.id ?? "", refresh);
  const runAt = (at: string): Run => async (fn, ok) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ at, kind: "ok", text: ok });
      refresh();
      return true;
    } catch (e) {
      setMsg({ at, kind: "err", text: errorMessage(e) });
      return false;
    }
  };
  const said = (at: string, className = "mt-3") =>
    msg?.at === at && (
      // Brought into view when it lands below the fold ("nearest" is a no-op otherwise).
      <div ref={(el) => el?.scrollIntoView?.({ block: "nearest", behavior: "smooth" })}>
        <Status kind={msg.kind} className={className}>{msg.text}</Status>
      </div>
    );

  if (isLoading) return <PageSkeleton />;
  if (error || !data) {
    return (
      <PageMain detail>
        <Crumbs
          items={[{ label: "Initiatives", to: "/" }, { label: "Admin", to: "/admin" }]}
        />
        <p className="alert">
          {error instanceof ApiError && error.status === 404
            ? "There is no initiative at this address. It may have been deleted, or the link is wrong."
            : errorMessage(error)}
        </p>
      </PageMain>
    );
  }
  const r = data.initiative;
  const base = `/api/admin/initiatives/${r.id}`;
  const pct = r.goalUsd > 0 ? (data.summary.total / r.goalUsd) * 100 : 0;
  // Deploy first, approve second: the wallet prompt is the admin's sign-off on the Safe.
  const canApprove = Boolean(r.safeAddress) || isConnected;
  const tagged = r.categories.length > 0;
  const run = runAt("status");
  const approve = (action: "approve" | "unarchive", ok: string) =>
    run(async () => {
      // The Safe card reports the deploy itself; here it is why nothing was approved.
      if (!r.safeAddress) {
        await safe.ensureDeployed().catch((e) => {
          throw new Error("Not approved: " + walletErrorMessage(e));
        });
      }
      await adminApi(`${base}/status`, { json: { action } });
    }, ok);

  return (
    <PageMain detail>
      <Crumbs items={[{ label: "Initiatives", to: "/" }, { label: "Admin", to: "/admin" }]} />
      <h1 className="m-0 mb-3 mt-1.5 font-inter-tight text-[clamp(28px,4vw,44px)] font-bold leading-[1.1] tracking-[-.02em]">
        {r.title}
      </h1>
      <p className="m-0 flex flex-wrap items-center gap-3">
        <TypeBadge type={r.type} inline />
        {/* The status has its own panel below; the categories sit together. */}
        {r.categories.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5" data-categories="">
            {r.categories.map((slug) => <CategoryTag key={slug} slug={slug} />)}
          </span>
        )}
        <span className="small dim">
          created {dt(r.createdAt)} · <span className="mono">{r.slug}</span>
        </span>
      </p>

      <div className="mt-4 grid grid-cols-[1fr_340px] items-start gap-9 max-[960px]:grid-cols-1">
        <div className="min-w-0">
          <FundingHead
            summary={data.summary}
            goal={r.goalUsd}
            pct={pct}
            funded={r.goalUsd > 0 && data.summary.total >= r.goalUsd}
          />

          <PendingEdit r={r} run={runAt("edit")} />
          {said("edit")}

          <InitiativeText r={r} />

          <SectionHeading>Settings</SectionHeading>
          <SettingsForm r={r} run={runAt("settings")} />
          {said("settings")}

          <SectionHeading count={data.pledges.length}>Backer pledges</SectionHeading>
          <Pledges page={data} base={base} run={runAt("pledges")} />
          {said("pledges")}

          <SectionHeading count={data.donations.length}>Donations</SectionHeading>
          <Donations page={data} base={base} run={runAt("donations")} />
          {said("donations")}

          <SectionHeading count={data.revisions.length}>Revisions</SectionHeading>
          <Revisions page={data} base={base} run={runAt("revisions")} />
          {said("revisions")}
        </div>

        <StickyAside className="flex flex-col gap-3.5 max-[960px]:static">
          <div className="panel">
            <span className="k">Status</span>
            <p className="m-0 flex items-center gap-2.5">
              <StatusChip status={r.status} />
              <span className="small dim">{STATUS_HELP[r.status]}</span>
            </p>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {r.status !== "approved" && r.status !== "archived" && (
                <Button
                  variant="primary"
                  sm
                  disabled={!canApprove || !tagged}
                  loading={safe.busy}
                  title={!tagged
                    ? "Add at least one category to approve."
                    : canApprove
                    ? undefined
                    : "Connect a wallet: approving deploys the Safe"}
                  onClick={() => approve("approve", "Safe deployed and initiative approved.")}
                >
                  Approve
                </Button>
              )}
              {r.status === "pending" && (
                <Button
                  variant="danger"
                  sm
                  onClick={() =>
                    run(
                      () => adminApi(`${base}/status`, { json: { action: "reject" } }),
                      "Rejected.",
                    )}
                >
                  Reject
                </Button>
              )}
              {r.status === "approved" && (
                <Button
                  variant="ghost"
                  sm
                  onClick={() =>
                    run(
                      () => adminApi(`${base}/status`, { json: { action: "archive" } }),
                      "Archived.",
                    )}
                >
                  Archive
                </Button>
              )}
              {r.status === "archived" && (
                <Button
                  sm
                  disabled={!canApprove || !tagged}
                  loading={safe.busy}
                  title={!tagged
                    ? "Add at least one category to approve."
                    : canApprove
                    ? undefined
                    : "Connect a wallet: approving deploys the Safe"}
                  onClick={() => approve("unarchive", "Re-approved.")}
                >
                  Re-approve
                </Button>
              )}
            </div>
            {!tagged && r.status !== "approved" && (
              <p className="m-0 mt-2.5 small text-dao-amber">
                Add at least one category to approve.
              </p>
            )}
            {said("status")}
          </div>

          <CategoriesPanel r={r} run={runAt("categories")} />
          {said("categories")}

          <SafeCard page={data} safe={safe} onChange={refresh} />

          <OpenPoints r={r} pledges={data.pledges} />

          <div className="panel">
            <span className="k">Links</span>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 small">
              <li>
                <Link to={`/initiative/${r.slug}`}>
                  Public page{r.status !== "approved" && " (unlisted)"}
                </Link>
              </li>
              <li>
                <a
                  href={`/initiative/${r.slug}.md`}
                  target="_blank"
                  rel="noopener"
                  title="The public initiative as a content file"
                >
                  <FileText className="mr-1.5 inline size-3.5 align-[-2px]" />
                  Public markdown file
                </a>
              </li>
              <li>
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-dao-green hover:underline"
                  title="With status, proposer, contact and funders. Never share it."
                  onClick={() =>
                    runAt("links")(async () => {
                      const md = await apiText(`/initiative/${r.slug}-PRIVATE.md`);
                      const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${r.slug}-PRIVATE.md`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    })}
                >
                  <Download className="mr-1.5 inline size-3.5 align-[-2px]" />
                  Private markdown file (download)
                </button>
              </li>
              {r.discourseUrl && (
                <li>
                  <a href={r.discourseUrl} target="_blank" rel="noopener">
                    <MessageSquare className="mr-1.5 inline size-3.5 align-[-2px]" />
                    {discussionKind(r.discourseUrl) === "telegram"
                      ? "Group discussion"
                      : "Forum thread"}
                  </a>
                </li>
              )}
              {r.safeAddress && (
                <li>
                  <a
                    href={`https://eth.blockscout.com/address/${r.safeAddress}`}
                    target="_blank"
                    rel="noopener"
                  >
                    <ExternalLink className="mr-1.5 inline size-3.5 align-[-2px]" />
                    Safe on Blockscout
                  </a>
                </li>
              )}
            </ul>
            {said("links")}
          </div>
        </StickyAside>
      </div>
    </PageMain>
  );
}
