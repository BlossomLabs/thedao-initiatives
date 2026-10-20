import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE, useInstant } from "~/components/ui/Reveal";
import { Lock } from "lucide-react";
import { useReviews } from "~/hooks/use-admin-ratings";
import { FormNote } from "~/components/comments/FormFeedback";
import { type RatingSummary, summaryWith } from "@shared/ratings";
import RatingHistogram from "./RatingHistogram";
import { RatingButtons, ReviewText, useRatingDraft } from "./RatingDraft";
import { StarInput, StarRow } from "./Stars";

const EYEBROW = "font-inter-tight text-[10.5px] font-medium uppercase tracking-[.1em] text-muted";

/** Yours: the stars to click and, once they are changed, Write review (the
 * optional text, above the stars) and Send in the same row. The bars above
 * count the pick before it is saved. */
function RateHere(
  { initiativeId, summary }: { initiativeId: string; summary: RatingSummary },
) {
  const [saved, setSaved] = useState(0);
  const draft = useRatingDraft({ initiativeId, summary, onSaved: () => setSaved((n) => n + 1) });
  // "Saved" on the button for a moment.
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!saved) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(t);
  }, [saved]);
  const instant = useInstant();
  // The buttons come in once the stars are changed (or the review is open), and stay
  // a moment after Send to say Saved.
  const show = draft.preview || draft.writing || flash;
  const motionProps = (from: { opacity: number; x?: number; height?: number }) =>
    instant ? {} : { initial: from, animate: { opacity: 1, x: 0, height: "auto" }, exit: from };
  return (
    <>
      <RatingHistogram summary={summaryWith(summary, draft.stars)} preview={draft.preview} />
      <div className="mt-3 border-t border-white/10 pt-3">
        <AnimatePresence initial={false}>
          {draft.writing && (
            // The review opens above the stars.
            <motion.div
              key="review"
              className="overflow-hidden"
              transition={{ duration: 0.22, ease: EASE }}
              {...motionProps({ opacity: 0, height: 0 })}
            >
              <div className="mb-2.5 rounded-xl border border-[rgba(240,180,41,.45)] bg-card px-3 py-2">
                <ReviewText draft={draft} className="w-full" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex min-h-8 items-center gap-2">
          <span className={EYEBROW}>Yours</span>
          <StarInput
            value={draft.stars}
            onChange={draft.setStars}
            label="Yours"
            disabled={draft.busy}
            compact
          />
          <AnimatePresence initial={false}>
            {show && (
              <motion.div
                key="buttons"
                className="ml-auto flex flex-none items-center gap-1.5"
                transition={{ duration: 0.2, ease: EASE }}
                {...motionProps({ opacity: 0, x: 8 })}
              >
                <RatingButtons draft={draft} saved={flash && !draft.preview} iconWrite />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <FormNote note={draft.note} className="mt-2" />
      </div>
    </>
  );
}

/**
 * The rating side card: the average and the bars, and (while the initiative
 * is on the board) the viewer's own stars to change right here, with an
 * optional review. Its own card (not the admins' panel) so it can go public
 * later; for now only admins get a summary, so it renders nothing for anyone
 * else.
 */
export default function RatingCard(
  { initiativeId, canRate }: { initiativeId: string; canRate: boolean },
) {
  const { summary } = useReviews(initiativeId);
  if (!summary) return null;
  return (
    <div className="panel">
      <span className="k">Rating</span>
      {canRate ? <RateHere initiativeId={initiativeId} summary={summary} /> : (
        <>
          <RatingHistogram summary={summary} />
          {summary.mine && (
            <p className="m-0 mt-2.5 flex items-center gap-1.5 small dim">
              Your rating: <StarRow value={summary.mine} size="size-3" />
            </p>
          )}
        </>
      )}
      <p className="m-0 mt-3 flex items-center gap-1.5 text-[12px] text-muted">
        <Lock className="size-3" aria-hidden="true" />Only admins see the ratings for now.
      </p>
    </div>
  );
}
