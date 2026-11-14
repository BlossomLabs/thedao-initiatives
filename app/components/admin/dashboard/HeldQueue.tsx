import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import BulkBar, { type BulkResult, HeadCheck, RowCheck } from "~/components/admin/BulkBar";
import { HeldEntryCell, HeldScreenCell, HeldWhoCell } from "~/components/admin/HeldCells";
import { Button } from "~/components/ui/Button";
import Skeleton from "~/components/ui/Skeleton";
import { useAdminApi } from "~/hooks/use-admin-api";
import { useSelection } from "~/hooks/use-selection";
import { api, errorMessage } from "~/lib/api";
import { cn } from "~/lib/utils";
import { useAdminHeld } from "./queries";

/**
 * The held comments as #88 shows them: the whole comment and its thread, what
 * the AI screen said, and who wrote it, with publish, discard and re-run, one
 * at a time or for a selection. Its data is its own request (the author facts
 * ask the chain for badges), so a skeleton stands in until it lands.
 */
export default function HeldQueue({ count }: { count: number }) {
  const adminApi = useAdminApi();
  const qc = useQueryClient();
  const { data, error } = useAdminHeld(count > 0);
  const held = useMemo(() => data?.held ?? [], [data?.held]);
  const ids = useMemo(() => held.map((c) => c.id), [held]);
  const sel = useSelection(ids);
  // A failed row action says so in that row, under the button that ran it.
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  // Re-runs of the AI screen in flight, by comment id: each is a model call.
  const [rerunning, setRerunning] = useState<Set<string>>(() => new Set());
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });
  const act = async (id: string, action: string) => {
    if (action === "discard" && !confirm("Discard this comment?")) return;
    setRowError(null);
    try {
      await api(`/api/admin/comments/${id}/${action}`, { method: "POST" });
    } catch (e) {
      setRowError({ id, text: errorMessage(e, "That did not work.") });
    }
    refresh();
  };
  const rerun = async (id: string) => {
    setRowError(null);
    setRerunning((s) => new Set(s).add(id));
    try {
      await api(`/api/admin/comments/${id}/rescreen`, { method: "POST" });
    } catch (e) {
      setRowError({ id, text: errorMessage(e, "The AI screen did not run.") });
    }
    setRerunning((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    refresh();
  };
  const bulk = async (action: string, picked: string[]) => {
    const r = await adminApi<BulkResult>("/api/admin/comments/bulk", {
      json: { ids: picked, action },
    });
    refresh();
    return r;
  };
  if (!count) return null;
  return (
    <div className="border-t border-white/[.07] px-4 py-3">
      {error
        ? (
          <p className="alert" role="alert">
            The held comments could not be loaded. {errorMessage(error, "")}
          </p>
        )
        : !data
        ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading held comments">
            {Array.from(
              { length: Math.min(count, 3) },
              (_, i) => <Skeleton key={i} className="h-16 rounded-xl" />,
            )}
          </div>
        )
        : (
          <div className="tblbox">
            <BulkBar
              selection={sel}
              noun="entry"
              actions={[
                { key: "publish", label: "Publish", variant: "primary" },
                {
                  key: "discard",
                  label: "Discard",
                  variant: "ghost",
                  confirm: "Discard {n} {noun}?",
                },
                { key: "rescreen", label: "Re-run AI screen", variant: "ghost" },
              ]}
              onAct={bulk}
            />
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-8">
                    <HeadCheck selection={sel} label="Select every held entry" />
                  </th>
                  <th>Entry</th>
                  <th>AI screen</th>
                  <th>Who</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {held.map((c) => (
                  <tr key={c.id} className={cn(c.reports > 0 && "[&>td]:bg-[rgba(255,59,56,.06)]")}>
                    <td>
                      <RowCheck
                        selection={sel}
                        id={c.id}
                        label={`Select ${c.type} on ${c.initiative?.title ?? "?"}`}
                      />
                    </td>
                    <HeldEntryCell c={c} />
                    <HeldScreenCell
                      c={c}
                      busy={rerunning.has(c.id)}
                      onRerun={() =>
                        void rerun(c.id)}
                    />
                    <HeldWhoCell c={c} />
                    <td className="whitespace-nowrap">
                      <Button
                        sm
                        variant="primary"
                        className="mr-1.5"
                        onClick={() =>
                          void act(c.id, "publish")}
                      >
                        Publish
                      </Button>
                      <Button sm variant="ghost" onClick={() => void act(c.id, "discard")}>
                        Discard
                      </Button>
                      {rowError?.id === c.id && (
                        <p className="fld-msg fld-err whitespace-normal" role="alert">
                          {rowError.text}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
