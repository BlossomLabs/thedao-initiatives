import { useId, useState } from "react";
import { Link } from "react-router";
import PendingEdit from "~/components/admin/initiative/PendingEdit";
import type { AdminTodoRow } from "~/lib/api-types";
import { useAdminPage } from "./queries";
import { useRun } from "./run";
import TodoSection, { DetailSkeleton, RowDetail, RowToggle, TodoRow } from "./TodoSection";

/** A proposer's edit to an approved initiative: open it to read the diff, then accept or reject it there. */
function EditRow({ row }: { row: AdminTodoRow }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const page = useAdminPage(row.slug, open);
  const { run, said } = useRun();
  return (
    <TodoRow>
      <RowToggle
        open={open}
        onToggle={() => setOpen(!open)}
        controls={detailId}
        title={row.title}
        meta={`Edit ${row.pendingRevision} waiting · open to see what changes`}
      />
      <Link className="btn btn-ghost btn-sm" to={`/admin/initiatives/${row.slug}`}>
        Open page
      </Link>
      {said && <div className="basis-full">{said}</div>}
      {open && (
        <RowDetail id={detailId}>
          {page.isLoading
            ? <DetailSkeleton />
            : page.data
            ? <PendingEdit r={page.data.initiative} run={run} />
            : (
              <p className="m-0 small text-[#ffd7d6]" role="alert">
                This edit could not be loaded.
              </p>
            )}
        </RowDetail>
      )}
    </TodoRow>
  );
}

export default function Edits({ rows }: { rows: AdminTodoRow[] }) {
  return (
    <TodoSection
      title="Edits to accept"
      count={rows.length}
      note="proposer changes to approved initiatives"
      empty="No edits waiting."
    >
      {rows.map((r) => <EditRow key={r.id} row={r} />)}
    </TodoSection>
  );
}
