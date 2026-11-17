import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "~/lib/api";
import { useAdminApi } from "~/hooks/use-admin-api";
import { Button } from "~/components/ui/Button";
import { When } from "~/components/vote/When";
import { BriefBullets } from "~/components/vote/BriefList";
import type { VoteBrief } from "../../../../shared/vote/brief";
import type { AdminInitiative } from "~/lib/api-types";
import type { Run } from "./run";

export type BriefState = { brief: VoteBrief | null; current: boolean; at: number | null };

/** While the bullets don't match the live text (just approved, an edit just accepted:
 * the model is writing them), read again this often, this many times (about 30 s). */
const POLL_MS = 4000;
const POLLS = 8;

/** The initiative's vote card summary (#96), as voters see it on /vote, and Rewrite
 * summary. The model writes it when an admin approves the initiative, accepts an edit or
 * edits it live; this redoes it (a failure, or an initiative approved before). */
export default function VoteSummary(
  { r, run }: { r: AdminInitiative; run: Run },
) {
  const adminApi = useAdminApi();
  const qc = useQueryClient();
  const path = `/api/admin/initiatives/${r.id}/vote-brief`;
  // The live text's revision in the key: a new one starts the polling again.
  const key = ["admin", "vote-brief", r.id, r.revision, r.status];
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<BriefState>(path, { signal }),
    refetchInterval: (query) =>
      query.state.data && !query.state.data.current && query.state.dataUpdateCount < POLLS
        ? POLL_MS
        : false,
  });
  /** One model call: about 10 s. */
  const [busy, setBusy] = useState(false);
  const rewrite = async () => {
    setBusy(true);
    await run(async () => {
      const next = await adminApi<BriefState>(path, { json: {} });
      qc.setQueryData(key, next);
      qc.invalidateQueries({ queryKey: ["vote-briefs"] });
    }, "Summary rewritten.");
    setBusy(false);
  };

  if (!q.data) return null;
  const { brief, current, at } = q.data;
  return (
    <div className="panel">
      <p className="small dim m-0 mb-3">
        {!brief ? "Not written yet." : current
          ? (
            <>
              Current: written <When at={at!} /> from the live text.
            </>
          )
          : (
            <>
              Out of date: written <When at={at!} />, and the text has changed since.
            </>
          )}
      </p>
      {brief && <BriefBullets brief={brief} className="text-[13.5px]" />}
      <Button sm className="mt-3.5" loading={busy} disabled={busy} onClick={rewrite}>
        Rewrite summary
      </Button>
    </div>
  );
}
