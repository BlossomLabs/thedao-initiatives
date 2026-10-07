import { Link } from "react-router";
import { ChevronLeft, ChevronRight, ChevronsRight, History } from "lucide-react";
import Identity from "~/components/wallet/Identity";
import type { RevisionMeta, RevisionSource } from "~/lib/api-types";
import type { Chunk } from "~/lib/revision-diff";
import { dt } from "~/lib/format";
import { cn } from "~/lib/utils";

export type ViewMode = "rendered" | "changes";

const SOURCE_LABEL: Record<RevisionSource, string> = {
  submit: "Submitted by",
  proposer: "Edited by the proposer",
  admin: "Edited by the team",
  content: "From a content file",
  import: "Imported",
};

/** Who wrote a revision: the wallet when there is one, otherwise the source. */
export function RevisionAuthor({ rev, size = 18 }: { rev: RevisionMeta; size?: number }) {
  if (rev.author) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {SOURCE_LABEL[rev.source]}
        <Identity address={rev.author} size={size} nameClassName="text-[13px]" />
      </span>
    );
  }
  return <span>{SOURCE_LABEL[rev.source]}</span>;
}

/**
 * Sidebar panel browsing the public history of an initiative: previous / next
 * through the visible revisions (`?rev=N`), a way back to the latest one, and
 * a toggle between the text as it was and the changes against the revision
 * before. Rendered as one more side card so it never crowds the page header.
 */
export default function RevisionPanel({
  slug,
  revisions,
  viewing,
  current,
  mode,
  onMode,
}: {
  slug: string;
  revisions: RevisionMeta[];
  viewing: number;
  current: number;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
}) {
  const idx = revisions.findIndex((r) => r.n === viewing);
  const rev = idx >= 0 ? revisions[idx] : null;
  const prev = idx > 0 ? revisions[idx - 1] : null;
  const next = idx >= 0 && idx < revisions.length - 1 ? revisions[idx + 1] : null;
  const href = (n: number) =>
    n === current ? `/initiative/${slug}` : `/initiative/${slug}?rev=${n}`;
  const isCurrent = viewing === current;
  return (
    <div
      className={cn("panel", !isCurrent && "border-[rgba(240,180,41,.4)]")}
      role="navigation"
      aria-label="Revisions"
    >
      <span className="k">Revisions</span>
      <p className="m-0 flex flex-wrap items-center gap-2 font-inter-tight text-[13.5px] font-semibold">
        <History className="size-4 text-dao-green" />
        {/* An edit in review or a rejected one is open: it has no place in this list. */}
        {idx >= 0 ? `Revision ${idx + 1} of ${revisions.length}` : "Not in the public history"}
        {isCurrent
          ? <span className="chip st-approved">current</span>
          : idx >= 0 && <span className="chip st-pending">superseded</span>}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <NavLink to={prev ? href(prev.n) : null} label="Previous revision">
          <ChevronLeft className="size-3.5" />
        </NavLink>
        <NavLink to={next ? href(next.n) : null} label="Next revision">
          <ChevronRight className="size-3.5" />
        </NavLink>
        <NavLink to={isCurrent ? null : href(current)} label="Latest revision">
          <ChevronsRight className="size-3.5" />
        </NavLink>
        <span className="ml-auto inline-flex overflow-hidden rounded-full border border-white/15 text-[12px]">
          {(["rendered", "changes"] as const).map((m) => (
            <button
              key={m}
              type="button"
              title={m === "changes" && idx === 0
                ? "First revision: everything shows as added"
                : undefined}
              className={cn(
                "cursor-pointer px-3 py-1 font-inter-tight capitalize transition-colors",
                mode === m ? "bg-dao-green text-[#0f1e2c]" : "text-muted hover:text-white",
              )}
              onClick={() => onMode(m)}
            >
              {m}
            </button>
          ))}
        </span>
      </div>
      {/* Last, so its varying length (wallet vs "from a content file") never shifts the controls. */}
      {rev && (
        <div className="mt-3 small dim border-t border-white/[.08] pt-2.5">
          <p className="m-0 flex flex-wrap items-center gap-x-1.5">
            <RevisionAuthor rev={rev} size={16} />
          </p>
          <p className="m-0">{dt(rev.createdAt)}</p>
        </div>
      )}
    </div>
  );
}

function NavLink(
  { to, label, children }: { to: string | null; label: string; children: React.ReactNode },
) {
  const cls =
    "inline-flex size-7 items-center justify-center rounded-full border border-white/15 text-muted transition-colors";
  if (!to) {
    return (
      <span className={cn(cls, "cursor-default opacity-35")} aria-disabled="true">{children}</span>
    );
  }
  return (
    <Link
      className={cn(cls, "no-underline hover:border-white/40 hover:text-white")}
      to={to}
      aria-label={label}
      title={label}
    >
      {children}
    </Link>
  );
}

/** Inline rendering of one field's diff: <ins> for added, <del> for removed words. */
export function DiffBlock({ chunks, className }: { chunks: Chunk[]; className?: string }) {
  return (
    <div className={cn("diff", className)}>
      {chunks.map((c, i) =>
        c.added
          ? <ins key={i}>{c.value}</ins>
          : c.removed
          ? <del key={i}>{c.value}</del>
          : <span key={i}>{c.value}</span>
      )}
    </div>
  );
}
