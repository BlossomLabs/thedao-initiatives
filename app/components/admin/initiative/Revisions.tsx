import { Link } from "react-router";
import { RevisionAuthor } from "~/components/initiative/RevisionBar";
import { Button } from "~/components/ui/Button";
import { api } from "~/lib/api";
import type { AdminInitiativePage } from "~/lib/api-types";
import { dt } from "~/lib/format";
import type { Run } from "./run";

const UNPUBLISHED = {
  pending: "in review",
  rejected: "rejected",
  superseded: "superseded",
} as const;

/** Every version of the text: the public history with archive as the only
 * edit, and the proposer edits that never went live (the team's eyes only). */
export default function Revisions(
  { page, base, run }: { page: AdminInitiativePage; base: string; run: Run },
) {
  const r = page.initiative;
  if (!page.revisions.length) {
    return (
      <p className="m-0 mb-3.5 small dim">
        No history yet: this initiative predates revisions. Its first edit will keep the text shown
        today as revision 1.
      </p>
    );
  }
  return (
    <div className="tblbox mb-3.5">
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>Author</th>
            <th>Date</th>
            <th>Visibility</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {[...page.revisions].reverse().map((v) => {
            const isCurrent = v.n === r.revision;
            return (
              <tr key={v.n} className={v.archived ? "[&>td]:opacity-60" : undefined}>
                <td className="mono">{v.n}</td>
                <td className="small">
                  <RevisionAuthor rev={v} />
                </td>
                <td className="whitespace-nowrap">{dt(v.createdAt)}</td>
                <td>
                  {isCurrent
                    ? <span className="chip st-approved">current</span>
                    : v.state !== "live"
                    ? (
                      <span
                        className={`chip ${v.state === "pending" ? "st-pending" : "st-rejected"}`}
                        title={v.note ? `Note: ${v.note}` : "Never published"}
                      >
                        {UNPUBLISHED[v.state]}
                      </span>
                    )
                    : v.archived
                    ? <span className="chip st-archived">archived</span>
                    : <span className="chip">public</span>}
                </td>
                <td className="whitespace-nowrap text-right">
                  <Link
                    className="btn btn-ghost btn-sm mr-1.5"
                    to={`/initiative/${r.slug}${isCurrent ? "" : `?rev=${v.n}`}`}
                  >
                    View
                  </Link>
                  <Button
                    sm
                    variant="ghost"
                    disabled={isCurrent || v.state !== "live"}
                    title={isCurrent
                      ? "The current revision cannot be archived; save a new one to replace it."
                      : v.state !== "live"
                      ? "Never published, so there is nothing to hide"
                      : v.archived
                      ? "Show it in the public history again"
                      : "Hide it from the public history (admins still see it)"}
                    onClick={() =>
                      run(
                        () =>
                          api(`${base}/revisions/${v.n}`, {
                            json: { action: v.archived ? "unarchive" : "archive" },
                          }),
                        v.archived ? "Revision restored." : "Revision archived.",
                      )}
                  >
                    {v.archived ? "Unarchive" : "Archive"}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
