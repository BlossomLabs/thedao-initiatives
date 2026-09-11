import { FIELDS, type SectionKey, SECTIONS, type Sections as SectionsMap } from "@shared/draft/mod";
import SectionHeading from "~/components/layout/SectionHeading";
import Markdown from "~/components/Markdown";
import { DiffBlock } from "~/components/initiative/RevisionBar";
import type { InitiativeType } from "~/lib/api-types";
import type { TextDiff } from "~/lib/revision-diff";

/**
 * The site-owned sections of a structured initiative, in the type's order,
 * empty ones skipped. In changes mode every key present on either side gets
 * a diff block; keys from the other type (after a type switch) come last.
 */
export default function Sections(
  { type, sections, diff }: {
    type: InitiativeType;
    sections: SectionsMap;
    diff?: Pick<TextDiff, "sections"> | null;
  },
) {
  if (diff) {
    const byKey = new Map(diff.sections.map((s) => [s.key, s]));
    const order: SectionKey[] = [
      ...SECTIONS[type],
      ...diff.sections.map((s) => s.key).filter((k) => !SECTIONS[type].includes(k)),
    ];
    return (
      <>
        {order.map((key) => {
          const s = byKey.get(key);
          if (!s || !s.chunks.length) return null;
          return (
            <div key={key}>
              <SectionHeading id={key}>{s.heading}</SectionHeading>
              <DiffBlock chunks={s.chunks} className="diff-body" />
            </div>
          );
        })}
      </>
    );
  }
  return (
    <>
      {SECTIONS[type].map((key) => {
        const text = sections[key]?.trim();
        if (!text) return null;
        return (
          <div key={key}>
            <SectionHeading id={key}>{FIELDS[key].heading}</SectionHeading>
            <Markdown text={text} />
          </div>
        );
      })}
    </>
  );
}
