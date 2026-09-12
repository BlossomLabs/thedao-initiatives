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

type Report = ReturnType<typeof splitReport>;

export function reportLine(r: Report): string {
  return `Sorted: ${r.sections} section${r.sections === 1 ? "" : "s"}, ${r.milestones} milestone${
    r.milestones === 1 ? "" : "s"
  }, ${r.fields} page field${r.fields === 1 ? "" : "s"}${
    r.unsorted ? ", plus text nothing matched." : "."
  }`;
}

const list = (letters: string[]) =>
  letters.length === 1
    ? `Milestone ${letters[0]}`
    : `Milestones ${letters.join(", ").replace(/, ([^,]*)$/, " and $1")}`;

/**
 * Hints only for what did not read as intended, shown after a sort: nobody
 * reads format rules before pasting, they read them when something did not
 * land. Each names the shape the site expects.
 */
export function formatHints(r: Report): { key: string; text: React.ReactNode }[] {
  const out: { key: string; text: React.ReactNode }[] = [];
  if (r.unsorted) {
    out.push({
      key: "unsorted",
      text: (
        <>
          Text under a heading the site does not know went to the Unsorted box below. Headings
          inside a section become bold text; the site owns the section headings.
        </>
      ),
    });
  }
  if (r.milestones === 0) {
    out.push({
      key: "no-milestones",
      text: (
        <>
          No milestones found. Put them under <code>## Milestones</code> as{" "}
          <code>### Name - $50,000</code>, one bullet line per acceptance criterion; add{" "}
          <code>(adoption)</code> to the one that pays only on evidence of adoption.
        </>
      ),
    });
  }
  if (r.noAmount.length) {
    out.push({
      key: "no-amount",
      text: (
        <>
          {list(r.noAmount)} {r.noAmount.length === 1 ? "has" : "have"} no amount: heading as{" "}
          <code>### Name - $50,000</code>.
        </>
      ),
    });
  }
  if (r.noCriteria.length) {
    out.push({
      key: "no-criteria",
      text: (
        <>
          {list(r.noCriteria)} {r.noCriteria.length === 1 ? "has" : "have"}{" "}
          no acceptance criteria: bullet lines under the heading become them, one per line.
        </>
      ),
    });
  }
  if (r.backersUnread) {
    out.push({
      key: "backers",
      text: (
        <>
          Backers go one per line as <code>Organization | $20,000 | https://link</code>.
        </>
      ),
    });
  }
  return out;
}

/** The empty box teaches by example: a skeleton draft in the placeholder. */
export const PASTE_PLACEHOLDER = [
  "Paste the draft your AI wrote. It sorts as soon as it lands. The shape it reads:",
  "",
  "## Title",
  'One line, no "RFP:" prefix',
  "",
  "## Why this matters",
  "One heading per section, in the guide's order; headings inside a section become bold.",
  "",
  "## Milestones",
  "### Agreed standard - $50,000",
  "- One checkable outcome per bullet line",
  "### Adoption evidence - $75,000 (adoption)",
  "- The (adoption) one pays only on evidence of adoption; (done) marks a finished top-up milestone",
  "",
  "## Backers already committed",
  "Organization | $20,000 | https://link",
].join("\n");

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
  const hints = report ? formatHints(report) : [];

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
        className="field mono mt-1.5 min-h-[160px] text-[13px] leading-[1.5] placeholder:text-white/30"
        rows={text ? 8 : 17}
        spellCheck={false}
        placeholder={PASTE_PLACEHOLDER}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onPaste={() => {
          // the textarea has the pasted text one tick later
          timer.current = setTimeout(() => sort(), 0);
        }}
      />
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
      {hints.length > 0 && (
        <ul className="hint m-0 mt-1.5 list-none p-0 text-[#ffe9b8]" data-field="paste-hints">
          {hints.map((h) => <li key={h.key}>{h.text}</li>)}
        </ul>
      )}
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
