import { AnimatePresence, motion } from "motion/react";
import { EASE, useInstant } from "./Reveal";

const PRESETS = {
  /** A menu under its trigger. */
  drop: { opacity: 0, y: -6, scale: 0.98 },
  /** A panel over a bottom-corner button. */
  rise: { opacity: 0, y: 8 },
  /** A modal panel. */
  zoom: { opacity: 0, scale: 0.95 },
  /** A backdrop. */
  fade: { opacity: 0 },
} as const;

const SHOWN = { opacity: 1, y: 0, scale: 1 };

type BoxProps =
  & Omit<
    React.ComponentProps<"div">,
    "ref" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"
  >
  & { from?: keyof typeof PRESETS; as?: "div" | "nav"; ref?: React.Ref<HTMLElement> };

/**
 * The animated element itself, for use under a `Pop` (a modal panel inside its
 * backdrop). It is the positioned element, not a wrapper: a transformed
 * wrapper would become the containing block of a fixed or absolute child.
 */
export function PopBox({ from = "drop", as = "div", style, ref, ...props }: BoxProps) {
  const instant = useInstant();
  const divRef = ref as React.Ref<HTMLDivElement>;
  if (instant) {
    const Tag = as;
    return <Tag ref={divRef} style={style} {...props} />;
  }
  const Tag = as === "nav" ? motion.nav : motion.div;
  return (
    <Tag
      ref={divRef}
      style={{ transformOrigin: from === "drop" ? "top" : undefined, ...style }}
      initial={PRESETS[from]}
      animate={SHOWN}
      exit={PRESETS[from]}
      transition={{ duration: 0.16, ease: EASE }}
      {...props}
    />
  );
}

/** A floating panel (menu, popover, modal) that fades in and out instead of blinking. */
export default function Pop({ show, ...props }: BoxProps & { show: boolean }) {
  const instant = useInstant();
  if (instant) return show ? <PopBox {...props} /> : null;
  return <AnimatePresence>{show && <PopBox {...props} />}</AnimatePresence>;
}
