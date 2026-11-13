import { type RefObject, useLayoutEffect, useState } from "react";

/** A hand-drawn dashed arrow from this badge's ballot to TheDAO's result, for the one
 * initiative being hovered, focused or tapped (one that won and was on the ballot): from
 * its chip on the left to the same chip on the right. It draws itself in; off when the
 * tables stack (phone). */

type Pt = { x: number; y: number };

/** A small, stable number in [-1, 1] from `seed`: the same arrow wobbles the same way. */
function jitter(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 2001) / 1000 - 1;
}

/** The arrow from `a` to `b`: a loose curve (as if drawn by hand) and an open head at
 * `b`. Pure, so it can be tested without a layout. */
export function arrowPath(a: Pt, b: Pt, seed: string): { d: string; head: string } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const bow = 10 + 14 * Math.abs(jitter(seed, 1));
  const lean = jitter(seed, 2);
  const c1 = { x: a.x + dx * 0.35, y: a.y + dy * 0.1 - bow * (lean >= 0 ? 1 : -1) };
  const c2 = { x: a.x + dx * 0.7, y: b.y - dy * 0.15 + bow * 0.6 * lean };
  const r = (n: number) => Math.round(n * 10) / 10;
  const d = `M ${r(a.x)} ${r(a.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(b.x)} ${
    r(b.y)
  }`;
  // The head follows the curve's last direction, its two strokes a little uneven.
  const angle = Math.atan2(b.y - c2.y, b.x - c2.x);
  const wing = (spread: number, len: number) => ({
    x: b.x - len * Math.cos(angle - spread),
    y: b.y - len * Math.sin(angle - spread),
  });
  const w1 = wing(0.5 + 0.08 * jitter(seed, 3), 9);
  const w2 = wing(-0.5 + 0.08 * jitter(seed, 4), 8);
  const head = `M ${r(w1.x)} ${r(w1.y)} L ${r(b.x)} ${r(b.y)} L ${r(w2.x)} ${r(w2.y)}`;
  return { d, head };
}

/** The chip for `slug` in the table named `table`, inside `root`. */
const chipIn = (root: HTMLElement, table: string, slug: string) =>
  root.querySelector<HTMLElement>(
    `[aria-label="${table}"] [data-final-chip="${CSS.escape(slug)}"]`,
  );

/** Which chip the arrow starts from: the one hovered, focused or tapped. */
export type ArrowFrom = "ballot" | "result";

export default function BallotArrows(
  { root, slug, from = "ballot", resultLabel = "TheDAO's result", live }: {
    root: RefObject<HTMLElement | null>;
    slug: string | undefined;
    from?: ArrowFrom;
    /** The result table's name: TheDAO's result, or during the vote the live result. */
    resultLabel?: string;
    /** Only the live tally funds it (an open tier): green, as its chips; gold otherwise. */
    live?: boolean;
  },
) {
  const [arrow, setArrow] = useState<{ slug: string; d: string; head: string }>();
  // Measured when a chip is picked (hover, focus, tap): by then the tables are laid out
  // and `root` is attached. (Measuring on mount from inside `root` found it still empty:
  // a child's layout effect runs before its parent's ref is set.)
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !slug) return setArrow(undefined);
    const measure = () => {
      // Stacked (phone): the tables aren't side by side, so no arrow.
      if (globalThis.matchMedia && !globalThis.matchMedia("(min-width: 640px)").matches) {
        return setArrow(undefined);
      }
      const box = el.getBoundingClientRect();
      const mine = chipIn(el, "Your ballot", slug)?.getBoundingClientRect();
      const theirs = chipIn(el, resultLabel, slug)?.getBoundingClientRect();
      if (!mine || !theirs) return setArrow(undefined);
      // The ballot chip's right edge and the result chip's left edge face each other.
      const left = { x: mine.right - box.left + 4, y: mine.top + mine.height / 2 - box.top };
      const right = { x: theirs.left - box.left - 4, y: theirs.top + theirs.height / 2 - box.top };
      if (right.x <= left.x) return setArrow(undefined);
      const [a, b] = from === "ballot" ? [left, right] : [right, left];
      setArrow({ slug, ...arrowPath(a, b, slug) });
    };
    measure();
    globalThis.addEventListener("resize", measure);
    return () => globalThis.removeEventListener("resize", measure);
  }, [root, slug, from, resultLabel]);
  if (!arrow) return null;
  const mask = `arrow-mask-${arrow.slug}`;
  return (
    <svg
      aria-hidden="true"
      data-arrow={arrow.slug}
      data-from={from}
      data-live={live || undefined}
      className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible"
    >
      {/* The dashed line draws itself in: a solid stroke growing along the path masks it. */}
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="-50%" y="-50%" width="200%" height="200%">
          <path
            key={`${arrow.slug}-${from}`}
            d={arrow.d}
            pathLength={1}
            stroke="white"
            strokeWidth="8"
            fill="none"
            strokeDasharray="1"
            className="motion-safe:animate-ballot-arrow-draw"
          />
        </mask>
      </defs>
      <g
        key={`${arrow.slug}-${from}`}
        className={live ? "stroke-dao-green" : "stroke-vote"}
        fill="none"
      >
        <path
          d={arrow.d}
          strokeWidth="1.8"
          strokeDasharray="5 5"
          strokeLinecap="round"
          mask={`url(#${mask})`}
        />
        <path
          d={arrow.head}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="motion-safe:animate-ballot-arrow-head"
        />
      </g>
    </svg>
  );
}
