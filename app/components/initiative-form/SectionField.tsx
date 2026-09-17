/**
 * One site-owned section: the eyebrow says what heading the site renders,
 * the label is the question, the proposer answers in markdown. A toggle
 * shows the gold-standard example; a word count sits next to it.
 */
import { useId, useState } from "react";
import { FIELDS, inputMax, LIMITS, type SectionKey } from "@shared/draft/mod";
import Markdown from "~/components/Markdown";
import { Textarea } from "~/components/ui/Field";
import { exampleFor } from "~/data/guide";
import { cn } from "~/lib/utils";
import { domId, FieldMsg, useFinding } from "./findings";

export const wordCount = (s: string): number => {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
};

export default function SectionField(
  { sectionKey, value, onChange, disabled }: {
    sectionKey: SectionKey;
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
  },
) {
  const def = FIELDS[sectionKey];
  const f = useFinding(sectionKey);
  const id = domId(sectionKey);
  const exId = useId();
  const [open, setOpen] = useState(false);
  const ex = exampleFor(sectionKey);
  return (
    <div className="mt-7 first:mt-5" data-field={sectionKey}>
      <span className="eyebrow">Renders as: {def.heading} *</span>
      <label
        htmlFor={id}
        className="mt-1.5 block font-inter-tight text-[15px] font-medium leading-[1.4] text-white"
      >
        {def.q}
      </label>
      <span className="hint">{def.helper}</span>
      <Textarea
        id={id}
        className={cn("mt-2.5 min-h-[96px]", f.cls)}
        rows={def.rows}
        maxLength={inputMax(LIMITS.SECTION_CHARS)}
        value={value}
        disabled={disabled}
        aria-invalid={f.errors.length ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldMsg field={sectionKey} />
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 font-inter-tight text-[12.5px] text-dao-green underline-offset-2 hover:underline"
          aria-expanded={open}
          aria-controls={exId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide example" : "Show example"}
        </button>
        <span className="small dim tnum">{wordCount(value)} words</span>
      </div>
      <div
        id={exId}
        hidden={!open}
        className="mt-2 rounded-xl border border-dashed border-white/15 bg-white/[.03] px-4 py-3"
      >
        <span className="eyebrow mb-1.5">
          Example{!ex.fallback && (
            <i className="ml-1.5 font-normal normal-case tracking-normal text-muted">
              from the gold-standard initiative
            </i>
          )}
        </span>
        {ex.fallback
          ? <p className="m-0 small dim">{ex.text}</p>
          : <Markdown text={ex.text} className="text-[13.5px] text-soft" />}
      </div>
    </div>
  );
}
