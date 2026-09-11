/**
 * The paste box: the whole AI-written draft lands here and is sorted into
 * the fields below on paste (or with the button). The report says what was
 * filled; lines that matched nothing go to the amber Unsorted box, kept in
 * the draft for the proposer and never posted.
 */
import { useEffect, useRef, useState } from "react";
import { type DraftType, FIELDS, splitDraft } from "@shared/draft/mod";
import { Button } from "~/components/ui/Button";
import { Textarea } from "~/components/ui/Field";
import { splitReport } from "./useDraft";
import type { SplitResult } from "@shared/draft/mod";

export const PASTE_HINT = (
  <>
    Milestone headings look like{" "}
    <code>### Agreed standard - $50,000</code>, in order: the site letters them A, B, C. Add{" "}
    <code>(adoption)</code> to a milestone that pays only on evidence of adoption, and{" "}
    <code>(done)</code>{" "}
    to a top-up milestone that is already finished. Bullet lines under a milestone become its
    acceptance criteria, one per line. Under{" "}
    <code>## Backers already committed</code>, one backer per line as{" "}
    <code>Organization | amount | link</code>. Headings inside a section become bold text: the site
    owns the headings.
  </>
);

type Report = ReturnType<typeof splitReport>;

export function reportLine(r: Report): string {
  return `Sorted: ${r.sections} section${r.sections === 1 ? "" : "s"}, ${r.milestones} milestone${
    r.milestones === 1 ? "" : "s"
  }, ${r.fields} page field${r.fields === 1 ? "" : "s"}${
    r.unsorted ? ", plus text nothing matched." : "."
  }`;
}

export default function PasteBox(
  { type, onSplit, onUndo, canUndo, unsorted, onUnsorted, initialText = "", disabled }: {
    type: DraftType;
    onSplit: (result: SplitResult) => void;
    onUndo: () => void;
    canUndo: boolean;
    unsorted: string;
    onUnsorted: (text: string) => void;
    /** A legacy body to migrate (edit pages). */
    initialText?: string;
    disabled?: boolean;
  },
) {
  const [text, setText] = useState(initialText);
  const [report, setReport] = useState<Report | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const sort = (src?: string) => {
    const t = src ?? ref.current?.value ?? text;
    if (!t.trim()) return;
    const res = splitDraft(t, type);
    onSplit(res);
    setReport(splitReport(res, type));
  };
  const grantHint = report && type === "rfp" && report.otherType.length > 0;

  return (
    <div className="mt-6" data-field="paste">
      <label className="label" htmlFor="f-paste">
        Paste your whole draft here
        <span className="hint">
          It splits on the section headings and fills the fields below. The fields are what gets
          submitted.
        </span>
      </label>
      <textarea
        ref={ref}
        id="f-paste"
        className="field mono mt-1.5 min-h-[160px] text-[13px] leading-[1.5]"
        rows={8}
        spellCheck={false}
        placeholder="Paste the draft your AI wrote. Sorting starts as soon as it lands."
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onPaste={() => {
          // the textarea has the pasted text one tick later
          timer.current = setTimeout(() => sort(), 0);
        }}
      />
      <p className="hint m-0">{PASTE_HINT}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
        <Button variant="ghost" sm disabled={disabled || !text.trim()} onClick={() => sort()}>
          Sort this text
        </Button>
        <Button
          variant="ghost"
          sm
          disabled={disabled || !text}
          onClick={() => {
            setText("");
            setReport(null);
          }}
        >
          Clear
        </Button>
        {report && (
          <span role="status" className="small flex flex-wrap items-center gap-2">
            <span>
              <b className="text-dao-green">Sorted:</b>{" "}
              {reportLine(report).slice("Sorted: ".length)}
            </span>
            {canUndo && (
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-dao-green underline-offset-2 hover:underline"
                onClick={() => {
                  onUndo();
                  setReport(null);
                }}
              >
                Undo
              </button>
            )}
          </span>
        )}
      </div>
      {grantHint && (
        <p className="hint m-0 mt-1.5 text-[#ffe9b8]">
          Switch to Grant to sort{" "}
          {report.otherType.map((k) => FIELDS[k].heading.replace(/:.*$/, "")).join(", ")
            .replace(/, ([^,]*)$/, " and $1")}.
        </p>
      )}
      {unsorted.trim() && (
        <div
          className="mt-4 rounded-2xl border border-[rgba(240,180,41,.5)] bg-[rgba(240,180,41,.06)] px-5 py-4"
          data-field="unsorted"
        >
          <span className="eyebrow text-dao-amber">Unsorted text</span>
          <p className="hint m-0">
            These lines matched no section. Copy what you need into a field above, then clear this
            box. Nothing here is submitted.
          </p>
          <Textarea
            id="f-unsorted"
            className="mono mt-2 min-h-0 text-[13px]"
            rows={5}
            value={unsorted}
            onChange={(e) => onUnsorted(e.target.value)}
          />
          <Button variant="ghost" sm className="mt-2" onClick={() => onUnsorted("")}>
            Clear the box
          </Button>
        </div>
      )}
    </div>
  );
}
