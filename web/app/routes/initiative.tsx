import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import PageMain from "~/components/layout/PageMain";
import SectionHeading from "~/components/layout/SectionHeading";
import { TypeBadge } from "~/components/ui/Badge";
import Skeleton from "~/components/ui/Skeleton";
import PageSkeleton from "~/components/layout/PageSkeleton";
import Markdown from "~/components/Markdown";
import FundingHead from "~/components/initiative/FundingHead";
import Backers from "~/components/initiative/Backers";
import DonationsTable from "~/components/initiative/DonationsTable";
import SideCards from "~/components/initiative/SideCards";
import CommentsSection from "~/components/comments/CommentsSection";
import { initiativeKey, useInitiative } from "~/hooks/use-initiative";
import { useBoard } from "~/hooks/use-board";
import { ApiError } from "~/lib/api";
import { SITE_NAME } from "~/data/site";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({ title: "Initiative" });
}

export default function Initiative() {
  const { slug = "" } = useParams();
  const { data: page, isLoading, error, isPlaceholderData } = useInitiative(slug);
  const board = useBoard();
  const qc = useQueryClient();

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
  if (isLoading || !page) return <PageSkeleton />;
  const r = page.initiative;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: initiativeKey(slug) });
    void qc.invalidateQueries({ queryKey: ["board"] });
  };
  return (
    <PageMain detail>
      <p className="m-0 mb-2.5">
        <Link to="/">← All initiatives</Link>
      </p>
      <h1 className="m-0 mb-3 mt-1.5 font-inter-tight text-[clamp(28px,4vw,44px)] font-bold leading-[1.1] tracking-[-.02em]">
        {r.title}
      </h1>
      <p className="m-0 flex flex-wrap items-center gap-3">
        {r.discourseUrl && (
          <a
            className="btn btn-discuss btn-sm"
            href={r.discourseUrl}
            target="_blank"
            rel="noopener"
          >
            <MessageSquare className="size-[15px]" />Discuss this initiative on the forum
          </a>
        )}
        <TypeBadge type={r.type} inline />
        {r.status === "archived" && <span className="chip st-archived">archived</span>}
      </p>

      <div className="mt-4 grid grid-cols-[1fr_340px] items-start gap-9 max-[960px]:grid-cols-1">
        <div className="min-w-0">
          <FundingHead
            summary={page.summary}
            goal={r.goalUsd}
            pct={page.pct}
            funded={page.funded}
          />
          <SectionHeading>Summary</SectionHeading>
          <p className="md m-0 whitespace-pre-line">{r.summary}</p>
          <SectionHeading>Full initiative details</SectionHeading>
          {r.details ? <Markdown text={r.details} /> : (
            <p className="text-muted">
              The complete spec (scope, milestones, budget breakdown) is being written.
              {r.discourseUrl && (
                <>
                  Follow and shape it{" "}
                  <a href={r.discourseUrl} target="_blank" rel="noopener">on the forum thread</a>.
                </>
              )}
            </p>
          )}
          <CommentsSection slug={r.slug} open={r.status === "approved"} />
          {isPlaceholderData
            ? (
              <>
                <SectionHeading>Backers</SectionHeading>
                <Skeleton className="h-11 w-64" />
                <SectionHeading>On-chain donations</SectionHeading>
                <Skeleton className="h-11" />
              </>
            )
            : (
              <>
                <Backers pledges={page.pledges} />
                <DonationsTable donations={page.donations} />
              </>
            )}
        </div>
        <SideCards
          page={page}
          safeThreshold={board.data?.flags.safeThreshold}
          onDonated={refresh}
        />
      </div>
    </PageMain>
  );
}
