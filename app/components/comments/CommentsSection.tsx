import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useAccount } from "wagmi";
import SectionHeading from "~/components/layout/SectionHeading";
import { QaChip } from "~/components/ui/Badge";
import { sessionKey, useSession } from "~/context/session";
import type { CommentEntry, CommentsResponse } from "~/lib/api-types";
import { myClaimTokens, rememberClaimToken } from "~/lib/claims";
import { cn } from "~/lib/utils";
import {
  adminAction,
  commentsKey,
  fetchComments,
  fetchMine,
  mineKey,
  postComment,
  reply,
  report,
  vote,
} from "./api";
import EntryCard from "./EntryCard";
import Composer from "./Composer";

const PAGE = 20;

export default function CommentsSection({ initiativeId, slug, open }: {
  initiativeId: string;
  slug: string;
  open: boolean;
}) {
  const { session, requireSession } = useSession();
  const { isConnected } = useAccount();
  const qc = useQueryClient();
  const key = commentsKey(slug, sessionKey(session), initiativeId);
  const q = useQuery({ queryKey: key, queryFn: () => fetchComments(slug) });
  const [tokens, setTokens] = useState<string[]>(
    () => (typeof localStorage === "undefined" ? [] : myClaimTokens()),
  );
  const mine = useQuery({
    queryKey: mineKey(tokens),
    queryFn: () => fetchMine(tokens),
    enabled: tokens.length > 0,
  });
  const [sort, setSort] = useState<"top" | "new">("top");
  const [shown, setShown] = useState(PAGE);

  const entries = q.data?.entries ?? [];
  const isAdmin = Boolean(session?.isAdmin);
  const canVote = Boolean(q.data?.viewerCanVote) || isAdmin;

  const list = useMemo(() => {
    const l = [...entries];
    l.sort((a, b) => {
      if (Boolean(a.featured) !== Boolean(b.featured)) return a.featured ? -1 : 1;
      if (a.featured && b.featured) return b.featuredAt - a.featuredAt;
      if (sort === "new") return b.createdAt - a.createdAt;
      return b.votes - a.votes || b.createdAt - a.createdAt;
    });
    return l;
  }, [entries, sort]);

  const held = (mine.data?.held ?? []).filter((h) => !entries.some((e) => e.id === h.id));
  const patch = (fn: (d: CommentsResponse) => CommentsResponse) =>
    qc.setQueryData<CommentsResponse>(key, (d) => (d ? fn(d) : d));
  const refetch = () => void qc.invalidateQueries({ queryKey: ["comments", slug] });

  const onVote = async (id: string, dir: "up" | "down") => {
    await requireSession();
    const r = await vote(id, dir);
    patch((d) => ({
      ...d,
      entries: d.entries.map((e) => (e.id === id ? { ...e, votes: r.votes, myvote: r.myvote } : e)),
    }));
  };
  // A connected wallet replies signed in (connecting signs in; the session
  // cookie does the rest); otherwise the reply carries a name, like an
  // anonymous top-level post.
  const onReply = async (id: string, body: string, name: string) => {
    if (isConnected) await requireSession();
    const r = await reply(id, body, name);
    if (r.claimToken) {
      rememberClaimToken(r.claimToken);
      setTokens(myClaimTokens());
    }
    const added = r.reply;
    if (added) {
      patch((d) => ({
        ...d,
        entries: d.entries.map((e) =>
          e.id === id ? { ...e, answered: r.answered, replies: [...(e.replies ?? []), added] } : e
        ),
      }));
    }
    return r.status;
  };
  const onReport = async (id: string) => {
    await report(id);
  };
  const onAdmin = async (id: string, action: string) => {
    if (
      action === "discard" && !confirm("Discard this comment? It will be removed from the forum.")
    ) return;
    try {
      await adminAction(id, action);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed.");
    }
    refetch();
  };
  const onPost = async (
    body: string,
    name: string,
    website: string,
  ): Promise<string | null> => {
    const r = await postComment(
      slug,
      { initiativeId, body, name, website },
    );
    if (r.status === "published" && r.entry) {
      const entry: CommentEntry = r.entry;
      patch((d) => ({ ...d, entries: [entry, ...d.entries] }));
      return null;
    }
    if (r.claimToken) {
      rememberClaimToken(r.claimToken);
      setTokens(myClaimTokens());
    }
    return "Thanks, your comment is in review.";
  };

  return (
    <section id="qa" className="mt-2">
      <SectionHeading count={entries.length || undefined}>Comments</SectionHeading>
      {entries.length > 1 && (
        <div className="mb-3.5 inline-flex gap-0.5 rounded-full border border-white/10 bg-[rgba(9,18,30,.55)] p-1">
          {(["top", "new"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={cn(
                "cursor-pointer rounded-full border-0 px-[15px] py-[7px] font-inter-tight text-[13px] font-semibold transition-all duration-150",
                sort === s
                  ? "bg-dao-green text-[#0d1f14]"
                  : "bg-transparent text-muted hover:text-white",
              )}
              onClick={() => {
                setSort(s);
                setShown(PAGE);
              }}
            >
              {s === "top" ? "Top score" : "Newest"}
            </button>
          ))}
        </div>
      )}
      {q.isError && <p className="text-muted">Comments could not be loaded.</p>}
      {!entries.length && !held.length && q.isSuccess && (
        <p className="text-muted">Be the first to ask about this initiative.</p>
      )}
      {list.slice(0, shown).map((c) => (
        <EntryCard
          key={c.id}
          c={c}
          canVote={canVote}
          isAdmin={isAdmin}
          connected={isConnected}
          onVote={onVote}
          onReply={onReply}
          onReport={onReport}
          onAdmin={onAdmin}
        />
      ))}
      {list.length > shown && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setShown((n) => n + PAGE)}
        >
          Show more
        </button>
      )}
      {held.map((h) => (
        <div
          key={h.id}
          className="mb-4 rounded-2xl border border-dashed border-white/10 bg-panel-deep px-[18px] py-4 opacity-85"
        >
          <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
            <MessageSquare className="size-[15px] text-muted" />
            <QaChip>waiting for review</QaChip>
          </div>
          <div className="mb-2 text-[15px] leading-[1.55] text-[#dce5ef] [overflow-wrap:anywhere]">
            {h.body}
          </div>
          <p className="m-0 small dim">
            Thanks. Your {h.parentId ? "reply" : "comment"}{" "}
            is waiting for review and is only visible to you.
          </p>
        </div>
      ))}
      {open && <Composer onPost={onPost} />}
    </section>
  );
}
