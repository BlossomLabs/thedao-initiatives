import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import PageMain from "~/components/layout/PageMain";
import Crumbs from "~/components/layout/Crumbs";
import SectionHeading from "~/components/layout/SectionHeading";
import { TypeBadge } from "~/components/ui/Badge";
import { CategoryLink, CategoryTag } from "~/components/ui/CategoryTag";
import Skeleton from "~/components/ui/Skeleton";
import PageSkeleton from "~/components/layout/PageSkeleton";
import Markdown from "~/components/Markdown";
import FundingHead from "~/components/initiative/FundingHead";
import Backers from "~/components/initiative/Backers";
import DonationsTable from "~/components/initiative/DonationsTable";
import SideCards from "~/components/initiative/SideCards";
import RulesPanel from "~/components/initiative/RulesPanel";
import MarkdownLink from "~/components/initiative/MarkdownLink";
import Sections from "~/components/initiative/Sections";
import Milestones from "~/components/initiative/Milestones";
import Links from "~/components/initiative/Links";
import { DiffBlock, type ViewMode } from "~/components/initiative/RevisionBar";
import CommentsSection from "~/components/comments/CommentsSection";
import Identity from "~/components/wallet/Identity";
import { initiativeKey, useInitiative } from "~/hooks/use-initiative";
import { useRevision } from "~/hooks/use-revision";
import { useSiteSettings } from "~/hooks/use-site-settings";
import { ApiError, errorMessage } from "~/lib/api";
import { diffCategories, diffRevisions } from "~/lib/revision-diff";
import type { RevisionState, RevisionText } from "~/lib/api-types";
import Status from "~/components/ui/Status";
import { SITE_NAME } from "~/data/site";
import { dt } from "~/lib/format";
import { discussionKind } from "~/lib/discussion";
import { generateMeta } from "~/utils/meta";
import { isStructured } from "@shared/draft/mod";

/** What the chip says when the version on screen is an edit that is not public. */
const UNPUBLISHED: Partial<Record<RevisionState, string>> = {
  pending: "edit in review",
  rejected: "edit not accepted",
};

export function meta() {
  return generateMeta({ title: "Initiative" });
}

