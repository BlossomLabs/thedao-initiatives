import { flushSync } from "react-dom";

/** The browser's own morph (View Transitions) between a ballot initiative and its card.
 * Both sides mark the same three parts: the box (`data-peek-box`), the title
 * (`data-peek-title`) and the category dot (`data-peek-dot`). Each part gets a shared
 * name just before the change and loses it after, so only the one initiative morphs.
 *
 * While its card is open the initiative stays in its place as a dashed box
 * (`data-peek-slot`, app.css), so the card never takes the chip itself: it grows out of
 * a solid copy laid over the chip (`ghost: "from"`), and shrinks back into one
 * (`ghost: "to"`), removed once it has landed. The dashed box stays put all along; only
 * its text fades in after the card has grown and out as it shrinks back. Nothing else
 * is named, so only the morphing card is drawn above the dim.
 * Without View Transitions, or with reduced motion, the change just happens. */

const NAMES = ["peek", "peek-title", "peek-dot"] as const;

function parts(root: Element | null): (HTMLElement | null)[] {
  if (!root) return [];
  const pick = (sel: string) =>
    (root.matches(sel) ? root : root.querySelector(sel)) as HTMLElement | null;
  return [
    pick("[data-peek-box]") ?? (root as HTMLElement),
    pick("[data-peek-title]"),
    pick("[data-peek-dot]"),
  ];
}

function name(els: (HTMLElement | null)[], on: boolean) {
  els.forEach((el, i) => {
    if (on) el?.style.setProperty("view-transition-name", NAMES[i]);
    else el?.style.removeProperty("view-transition-name");
  });
}

const face = (root: Element | null): HTMLElement | null =>
  !root ? null : (root.matches("[data-peek-box]") ? root : root.querySelector("[data-peek-box]")) as
    | HTMLElement
    | null;

/** A solid copy of the initiative's box, laid exactly over it. */
function ghostOf(el: HTMLElement): HTMLElement {
  const r = el.getBoundingClientRect();
  const width = el.offsetWidth || r.width;
  const height = el.offsetHeight || r.height;
  const g = el.cloneNode(true) as HTMLElement;
  for (const n of [g, ...g.querySelectorAll<HTMLElement>("*")]) {
    n.removeAttribute("id");
    n.removeAttribute("data-peek-slot");
    n.removeAttribute("data-ballot-box");
    n.style.removeProperty("view-transition-name");
  }
  g.setAttribute("aria-hidden", "true");
  g.setAttribute("inert", "");
  Object.assign(g.style, {
    position: "fixed",
    margin: "0",
    // Its untransformed size, around its centre (a chip may still be landing).
    left: `${r.left + (r.width - width) / 2}px`,
    top: `${r.top + (r.height - height) / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
    animation: "none",
    pointerEvents: "none",
    listStyle: "none",
    zIndex: "1",
  });
  document.body.append(g);
  return g;
}

const canMorph = () =>
  typeof document !== "undefined" && "startViewTransition" in document &&
  !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Runs `update` (a React state change) as a morph from `from` into what `to` finds once
 * it has rendered. With `ghost`, that side is a solid copy of the initiative laid over
 * it, so the initiative itself can stay in its place as the dashed box. `landed` runs
 * when the morph is over, together with removing a `to` copy. */
export function morph(
  from: Element | null,
  update: () => void,
  to: () => Element | null,
  { ghost, landed }: { ghost?: "from" | "to"; landed?: () => void } = {},
): Promise<void> {
  if (!canMorph()) {
    update();
    landed?.();
    return Promise.resolve();
  }
  let fromGhost: HTMLElement | null = null;
  const fromFace = face(from);
  if (ghost === "from" && fromFace) {
    fromGhost = ghostOf(fromFace);
    // Under its copy the initiative is already its dashed, empty self.
    fromFace.setAttribute("data-peek-slot", "empty");
  }
  const before = parts(fromGhost ?? from);
  let after: (HTMLElement | null)[] = [];
  let toGhost: HTMLElement | null = null;
  name(before, true);
  const t = document.startViewTransition(() => {
    name(before, false);
    fromGhost?.remove();
    flushSync(update);
    const target = to();
    const targetFace = face(target);
    if (ghost === "to" && targetFace) toGhost = ghostOf(targetFace);
    after = parts(toGhost ?? target);
    name(after, true);
  });
  return t.finished.catch(() => {}).finally(() => {
    name(after, false);
    // The real initiative turns solid as its copy goes: the same frame.
    if (landed) flushSync(landed);
    toGhost?.remove();
  });
}
