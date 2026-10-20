import { useReviews } from "~/hooks/use-admin-ratings";
import type { RatingSummary } from "@shared/ratings";
import RatingHistogram from "./RatingHistogram";
import { goRate } from "./rate-here";
import { StarRow } from "./Stars";

const EYEBROW = "font-inter-tight text-[10.5px] font-medium uppercase tracking-[.1em] text-muted";

/** Yours, as saved, and Rate it (Change once rated): the page rates in one
 * place, the comment box, and this takes the viewer there. */
function Yours({ summary }: { summary: RatingSummary }) {
  return (
    <div className="mt-3 flex min-h-8 items-center gap-2 border-t border-white/10 pt-3">
      <span className={EYEBROW}>Yours</span>
      {summary.mine
        ? <StarRow value={summary.mine} />
        : <span className="small dim">Not rated</span>}
      <a
        href="#reviews"
        onClick={(e) => {
          e.preventDefault();
          goRate();
        }}
        className="ml-auto font-inter-tight text-[12.5px] font-bold text-dao-amber no-underline hover:underline"
      >
        {summary.mine ? "Change" : "Rate it"}
      </a>
    </div>
  );
}

/**
 * The rating side card: the average and the bars, and (while the initiative
 * is on the board) the viewer's own rating with a way to the comment box to
 * give or change it. Its own card (not the admins' panel) so it can go public
 * later; for now only admins get a summary, so it renders nothing for anyone
 * else.
 */
export default function RatingCard(
  { initiativeId, canRate }: { initiativeId: string; canRate: boolean },
) {
  const { summary } = useReviews(initiativeId);
  if (!summary) return null;
  return (
    <div className="panel">
      <span className="k">Rating</span>
      <RatingHistogram summary={summary} />
      {canRate
        ? <Yours summary={summary} />
        : summary.mine && (
          <p className="m-0 mt-2.5 flex items-center gap-1.5 small dim">
            Your rating: <StarRow value={summary.mine} size="size-3" />
          </p>
        )}
    </div>
  );
}
