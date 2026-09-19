import SectionHeading from "~/components/layout/SectionHeading";
import BackerLogo from "~/components/ui/BackerLogo";
import type { Pledge } from "~/lib/api-types";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";

/** Pledge chips under the funding panel; nothing at all until someone has pledged.
 * Headed "Pledges": the card's backer count also includes the on-chain donors. */
export default function Backers({ pledges }: { pledges: Pledge[] }) {
  if (!pledges.length) return null;
  return (
    <>
      <SectionHeading count={pledges.length}>Pledges</SectionHeading>
      <div className="flex flex-wrap gap-2.5">
        {pledges.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-[14px] border border-edge2 bg-card px-4 py-2.5"
          >
            <BackerLogo logoUrl={p.logoUrl} company={p.company} url={p.url} className="flex-none" />
            <div>
              <b className="mr-2 font-inter-tight text-[14px] font-semibold">
                {p.url ? <a href={p.url} target="_blank" rel="noopener">{p.company}</a> : p.company}
              </b>
              <span className="mono text-[13px] text-dao-green">{usd(p.amountUsd)}</span>
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
