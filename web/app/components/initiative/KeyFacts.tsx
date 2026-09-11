import type { Initiative, Summary } from "~/lib/api-types";
import { plural, usd } from "~/lib/format";
import { httpsHref } from "~/lib/utils";

/**
 * Side card with the page facts the funding panel does not already show:
 * duration, recipient, what a top-up still needs, and who reviews it.
 */
export default function KeyFacts({ r, summary }: { r: Initiative; summary: Summary }) {
  const grant = r.type === "grant";
  const topup = grant && r.topup;
  const href = httpsHref(r.recipientUrl);
  const rows: { label: string; value: React.ReactNode }[] = [];
  rows.push({
    label: "Expected duration",
    value: r.durationMonths ? `About ${plural(r.durationMonths, "month")}` : "Duration not stated",
  });
  if (grant && r.recipientTeam) {
    rows.push({
      label: "Recipient",
      value: href
        ? <a href={href} target="_blank" rel="noopener noreferrer">{r.recipientTeam}</a>
        : r.recipientTeam,
    });
  }
  if (topup && summary.pledged > 0) {
    rows.push({
      label: "Already committed",
      value: (
        <>
          <b className="text-white">{usd(summary.pledged)}</b>; this grant raises the remaining{" "}
          <b className="text-white">{usd(Math.max(0, r.goalUsd - summary.pledged))}</b>
        </>
      ),
    });
  }
  if (topup && r.milestoneReviewer) {
    rows.push({ label: "Milestone reviewer", value: r.milestoneReviewer });
  }
  return (
    <div className="panel">
      <span className="k">Key facts</span>
      <dl className="m-0 flex flex-col divide-y divide-white/[.08] small">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[88px_1fr] gap-x-4 py-2 first:pt-0 last:pb-0"
          >
            <dt className="dim">{row.label}</dt>
            <dd className="m-0 text-soft">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
