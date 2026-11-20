import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, ChevronUp, CornerDownRight, Star } from "lucide-react";
import Markdown from "~/components/Markdown";
import { hasRatingAverage, type RatingSummary } from "@shared/ratings";
import { sessionKey, useSession } from "~/context/session";
import { type AdminReview, useAdminRatings } from "~/hooks/use-admin-ratings";
import { api } from "~/lib/api";
import type { CommentEntry } from "~/lib/api-types";
import { cn } from "~/lib/utils";
import { commentsKey, expertsKey, fetchComments, fetchExperts } from "~/components/comments/api";
import { IdentityRow } from "~/components/comments/EntryCard";
import { QaChip } from "~/components/ui/Badge";
import Identity from "~/components/wallet/Identity";
import { StarRow } from "~/components/ratings/Stars";
import RatingHistogram from "~/components/ratings/RatingHistogram";
import { ago } from "~/lib/format";
import { REVIEWER } from "~/lib/reviewer";
import type { BallotItem } from "./TierBallot";

/** What others say about a ballot initiative, in its Details card: the voting badge
 * holders' reviews and the page's comments, read only. Rating and commenting stay on the
 * initiative's page (one place to rate). On a desktop it is the card's side panel; on a
 * phone, two of the card's tabs. */

export type OthersTab = "reviews" | "comments";

/** Its rating, from the board's one list of every initiative's ratings. */
export function useRating(item: BallotItem): RatingSummary | undefined {
  const ratings = useAdminRatings();
  const id = item.card?.initiative.id;
  return id ? ratings?.[id] : undefined;
}

/** Its reviews and comments, once `enabled` (the panel or tab is showing). The comments
 * share the page's cache. */
export type OthersData = {
  reviews: AdminReview[] | undefined;
  comments: CommentEntry[] | undefined;
  /** A list couldn't be read. */
  failed: boolean;
};

export function useOthersSay(item: BallotItem, enabled: boolean): OthersData {
  const { session } = useSession();
  const id = item.card?.initiative.id ?? "";
  const on = enabled && Boolean(id);
  const reviews = useQuery({
    queryKey: ["ballot-reviews", id],
    queryFn: ({ signal }) =>
      api<{ reviews: AdminReview[] }>(
        `/api/reviews/initiatives/${encodeURIComponent(id)}/reviews`,
        { signal, passive: true },
      ).then((r) => r.reviews),
    enabled: on,
  });
  const comments = useQuery({
    queryKey: commentsKey(item.slug, sessionKey(session), id),
    queryFn: ({ signal }) => fetchComments(item.slug, signal, !session),
    enabled: on,
  });
  const experts = useQuery({
    queryKey: expertsKey(item.slug, sessionKey(session), id),
    queryFn: ({ signal }) => fetchExperts(item.slug, signal, !session),
    enabled: on,
  });
  const expert = new Set(experts.data?.experts ?? []);
  const withExpert = (c: CommentEntry): CommentEntry =>
    c.address && expert.has(c.address.toLowerCase()) && !c.roles.includes("EXPERT")
      ? { ...c, roles: [...c.roles, "EXPERT"] }
      : c;
  return {
    /** The reviews that count (each badge's latest), newest first: never by stars, so a
     * critical one isn't buried. */
    reviews: reviews.data
      ?.filter((r) => r.current)
      .sort((a, b) => b.createdAt - a.createdAt),
    /** Pinned first, then the most voted, then the newest. */
    comments: comments.data?.entries
      .map((c) => ({ ...withExpert(c), replies: c.replies?.map(withExpert) }))
      .sort((a, b) => b.featured - a.featured || b.votes - a.votes || b.createdAt - a.createdAt),
    failed: reviews.isError || comments.isError,
  };
}

/** "★ 4.3 · 7 reviews"; the average only from a few reviews on, as on the board. */
export function RatingLine(
  { summary, className }: { summary: RatingSummary | undefined; className?: string },
) {
  const count = summary?.count ?? 0;
  if (!count) return null;
  const word = count === 1 ? "review" : "reviews";
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap tnum", className)}>
      <Star className="size-3.5 text-dao-amber" fill="currentColor" aria-hidden="true" />
      {hasRatingAverage(summary)
        ? (
          <>
            <b className="font-semibold text-white">{summary!.avg.toFixed(1)}</b>
            <span className="text-white/60">· {count} {word}</span>
          </>
        )
        : <span className="text-white/70">{count} {word}</span>}
    </span>
  );
}

/** The two tabs' names, with their counts once known. */
export const othersLabel = (
  tab: OthersTab,
  n: number | undefined,
) => `${tab === "reviews" ? "Reviews" : "Comments"}${n ? ` ${n}` : ""}`;

