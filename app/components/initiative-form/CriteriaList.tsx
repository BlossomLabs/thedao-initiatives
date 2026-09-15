/**
 * A milestone's acceptance criteria, one per row: a two-line textarea with a
 * checkbox glyph in front (the page renders a checklist). Enter starts the
 * next row, pasted newlines flatten to spaces, x removes a row.
 */
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/utils";
import { domId, edgeClass, FieldMsg, useFinding } from "./findings";
import type { DraftCriterion } from "./types";

export default function CriteriaList(
  { msIndex, msId, criteria, onSet, onInsert, onRemove, disabled }: {
    msIndex: number;
    msId: string;
    criteria: DraftCriterion[];
    onSet: (msId: string, critId: string, value: string) => void;
    /** Returns the new row's id. */
    onInsert: (msId: string, after: string | null) => string;
    onRemove: (msId: string, critId: string) => void;
    disabled?: boolean;
  },
) {
  const field = `ms_${msIndex}_crit`;
  const f = useFinding(field);
  // the row inserted by Enter gets focus once it exists
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (!pending.current) return;
    const el = document.getElementById(pending.current);
    if (el) {
      pending.current = null;
      el.focus();
    }
  });
  const insert = (after: string | null) => {
    onInsert(msId, after);
    const j = after === null ? criteria.length : criteria.findIndex((c) => c.id === after) + 1;
    pending.current = domId(`ms_${msIndex}_c${j}`);
  };
  return (
    <div id={domId(field)} data-field={field} className={cn("mt-3.5", edgeClass(f))}>
      <span className="eyebrow">Acceptance criteria, one per row *</span>
      <div className="mt-2 flex flex-col gap-2">
        {criteria.map((c, j) => {
          const cf = `ms_${msIndex}_c${j}`;
          return (
            <div key={c.id} data-field={cf}>
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-[15px] size-4 flex-none rounded-[4px] border border-white/40"
                />
                <CriterionInput
                  field={cf}
                  value={c.text}
                  disabled={disabled}
                  onChange={(v) => onSet(msId, c.id, v)}
                  onEnter={() => insert(c.id)}
                />
                <button
                  type="button"
                  className="mt-2.5 grid size-7 flex-none cursor-pointer place-items-center rounded-full border border-transparent bg-transparent text-muted hover:border-white/15 hover:text-white disabled:opacity-40"
                  title="Remove this criterion"
                  aria-label="Remove this criterion"
                  disabled={disabled}
                  onClick={() => onRemove(msId, c.id)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <FieldMsg field={cf} className="ml-[26px]" />
            </div>
          );
        })}
      </div>
      <FieldMsg field={field} />
      <Button variant="ghost" sm className="mt-2" disabled={disabled} onClick={() => insert(null)}>
        Add criterion
      </Button>
    </div>
  );
}

function CriterionInput(
  { field, value, onChange, onEnter, disabled }: {
    field: string;
    value: string;
    onChange: (v: string) => void;
    onEnter: () => void;
    disabled?: boolean;
  },
) {
  const f = useFinding(field);
  return (
    <textarea
      id={domId(field)}
      className={cn("field min-h-0 py-2.5 text-[13.5px] leading-[1.45]", f.cls)}
      rows={2}
      placeholder="One checkable outcome"
      value={value}
      disabled={disabled}
      aria-invalid={f.errors.length ? true : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}
