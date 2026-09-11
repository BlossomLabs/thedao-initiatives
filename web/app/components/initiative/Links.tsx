import { ExternalLink } from "lucide-react";
import SectionHeading from "~/components/layout/SectionHeading";
import { DiffBlock } from "~/components/initiative/RevisionBar";
import type { TextDiff } from "~/lib/revision-diff";
import { httpsHref } from "~/lib/utils";

/** The initiative's links: https ones as anchors, anything else as plain text. */
export default function Links(
  { links, diff }: { links: string[]; diff?: Pick<TextDiff, "links"> | null },
) {
  if (diff) {
    if (!diff.links.length) return null;
    return (
      <>
        <SectionHeading id="links">Links</SectionHeading>
        <DiffBlock chunks={diff.links} className="mono text-[13px]" />
      </>
    );
  }
  const rows = links.map((l) => l.trim()).filter(Boolean);
  if (!rows.length) return null;
  return (
    <>
      <SectionHeading id="links">Links</SectionHeading>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[14.5px]">
        {rows.map((l, i) => {
          const href = httpsHref(l);
          return (
            <li key={i} className="[overflow-wrap:anywhere]">
              {href
                ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 [overflow-wrap:anywhere]"
                  >
                    <ExternalLink className="size-3.5 flex-none" />
                    {l}
                  </a>
                )
                : l}
            </li>
          );
        })}
      </ul>
    </>
  );
}
