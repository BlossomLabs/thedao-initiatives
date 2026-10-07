import { motion } from "motion/react";
import { EASE, useInstant } from "~/components/ui/Reveal";
import { cn } from "~/lib/utils";

/**
 * A card that comes and goes with the filters (inside AnimatePresence): it fades
 * up in, fades and shrinks out, and glides to its new place when others move. On
 * the board's first show the cards come in one after another (`stagger`); later
 * arrivals come in at once. Reduced motion: no movement at all.
 */
export function ShuffleItem(
  { index = 0, stagger, className, children, ref }: {
    index?: number;
    stagger?: boolean;
    className?: string;
    children: React.ReactNode;
    ref?: React.Ref<HTMLDivElement>;
  },
) {
  const instant = useInstant();
  return (
    <motion.div
      ref={ref}
      // A one-cell grid, so the card fills the grid row's height as before.
      className={cn("grid", className)}
      layout={!instant}
      initial={instant ? false : { opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={instant ? undefined : { opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
      transition={{
        duration: 0.35,
        ease: EASE,
        delay: stagger ? Math.min(index, 10) * 0.06 : 0,
        layout: { duration: 0.35, ease: EASE },
      }}
    >
      {children}
    </motion.div>
  );
}

/** A list row's motion: a quick fade and a small slide, and a glide when rows move. */
export function useRowMotion() {
  const instant = useInstant();
  if (instant) return {};
  return {
    layout: "position" as const,
    initial: { opacity: 0, y: -6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, transition: { duration: 0.15 } },
    transition: { duration: 0.28, ease: EASE },
  };
}
