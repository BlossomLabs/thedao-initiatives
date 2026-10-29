import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { EASE, useInstant } from "~/components/ui/Reveal";
import { ChevronDown, Star } from "lucide-react";
import { cn } from "~/lib/utils";
import { plural } from "~/lib/format";
import { FormNote } from "~/components/comments/FormFeedback";
import { averageWith, EMPTY_SUMMARY, hasRatingAverage, type RatingSummary } from "@shared/ratings";
import { StarInput } from "./Stars";
import { REVIEWER, Reviewer } from "~/lib/reviewer";
import { RatingButtons, ReviewText, useRatingDraft } from "./RatingDraft";

/**
 * Public average and review count. For badge holders, like Donate, it opens
 * the card's rating form below (see RatingForm). The star is filled once the
 * viewer rated, outlined while they have not.
 */
export default function RatingChip(
  { summary, open, onToggle, controls, className, canRate = false }: {
    summary?: RatingSummary;
    canRate?: boolean;
    open: boolean;
    onToggle: () => void;
    /** The id of the form it opens. */
    controls: string;
    className?: string;
  },
) {
  const count = summary?.count ?? 0;
  const mine = summary?.mine ?? null;
  const hasAverage = hasRatingAverage(summary);
  const title = hasAverage
    ? `${Reviewer} average ${summary!.avg} from ${plural(count, REVIEWER)}` +
      (canRate ? (mine ? ` · yours: ${mine}` : " · you have not rated it") : "")
    : (count
      ? `${plural(count, REVIEWER)} rated it · average shown after 3 reviewers`
      : `No ${REVIEWER} rated it yet`);
  const Tag = canRate ? "button" : "span";
  return (
    <Tag
      {...(canRate
        ? {
          type: "button" as const,
          "aria-expanded": open,
          "aria-controls": controls,
          onClick: onToggle,
        }
        : {})}
      title={title}
      aria-label={canRate ? `${title}. Rate it` : title}
      className={cn(
        "inline-flex h-5 flex-none items-center gap-1 rounded-full border-0 bg-transparent px-1 font-inter-tight text-[12px] transition-colors hover:bg-white/[.06] focus-visible:outline-2 focus-visible:outline-dao-bright aria-expanded:bg-white/[.06]",
        canRate && "cursor-pointer",
        count || open ? "text-dao-amber" : "text-white/35 hover:text-dao-amber",
        className,
      )}
    >
      <Star className="size-3.5" fill={mine ? "currentColor" : "none"} aria-hidden="true" />
      {count
        ? (
          <>
            {hasAverage && <span className="tnum">{summary!.avg.toFixed(1)}</span>}
            <span className="tnum text-white/35">({count})</span>
          </>
        )
        : <span>{canRate ? "Rate" : "No ratings"}</span>}
      {/* Turned up while the form is open: the chip closes it too. */}
      {canRate && (
        <ChevronDown
          className={cn(
            "size-3 text-white/45 transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      )}
    </Tag>
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
  { initiativeId, summary = EMPTY_SUMMARY, onClose, card = false, className }: {
    initiativeId: string;
    summary?: RatingSummary;
    onClose: () => void;
    /** A board card's narrow form: the buttons as icons (Send once the review is
     * open, with smaller stars) so the stars keep their room. */
    card?: boolean;
    className?: string;
  },
) {
  const draft = useRatingDraft({ initiativeId, summary, onSaved: onClose });
  const { stars, writing } = draft;
  const instant = useInstant();
  const avg = hasRatingAverage(summary) ? averageWith(summary, stars) : null;

  return (
    // A container, so a narrow form can drop the buttons under the stars, still in the box.
    <div className={cn("@container", className)}>
      <LayoutGroup>
        <motion.div
          layout={!instant}
          transition={{ duration: 0.22, ease: EASE }}
          // Inline, so the layout animation keeps the corners round while the width moves.
          style={{ borderRadius: 12 }}
          className={cn(
            "flex items-stretch border border-edge2 bg-white/[.03] transition-colors",
            // Too narrow for the buttons beside the stars: their own line, styled as one, and
            // never a loose wrap above it. The list's buttons have labels, so it needs more.
            card ? "@max-[400px]:flex-wrap" : "@max-[520px]:flex-wrap",
            writing && "border-[rgba(240,180,41,.45)]",
            // A wide row: at its end, under the chip that opened it, until the text needs the row.
            !card && (writing ? "w-full" : "ml-auto w-fit max-w-full"),
          )}
        >
          <motion.div
            layout={instant ? false : "position"}
            transition={{ duration: 0.22, ease: EASE }}
            className="flex w-[104px] flex-none flex-col justify-center gap-1 border-r border-edge2 py-2.5 pl-4 pr-3"
          >
            <span className={EYEBROW}>Average</span>
            <span
              role="img"
              aria-label={avg === null ? "Average shown after 3 reviewers" : `Average ${avg} of 5`}
            >
              <Average value={avg} preview={avg !== null && draft.preview} />
            </span>
          </motion.div>
          <motion.div
            layout={!instant}
            transition={{ duration: 0.22, ease: EASE }}
            className={cn(
              "flex min-w-0 flex-col justify-center gap-1 py-2.5 pl-3 pr-2",
              // In a wide row the buttons follow the stars; the text, once open, fills it.
              card || writing ? "flex-1" : "flex-none",
            )}
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
                  compact={card && writing}
                />
              </motion.span>
            </div>
            {writing && <ReviewText draft={draft} className="mx-1 mt-0.5" />}
          </motion.div>
          <motion.div
            layout={!instant}
            transition={{ duration: 0.22, ease: EASE }}
            className={cn(
              "flex flex-none items-end justify-end gap-2 self-end pb-2.5 pr-2.5",
              card
                ? "@max-[400px]:w-full @max-[400px]:border-t @max-[400px]:border-edge2 @max-[400px]:py-2 @max-[400px]:pl-2.5"
                : "@max-[520px]:w-full @max-[520px]:border-t @max-[520px]:border-edge2 @max-[520px]:py-2 @max-[520px]:pl-2.5",
            )}
          >
            <RatingButtons draft={draft} iconWrite={card} iconSend={card && writing} />
          </motion.div>
        </motion.div>
      </LayoutGroup>
      {avg === null && <p className="small dim mt-2">Average shown after 3 reviewers.</p>}
      <FormNote note={draft.note} className="mt-2" />
    </div>
  );
}
