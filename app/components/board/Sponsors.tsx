import SectionHeading from "~/components/layout/SectionHeading";
import BackerLogo from "~/components/ui/BackerLogo";
import Skeleton from "~/components/ui/Skeleton";
import type { Sponsor } from "~/lib/api-types";
import { cn } from "~/lib/utils";

const GRID = "m-0 grid list-none grid-cols-2 gap-4 p-0 max-[640px]:grid-cols-1";

/** "Top sponsors of security for Ethereum": the five biggest pledgers as a numbered
 * board, two to a row. The leader takes the first row alone, inverted to white.
 * While the board loads, five card-shaped skeletons hold the place so the rest of
 * the page does not jump once the sponsors arrive. */
export default function Sponsors(
  { sponsors, loading }: { sponsors?: Sponsor[]; loading?: boolean },
) {
  if (!loading && !sponsors?.length) return null;
  return (
    <section className="mx-auto max-w-[1100px] px-6" aria-labelledby="sponsors">
      <SectionHeading id="sponsors" className="max-[640px]:text-center">
        Top sponsors of security for Ethereum
      </SectionHeading>
      {sponsors?.length
        ? (
          <ol className={GRID}>
            {sponsors.map((s, i) => <Entry key={s.company} s={s} rank={i + 1} lead={i === 0} />)}
          </ol>
        )
        : (
          <div className={GRID} aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton
                key={i}
                className={cn(
                  "h-[78px] rounded-2xl",
                  i === 0 && "col-span-2 max-[640px]:col-span-1",
                )}
              />
            ))}
          </div>
        )}
    </section>
  );
}

/** Whole dollars: a leaderboard ranks, it does not account. */
const dollars = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

function Entry({ s, rank, lead }: { s: Sponsor; rank: number; lead: boolean }) {
  return (
    <li
      className={cn(
        "flex items-center gap-4 rounded-2xl border px-5 py-4 font-inter-tight max-[640px]:gap-3.5 max-[640px]:px-4",
        lead
          ? "col-span-2 border-white bg-white text-dao-blue-dark max-[640px]:col-span-1"
          : "border-white/[.09] bg-white/5 text-white",
      )}
    >
      {
        /* The same round mark as the cards' "Pledged by" strip; a silhouette when none
          was uploaded, drawn in blue on the white leader card. */
      }
      <BackerLogo
        logoUrl={s.logoUrl}
        company={s.company}
        className={cn(
          "size-11 flex-none",
          lead && (s.logoUrl
            ? "border-dao-blue-dark/15"
            : "border-dao-blue-dark/20 bg-dao-blue-dark/[.07] text-dao-blue-dark/50"),
        )}
      />
      <div className="min-w-0 flex-1">
        <b className="block text-[17px] font-bold leading-tight">
          {s.url
            ? (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("hover:underline", lead ? "text-dao-blue-dark" : "text-white")}
              >
                {s.company}
              </a>
            )
            : s.company}
        </b>
        <span
          className={cn("mono mt-0.5 block text-[13px]", lead ? "text-dao-blue" : "text-dao-green")}
        >
          {dollars(s.totalUsd)} pledged
        </span>
      </div>
      {/* The list numbers the entries; the numeral is the picture of it. */}
      <span
        className="tnum flex-none text-right text-[44px] font-bold leading-none tracking-[-.05em]"
        aria-hidden="true"
      >
        <span
          className={cn(
            "mr-0.5 align-baseline text-[28px] font-semibold tracking-normal",
            lead ? "text-dao-blue" : "text-white/45",
          )}
        >
          #
        </span>
        {String(rank).padStart(2, "0")}
      </span>
    </li>
  );
}
