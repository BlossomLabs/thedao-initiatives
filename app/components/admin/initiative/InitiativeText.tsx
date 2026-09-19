import { useState } from "react";
import { ChevronDown, ChevronUp, PencilLine } from "lucide-react";
import { isStructured } from "@shared/draft/mod";
import SectionHeading from "~/components/layout/SectionHeading";
import Markdown from "~/components/Markdown";
import Links from "~/components/initiative/Links";
import Milestones from "~/components/initiative/Milestones";
import Sections from "~/components/initiative/Sections";
import { Button, LinkButton } from "~/components/ui/Button";
import type { AdminInitiative } from "~/lib/api-types";

/**
 * The initiative's text as the public page formats it, in a box that folds
 * away, with the way to the edit page next to it.
 */
export default function InitiativeText({ r }: { r: AdminInitiative }) {
  // Open for the read that comes before a review, folded once that is done.
  const [open, setOpen] = useState(r.status === "pending");
  // The edit page takes pending and approved initiatives, from anyone.
  const editable = r.status === "pending" || r.status === "approved";
  return (
    <div className="panel relative mt-7">
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer list-none marker:content-none [&::-webkit-details-marker]:hidden">
          {/* As tall as the edit link, so the two share a centre line. */}
          <span className="flex min-h-9 items-center gap-2">
            <span className="k mb-0">Initiative text</span>
            <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" />
          </span>
          <span className="mt-2 small dim line-clamp-2 group-open:hidden">{r.summary}</span>
          {!editable && (
            <span className="mt-2 block small dim">
              Its text is closed for edits while it is {r.status}.
            </span>
          )}
        </summary>
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
          onClick={(e) => {
            setOpen(false);
            e.currentTarget.closest("details")?.scrollIntoView?.({ block: "nearest" });
          }}
        >
          <ChevronUp className="size-[15px]" />Fold the text
        </Button>
      </details>
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