export default function Initiative() {
  const { slug = "" } = useParams();
  const { data: page, isLoading, error, refetch, isPlaceholderData, isUpdatingLedger } =
    useInitiative(slug);
  const qc = useQueryClient();

  // ?rev=N opens an older revision in place of the current text. The history
  // list comes with the page; the older text is fetched on demand.
  const [params] = useSearchParams();
  const current = page?.initiative.revision ?? 0;
  const asked = Number(params.get("rev"));
  const viewing = Number.isInteger(asked) && asked > 0 && asked !== current ? asked : current;
  const older = useRevision(slug, viewing !== current ? viewing : null);
  const { data: site } = useSiteSettings();
  const revisions = page?.revisions ?? [];
  const idx = revisions.findIndex((v) => v.n === viewing);
  const [mode, setMode] = useState<ViewMode>("rendered");
  const prevMeta = idx > 0 ? revisions[idx - 1] : null;
  const prev = useRevision(slug, mode === "changes" && prevMeta ? prevMeta.n : null);

  useEffect(() => {
    if (page) document.title = `${page.initiative.title} · ${SITE_NAME}`;
  }, [page]);

  if (error instanceof ApiError && error.status === 404) {
    return (
      <PageMain detail center className="min-h-[50vh]">
        <h1 className="font-inter-tight text-[40px] font-medium tracking-[-.02em]">404</h1>
        <p className="text-muted">That initiative does not exist or is not published.</p>
        <Link className="btn mt-4" to="/">All initiatives</Link>
      </PageMain>
    );
  }
  // Any other failure (the API is down, a 500): say so instead of a skeleton forever.
  if (error && !page) {
    return (
      <PageMain detail center className="min-h-[50vh]">
        <h1 className="font-inter-tight text-[28px] font-medium tracking-[-.02em]">
          This initiative could not be loaded
        </h1>
        <p className="text-muted" role="alert">{errorMessage(error)}</p>
        <div className="mt-4 flex justify-center gap-2.5">
          <button type="button" className="btn" onClick={() => void refetch()}>Try again</button>
          <Link className="btn" to="/">All initiatives</Link>
        </div>
      </PageMain>
    );
  }
  if (isLoading || !page) return <PageSkeleton />;
  const r = page.initiative;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: initiativeKey(slug) });
    void qc.invalidateQueries({ queryKey: ["board"] });
  };
  // The text on screen: the current one, or the older revision once loaded.
  const showingOld = viewing !== current && !older.error && Boolean(older.data);
  const text: RevisionText = showingOld ? older.data! : r;
  // An edit that was never published (in review, rejected) is not in the
  // history: its changes are against the live text, not a revision before it.
  const unpublished = showingOld && older.data!.state !== "live";
  const diff = mode === "changes" && !older.error && !prev.error &&
      (unpublished || prev.data || !prevMeta)
    ? diffRevisions(unpublished ? r : prev.data ?? null, text, r.type)
    : null;
  // The categories of the version on screen; one written before revisions
  // recorded them shows the current ones, and its changes view marks none.
  const categories = showingOld ? older.data!.categories : r.categories;
  const before = unpublished ? r.categories : prevMeta ? prev.data?.categories ?? null : [];
  const tags = (diff && diffCategories(before, categories)) ||
    (categories ?? r.categories).map((slug) => ({ slug, added: false, removed: false }));
  // Structured rows render their sections, milestones and links; a legacy
  // revision (or one side of a diff) still shows the details blob.
  const structured = isStructured(text) || Boolean(diff?.structured);
  const showBar = revisions.length > 1 || viewing !== current;
  return (
    <PageMain detail>
      <Crumbs items={[{ label: "Initiatives", to: "/" }]} />
      <h1 className="m-0 mb-3 mt-1.5 font-inter-tight text-[clamp(28px,4vw,44px)] font-bold leading-[1.1] tracking-[-.02em]">
        {diff ? <DiffBlock chunks={diff.title} /> : text.title}
      </h1>
      <p className="m-0 flex flex-wrap items-center gap-3">
        <TypeBadge type={r.type} inline />
        {tags.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5" data-categories="">
            {tags.map(({ slug, added, removed }) =>
              added
                ? (
                  <ins key={slug} className="tag-added">
                    <CategoryTag slug={slug} />
                  </ins>
                )
                : removed
                ? (
                  <del key={slug} className="tag-removed">
                    <CategoryTag slug={slug} />
                  </del>
                )
                : <CategoryLink key={slug} slug={slug} />
            )}
          </span>
        )}
        {r.status === "archived" && <span className="chip chip-badge st-archived">archived</span>}
        {r.status === "pending" && (
          <span
            className="chip chip-badge st-pending"
            title="Only you and the team can see it until it is approved"
          >
            pending review
          </span>
        )}
        {r.status === "rejected" && (
          <span
            className="chip chip-badge st-rejected"
            title="Only you and the team can see it"
          >
            not accepted
          </span>
        )}
        {showingOld && (
          <span
            className="chip chip-badge st-pending"
            title={older.data!.state === "live"
              ? "An older revision of the text is open"
              : "This edit was never published; only you and the team can see it"}
          >
            {UNPUBLISHED[older.data!.state] ?? "superseded"}
          </span>
        )}
      </p>
      {r.pendingRevision && viewing !== r.pendingRevision && (
        <Status kind="wait" className="mt-4">
          An edit to this initiative is waiting for the team's review. This page shows the approved
          version. <Link to={`/initiative/${r.slug}?rev=${r.pendingRevision}`}>See the edit</Link>
        </Status>
      )}
      {viewing !== current && older.error && (
        <p className="alert" role="alert">
          That revision is not available. Showing the current text instead.
        </p>
      )}

      <div className="mt-4 grid grid-cols-[1fr_340px] items-start gap-9 max-[960px]:grid-cols-1">
        <div className="min-w-0">
          <FundingHead
            summary={page.summary}
            goal={r.goalUsd}
            pct={page.pct}
            funded={page.funded}
            vote={r.status === "approved" ? site?.vote : undefined}
          />
          {!isPlaceholderData && <Backers pledges={page.pledges} />}
          <SectionHeading>Summary</SectionHeading>
          {diff
            ? <DiffBlock chunks={diff.summary} className="diff-body" />
            : <p className="md m-0 whitespace-pre-line">{text.summary}</p>}
          {isPlaceholderData
            ? (
              <>
                <SectionHeading>Full initiative details</SectionHeading>
                <Skeleton className="h-40" />
              </>
            )
            : structured
            ? (
              <>
                <Sections type={r.type} sections={text.sections ?? {}} diff={diff} />
                <Milestones
                  type={r.type}
                  topup={r.type === "grant" && r.topup}
                  milestones={text.milestones ?? []}
                  diff={diff}
                />
                <Links links={text.links ?? []} diff={diff} />
                {diff && diff.details.length > 0 && (
                  <>
                    <SectionHeading>Full initiative details</SectionHeading>
                    <DiffBlock chunks={diff.details} className="mono text-[13px]" />
                  </>
                )}
              </>
            )
            : (
              <>
                <SectionHeading>Full initiative details</SectionHeading>
                {diff
                  ? (diff.details.length
                    ? <DiffBlock chunks={diff.details} className="mono text-[13px]" />
                    : <p className="text-muted">No details in either revision.</p>)
                  : text.details
                  ? <Markdown text={text.details} />
                  : (
                    <p className="text-muted">
                      The complete spec (scope, milestones, budget breakdown) is being written.
                      {r.discourseUrl && (
                        <>
                          Follow and shape it{" "}
                          <a href={r.discourseUrl} target="_blank" rel="noopener">
                            {discussionKind(r.discourseUrl) === "telegram"
                              ? "in the group discussion"
                              : "on the forum thread"}
                          </a>.
                        </>
                      )}
                    </p>
                  )}
              </>
            )}
          {!isPlaceholderData && <RulesPanel r={r} />}
          <CommentsSection
            key={r.id}
            initiativeId={r.id}
            slug={r.slug}
            open={r.status === "approved"}
          />
          {isPlaceholderData
            ? (
              <>
                <SectionHeading>On-chain donations</SectionHeading>
                <Skeleton className="h-11" />
              </>
            )
            : (
              <DonationsTable
                donations={page.donations}
                ledger={page.ledger}
                updating={isUpdatingLedger}
              />
            )}
          <p className="mt-7 flex flex-wrap items-center gap-2 border-t border-white/[.08] pt-4 text-[13.5px] text-muted">
            {!isPlaceholderData && r.proposer && (
              <>
                Proposed by <Identity address={r.proposer} size={20} />
                <span>on {dt(r.createdAt)}</span>
              </>
            )}
            {(r.status === "approved" || r.status === "archived") && <MarkdownLink slug={r.slug} />}
          </p>
        </div>
        <SideCards
          page={page}
          placeholder={isPlaceholderData}
          onDonated={refresh}
          revisions={showBar ? { viewing, current, mode, onMode: setMode } : undefined}
        />
      </div>
    </PageMain>
  );
}
