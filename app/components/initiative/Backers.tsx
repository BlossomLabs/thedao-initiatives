import SectionHeading from "~/components/layout/SectionHeading";
import BackerLogo from "~/components/ui/BackerLogo";
import type { Pledge } from "~/lib/api-types";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";

/** A pledge in whole dollars when it is one ("$500", not "$500.00"), so the amounts line up. */
const pledgeUsd = (v: number) =>
  Number.isInteger(v) && v > 0 ? "$" + v.toLocaleString("en-US") : usd(v);

/** Pledge chips under the funding panel; nothing at all until someone has pledged.
 * Headed "Pledges": the card's backer count also includes the on-chain donors. */
export default function Backers({ pledges }: { pledges: Pledge[] }) {
  if (!pledges.length) return null;
  return (
    <>
      <SectionHeading count={pledges.length}>Pledges</SectionHeading>
      {/* Even tiles, so several read as one list: one column on phones, two side by side above. */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {pledges.map((p) => (
          <div
            key={p.id}
            className="flex min-w-0 items-center gap-3 rounded-[14px] border border-edge2 bg-card px-4 py-2.5"
          >
            <BackerLogo logoUrl={p.logoUrl} company={p.company} url={p.url} className="flex-none" />
            <div className="min-w-0">
              <b
                className="block truncate font-inter-tight text-[14px] font-semibold"
                title={p.company}
              >
                {p.url ? <a href={p.url} target="_blank" rel="noopener">{p.company}</a> : p.company}
              </b>
              <span className="mono text-[13px] text-dao-green">{pledgeUsd(p.amountUsd)}</span>
              <small
                className={cn(
                  "ml-2 inline-block text-[11px] uppercase tracking-[.08em] text-muted",
                  p.status === "received" && "text-dao-green",
                )}
              >
                {p.status}
              </small>
              {p.note && <small className="mt-1 block text-[11.5px] text-muted">{p.note}</small>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
