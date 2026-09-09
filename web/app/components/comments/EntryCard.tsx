import { useState } from "react";
import { Check, CornerDownLeft, Flag, Star, Trash2 } from "lucide-react";
import Identity from "~/components/wallet/Identity";
import { Avatar } from "~/components/wallet/Avatar";
import { QaChip, RoleTags } from "~/components/ui/Badge";
import type { CommentEntry } from "~/lib/api-types";
import { avatarSrc } from "~/lib/avatar";
import { cn } from "~/lib/utils";
import VoteBox from "./VoteBox";

export function IdentityRow({ c }: { c: CommentEntry }) {
  const label = c.roles.includes("ADMIN") ? "TheDAO team" : c.displayName || "Anonymous";
  return (
    <span className="flex flex-wrap items-center gap-2.5">
      {c.address
        ? <Identity address={c.address} size={24} />
        : (
          <span className="inline-flex items-center gap-1.5">
            <Avatar src={avatarSrc(label)} size={24} />
            <span className="font-inter-tight text-[14.5px] font-normal text-muted">{label}</span>
          </span>
        )}
      <RoleTags roles={c.roles} />
    </span>
  );
}

function Body({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        "mb-3.5 mt-0.5 text-[15px] leading-[1.55] text-[#dce5ef] [overflow-wrap:anywhere]",
        className,
      )}
    >
      {text.split("\n").map((line, i) => <span key={i}>{i > 0 && <br />}{line}</span>)}
    </div>
  );
}

const linkBtn =
  "inline-flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-white/[.16] bg-white/5 px-3.5 py-2 font-inter-tight text-[13px] font-semibold leading-none text-[#f2f6fa] transition-all duration-150 hover:border-white/[.28] hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-60";

