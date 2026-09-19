import { useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, PencilLine } from "lucide-react";
import { isStructured } from "@shared/draft/mod";
import SectionHeading from "~/components/layout/SectionHeading";
import Markdown from "~/components/Markdown";
import Links from "~/components/initiative/Links";
import Milestones from "~/components/initiative/Milestones";
import Sections from "~/components/initiative/Sections";
import { Button, LinkButton } from "~/components/ui/Button";
import Reveal, { useInstant } from "~/components/ui/Reveal";
import type { AdminInitiative } from "~/lib/api-types";
import { cn } from "~/lib/utils";

// Folded, the box keeps about six lines of the text in view.
const PEEK = 168;

/**
 * The initiative's text as the public page formats it, in a box that folds
 * down to its first lines, with the way to the edit page next to it.
 */
export default function InitiativeText({ r }: { r: AdminInitiative }) {
  // Open for the read that comes before a review, folded once that is done.
  const [open, setOpen] = useState(r.status === "pending");
  // The edit page takes pending and approved initiatives, from anyone.
  const editable = r.status === "pending" || r.status === "approved";
  const box = useRef<HTMLDivElement>(null);
  const textId = useId();
  const instant = useInstant();
  return (
    <div ref={box} className="panel relative mt-7 scroll-mt-24">
      {/* As tall as the edit link, so the two share a centre line. */}
      <button
        type="button"
        className="flex min-h-9 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left"
        aria-expanded={open}
        aria-controls={textId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="k mb-0">Initiative text</span>
        <ChevronDown
          className={cn("size-4 text-muted transition-transform", open && "rotate-180")}
        />
      </button>
      {!editable && (
        <span className="mt-2 block small dim">
          Its text is closed for edits while it is {r.status}.
        </span>
      )}
      {/* Folded, the start of the text still shows, and a click on it opens the box. */}
      <div className={cn(!open && "cursor-pointer")} onClick={() => !open && setOpen(true)}>
        <Reveal show={open} peek={PEEK} id={textId}>
          <SectionHeading className="mt-5">Summary</SectionHeading>
          <p className="md m-0 whitespace-pre-line">{r.summary}</p>
          {isStructured(r)
            ? (
              <>
                <Sections type={r.type} sections={r.sections ?? {}} />
                <Milestones
                  type={r.type}
                  topup={r.type === "grant" && r.topup}
                  milestones={r.milestones ?? []}
                />
                <Links links={r.links ?? []} />
              </>
            )
            : (
              <>
                <SectionHeading>Full initiative details</SectionHeading>
                {r.details
                  ? <Markdown text={r.details} />
                  : <p className="m-0 text-muted">No details yet.</p>}
              </>
            )}
          {/* The text is long: fold it from its end too, and land back on the box. */}
          <Button
            variant="ghost"
            sm
            className="mt-7"
            onClick={() => {
              setOpen(false);
              box.current?.scrollIntoView?.({
                block: "start",
                behavior: instant ? "auto" : "smooth",
              });
            }}
          >
            <ChevronUp className="size-[15px]" />Fold the text
          </Button>
        </Reveal>
      </div>
      {editable && (
        <LinkButton
          variant="ghost"
          sm
          className="absolute right-[22px] top-5"
          to={`/initiative/${r.slug}/edit`}
        >
          <PencilLine className="size-[15px]" />Edit initiative
        </LinkButton>
      )}
    </div>
  );
}