/** One tab's list: the reviews or the comments, or why there are none yet. */
export function OthersList(
  { item, tab, data, rating }: {
    item: BallotItem;
    tab: OthersTab;
    data: OthersData;
    /** Over the reviews: their average and 5★ to 1★ bars, as on the page, once there are
     * enough reviews for an average; before that, only the reviews. */
    rating?: RatingSummary;
  },
) {
  const list = tab === "reviews" ? data.reviews : data.comments;
  const page = `/initiative/${item.slug}`;
  if (data.failed && !list) {
    return <p className="m-0 py-4 text-center text-[13px] text-white/55">Couldn't load them.</p>;
  }
  if (!list) {
    return (
      <div aria-hidden="true" className="space-y-2">
        {[0, 1].map((i) => <div key={i} className="h-20 rounded-xl bg-white/[.04]" />)}
      </div>
    );
  }
  if (!list.length) {
    return (
      <p className="m-0 py-4 text-center text-[13px] leading-snug text-white/55">
        {tab === "reviews" ? `No ${REVIEWER} has reviewed it yet.` : "No comments yet."}{" "}
        <a href={`${page}#qa`} target="_blank" rel="noopener noreferrer">
          {tab === "reviews" ? "Write the first review" : "Ask on its page"}
        </a>
      </p>
    );
  }
  return (
    <>
      {tab === "reviews" && hasRatingAverage(rating) && (
        <div className="mb-3 rounded-xl bg-white/[.05] px-3 py-3">
          <RatingHistogram summary={rating!} noun="review" />
        </div>
      )}
      <ul className="m-0 list-none space-y-2 p-0" aria-label={othersLabel(tab, undefined)}>
        {tab === "reviews"
          ? data.reviews!.map((r) => (
            <li key={r.id} className="rounded-xl bg-white/[.05] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/60">
                <Identity address={r.address} size={20} nameClassName="text-[13px]" />
                <StarRow value={r.stars} size="size-3" />
                <span className="ml-auto">{ago(r.createdAt)}</span>
              </div>
              {r.body && <Note text={r.body} />}
            </li>
          ))
          : data.comments!.map((c) => (
            <li key={c.id} className="rounded-xl bg-white/[.05] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] [&_.small]:text-[11.5px]">
                <IdentityRow c={c} />
                {c.featured > 0 && <QaChip tone="feat">Featured</QaChip>}
                {c.type === "question" && c.answered && <QaChip tone="ok">answered ✓</QaChip>}
              </div>
              <Note
                text={c.body}
                more={(c.replies?.length ?? 0) > 0}
                meta={(c.votes > 0 || (c.replies?.length ?? 0) > 1) && (
                  <span className="flex items-center gap-3 text-[12px] text-white/55 tnum">
                    {c.votes > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <ArrowUp className="size-3" aria-hidden="true" />
                        {c.votes} {c.votes === 1 ? "vote" : "votes"}
                      </span>
                    )}
                    {(c.replies?.length ?? 0) > 1 && <span>{c.replies!.length} replies</span>}
                  </span>
                )}
                after={(open) =>
                  (c.replies ?? []).length > 0 && (open
                    ? (
                      <ul className="m-0 mt-2 list-none space-y-2 p-0" aria-label="Replies">
                        {c.replies!.map((r) => (
                          <li key={r.id} className="border-l-2 border-white/15 pl-2.5">
                            <p className="m-0 text-[12px] font-semibold text-white">{replier(r)}</p>
                            <Markdown text={r.body} className="md-note mt-0.5" />
                          </li>
                        ))}
                      </ul>
                    )
                    : (
                      <p className="m-0 mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-white/70">
                        <CornerDownRight className="mt-0.5 size-3.5 flex-none" aria-hidden="true" />
                        <span className="line-clamp-2">
                          <b className="font-semibold text-white">{replier(c.replies![0])}</b>
                          {" · "}
                          {c.replies![0].body}
                        </span>
                      </p>
                    ))}
              />
            </li>
          ))}
      </ul>
    </>
  );
}

/** Who wrote a reply: the proposer, or their name. */
const replier = (r: CommentEntry) =>
  r.roles.includes("PROPOSER") ? "Proposer" : r.displayName || "Reply";

/** A review's or comment's text in markdown, folded to about four lines; Show more opens
 * the rest. `more`: there is more to open even when the text fits (a comment's replies);
 * `after` draws what comes under the text, folded or open. */
function Note(
  { text, more = false, after, meta }: {
    text: string;
    more?: boolean;
    after?: (open: boolean) => React.ReactNode;
    /** On the Show more row, after the button: a comment's votes and replies. */
    meta?: React.ReactNode;
  },
) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || open) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [text, open]);
  return (
    <>
      <div
        ref={box}
        className={cn(
          "mt-1.5 [overflow-wrap:anywhere]",
          !open && "max-h-[78px] overflow-hidden",
          !open && cut && "[mask-image:linear-gradient(to_bottom,#000_60%,transparent)]",
        )}
      >
        <Markdown text={text} className="md-note" />
      </div>
      {after?.(open)}
      {(cut || more || open || meta) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          {(cut || more || open) && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-0.5 text-[12px] text-white/80 hover:border-white/30 hover:text-white"
            >
              {open
                ? <ChevronUp className="size-3.5" aria-hidden="true" />
                : <ChevronDown className="size-3.5" aria-hidden="true" />}
              {open ? "Show less" : "Show more"}
            </button>
          )}
          {meta}
        </div>
      )}
    </>
  );
}
