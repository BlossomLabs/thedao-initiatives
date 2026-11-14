import { useId, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "~/components/ui/Button";
import { TypeBadge } from "~/components/ui/Badge";
import Status from "~/components/ui/Status";
import CategoriesPanel from "~/components/admin/initiative/CategoriesPanel";
import { useSafeDeploy } from "~/components/admin/initiative/SafeCard";
import { useWallet } from "~/context/wallet";
import { useAdminApi } from "~/hooks/use-admin-api";
import type { AdminTodoRow } from "~/lib/api-types";
import { walletErrorMessage } from "~/lib/donate";
import { dayTime, usd } from "~/lib/format";
import { useAdminPage } from "./queries";
import { useRun } from "./run";
import TodoSection, { DetailSkeleton, RowDetail, RowToggle, TodoRow } from "./TodoSection";

/** A pending submission: approve it from the row (the Safe deploys first), or open it to read and tag it. */
function SubmissionRow({ row }: { row: AdminTodoRow }) {
  const adminApi = useAdminApi();
  const qc = useQueryClient();
  const { isConnected } = useWallet();
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const page = useAdminPage(row.slug, open);
  const { run, said } = useRun();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });
  const safe = useSafeDeploy(row.id, refresh);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const tagged = row.categories.length > 0;
  const canApprove = tagged && (Boolean(row.safeAddress) || isConnected);
  const base = `/api/admin/initiatives/${row.id}`;
  const status = (action: "approve" | "reject", ok: string) => {
    setBusy(action);
    void run(async () => {
      // Deploy first, approve second: the wallet prompt is the admin's sign-off on the Safe.
      if (action === "approve" && !row.safeAddress) {
        await safe.ensureDeployed().catch((e) => {
          throw new Error("Not approved: " + walletErrorMessage(e));
        });
      }
      await adminApi(`${base}/status`, { json: { action } });
    }, ok).finally(() => setBusy(null));
  };
  return (
    <TodoRow>
      <RowToggle
        open={open}
        onToggle={() => setOpen(!open)}
        controls={detailId}
        title={row.title}
        meta={
          <>
            <TypeBadge type={row.type} inline /> · <span className="tnum">{usd(row.goalUsd)}</span>
            {row.recipientTeam ? ` · ${row.recipientTeam}` : ""} · sent {dayTime(row.createdAt)}
          </>
        }
      />
      <span className="flex flex-wrap gap-1.5">
        <Button
          variant="primary"
          sm
          disabled={!canApprove || busy !== null}
          loading={busy === "approve" || safe.busy}
          title={!tagged
            ? "Add at least one category to approve."
            : canApprove
            ? undefined
            : "Connect a wallet: approving deploys the Safe"}
          onClick={() => status("approve", "Safe deployed and initiative approved.")}
        >
          {row.safeAddress ? "Approve" : "Deploy Safe and approve"}
        </Button>
        <Button
          variant="danger"
          sm
          disabled={busy !== null}
          loading={busy === "reject"}
          onClick={() => status("reject", "Rejected.")}
        >
          Reject
        </Button>
      </span>
      {!tagged && (
        <p className="m-0 basis-full small text-dao-amber">
          Add at least one category to approve. Open the row to tag it.
        </p>
      )}
      {safe.status && (
        <Status kind={safe.status.kind} className="basis-full">{safe.status.text}</Status>
      )}
      {said && <div className="basis-full">{said}</div>}
      {open && (
        <RowDetail id={detailId}>
          {page.isLoading ? <DetailSkeleton /> : page.data
            ? (
              <>
                <p className="m-0 text-[13.5px] leading-[1.55]">{page.data.initiative.summary}</p>
                {page.data.initiative.contact && (
                  <p className="m-0 small dim [overflow-wrap:anywhere]">
                    Contact: {page.data.initiative.contact}
                  </p>
                )}
                <CategoriesPanel r={page.data.initiative} run={run} />
                <Link className="small" to={`/admin/initiatives/${row.slug}`}>
                  Open the full page
                </Link>
              </>
            )
            : (
              <p className="m-0 small text-[#ffd7d6]" role="alert">
                This initiative could not be loaded.
              </p>
            )}
        </RowDetail>
      )}
    </TodoRow>
  );
}

export default function Submissions({ rows }: { rows: AdminTodoRow[] }) {
  return (
    <TodoSection
      title="Submissions to approve"
      count={rows.length}
      note="oldest first"
      empty="No submissions waiting."
    >
      {rows.map((r) => <SubmissionRow key={r.id} row={r} />)}
    </TodoSection>
  );
}
