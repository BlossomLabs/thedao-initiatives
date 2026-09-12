/**
 * The draft as the site publishes it: the real page components fed from the
 * draft, with the panel the site adds and the side cards. Nothing is posted.
 */
import { useEffect, useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { parseAmount } from "@shared/draft/mod";
import SectionHeading from "~/components/layout/SectionHeading";
import Backers from "~/components/initiative/Backers";
import FundingHead from "~/components/initiative/FundingHead";
import KeyFacts from "~/components/initiative/KeyFacts";
import Links from "~/components/initiative/Links";
import Milestones from "~/components/initiative/Milestones";
import RulesPanel from "~/components/initiative/RulesPanel";
import Sections from "~/components/initiative/Sections";
import { TypeBadge } from "~/components/ui/Badge";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import { WHAT_NEXT } from "~/data/what-next";
import type { Initiative, Pledge, Summary } from "~/lib/api-types";
import { pct as pctOf } from "~/lib/format";
import { httpsHref } from "~/lib/utils";
import type { Draft } from "./types";
import { linksOf, liveBackers, payloadMilestones, sectionsOf } from "./useDraft";

export const PREVIEW_BANNER =
  "Preview. This is what the site publishes, including the panel the site adds for you. Nothing is submitted yet.";

/** The draft as the Initiative shape the page components read. */
export function previewInitiative(d: Draft): Initiative {
  const grant = d.type === "grant";
  return {
    id: "",
    slug: "",
    title: d.page.title.trim() || "Untitled initiative",
    summary: d.page.summary.trim(),
    details: "",
    discourseUrl: d.page.discourseUrl.trim(),
    goalUsd: parseAmount(d.page.goal),
    status: "pending",
    type: d.type,
    sortRank: null,
    safeAddress: "",
    paidOutUsd: 0,
    proposer: "",
    durationMonths: parseInt(d.page.duration, 10) || null,
    recipientTeam: grant ? d.page.recipientTeam.trim() : "",
    recipientUrl: grant ? d.page.recipientUrl.trim() : "",
    topup: grant && d.topup,
    milestoneReviewer: grant && d.topup ? d.milestoneReviewer.trim() : "",
    sections: sectionsOf(d),
    milestones: payloadMilestones(d),
    links: linksOf(d),
    structured: true,
    revision: 0,
    createdAt: 0,
    approvedAt: null,
  };
}

export default function PreviewPane({ draft, onBack }: { draft: Draft; onBack: () => void }) {
  const r = useMemo(() => previewInitiative(draft), [draft]);
  const live = liveBackers(draft);
  // object URLs for the chosen logo files, revoked when the list changes
  const logoUrls = useMemo(
    () =>
      live.map((b) =>
        b.logo && typeof URL.createObjectURL === "function" ? URL.createObjectURL(b.logo) : ""
      ),
    [live.map((b) => b.id + ":" + (b.logo?.name ?? "")).join("|")],
  );
  useEffect(() => () => {
    for (const u of logoUrls) if (u) URL.revokeObjectURL(u);
  }, [logoUrls]);
  const pledges: Pledge[] = live.map((b, i) => ({
    id: b.id,
    company: b.org.trim() || "Unnamed backer",
    amountUsd: parseAmount(b.amount),
    status: "pledged",
    note: "",
    url: httpsHref(b.url.trim()),
    logoUrl: logoUrls[i] ?? "",
    createdAt: 0,
  }));
  const pledged = pledges.reduce((a, p) => a + p.amountUsd, 0);
  const summary: Summary = {
    pledged,
    donated: 0,
    total: pledged,
    live: false,
    ledger: 0,
    paidOut: 0,
  };
  const pct = pctOf(pledged, r.goalUsd);
  useEffect(() => {
    globalThis.scrollTo?.({ top: 0, behavior: "smooth" });
  }, []);
  return (
    <div>
      <Status kind="wait" className="flex flex-wrap items-center justify-between gap-3">
        <span>{PREVIEW_BANNER}</span>
        <Button variant="ghost" sm onClick={onBack}>
          <ArrowLeft className="size-3.5" />Back to editing
        </Button>
      </Status>
      <h1 className="m-0 mb-3 mt-6 font-inter-tight text-[clamp(28px,4vw,44px)] font-bold leading-[1.1] tracking-[-.02em]">
        {r.title}
      </h1>
      <p className="m-0 flex flex-wrap items-center gap-3">
        <TypeBadge type={r.type} inline />
        {r.type === "grant" && r.topup && (
          <span className="chip chip-badge" title="Work already under way with another funder">
            top-up, work under way
          </span>
        )}
        {r.type === "grant" && r.recipientTeam && (
          <span className="chip chip-badge">
            to {httpsHref(r.recipientUrl)
              ? (
                <a href={httpsHref(r.recipientUrl)} target="_blank" rel="noopener noreferrer">
                  {r.recipientTeam}
                </a>
              )
              : r.recipientTeam}
          </span>
        )}
        <span className="chip chip-badge st-pending">pending review</span>
      </p>
      <div className="mt-4 grid grid-cols-[1fr_340px] items-start gap-9 max-[960px]:grid-cols-1">
        <div className="min-w-0">
          <FundingHead summary={summary} goal={r.goalUsd} pct={pct} funded={false} />
          <Backers pledges={pledges} />
          <SectionHeading>Summary</SectionHeading>
          <p className="md m-0 whitespace-pre-line">{r.summary}</p>
          <Sections type={r.type} sections={r.sections} />
          <Milestones type={r.type} topup={r.topup} milestones={r.milestones} />
          <Links links={r.links} />
          <RulesPanel r={r} />
        </div>
        <aside className="flex flex-col gap-3.5 max-[960px]:static">
          <KeyFacts r={r} summary={summary} />
          <div className="panel">
            <span className="k">What happens next</span>
            <p className="m-0 small dim">{WHAT_NEXT[r.type]}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
