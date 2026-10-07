import { useId, useState } from "react";
import { DiffBlock, RevisionAuthor } from "~/components/initiative/RevisionBar";
import { Button } from "~/components/ui/Button";
import { CategoryTag } from "~/components/ui/CategoryTag";
import { Textarea } from "~/components/ui/Field";
import { useAdminApi } from "~/hooks/use-admin-api";
import { useRevision } from "~/hooks/use-revision";
import type { AdminInitiative } from "~/lib/api-types";
import { errorMessage } from "~/lib/api";
import { dt } from "~/lib/format";
import { changed, type Chunk, diffCategories, diffRevisions } from "~/lib/revision-diff";
import type { Run } from "./run";

/**
 * The proposer's edit waiting on an approved initiative: what it changes
 * against the live text, field by field, with Accept (it goes live) and
 * Reject (the live text stays; the note is for the proposer).
 */
export default function PendingEdit({ r, run }: { r: AdminInitiative; run: Run }) {
  const adminApi = useAdminApi();
  const n = r.pendingRevision;
  const { data: edit, error } = useRevision(r.slug, n);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const noteId = useId();
  if (!n) return null;
  const decide = (verdict: "accept" | "reject") => {
    setBusy(verdict);
    void run(
      () =>
        adminApi(`/api/admin/initiatives/${r.id}/revisions/${n}/${verdict}`, {
          json: verdict === "reject" && note.trim() ? { note: note.trim() } : {},
        }),
      verdict === "accept" ? "Edit accepted: it is live." : "Edit rejected.",
    ).finally(() => setBusy(null));
  };
  const diff = edit ? diffRevisions(r, edit, r.type) : null;
  const fields: [string, Chunk[]][] = diff
    ? ([
      ["Title", diff.title],
      ["Summary", diff.summary],
      ...diff.sections.map((s): [string, Chunk[]] => [s.heading, s.chunks]),
      ["Milestones", diff.milestones],
      ["Links", diff.links],
      ["Details", diff.details],
    ] as [string, Chunk[]][]).filter(([, chunks]) => changed(chunks))
    : [];
  const tags = (edit && diffCategories(r.categories, edit.categories)) || [];
  const retagged = tags.some((t) => t.added || t.removed);
  return (
    <div className="panel mt-7 border-[rgba(240,180,41,.45)]">
      <span className="k">Edit awaiting approval</span>
      <p className="m-0 small dim">
        The proposer edited this approved initiative. The public page keeps the approved version
        until you accept the edit.
      </p>
      {edit && (
        <p className="m-0 mt-2 flex flex-wrap items-center gap-x-2 small dim">
          <RevisionAuthor rev={edit} size={16} />
          <span>· {dt(edit.createdAt)}</span>
        </p>
      )}
      {error && <p className="alert mt-3">{errorMessage(error)}</p>}
      {!edit && !error && <p className="m-0 mt-3 small dim">Loading the edit…</p>}
      {edit && !fields.length && !retagged && (
        <p className="m-0 mt-3 small dim">It no longer differs from the live text.</p>
      )}
      {retagged && (
        <div className="mt-4">
          <span className="label">Categories</span>
          <span className="flex flex-wrap items-center gap-1.5" data-categories="">
            {tags.map(({ slug, added, removed }) =>
              added
                ? (
                  <ins key={slug} className="tag-added">
                    <CategoryTag slug={slug} />
                  </ins>
                )
                : removed
                ? (
                  <del key={slug} className="tag-removed">
                    <CategoryTag slug={slug} />
                  </del>
                )
                : <CategoryTag key={slug} slug={slug} />
            )}
          </span>
        </div>
      )}
      {fields.map(([label, chunks]) => (
        <div key={label} className="mt-4">
          <span className="label">{label}</span>
          <DiffBlock chunks={chunks} className="diff-body" />
        </div>
      ))}
      {rejecting && (
        <div className="mt-4">
          <label className="label" htmlFor={noteId}>Note for the proposer (optional)</label>
          <Textarea
            id={noteId}
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {!rejecting && (
          <Button
            variant="primary"
            loading={busy === "accept"}
            disabled={!edit || busy !== null}
            onClick={() => decide("accept")}
          >
            Accept edit
          </Button>
        )}
        {rejecting
          ? (
            <>
              <Button
                variant="danger"
                loading={busy === "reject"}
                disabled={busy !== null}
                onClick={() => decide("reject")}
              >
                Reject edit
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </>
          )
          : (
            <Button variant="ghost" disabled={busy !== null} onClick={() => setRejecting(true)}>
              Reject…
            </Button>
          )}
      </div>
    </div>
  );
}
