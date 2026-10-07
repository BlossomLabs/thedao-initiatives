/**
 * The draft as the site publishes it: the header, body and side cards of the
 * initiative page, the same components fed from the draft. The banner carries
 * the way back and the submit button. Nothing is posted until it is pressed.
 */
import { useEffect, useMemo } from "react";
import { ArrowLeft, Send } from "lucide-react";
import { parseAmount } from "@shared/draft/mod";
import CommentsClosed from "~/components/comments/CommentsClosed";
import SectionHeading from "~/components/layout/SectionHeading";
import Backers from "~/components/initiative/Backers";
import FundingHead from "~/components/initiative/FundingHead";
import Milestones from "~/components/initiative/Milestones";
import RulesPanel from "~/components/initiative/RulesPanel";
import Sections from "~/components/initiative/Sections";
import { PublicCards } from "~/components/initiative/SideCards";
import StickyAside from "~/components/layout/StickyAside";
import { TypeBadge } from "~/components/ui/Badge";
import { Button } from "~/components/ui/Button";
import { CategoryTag } from "~/components/ui/CategoryTag";
import Status from "~/components/ui/Status";
import Identity from "~/components/wallet/Identity";
import type { Initiative, Pledge, Summary } from "~/lib/api-types";
import { dt, pct as pctOf } from "~/lib/format";
import { httpsHref } from "~/lib/utils";
import type { Draft } from "./types";
import { linksOf, liveBackers, payloadMilestones, sectionsOf } from "./useDraft";

export const PREVIEW_BANNER =
  "Preview. This is what the site publishes, including the panel the site adds for you. Nothing is submitted yet.";

/** What the draft cannot say about its page: who proposed it, when, and where it stands. */
export type PreviewAs = Partial<Pick<Initiative, "proposer" | "createdAt" | "status">>;

/** The draft as the Initiative shape the page components read. */
export function previewInitiative(d: Draft, as: PreviewAs = {}): Initiative {
  const grant = d.type === "grant";
  return {
    id: "",
    slug: "",
    title: d.page.title.trim() || "Untitled initiative",
    summary: d.page.summary.trim(),
    details: "",
    discourseUrl: d.page.discourseUrl.trim(),
    goalUsd: parseAmount(d.page.goal),
    categories: d.categories,
    status: as.status ?? "pending",
    type: d.type,
    sortRank: null,
    safeAddress: "",
    paidOutUsd: 0,
    proposer: as.proposer ?? "",
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
    createdAt: as.createdAt ?? Math.floor(Date.now() / 1000),
    approvedAt: null,
  };
}

const blockedLine = (n: number) =>
  n === 1 ? "One thing needs fixing first." : `${n} things need fixing first.`;

export default function PreviewPane(
  { draft, as, onBack, submit }: {
    draft: Draft;
    as?: PreviewAs;
    onBack: () => void;
    submit: {
      label: string;
      /** How many errors stand in the way; the button is disabled above zero. */
      blocked: number;
      busy: boolean;
      /** Runs the form's submit; with errors it goes back to editing and marks them. */
      onSubmit: () => void;
    };
  },
) {
  const r = useMemo(
    () => previewInitiative(draft, as),
    [draft, as?.proposer, as?.createdAt, as?.status],
  );
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
    received: 0,
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
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" sm onClick={onBack}>
            <ArrowLeft className="size-3.5" />Back to editing
          </Button>
          <Button
            variant="primary"
            sm
            loading={submit.busy}
            disabled={submit.busy || submit.blocked > 0}
            onClick={submit.onSubmit}
          >
            {!submit.busy && <Send className="size-3.5" />}
            {submit.label}
          </Button>
        </span>
      </Status>
      {submit.blocked > 0 && (
        <p className="m-0 mt-2 text-right small text-[#ffd7d6]" role="status">
          {blockedLine(submit.blocked)}{" "}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[inherit] underline"
            onClick={submit.onSubmit}
          >
            {submit.blocked === 1 ? "Show it" : "Show them"}
          </button>
        </p>
      )}
      <h1 className="m-0 mb-3 mt-6 font-inter-tight text-[clamp(28px,4vw,44px)] font-bold leading-[1.1] tracking-[-.02em]">
        {r.title}
      </h1>
      <p className="m-0 flex flex-wrap items-center gap-3">
        <TypeBadge type={r.type} inline />
        {r.categories.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5" data-categories="">
            {r.categories.map((slug) => <CategoryTag key={slug} slug={slug} />)}
          </span>
        )}
        {r.status === "archived" && <span className="chip chip-badge st-archived">archived</span>}
        {r.status === "pending" && (
          <span className="chip chip-badge st-pending">pending review</span>
        )}
        {r.status === "rejected" && (
          <span className="chip chip-badge st-rejected">not accepted</span>
        )}
      </p>
      <div className="mt-4 grid grid-cols-[1fr_340px] items-start gap-9 max-[960px]:grid-cols-1">
        <div className="min-w-0">
          <FundingHead summary={summary} goal={r.goalUsd} pct={pct} funded={false} />
          <Backers pledges={pledges} />
          <SectionHeading>Summary</SectionHeading>
          <p className="md m-0 whitespace-pre-line">{r.summary}</p>
          <Sections type={r.type} sections={r.sections} />
          <Milestones type={r.type} topup={r.topup} milestones={r.milestones} />
          <RulesPanel r={r} />
          {r.status !== "approved" && r.status !== "archived" && (
            <CommentsClosed status={r.status} />
          )}
          {r.proposer && (
            <p className="mt-7 flex flex-wrap items-center gap-2 border-t border-white/[.08] pt-4 text-[13.5px] text-muted">
              Proposed by <Identity address={r.proposer} size={20} />
              <span>on {dt(r.createdAt)}</span>
            </p>
          )}
        </div>
        <StickyAside className="flex flex-col gap-3.5 max-[960px]:static">
          <PublicCards r={r} summary={summary} />
        </StickyAside>
      </div>
    </div>
  );
}
