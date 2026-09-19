import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/Button";
import Status, { type StatusKind } from "~/components/ui/Status";
import type { Selection } from "~/hooks/use-selection";
import { cn } from "~/lib/utils";
import { errorMessage } from "~/lib/api";

export interface BulkAction {
  key: string;
  label: string;
  variant?: "default" | "primary" | "ghost" | "danger";
  /** Ask before running; `{n}` is the count, `{noun}` the pluralised noun. */
  confirm?: string;
}

export interface BulkResult {
  done: number;
  failed: { id: string; error: string }[];
}

const plural = (n: number, noun: string) =>
  n === 1 ? `${n} ${noun}` : `${n} ${noun.endsWith("y") ? noun.slice(0, -1) + "ies" : noun + "s"}`;

/**
 * The row of actions that appears once rows are selected. Destructive actions
 * confirm inline (no browser dialog); the result stays visible until the next
 * selection.
 */
export default function BulkBar(
  { selection, noun, actions, onAct }: {
    selection: Selection;
    noun: string;
    actions: BulkAction[];
    onAct: (key: string, ids: string[]) => Promise<BulkResult>;
  },
) {
  const [pending, setPending] = useState<BulkAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: StatusKind; text: string } | null>(null);
  useEffect(() => {
    if (selection.count) setMsg(null);
    setPending(null);
  }, [selection.count]);
  if (!selection.count && !msg) return null;

  const run = async (a: BulkAction) => {
    setPending(null);
    setBusy(true);
    const ids = [...selection.selected];
    try {
      const r = await onAct(a.key, ids);
      const failed = r.failed.length;
      setMsg({
        kind: failed ? "err" : "ok",
        text: failed
          ? `${a.label}: ${r.done} of ${plural(ids.length, noun)} done; ${failed} failed (${
            r.failed[0].error
          }).`
          : `${a.label}: ${plural(r.done, noun)} done.`,
      });
      selection.clear();
    } catch (e) {
      setMsg({ kind: "err", text: errorMessage(e, "That did not work.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "mb-2.5 flex flex-wrap items-center gap-2.5 rounded-xl border px-3.5 py-2 small",
        selection.count ? "border-[rgba(92,183,90,.35)] bg-card" : "border-transparent px-0",
      )}
      role="region"
      aria-label={`Bulk actions on ${plural(2, noun).replace(/^\d+ /, "")}`}
    >
      {selection.count > 0 && (
        <>
          <b className="font-inter-tight text-[13px] font-semibold">
            {plural(selection.count, noun)} selected
          </b>
          {pending
            ? (
              <>
                <span className="text-[#ffe9b8]">
                  {pending.confirm!.replace("{n}", String(selection.count)).replace(
                    "{noun}",
                    plural(selection.count, noun).replace(/^\d+ /, ""),
                  )}
                </span>
                <Button sm variant="danger" loading={busy} onClick={() => void run(pending)}>
                  Yes, {pending.label.toLowerCase()}
                </Button>
                <Button sm variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
              </>
            )
            : (
              <>
                {actions.map((a) => (
                  <Button
                    key={a.key}
                    sm
                    variant={a.variant ?? "default"}
                    loading={busy}
                    onClick={() => (a.confirm ? setPending(a) : void run(a))}
                  >
                    {a.label}
                  </Button>
                ))}
                <button
                  type="button"
                  className="ml-auto cursor-pointer text-muted hover:text-white"
                  onClick={selection.clear}
                >
                  Clear
                </button>
              </>
            )}
        </>
      )}
      {msg && <Status kind={msg.kind} className="m-0 w-full">{msg.text}</Status>}
    </div>
  );
}

/** Header checkbox: checked when every row is, indeterminate when some are. */
export function HeadCheck({ selection, label }: { selection: Selection; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selection.count > 0 && !selection.all;
  }, [selection.count, selection.all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-4 align-middle"
      checked={selection.all}
      onChange={selection.toggleAll}
      aria-label={label}
    />
  );
}

export function RowCheck(
  { selection, id, label }: { selection: Selection; id: string; label: string },
) {
  return (
    <input
      type="checkbox"
      className="size-4 align-middle"
      checked={selection.has(id)}
      onChange={() => selection.toggle(id)}
      aria-label={label}
    />
  );
}
