import { useState } from "react";
import { Check, ChevronDown, CornerDownLeft, Flag, Star, Trash2, Wallet } from "lucide-react";
import { useWallet } from "~/context/wallet";
import { useSession } from "~/context/session";
import Identity from "~/components/wallet/Identity";
import { Avatar } from "~/components/wallet/Avatar";
import { BadgeHolderMark, QaChip, RoleTags } from "~/components/ui/Badge";
import Reveal from "~/components/ui/Reveal";
import WalletMenu from "~/components/wallet/WalletMenu";
import type { CommentEntry } from "~/lib/api-types";
import { errorMessage } from "~/lib/api";
import { useIdentity } from "~/hooks/use-identity";
import { avatarSrc } from "~/lib/avatar";
import { cn } from "~/lib/utils";
import VoteBox from "./VoteBox";
import ConnectInline from "~/components/wallet/ConnectInline";
import { nameInput, signedInAs } from "./styles";
import { FormNote, type Note, SENT_MS, SubmitButton } from "./FormFeedback";
import { COMMENT_BODY_MAX, COMMENT_NAME_MAX } from "@shared/comments";
import { inputMax, tooLong } from "@shared/draft/mod";

export function IdentityRow({ c }: { c: CommentEntry }) {
  const label = c.roles.includes("ADMIN") ? "TheDAO team" : c.displayName || "Anonymous";
  return (
    <span className="flex flex-wrap items-center gap-2.5">
      <span className="inline-flex items-center gap-1">
        {c.address
          ? <Identity address={c.address} size={24} />
          : (
            <span className="inline-flex items-center gap-1.5">
              <Avatar src={avatarSrc(label)} size={24} />
              <span className="font-inter-tight text-[14.5px] font-normal text-muted">{label}</span>
            </span>
          )}
        {c.roles.includes("EXPERT") && <BadgeHolderMark />}
      </span>
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

/** Feature levels by the entry's `featured` value, with the admin action that sets each. */
const FEATURE_LEVELS = [
  { label: "Not featured", action: "unfeature" },
  { label: "Featured", action: "feature" },
];

const linkBtn =
  "inline-flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-white/[.16] bg-white/5 px-3.5 py-2 font-inter-tight text-[13px] font-semibold leading-none text-[#f2f6fa] transition-all duration-150 hover:border-white/[.28] hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-60";

export default function EntryCard({
  c,
  canVote,
  isAdmin,
  connected,
  onVote,
  onReply,
  onReport,
  onAdmin,
}: {
  c: CommentEntry;
  canVote: boolean;
  isAdmin: boolean;
  connected: boolean;
  onVote: (id: string, dir: "up" | "down") => Promise<void>;
  onReply: (id: string, body: string, name: string) => Promise<"published" | "held">;
  onReport: (id: string) => Promise<void>;
  onAdmin: (id: string, action: string) => Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  const [name, setName] = useState("");
  const [featureMenu, setFeatureMenu] = useState(false);
  const { address } = useWallet();
  const { connecting } = useSession();
  const me = useIdentity(replying ? address : undefined);
  // The wallet is briefly connected before the sign-in signature; keep the
  // connect button mounted until then so it can still show a refusal.
  const signedIn = Boolean(address) && !connecting;
  const [text, setText] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(0);
  const [reported, setReported] = useState(false);
  const [flash, setFlash] = useState<Note>(null);
  const admin = (action: string) =>
    void onAdmin(c.id, action).catch((e) => say(errorMessage(e, "Action failed.")));
  const say = (text: string, ok = false) => {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 6000);
  };

  async function sendReply() {
    const t = text.trim();
    if (!t) {
      setNote({ text: "Write something first." });
      return;
    }
    if (t.length > COMMENT_BODY_MAX) {
      setNote({ text: tooLong("The reply", COMMENT_BODY_MAX) });
      return;
    }
    if (name.trim().length > COMMENT_NAME_MAX) {
      setNote({ text: tooLong("The name", COMMENT_NAME_MAX) });
      return;
    }
    if (!address && !name.trim()) {
      setNote({ text: "Add your name, or connect a wallet." });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const status = await onReply(c.id, t, name.trim());
      setText("");
      setPosted((n) => n + 1);
      if (status === "held") {
        say("Thanks. Your reply is waiting for review and will appear once approved.", true);
      }
      // Let the button show its "Posted" state before the box folds away.
      setTimeout(() => setReplying(false), SENT_MS - 200);
    } catch (e) {
      setNote({ text: errorMessage(e, "Reply failed.") });
    } finally {
      setBusy(false);
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
          onVote={(d) => onVote(c.id, d).catch((e) => say(errorMessage(e, "Vote failed.")))}
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
            <button
              type="button"
              className={linkBtn}
              onClick={() => setReplying((v) => !v)}
            >
              <CornerDownLeft className="size-3.5" />Reply
            </button>
            <button
              type="button"
              className={cn(
                linkBtn,
                "border-white/10 bg-transparent text-muted hover:border-white/[.16] hover:bg-white/5",
              )}
              disabled={reported}
              onClick={() =>
                onReport(c.id).then(() => setReported(true)).catch((e) =>
                  say(errorMessage(e, "Report failed."))
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
                    onClick={() => admin("review")}
                  >
                    <Check className="size-3.5" />Mark reviewed
                  </button>
                )}
                <span className="relative">
                  <button
                    type="button"
                    className={cn(
                      linkBtn,
                      "border-[rgba(92,183,90,.35)] bg-[rgba(92,183,90,.1)] text-dao-green hover:border-dao-green hover:bg-dao-green hover:text-[#0d1f14]",
                    )}
                    aria-haspopup="menu"
                    aria-expanded={featureMenu}
                    onClick={() => setFeatureMenu((v) => !v)}
                  >
                    <Star className="size-3.5" />
                    {FEATURE_LEVELS[c.featured]?.label ?? "Feature"}
                    <ChevronDown className="size-3.5 opacity-70" />
                  </button>
                  <WalletMenu
                    open={featureMenu}
                    className="left-0 right-auto top-[36px] min-w-[170px]"
                    onClose={() => setFeatureMenu(false)}
                    items={FEATURE_LEVELS.map((f, level) => ({
                      key: f.action,
                      label: f.label,
                      active: c.featured === level,
                      onClick: () => {
                        if (c.featured !== level) admin(f.action);
                      },
                    }))}
                  />
                </span>
                <button
                  type="button"
                  className={cn(
                    linkBtn,
                    "border-[rgba(255,59,56,.35)] bg-[rgba(255,59,56,.1)] text-[#ffd2d1] hover:border-[rgba(255,59,56,.6)] hover:bg-[rgba(255,59,56,.2)]",
                  )}
                  onClick={() => admin("discard")}
                >
                  <Trash2 className="size-3.5" />Discard
                </button>
              </span>
            )}
          </div>
          <FormNote note={flash} className="mt-1.5" />
          <Reveal show={replying}>
            <div className="mt-3 flex flex-col gap-2">
              <textarea
                className="min-h-[70px] w-full rounded-xl border border-white/10 bg-[rgba(9,18,30,.5)] px-3 py-2.5 font-inter-tight text-[14px] text-white outline-none placeholder:text-muted focus:border-[rgba(92,183,90,.55)] disabled:cursor-default disabled:opacity-60"
                maxLength={inputMax(COMMENT_BODY_MAX)}
                placeholder="Write a reply"
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
                autoFocus
              />
              <div className="flex flex-wrap items-center gap-2.5">
                {!address && (
                  <input
                    className={cn(nameInput, "w-auto min-w-[200px] flex-1")}
                    maxLength={inputMax(COMMENT_NAME_MAX)}
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                )}
                <span className="ml-auto inline-flex flex-wrap items-center gap-2.5">
                  {signedIn
                    ? (
                      <span className={signedInAs}>
                        <Wallet className="size-3.5" />
                        Signed in as {me.name}
                      </span>
                    )
                    : <ConnectInline />}
                  <SubmitButton busy={busy} done={posted} onClick={sendReply}>
                    Post reply
                  </SubmitButton>
                </span>
              </div>
              <FormNote note={note} />
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
