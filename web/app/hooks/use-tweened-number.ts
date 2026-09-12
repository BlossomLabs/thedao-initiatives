import { useEffect, useRef, useState } from "react";
import { useMedia } from "./use-media";

export const TWEEN_MS = 600;
/** How long the changed number stays highlighted. */
export const FLASH_MS = 1200;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A number that rolls from its previous value to the new one instead of
 * jumping, and reports `changed` for a moment so the UI can highlight it.
 * The first value renders as-is; only later changes animate. Under
 * `prefers-reduced-motion` the value jumps but still flashes.
 */
export function useTweenedNumber(value: number): { shown: number; changed: boolean } {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const [shown, setShown] = useState(value);
  const [changed, setChanged] = useState(false);
  const shownRef = useRef(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const from = shownRef.current;
    if (from === value) return;
    setChanged(true);
    const flash = setTimeout(() => setChanged(false), FLASH_MS);
    if (reduced || typeof requestAnimationFrame !== "function") {
      shownRef.current = value;
      setShown(value);
      return () => clearTimeout(flash);
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const v = t >= 1 ? value : from + (value - from) * easeOut(t);
      shownRef.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(flash);
    };
  }, [value, reduced]);

  return { shown, changed };
}
