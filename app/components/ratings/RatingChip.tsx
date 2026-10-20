import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { EASE, useInstant } from "~/components/ui/Reveal";
import { Star } from "lucide-react";
import { cn } from "~/lib/utils";
import { plural } from "~/lib/format";
import { FormNote } from "~/components/comments/FormFeedback";
import { averageWith, EMPTY_SUMMARY, type RatingSummary } from "@shared/ratings";
import { StarInput } from "./Stars";
import { RatingButtons, ReviewText, useRatingDraft } from "./RatingDraft";

/**
 * Admins only: the average and how many admins rated. Like Donate, it opens
 * the card's rating form below (see RatingForm). The star is filled once the
 * viewer rated, outlined while they have not.
 */
export default function RatingChip(
  { summary, open, onToggle, controls, className }: {
    summary?: RatingSummary;
    open: boolean;
    onToggle: () => void;
    /** The id of the form it opens. */
    controls: string;
    className?: string;
  },
) {
  const count = summary?.count ?? 0;
  const mine = summary?.mine ?? null;
  const title = count
    ? `Admin average ${summary!.avg} from ${plural(count, "admin")}` +
      (mine ? ` · yours: ${mine}` : " · you have not rated it")
    : "No admin rated it yet";
  return (
    <button
      type="button"
      title={title}
      aria-label={`${title}. Rate it`}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        "inline-flex h-8 flex-none cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-2 font-inter-tight text-[12px] transition-colors hover:bg-white/[.06] focus-visible:outline-2 focus-visible:outline-dao-bright aria-expanded:bg-white/[.06]",
        count || open ? "text-dao-amber" : "text-white/35 hover:text-dao-amber",
        className,
      )}
    >
      <Star className="size-3.5" fill={mine ? "currentColor" : "none"} aria-hidden="true" />
      {count
        ? (
          <>
            <span className="tnum">{summary!.avg.toFixed(1)}</span>
            <span className="tnum text-white/35">({count})</span>
          </>
        )
        : <span>Rate</span>}
    </button>
  );
}

const EYEBROW = "font-inter-tight text-[10.5px] font-medium uppercase tracking-[.1em] text-muted";

/** The average as a number: it slides to a new value, amber while the viewer's
 * pick (not saved yet) moves it. */
function Average({ value, preview }: { value: number | null; preview: boolean }) {
  const instant = useInstant();
  return (
    <span className="flex h-7 items-center gap-1.5">
      <span className="relative inline-grid overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={value ?? "none"}
            className={cn(
              "font-inter-tight text-[22px] font-semibold leading-none tnum transition-colors",
              preview ? "text-dao-amber" : "text-white",
            )}
            initial={instant ? false : { y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={instant ? undefined : { y: -10, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {value === null ? "" : value.toFixed(1)}
          </motion.span>
        </AnimatePresence>
      </span>
      <Star
        className={cn("size-4", value === null ? "text-white/25" : "text-dao-amber")}
        fill={value === null ? "none" : "currentColor"}
        aria-hidden="true"
      />
    </span>
  );
}

/**
 * Rate from the board, unfolded by the chip under the card or row: one strip
 * with the average (a number, as it will be with the viewer's pick), the
 * viewer's own stars (the only clickable part), and Write review and Send.
 * Write review moves the stars up next to "Yours" and opens the text in their
 * place. It posts the same private review as the initiative's page.
 */
export function RatingForm(
  { initiativeId, summary = EMPTY_SUMMARY, onClose, className }: {
    initiativeId: string;
    summary?: RatingSummary;
    onClose: () => void;
    className?: string;
  },
) {
  const draft = useRatingDraft({ initiativeId, summary, onSaved: onClose });
  const { stars, writing } = draft;
  const instant = useInstant();
  const avg = summary.count || stars ? averageWith(summary, stars) : null;

  return (
    // A container, so a narrow card can drop the buttons under the stars, still in the box.
    <div className={cn("@container", className)}>
      <div
        className={cn(
          "flex flex-wrap items-stretch rounded-xl border border-edge2 bg-white/[.03] transition-colors",
          writing && "border-[rgba(240,180,41,.45)]",
        )}
      >
        <div className="flex w-[104px] flex-none flex-col justify-center gap-1 border-r border-edge2 py-2.5 pl-4 pr-3">
          <span className={EYEBROW}>Average</span>
          <span role="img" aria-label={avg === null ? "No ratings yet" : `Average ${avg} of 5`}>
            <Average value={avg} preview={avg !== null && draft.preview} />
          </span>
        </div>
        <LayoutGroup>
          <motion.div
            layout={!instant}
            transition={{ duration: 0.22, ease: EASE }}
            className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-2.5 pl-3 pr-2"
          >
            {/* Writing, the stars move up next to "Yours" to make room for the text. */}
            <div className={cn("flex", writing ? "items-center gap-1.5" : "flex-col gap-1")}>
              <motion.span layout={instant ? false : "position"} className={cn(EYEBROW, "pl-1")}>
                Yours
              </motion.span>
              <motion.span layout={instant ? false : "position"}>
                <StarInput
                  value={stars}
                  onChange={draft.setStars}
                  label="Yours"
                  disabled={draft.busy}
                />
              </motion.span>
            </div>
            {writing && <ReviewText draft={draft} className="mx-1 mt-0.5" />}
          </motion.div>
          <motion.div
            layout={!instant}
            transition={{ duration: 0.22, ease: EASE }}
            className="flex items-end justify-end gap-2 self-end pb-2.5 pr-2.5 @max-[400px]:w-full @max-[400px]:border-t @max-[400px]:border-edge2 @max-[400px]:py-2 @max-[400px]:pl-2.5"
          >
            <RatingButtons draft={draft} />
          </motion.div>
        </LayoutGroup>
      </div>
      <FormNote note={draft.note} className="mt-2" />
    </div>
  );
}
