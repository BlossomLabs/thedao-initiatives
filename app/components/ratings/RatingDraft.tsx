import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Loader2, PencilLine, Send } from "lucide-react";
import { EASE, useInstant } from "~/components/ui/Reveal";
import { cn } from "~/lib/utils";
import { errorMessage } from "~/lib/api";
import { usePostReview } from "~/hooks/use-admin-ratings";
import type { Note } from "~/components/comments/FormFeedback";
import { COMMENT_BODY_MAX } from "@shared/comments";
import { inputMax, tooLong } from "@shared/draft/mod";
import type { RatingSummary, Stars } from "@shared/ratings";

/**
 * A rating being made on the board, under the card or row: the
 * viewer's stars (from their current rating), the optional review text, and
 * the submit. It posts the same private review as the comment box.
 */
export function useRatingDraft(
  { initiativeId, summary, onSaved }: {
    initiativeId: string;
    summary: RatingSummary;
    onSaved: () => void;
  },
) {
  const post = usePostReview();
  const [stars, setStars] = useState<Stars | null>(summary.mine);
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  // A rating saved elsewhere (the comment box) becomes the starting point.
  useEffect(() => setStars(summary.mine), [summary.mine]);

  async function submit() {
    const t = text.trim();
    if (!stars || busy) return;
    if (t.length > COMMENT_BODY_MAX) {
      return setNote({ text: tooLong("The review", COMMENT_BODY_MAX) });
    }
    setBusy(true);
    setNote(null);
    try {
      await post(initiativeId, stars, t);
      setText("");
      setWriting(false);
      onSaved();
    } catch (e) {
      setNote({ text: errorMessage(e, "Could not save the rating."), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return {
    stars,
    setStars,
    text,
    setText,
    writing,
    setWriting,
    busy,
    note,
    submit,
    /** The viewer's pick moves the average from the saved one. */
    preview: stars !== summary.mine,
  };
}

type Draft = ReturnType<typeof useRatingDraft>;

/** The review text, opened by Write review and focused. Esc on an empty one
 * folds it back; Ctrl/Cmd+Enter sends. */
export function ReviewText({ draft, className }: { draft: Draft; className?: string }) {
  const instant = useInstant();
  return (
    <motion.textarea
      initial={instant ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.22, ease: EASE }}
      autoFocus
      rows={2}
      className={cn(
        "min-w-0 resize-none bg-transparent font-inter-tight text-[14px] leading-[1.45] text-white outline-none placeholder:text-white/35 disabled:opacity-60",
        className,
      )}
      maxLength={inputMax(COMMENT_BODY_MAX)}
      placeholder="Why this rating? (optional)"
      aria-label="Review (optional)"
      value={draft.text}
      onChange={(e) => draft.setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !draft.text.trim()) draft.setWriting(false);
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void draft.submit();
      }}
      disabled={draft.busy}
    />
  );
}

const BTN =
  "inline-flex h-8 flex-none cursor-pointer items-center gap-1.5 rounded-lg px-3 font-inter-tight text-[12.5px] font-bold transition-all duration-150 active:scale-[.97] disabled:cursor-default disabled:opacity-40 disabled:active:scale-100";

/** [Write review], a toggle (lit while the text is open; folding it keeps the
 * text for next time), and [Send] (once there are stars). */
export function RatingButtons(
  { draft, iconWrite = false, iconSend = false }: {
    draft: Draft;
    /** Write review as its pencil alone (named for screen readers and on hover), for a narrow card. */
    iconWrite?: boolean;
    /** Send as its arrow alone, likewise. */
    iconSend?: boolean;
  },
) {
  return (
    <>
      <button
        type="button"
        onClick={() => draft.setWriting(!draft.writing)}
        disabled={draft.busy}
        aria-pressed={draft.writing}
        aria-label={iconWrite ? "Write review" : undefined}
        title={iconWrite ? (draft.writing ? "Hide the review" : "Write review") : undefined}
        className={cn(
          BTN,
          "border",
          draft.writing
            ? "border-[rgba(240,180,41,.45)] bg-[rgba(240,180,41,.12)] text-dao-amber hover:bg-[rgba(240,180,41,.2)]"
            : "border-edge2 bg-white/5 text-white hover:bg-white/10",
          iconWrite && "w-8 justify-center px-0",
        )}
      >
        <PencilLine className="size-3.5" aria-hidden="true" />
        {!iconWrite && "Write review"}
      </button>
      <button
        type="button"
        onClick={() => void draft.submit()}
        disabled={draft.busy || !draft.stars}
        aria-busy={draft.busy}
        aria-label={iconSend ? "Send" : undefined}
        title={iconSend ? "Send" : undefined}
        className={cn(
          BTN,
          "border border-dao-green bg-dao-green text-[#0d1f14] hover:bg-[#6cc96a] disabled:hover:bg-dao-green",
          iconSend && "w-8 justify-center px-0",
        )}
      >
        {draft.busy
          ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          : <Send className="size-3.5" aria-hidden="true" />}
        {!iconSend && "Send"}
      </button>
    </>
  );
}
