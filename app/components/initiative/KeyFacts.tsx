import type { Initiative, Summary } from "~/lib/api-types";
import { plural, usd } from "~/lib/format";
import { httpsHref } from "~/lib/utils";

/** The domain a link is shown as: the host without a leading "www.". */
export function linkDomain(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/**
 * Side card with the page facts the funding panel does not already show:
 * duration, recipient, what a top-up still needs, who reviews it, and the
 * initiative's links by domain. `links` are those of the text on screen when
 * it is not the current one (an older revision).
 */
export default function KeyFacts(
  { r, summary, links = r.links ?? [] }: { r: Initiative; summary: Summary; links?: string[] },
) {
  const grant = r.type === "grant";
  const topup = grant && r.topup;
  const href = httpsHref(r.recipientUrl);
  const rows: { label: string; value: React.ReactNode }[] = [];
  rows.push({
    label: "Expected duration",
    value: r.durationMonths ? `About ${plural(r.durationMonths, "month")}` : "Duration not stated",
  });
  if (topup) {
    rows.push({ label: "Top-up", value: "Work already under way with another funder" });
  }
  if (grant && r.recipientTeam) {
    rows.push({
      label: "Recipient",
      value: href
        ? <a href={href} target="_blank" rel="noopener noreferrer">{r.recipientTeam}</a>
        : r.recipientTeam,
    });
  }
  // What the other funder committed, whether it is still owed or already paid in.
  const committed = summary.pledged + summary.received;
  if (topup && committed > 0) {
    rows.push({
      label: "Already committed",
      value: (
        <>
          <b className="text-white">{usd(committed)}</b>; this grant raises the remaining{" "}
          <b className="text-white">{usd(Math.max(0, r.goalUsd - committed))}</b>
        </>
      ),
    });
  }
  if (topup && r.milestoneReviewer) {
    rows.push({ label: "Milestone reviewer", value: r.milestoneReviewer });
  }
  // https links as anchors named by their domain, anything else as plain text
  const linkRows = links.map((l) => l.trim()).filter(Boolean);
  if (linkRows.length) {
    rows.push({
      label: "Links",
      value: (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {linkRows.map((l, i) => {
            const to = httpsHref(l);
            return (
              <li key={i} className="[overflow-wrap:anywhere]">
                {to
                  ? (
                    <a href={to} title={l} target="_blank" rel="noopener noreferrer">
                      {linkDomain(to)}
                    </a>
                  )
                  : l}
              </li>
            );
          })}
        </ul>
      ),
    });
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
