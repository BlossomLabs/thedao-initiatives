/**
 * The paste box: the whole draft as one text, mirrored with the fields
 * below. Paste or type here and the fields follow; edit a field and this
 * text follows. Whichever side holds the caret is the source, and the box
 * is never rewritten while it is focused. The report under it says what a
 * paste filled; lines that matched nothing go to the amber Unsorted box,
 * kept in the draft for the proposer and never posted.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { type DraftType, FIELDS, splitDraft } from "@shared/draft/mod";
import { Button } from "~/components/ui/Button";
import { Textarea } from "~/components/ui/Field";
import Reveal from "~/components/ui/Reveal";
import { renderDraft, textMatchesDraft } from "./draft-text";
import type { Draft } from "./types";
import { splitReport } from "./useDraft";
import { CATEGORIES } from "@shared/categories";

const CATEGORY_NAMES = CATEGORIES.map((c) => c.label).join(", ");

type Report = ReturnType<typeof splitReport>;

/** How long after the last keystroke in the box the fields follow. */
export const MIRROR_DELAY = 300;

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
 * Hints only for what did not read as intended, shown after a paste: nobody
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
  if (r.categories === 0 && !r.unknownCategories.length) {
    out.push({
      key: "no-categories",
      text: (
        <>
          No categories found. Put 1 to 3 under{" "}
          <code>## Categories</code>, one per line, the main one first, or pick them in the
          Categories field above.
        </>
      ),
    });
  }
  if (r.unknownCategories.length) {
    out.push({
      key: "unknown-categories",
      text: (
        <>
          Not a category: {r.unknownCategories.join(", ")}. Use these names: {CATEGORY_NAMES}.
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
  "## Categories",
  "OpSec",
  "Research & Education",
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
  { draft, onText, onUnsorted, disabled }: {
    draft: Draft;
    /** The box changed: replace the text half of the draft with it. */
    onText: (text: string) => void;
    onUnsorted: (text: string) => void;
    disabled?: boolean;
  },
) {
  const type: DraftType = draft.type;
  const [text, setText] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  const clicked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) {
      const t = pending.current;
      pending.current = null;
      onText(t);
    }
  };
  const push = (t: string, delay: number) => {
    pending.current = t;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };

  // The fields changed: the box follows, unless the change came from the box
  // or the caret is in it.
  const rendered = useMemo(() => renderDraft(draft), [draft]);
  useEffect(() => {
    if (focused.current || pending.current !== null) return;
    if (rendered === text || textMatchesDraft(draft, text)) return;
    setText(rendered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const grantHint = report && type === "rfp" && report.otherType.length > 0;
  const hints = report ? formatHints(report) : [];

  return (
    <div className="mt-6" data-field="paste">
      <label className="label" htmlFor="f-paste">
        Your whole draft as one text
        <span className="hint">Paste the draft your AI wrote, or write here.</span>
      </label>
      <textarea
        ref={ref}
        id="f-paste"
        className="field mono mt-1.5 min-h-[160px] text-[13px] leading-[1.5] placeholder:text-white/30"
        rows={text ? 12 : 17}
        spellCheck={false}
        placeholder={PASTE_PLACEHOLDER}
        value={text}
        disabled={disabled}
        onFocus={(e) => {
          focused.current = true;
          // The whole draft is selected on focus: the next paste replaces it.
          e.currentTarget.select();
          clicked.current = true;
        }}
        onMouseUp={(e) => {
          // The click that gave the focus would drop the selection on release.
          if (clicked.current) e.preventDefault();
          clicked.current = false;
        }}
        onKeyDown={() => {
          clicked.current = false;
        }}
        onBlur={() => {
          focused.current = false;
          clicked.current = false;
          flush();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setReport(null);
          push(e.target.value, MIRROR_DELAY);
        }}
        onPaste={() => {
          // the textarea has the pasted text one tick later
          timer.current = setTimeout(() => {
            const t = ref.current?.value ?? "";
            pending.current = t;
            flush();
            if (t.trim()) setReport(splitReport(splitDraft(t, type), type));
          }, 0);
        }}
      />
      <p className="hint m-0 mt-1.5" data-field="paste-note">
        What you write here fills the fields below, and what you type in a field shows up here. Both
        are the same draft; the fields are what gets submitted.
      </p>
      <Reveal show={Boolean(report)}>
        {report && (
          <p role="status" className="small m-0 mt-2.5">
            <b className="text-dao-green">Sorted:</b> {reportLine(report).slice("Sorted: ".length)}
          </p>
        )}
      </Reveal>
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
      {draft.unsorted.trim() && (
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
            value={draft.unsorted}
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
