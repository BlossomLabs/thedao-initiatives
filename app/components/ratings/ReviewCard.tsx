import { useState } from "react";
import { Trash2 } from "lucide-react";
import Identity from "~/components/wallet/Identity";
import { QaChip } from "~/components/ui/Badge";
import type { AdminReview } from "~/hooks/use-admin-ratings";
import { errorMessage } from "~/lib/api";
import { ago } from "~/lib/format";
import { cn } from "~/lib/utils";
import { StarRow } from "./Stars";
import { REVIEW_LABEL } from "~/lib/reviewer";

/** Public badge-backed review. Superseded reviews remain visible but no longer count. */
export default function ReviewCard(
  { r, mine, onDelete }: { r: AdminReview; mine: boolean; onDelete: () => Promise<void> },
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      id={`review-${r.id}`}
      className={cn(
        "mb-4 rounded-2xl border border-white/10 border-l-[3px] border-l-dao-amber bg-panel-deep px-5 py-[18px] shadow-qa",
        !r.current && "opacity-60",
      )}
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
        <Identity address={r.address} size={24} />
        <QaChip>{REVIEW_LABEL} #{r.tokenId}</QaChip>
        <StarRow value={r.stars} />
        <span className="small dim">{ago(r.createdAt)}</span>
      </div>
      {r.body && (
        <div className="mb-2 text-[15px] leading-[1.55] text-[#dce5ef] [overflow-wrap:anywhere]">
          {r.body.split("\n").map((line, i) => <span key={i}>{i > 0 && <br />}{line}</span>)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
        {!r.current && <span>Replaced by a newer review: it no longer counts.</span>}
        {mine && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-muted underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
            onClick={() => {
              if (
                !confirm(
                  "Delete this review? The voting badge’s previous review, if any, counts again.",
                )
              ) return;
              setBusy(true);
              setError(null);
              onDelete().catch((e) => {
                setError(errorMessage(e, "Could not delete."));
                setBusy(false);
              });
            }}
          >
            <Trash2 className="size-3" aria-hidden="true" />Delete
          </button>
        )}
        {error && <span className="text-dao-red" role="alert">{error}</span>}
      </div>
    </div>
  );
}