export default function EntryCard({
  c,
  canVote,
  canReply,
  isAdmin,
  connected,
  onVote,
  onReply,
  onReport,
  onAdmin,
}: {
  c: CommentEntry;
  canVote: boolean;
  canReply: boolean;
  isAdmin: boolean;
  connected: boolean;
  onVote: (id: string, dir: "up" | "down") => Promise<void>;
  onReply: (id: string, body: string, name: string) => Promise<void>;
  onReport: (id: string) => Promise<void>;
  onAdmin: (id: string, action: string) => Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [name, setName] = useState(() => {
    try {
      return isAdmin ? localStorage.getItem("thedao:qa:adminname") || "" : "";
    } catch {
      return "";
    }
  });
  const [note, setNote] = useState("");
  const [reported, setReported] = useState(false);
  const [flash, setFlash] = useState("");
  const say = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(""), 6000);
  };

  async function sendReply() {
    const t = text.trim();
    if (!t) {
      setNote("Write something first.");
      return;
    }
    try {
      if (isAdmin) localStorage.setItem("thedao:qa:adminname", name.trim());
    } catch { /* ignore */ }
    try {
      await onReply(c.id, t, name.trim());
      setText("");
      setReplying(false);
      setNote("");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Reply failed.");
    }
  }

  return (
    <div
      id={`qa-${c.id}`}
      className={cn(
        "mb-4 rounded-2xl border border-white/10 bg-panel-deep shadow-qa transition-[border-color] duration-150 hover:border-white/[.16]",
        c.featured &&
          "border-[rgba(92,183,90,.55)] bg-[linear-gradient(180deg,rgba(92,183,90,.10),rgba(92,183,90,.02)),#213c58] shadow-[0_0_0_1px_rgba(92,183,90,.12),0_8px_26px_rgba(0,0,0,.28),0_0_22px_rgba(92,183,90,.10)]",
      )}
    >
      <div className="flex items-start gap-4 px-5 py-[18px]">
        <VoteBox
          votes={c.votes}
          myvote={c.myvote ?? 0}
          canVote={canVote}
          connected={connected}
          onVote={(d) =>
            onVote(c.id, d).catch((e) => say(e instanceof Error ? e.message : "Vote failed."))}
        />
        <div className="min-w-0 flex-1">
          {c.featured > 0 && (
            <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3">
              <QaChip tone="feat">Featured</QaChip>
              <span className="text-[11.5px] font-medium text-muted">
                Pinned by an administrator
              </span>
            </div>
          )}
          <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
            <IdentityRow c={c} />
            {c.type === "question" && c.answered && <QaChip tone="ok">answered ✓</QaChip>}
            {c.type === "suggestion" && c.reviewed && <QaChip>reviewed</QaChip>}
          </div>
          <Body text={c.body} />
          {(c.replies ?? []).map((r) => (
            <div
              key={r.id}
              className="ml-[18px] mt-3.5 rounded-xl border border-white/10 border-l-2 border-l-[rgba(255,180,50,.28)] bg-panel-reply px-4 py-3.5"
            >
              <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
                <IdentityRow c={r} />
              </div>
              <Body text={r.body} className="mb-2.5 text-[14.5px]" />
            </div>
          ))}
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            {canReply && (
              <button
                type="button"
                className={linkBtn}
                onClick={() => setReplying((v) => !v)}
              >
                <CornerDownLeft className="size-3.5" />Reply
              </button>
            )}
            <button
              type="button"
              className={cn(
                linkBtn,
                "border-white/10 bg-transparent text-muted hover:border-white/[.16] hover:bg-white/5",
              )}
              disabled={reported}
              onClick={() =>
                onReport(c.id).then(() => setReported(true)).catch((e) =>
                  say(e instanceof Error ? e.message : "Report failed.")
                )}
            >
              <Flag className="size-3.5" />
              {reported ? "Reported" : "Report"}
            </button>
            {isAdmin && (
              <span className="ml-auto inline-flex flex-wrap items-center gap-2 border-l border-white/10 pl-3.5">
                <span className="font-inter-tight text-[10px] font-bold uppercase tracking-[.1em] text-muted">
                  Admin
                </span>
                {c.type === "suggestion" && !c.reviewed && (
                  <button
                    type="button"
                    className={cn(
                      linkBtn,
                      "border-[rgba(92,183,90,.35)] bg-[rgba(92,183,90,.1)] text-dao-green hover:border-dao-green hover:bg-dao-green hover:text-[#0d1f14]",
                    )}
                    onClick={() => onAdmin(c.id, "review")}
                  >
                    <Check className="size-3.5" />Mark reviewed
                  </button>
                )}
                {c.featured !== 1 && (
                  <button
                    type="button"
                    className={cn(
                      linkBtn,
                      "border-[rgba(92,183,90,.35)] bg-[rgba(92,183,90,.1)] text-dao-green hover:border-dao-green hover:bg-dao-green hover:text-[#0d1f14]",
                    )}
                    onClick={() => onAdmin(c.id, "feature")}
                  >
                    <Star className="size-3.5" />Feature
                  </button>
                )}
                {c.featured !== 2 && (
                  <button
                    type="button"
                    className={cn(
                      linkBtn,
                      "border-[rgba(92,183,90,.35)] bg-[rgba(92,183,90,.1)] text-dao-green hover:border-dao-green hover:bg-dao-green hover:text-[#0d1f14]",
                    )}
                    onClick={() => onAdmin(c.id, "feature-front")}
                  >
                    <Star className="size-3.5" />Front page
                  </button>
                )}
                {c.featured > 0 && (
                  <button
                    type="button"
                    className={cn(
                      linkBtn,
                      "border-[rgba(92,183,90,.35)] bg-[rgba(92,183,90,.1)] text-dao-green",
                    )}
                    onClick={() => onAdmin(c.id, "unfeature")}
                  >
                    <Star className="size-3.5" />Unfeature
                  </button>
                )}
                <button
                  type="button"
                  className={cn(
                    linkBtn,
                    "border-[rgba(255,59,56,.35)] bg-[rgba(255,59,56,.1)] text-[#ffd2d1] hover:border-[rgba(255,59,56,.6)] hover:bg-[rgba(255,59,56,.2)]",
                  )}
                  onClick={() => onAdmin(c.id, "discard")}
                >
                  <Trash2 className="size-3.5" />Discard
                </button>
              </span>
            )}
          </div>
          {flash && <p className="mt-1.5 text-[13px] text-dao-red">{flash}</p>}
          {replying && (
            <div className="mt-3 flex flex-col gap-2">
              <textarea
                className="min-h-[70px] w-full rounded-xl border border-white/10 bg-[rgba(9,18,30,.5)] px-3 py-2.5 font-inter-tight text-[14px] text-white outline-none placeholder:text-muted focus:border-[rgba(92,183,90,.55)]"
                maxLength={2000}
                placeholder="Write a reply"
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
              <input
                className="rounded-[9px] border border-white/10 bg-[rgba(9,18,30,.5)] px-3 py-[9px] font-inter-tight text-[13.5px] text-white outline-none placeholder:text-muted"
                maxLength={60}
                placeholder="Display name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="flex items-center gap-2.5">
                <button type="button" className="btn btn-sm" onClick={sendReply}>Post reply</button>
                {note && <span className="text-[13px] text-dao-red">{note}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
