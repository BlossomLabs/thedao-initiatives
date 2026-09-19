import { useState } from "react";
import {
  AnimatePresence,
  motion,
  MotionGlobalConfig,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import { cn } from "~/lib/utils";

/** No animation: the visitor asked for reduced motion, or a test skips animations. */
export const useInstant = () => Boolean(useReducedMotion()) || MotionGlobalConfig.skipAnimations;

export const EASE = [0.22, 1, 0.36, 1] as const;

function Body(
  { children, className, id }: { children: React.ReactNode; className?: string; id?: string },
) {
  const present = useIsPresent();
  // Clipped only while the height moves, so focus rings and menus inside an
  // open panel are not cut off.
  const [moving, setMoving] = useState(true);
  return (
    <motion.div
      id={id}
      className={cn("flow-root", className)}
      style={{ overflow: moving || !present ? "hidden" : undefined }}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
    >
      {children}
    </motion.div>
  );
}

// Folded text fades out at its foot instead of stopping mid-line.
const FADE = "linear-gradient(to bottom, #000 45%, transparent)";

/** A box that folds down to a strip of its content: it stays mounted, clipped and inert. */
function Peek(
  { show, peek, children, className, id }: {
    show: boolean;
    peek: number;
    children: React.ReactNode;
    className?: string;
    id?: string;
  },
) {
  const instant = useInstant();
  const [moving, setMoving] = useState(false);
  const clipped = !show || moving;
  const style = {
    overflow: clipped ? "hidden" : undefined,
    maskImage: show ? undefined : FADE,
    WebkitMaskImage: show ? undefined : FADE,
  };
  if (instant) {
    return (
      <div
        id={id}
        inert={!show}
        className={cn("flow-root", className)}
        style={{ ...style, height: show ? undefined : peek }}
      >
        {children}
      </div>
    );
  }
  return (
    <motion.div
      id={id}
      inert={!show}
      className={cn("flow-root", className)}
      style={style}
      initial={false}
      animate={{ height: show ? "auto" : peek }}
      transition={{ duration: 0.32, ease: EASE }}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
    >
      {children}
    </motion.div>
  );
}

/**
 * An in-flow panel that opens and closes: its height and opacity animate both
 * ways, so the content below slides instead of jumping. Margins belong on
 * `className` (or inside), where they animate with the height. With `peek`
 * (pixels), a closed panel folds down to that much of its content instead of
 * leaving the page.
 */
export default function Reveal(
  { show, children, className, peek, id }: {
    show: boolean;
    children: React.ReactNode;
    className?: string;
    peek?: number;
    id?: string;
  },
) {
  const instant = useInstant();
  if (peek != null) {
    return <Peek show={show} peek={peek} className={className} id={id}>{children}</Peek>;
  }
  if (instant) {
    return show ? <div id={id} className={cn("flow-root", className)}>{children}</div> : null;
  }
  return (
    <AnimatePresence initial={false}>
      {show && <Body id={id} className={className}>{children}</Body>}
    </AnimatePresence>
  );
}
