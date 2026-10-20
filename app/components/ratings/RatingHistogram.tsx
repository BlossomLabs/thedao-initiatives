import { plural } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { RatingSummary } from "@shared/ratings";
import { StarRow } from "./Stars";

/** The average over five rows, 5★ to 1★, each with its share of the admins who rated. */
export default function RatingHistogram(
  { summary, preview = false }: {
    summary: RatingSummary;
    /** It counts the viewer's unsaved pick: the average in amber. */
    preview?: boolean;
  },
) {
  const { avg, count, dist } = summary;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        {count > 0 && (
          <span
            className={cn(
              "font-inter-tight text-[28px] font-semibold leading-none tnum transition-colors",
              preview ? "text-dao-amber" : "text-white",
            )}
          >
            {avg.toFixed(1)}
          </span>
        )}
        <StarRow value={avg} />
        <span className="small dim">{count ? plural(count, "admin") : "No ratings yet"}</span>
      </div>
      {count > 0 && (
        <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0" aria-label="Ratings by stars">
          {[5, 4, 3, 2, 1].map((n) => {
            const share = dist[n - 1] / count;
            return (
              <li key={n} className="flex items-center gap-2 text-[12px] text-white/55">
                <span className="w-6 flex-none tnum">{n} ★</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="block h-full rounded-full bg-dao-amber transition-[width] duration-300"
                    style={{ width: `${share * 100}%` }}
                  />
                </span>
                <span className="w-9 flex-none text-right tnum">
                  {Math.round(share * 100)}%
                  <span className="sr-only">({dist[n - 1]})</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
