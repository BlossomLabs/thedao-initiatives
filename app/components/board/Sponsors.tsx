import SectionHeading from "~/components/layout/SectionHeading";
import BackerLogo from "~/components/ui/BackerLogo";
import Skeleton from "~/components/ui/Skeleton";
import type { Sponsor } from "~/lib/api-types";
import { cn } from "~/lib/utils";

/** How the full-width row is drawn: up to four at full size, five at a smaller one,
 * and six to eight stacked (logo over name over amount), the only way they fit. */
type Fit = "wide" | "tight" | "stack";
const fitOf = (n: number): Fit => n > 5 ? "stack" : n > 4 ? "tight" : "wide";

/** "Top sponsors of security for Ethereum": the biggest pledgers (eight at most) side by side
 * in one panel, biggest first, each the same width, a hairline between each. The row needs the full
 * page width: under 1100px the panel holds them two to a line, and on phones one
 * to a line. While the board loads, a panel-shaped skeleton holds the place so the
 * rest of the page does not jump once the sponsors arrive. */
export default function Sponsors(
  { sponsors, loading }: { sponsors?: Sponsor[]; loading?: boolean },
) {
  if (!loading && !sponsors?.length) return null;
  const fit = fitOf(sponsors?.length ?? 0);
  return (
    <section className="mx-auto max-w-[1100px] px-6" aria-labelledby="sponsors">
      <SectionHeading id="sponsors" className="max-[640px]:text-center">
        Top sponsors of security for Ethereum
      </SectionHeading>
      {sponsors?.length
        ? (
          <ol
            className={cn(
              "m-0 grid list-none rounded-2xl border border-white/[.09] bg-white/5 px-5 py-1.5 min-[641px]:grid-cols-2 min-[641px]:gap-x-6 min-[1100px]:auto-cols-[minmax(0,1fr)] min-[1100px]:grid-flow-col min-[1100px]:grid-cols-none min-[1100px]:gap-0",
              {
                wide: "min-[1100px]:px-1 min-[1100px]:py-6",
                tight: "min-[1100px]:px-2 min-[1100px]:py-5",
                stack: "min-[1100px]:px-3 min-[1100px]:py-6",
              }[fit],
            )}
          >
            {sponsors.map((s) => <Entry key={s.company} s={s} fit={fit} />)}
          </ol>
        )
        : (
          <div aria-busy="true">
            <Skeleton className="h-[114px] rounded-2xl" />
          </div>
        )}
    </section>
  );
}

/** Whole dollars: a leaderboard ranks, it does not account. */
const dollars = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

function Entry({ s, fit }: { s: Sponsor; fit: Fit }) {
  return (
    <li
      className={cn(
        "flex min-w-0 items-center gap-4 border-t border-white/10 py-3.5 font-inter-tight text-white first:border-t-0 min-[641px]:border-t-0 min-[1100px]:border-l min-[1100px]:py-0 min-[1100px]:first:border-l-0",
        {
          wide: "min-[1100px]:px-5",
          tight: "min-[1100px]:gap-2 min-[1100px]:px-3",
          stack:
            "min-[1100px]:flex-col min-[1100px]:items-center min-[1100px]:justify-start min-[1100px]:gap-3.5 min-[1100px]:px-2 min-[1100px]:text-center",
        }[fit],
      )}
    >
      {/* The cards' "Pledged by" mark, larger; a silhouette when none was uploaded. */}
      <BackerLogo
        logoUrl={s.logoUrl}
        company={s.company}
        className={cn(
          "size-14 flex-none p-2 [&>svg]:size-5",
          {
            wide: "min-[1100px]:size-16 min-[1100px]:p-2.5 min-[1100px]:[&>svg]:size-6",
            tight: "min-[1100px]:size-12 min-[1100px]:p-1.5",
            stack: "min-[1100px]:size-[52px] min-[1100px]:p-2",
          }[fit],
        )}
      />
      <div
        className={cn(
          "min-w-0 break-words",
          // Stacked, the amount leads, above the logo, so the amounts share one line
          // however many lines the names take.
          fit === "stack" &&
            "min-[1100px]:contents",
        )}
      >
        <b
          title={s.company}
          className={cn(
            "line-clamp-3 text-balance text-[17px] font-bold leading-[1.2]",
            {
              wide: "min-[1100px]:text-[19px]",
              tight: "min-[1100px]:text-[16px]",
              stack:
                "min-[1100px]:w-full min-[1100px]:text-[14px] min-[1100px]:font-semibold min-[1100px]:leading-[1.3]",
            }[fit],
          )}
        >
          {s.url
            ? (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white hover:underline"
              >
                {s.company}
              </a>
            )
            : s.company}
        </b>
        <span
          className={cn(
            "mono mt-1 block text-[13px] text-dao-green",
            fit === "wide" && "min-[1100px]:text-[14px]",
            fit === "stack" &&
              "min-[1100px]:order-first min-[1100px]:mt-0 min-[1100px]:text-[16px] min-[1100px]:leading-none",
          )}
        >
          <span className="whitespace-nowrap">{dollars(s.totalUsd)}</span> {
            /* Stacked, the figure is the headline and "pledged by" its caption, read
            down into the logo and the name. */
          }
          <span
            className={cn(
              fit === "stack" &&
                "min-[1100px]:mt-2 min-[1100px]:block min-[1100px]:font-inter-tight min-[1100px]:text-[10px] min-[1100px]:uppercase min-[1100px]:tracking-[.18em] min-[1100px]:text-white/45",
            )}
          >
            {fit === "stack" ? "pledged by" : "pledged"}
          </span>
        </span>
      </div>
    </li>
  );
}
