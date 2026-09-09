import SectionHeading from "~/components/layout/SectionHeading";
import type { Pledge } from "~/lib/api-types";
import { usd } from "~/lib/format";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "~/data/site";
import { cn } from "~/lib/utils";

export default function Backers({ pledges }: { pledges: Pledge[] }) {
  return (
    <>
      <SectionHeading count={pledges.length}>Backers</SectionHeading>
      {pledges.length
        ? (
          <div className="flex flex-wrap gap-2.5">
            {pledges.map((p) => (
              <div key={p.id} className="rounded-[14px] border border-edge2 bg-card px-4 py-2.5">
                {p.logoUrl && (
                  <img
                    className="mb-2 block max-h-[34px] max-w-[150px] rounded-md bg-white px-1.5 py-[3px]"
                    src={p.logoUrl}
                    alt={`${p.company} logo`}
                  />
                )}
                <b className="mr-2 font-inter-tight text-[14px] font-semibold">
                  {p.url
                    ? <a href={p.url} target="_blank" rel="noopener">{p.company}</a>
                    : p.company}
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
            ))}
          </div>
        )
        : (
          <p className="text-muted">
            No backer pledges yet. Pledges pay only when the work is completed. Email{" "}
            <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a> to put your name on this initiative.
          </p>
        )}
    </>
  );
}
