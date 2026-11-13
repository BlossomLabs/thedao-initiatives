import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { ChevronDown, Eraser, Eye, EyeOff, GripVertical, Maximize2, Undo2 } from "lucide-react";
import CategoryDot from "~/components/ui/CategoryDot";
import type { Card } from "~/lib/api-types";
import type { AiSearchResult } from "../../../shared/ai-search";
import StickyAside from "~/components/layout/StickyAside";
import BoardSearch from "~/components/board/BoardSearch";
import CategoryFilter from "~/components/board/filters/CategoryFilter";
import { type BoardView, DEFAULT_VIEW, facetCounts, isFiltered, matches } from "~/lib/board-view";
import { categoryOf } from "~/lib/categories";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import { type Tier, tierName } from "../../../shared/vote/ballot";
import InitiativePeek, { type PeekChoice } from "./InitiativePeek";
import { morph } from "./peek-morph";

/** Ported from blossomlabs.eth's budgeting TierList.
 * A tier list (S-Tier, A-Tier and B-Tier rows of small chips) beside the initiatives not ranked yet;
 * on a phone it is pinned at the top, over the full-width list.
 * Drag a tile (press and hold on a phone) onto a tier, or tap it: its card says where it
 * goes. Dragging it back on the list (or choosing so) unranks it. Same tier = equal priority. */
export const TIER_LABELS: { tier: Tier; grade: string; label: string }[] = [
  { tier: "S", grade: "S", label: "Must fund" },
  { tier: "A", grade: "A", label: "Should fund" },
  { tier: "B", grade: "B", label: "Nice to have" },
];

export type BallotItem = { slug: string; title: string; card?: Card };

/** Where an initiative is: a tier, the list, or skipped (off the list, out of sight;
 * on the ballot it is as unranked as the list). */
type Where = Tier | "unplaced" | "skipped";

const UNRANKED = "Not ranked yet";
const SKIPPED = "Skipped";
/** A small button on a list tile's right: Details, Skip. */
const TILE_ACTION =
  "inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[12px] text-white/45 no-underline hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-dao-green";

/** Every tile is this one size, in a tier or in the list, still or mid-drag. */
const TILE = "h-[72px]";
const TILE_PX = 72;
/** A touch has to rest this long before it picks the tile up (shorter = a scroll). */
const LONG_PRESS_MS = 250;
/** A mouse picks the tile up once it moves this far. */
const MOUSE_SLOP = 4;
/** A finger moving this far before the long press is a scroll. */
const TOUCH_SLOP = 8;

type Press = {
  slug: string;
  pointerId: number;
  touch: boolean;
  x0: number;
  y0: number;
  el: HTMLElement;
  timer?: ReturnType<typeof setTimeout>;
  /** Ends the hold's glow: fades it out and removes it. */
  unglow?: () => void;
};
/** What follows the pointer: a copy of the pressed element, at its own size. */
type Drag = {
  slug: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
};

/**
 * Touch: while a finger rests on a tile, a green glow spreads from under it
 * and fills the tile just as the long press picks it up, so holding reads as
 * "keep going". The pressed element needs `relative overflow-hidden`.
 */
function glow(el: HTMLElement, x: number, y: number): () => void {
  const box = el.getBoundingClientRect();
  const cx = x - box.left;
  const cy = y - box.top;
  // Big enough to reach the farthest corner.
  const r = Math.hypot(Math.max(cx, box.width - cx), Math.max(cy, box.height - cy));
  const dot = document.createElement("span");
  dot.dataset.glow = "";
  dot.setAttribute("aria-hidden", "true");
  Object.assign(dot.style, {
    position: "absolute",
    left: `${cx - r}px`,
    top: `${cy - r}px`,
    width: `${2 * r}px`,
    height: `${2 * r}px`,
    borderRadius: "50%",
    pointerEvents: "none",
    background:
      "radial-gradient(circle, rgba(92,183,90,.34) 0%, rgba(92,183,90,.2) 65%, rgba(92,183,90,.08) 100%)",
  });
  el.appendChild(dot);
  const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  dot.animate?.(
    still
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ transform: "scale(0.08)", opacity: 0.7 }, { transform: "scale(1)", opacity: 1 }],
    { duration: LONG_PRESS_MS, easing: "cubic-bezier(.25,.6,.35,1)", fill: "forwards" },
  );
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    const fade = dot.animate?.([{ opacity: getComputedStyle(dot).opacity }, { opacity: 0 }], {
      duration: 160,
      fill: "forwards",
    });
    if (fade) fade.onfinish = () => dot.remove();
    else dot.remove();
  };
}

/** The drop target under a point: a tier or the unranked list. */
function targetAt(x: number, y: number): Where | undefined {
  const el = document.elementFromPoint?.(x, y);
  return el?.closest<HTMLElement>("[data-drop]")?.dataset.drop as Where | undefined;
}

export default function TierBallot(
  {
    items,
    tiers,
    disabled,
    onChange,
    onReplace,
    search = {},
    actions,
    aside,
    head,
    notice,
    listHead,
    locked,
    funded,
    paid,
    skipped,
    onSkip,
    sent,
  }: {
    items: BallotItem[];
    /** The send bar: under the tier list on wider screens, floating at the bottom on a phone. */
    actions?: React.ReactNode;
    /** Under the send bar on wider screens; above the tiers on a phone. */
    aside?: React.ReactNode;
    /** Above the tier list, in its column. */
    head?: React.ReactNode;
    /** At the top of the second column, above the list (outside its drop area); on a
     * phone, under the pinned tier strip. */
    listHead?: React.ReactNode;
    /** Between the tier list and the send bar on wider screens; above the tiers on a phone. */
    notice?: React.ReactNode;
    /** The board's AI search flags: the box offers AI only while it is on. */
    search?: { ai?: boolean; aiAuto?: boolean };
    tiers: Partial<Record<string, Tier>>;
    disabled: boolean;
    onChange: (slug: string, tier: Tier | undefined) => void;
    /** Sets the whole ballot at once: Clear ballot, and its Undo. */
    onReplace?: (tiers: Partial<Record<string, Tier>>) => void;
    /** Tiers the quiet ending has settled: nothing moves into or out of them. */
    locked?: ReadonlySet<Tier>;
    /** What the settled tiers funded (slugs). */
    funded?: ReadonlySet<string>;
    /** USD this badge paid for each initiative a settled tier funded. */
    paid?: ReadonlyMap<string, number>;
    /** Initiatives this voter skipped: off the list, in a hidden one that can be opened. */
    skipped?: ReadonlySet<string>;
    /** Skips an initiative (or brings it back); without it there's no Skip. */
    onSkip?: (slug: string, skip: boolean) => void;
    /** The ballot that counts, once one was sent: changed since, it can be restored. */
    sent?: Partial<Record<string, Tier>>;
  },
) {
  const id = useId();
  /** The initiative being dragged. */
  const [picked, setPicked] = useState<string>();
  const [drag, setDrag] = useState<Drag>();
  const [over, setOver] = useState<Where>();
  /** The initiative whose card is open (a tap on its tile or chip). */
  /** The initiative whose card is shrinking back into it: dashed and empty until it lands. */
  const [closing, setClosing] = useState<string>();
  const [peek, setPeek] = useState<
    {
      slug: string;
      /** The ‹ › order, fixed when the card opened: a move on the card keeps it. */
      order: string[];
    }
  >();
  // The front page's search (keywords, or AI) and category filter, over the list.
  const [view, setView] = useState<BoardView>({ ...DEFAULT_VIEW });
  const [aiResult, setAiResult] = useState<AiSearchResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [announce, setAnnounce] = useState("");
  /** What Clear ballot took away, for its Undo, while the offer lasts. */
  const [cleared, setCleared] = useState<Partial<Record<string, Tier>>>();
  /** The settled tier whose note is open: by a hover, or by a tap (phones can't hover). */
  const [noteOpen, setNoteOpen] = useState<Tier>();
  useEffect(() => {
    if (!noteOpen) return;
    // A tap outside the row closes a tapped note.
    const away = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(`[data-drop="${noteOpen}"]`)) {
        setNoteOpen(undefined);
      }
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [noteOpen]);
  useEffect(() => {
    if (!cleared) return;
    const t = setTimeout(() => setCleared(undefined), 8000);
    return () => clearTimeout(t);
  }, [cleared]);
  const placedCount = Object.keys(tiers).length;
  const clearAll = () => {
    if (!onReplace || placedCount === 0) return;
    done();
    setCleared({ ...tiers });
    // A settled tier stays as it is.
    onReplace(Object.fromEntries(Object.entries(tiers).filter(([, t]) => t && isLocked(t))));
    setAnnounce("Ballot cleared. Every initiative is back in the list.");
  };
  /** The ballot on screen isn't the one sent: offer to go back to it. */
  const changed = Boolean(sent) &&
    (Object.keys(sent!).length !== placedCount ||
      Object.entries(sent!).some(([slug, t]) => tiers[slug] !== t));
  const restoreSent = () => {
    if (!onReplace || !sent) return;
    done();
    setCleared(undefined);
    onReplace({ ...sent });
    setAnnounce("Back to the ballot you sent.");
  };
  const undoClear = () => {
    if (!onReplace || !cleared) return;
    onReplace(cleared);
    setCleared(undefined);
    setAnnounce("Ballot restored.");
  };
  /** The last drop, for its landing animation; `n` restarts it on a repeat drop. */
  const [landed, setLanded] = useState<{ slug: string; to: Where; n: number }>();
  useEffect(() => {
    if (!landed) return;
    const t = setTimeout(() => setLanded(undefined), 800);
    return () => clearTimeout(t);
  }, [landed]);
  const press = useRef<Press | null>(null);
  const dragRef = useRef<Drag | undefined>(undefined);
  /** A drag ends in a click on what was pressed; that click must not pick it up again. */
  const justDragged = useRef(false);
  const where = (slug: string): Where =>
    tiers[slug] ?? (skipped?.has(slug) ? "skipped" : "unplaced");
  const isTier = (w: Where): w is Tier => w !== "unplaced" && w !== "skipped";
  const isLocked = (w: Where) => isTier(w) && Boolean(locked?.has(w));
  const labelOf = (w: Where) =>
    TIER_LABELS.find((t) => t.tier === w)?.label ?? (w === "skipped" ? SKIPPED : UNRANKED);
  /** The skipped list: hidden until asked for. */
  const [showSkipped, setShowSkipped] = useState(false);
  const titleOf = (slug: string) => items.find((i) => i.slug === slug)?.title ?? slug;

  const done = () => {
    setPicked(undefined);
    setDrag(undefined);
    dragRef.current = undefined;
    setOver(undefined);
  };

  const place = (slug: string, dest: Where | undefined) => {
    done();
    if (!dest || where(slug) === dest) return;
    const from = where(slug);
    if (isLocked(from) || isLocked(dest)) return;
    if (dest === "skipped") {
      if (isTier(from)) onChange(slug, undefined);
      onSkip?.(slug, true);
    } else {
      if (from === "skipped") onSkip?.(slug, false);
      onChange(slug, dest === "unplaced" ? undefined : dest);
    }
    setLanded((l) => ({ slug, to: dest, n: (l?.n ?? 0) + 1 }));
    setAnnounce(`${titleOf(slug)} moved to ${labelOf(dest)}.`);
  };

  // While a drag is on: follow the pointer, keep the page from scrolling under a
  // finger, and drop on release. Before it starts: tell a press from a scroll or a click.
  useEffect(() => {
    const stopPress = () => {
      if (press.current?.timer) clearTimeout(press.current.timer);
      press.current?.unglow?.();
      press.current = null;
    };
    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (p && e.pointerId === p.pointerId && !dragRef.current) {
        const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
        if (p.touch && dist > TOUCH_SLOP) stopPress();
        else if (!p.touch && dist > MOUSE_SLOP) start(p, e.clientX, e.clientY);
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, x: e.clientX, y: e.clientY };
      dragRef.current = next;
      setDrag(next);
      setOver(targetAt(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      stopPress();
      if (!d) return;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      place(d.slug, targetAt(e.clientX, e.clientY));
    };
    const onCancel = () => {
      stopPress();
      if (dragRef.current) done();
    };
    const noScroll = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("touchmove", noScroll, { passive: false });
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", noScroll);
    };
  });

  const start = (p: Press, x: number, y: number) => {
    if (p.timer) clearTimeout(p.timer);
    p.unglow?.();
    press.current = null;
    const rect = p.el.getBoundingClientRect();
    // The pointer carries a whole card, even from a tier's small chip: as wide as the
    // list's cards, held at the same spot (in proportion) as the pressed element.
    const w = p.el.dataset.ballotTile !== undefined
      ? rect.width
      : document.querySelector("[data-ballot-tile]")?.getBoundingClientRect().width ??
        Math.min(360, globalThis.innerWidth - 32);
    const h = TILE_PX;
    const vw = globalThis.innerWidth;
    const d: Drag = {
      slug: p.slug,
      x,
      y,
      // Phone: the card appears centred across the screen, then moves with the finger.
      dx: vw < 640 ? x - (vw - w) / 2 : ((p.x0 - rect.left) / rect.width) * w,
      dy: ((p.y0 - rect.top) / rect.height) * h,
      w,
      h,
    };
    dragRef.current = d;
    setDrag(d);
    setPicked(p.slug);
    setOver(undefined);
    if (p.touch) navigator.vibrate?.(8);
  };

  /** Pressing a tile or a chip: a drag once it moves (mouse) or rests (touch). */
  /** Press and drag an initiative onto a tier; `opens`: a click opens its card too (the
   * tier chips; a list tile has its own Details for that). */
  const grab = (slug: string, opens = true) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || isLocked(where(slug)) || (e.pointerType === "mouse" && e.button !== 0)) {
        return;
      }
      const p: Press = {
        slug,
        pointerId: e.pointerId,
        touch: e.pointerType !== "mouse",
        x0: e.clientX,
        y0: e.clientY,
        el: e.currentTarget,
      };
      if (p.touch) {
        p.timer = setTimeout(() => start(p, p.x0, p.y0), LONG_PRESS_MS);
        p.unglow = glow(p.el, p.x0, p.y0);
      }
      press.current = p;
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      if (justDragged.current || !opens) return;
      openPeek(slug, e.currentTarget as HTMLElement);
    },
  });

  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picked]);

  const unranked = useMemo(
    () => items.filter((i) => !tiers[i.slug] && !skipped?.has(i.slug)),
    [items, tiers, skipped],
  );
  const skippedItems = useMemo(
    () => items.filter((i) => !tiers[i.slug] && skipped?.has(i.slug)),
    [items, tiers, skipped],
  );
  const ai = Boolean(aiResult?.scores.length);
  // While the AI order is on, the model ranked everything: the words stop filtering.
  const shownView = useMemo(
    () => (ai || (search.aiAuto && asking) ? { ...view, q: "" } : view),
    [view, ai, asking, search.aiAuto],
  );
  const unrankedCards = useMemo(
    () => unranked.flatMap((i) => i.card ? [i.card] : []),
    [unranked],
  );
  const counts = useMemo(() => facetCounts(unrankedCards, shownView), [
    unrankedCards,
    shownView,
  ]);
  const shown = useMemo(() => {
    const words = shownView.q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = unranked.filter((i) =>
      i.card ? matches(i.card, shownView) : words.every((w) => i.title.toLowerCase().includes(w))
    );
    if (!ai || !aiResult) return list;
    const score = new Map(aiResult.scores.map(({ id, score }) => [id, score]));
    const of = (i: BallotItem) => (i.card && score.get(i.card.initiative.id)) ?? -1;
    return list.sort((a, b) => of(b) - of(a));
  }, [unranked, shownView, ai, aiResult]);
  const filtered = isFiltered(shownView);

  /** A tier (or the list) that would take the initiative being dragged or tapped. */
  const takes = (t: Where) =>
    picked !== undefined && where(picked) !== t && !isLocked(t) && !isLocked(where(picked));
  const lit = (t: Where) => Boolean(drag) && over === t && takes(t);

  /** The card: the initiative's chip or tile morphs into it (the browser's own morph). */
  const cardEl = () => document.querySelector("[data-initiative-peek] [role=dialog]");
  const boxEl = (slug: string) =>
    document.querySelector<HTMLElement>(`[data-ballot-box="${slug}"]`) ??
      // Skipped while the skipped list is shut: it goes into the list's link.
      document.querySelector<HTMLElement>("[data-skipped-toggle]");
  /** While its card is open, an initiative stays in its place as a dashed box
   * (`data-peek-slot`, app.css): it scrolls with the page and moves with the initiative.
   * "text": its dot and title show (fading in once the card has grown); "empty": as the
   * card shrinks back into it, they've gone. */
  const slotOf = (slug: string): "text" | "empty" | undefined =>
    peek?.slug === slug ? "text" : closing === slug ? "empty" : undefined;
  const openPeek = (slug: string, from: HTMLElement) => {
    const box = from.closest<HTMLElement>("[data-ballot-box]");
    // The card grows out of a copy of the chip; the chip stays, dashed.
    void morph(box, () => setPeek({ slug, order: navOrder }), cardEl, { ghost: "from" });
  };
  /** The card's ‹ › order, taken when it opens: as the page shows them, S-Tier, A-Tier,
   * B-Tier, then the list (as searched and filtered), then the skipped ones while their
   * list is open. */
  const navOrder = [
    ...TIER_LABELS.flatMap((t) => items.filter((i) => tiers[i.slug] === t.tier)),
    ...shown,
    ...(showSkipped ? skippedItems : []),
  ].map((i) => i.slug);
  /** The previous (-1) or next (1) initiative's card, its outline moving to its place. */
  const stepPeek = (dir: -1 | 1) => {
    if (!peek) return;
    const { order } = peek;
    const next = order[order.indexOf(peek.slug) + dir];
    if (!next) return;
    const box = document.querySelector<HTMLElement>(`[data-ballot-box="${next}"]`);
    box?.scrollIntoView?.({ block: "nearest" });
    void morph(cardEl(), () => setPeek({ slug: next, order }), cardEl);
  };
  /** A choice on the card: the initiative moves (its outline with it), the card stays. */
  const movePeek = (dest: Where) => {
    if (peek) place(peek.slug, dest);
  };
  /** Closes the card into the initiative's place, after moving it there when asked. */
  const closePeek = (dest?: Where) => {
    if (!peek) return;
    const { slug } = peek;
    // The card shrinks into a copy of the chip laid over its dashed self, which turns
    // solid as the copy goes.
    void morph(
      cardEl(),
      () => {
        if (dest !== undefined) place(slug, dest);
        setPeek(undefined);
        setClosing(slug);
      },
      () => boxEl(slug),
      { ghost: "to", landed: () => setClosing(undefined) },
    ).then(() => boxEl(slug)?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }));
  };

  /** A card's insides: the grip, the title, and its category and goal. */
  const tileFace = (i: BallotItem) => {
    const r = i.card?.initiative;
    const cat = r?.categories[0];
    return (
      <>
        <GripVertical className="size-4 flex-none text-white/30" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <span
            data-peek-title=""
            className="line-clamp-2 font-inter-tight text-[14px] leading-[1.3] text-white"
          >
            {i.title}
          </span>
          {r && (
            <span className="flex h-[18px] items-center gap-1.5 truncate text-[12px] text-white/45">
              {cat && <CategoryDot slug={cat} className="size-[7px]" data-peek-dot="" />}
              {cat && <span className="truncate">{categoryOf(cat)?.label}</span>}
              <span className="tnum whitespace-nowrap">
                {cat && "· "}
                {usd(r.goalUsd)} goal
              </span>
            </span>
          )}
        </span>
      </>
    );
  };

  /** The card's line under its choices: a settled tier holds it, and what it funded. */
  const noteOf = (slug: string): string | undefined => {
    const w = where(slug);
    if (!isTier(w) || !isLocked(w)) return undefined;
    const settled = `${tierName(w)} has settled.`;
    if (!funded) return settled;
    if (!funded.has(slug)) return `${settled} It wasn't funded.`;
    const youPaid = paid?.get(slug);
    // Whole dollars, as on the chip: "You paid $7,000."
    return youPaid
      ? `${settled} You paid $${Math.round(youPaid).toLocaleString("en-US")}.`
      : `${settled} It was funded.`;
  };
  /** What this badge paid for an initiative its settled tier funded: "$7,000". */
  const paidOf = (slug: string): string | undefined => {
    const youPaid = isLocked(where(slug)) && funded?.has(slug) ? paid?.get(slug) : undefined;
    return youPaid ? `$${Math.round(youPaid).toLocaleString("en-US")}` : undefined;
  };
  /** The card's choices: the three tiers and the list, a settled one locked. */
  const choicesFor = (slug: string): PeekChoice<Where>[] => [
    ...TIER_LABELS.map((t) => ({
      value: t.tier as Where,
      grade: t.grade,
      label: t.label,
      name: `${tierName(t.tier)}, ${t.label}`,
      display: `${tierName(t.tier)} · ${t.label}`,
      disabled: disabled || isLocked(where(slug)) || isLocked(t.tier),
    })),
    {
      value: "unplaced" as Where,
      grade: "–",
      label: "Not ranked",
      name: UNRANKED,
      display: UNRANKED,
      disabled: disabled || isLocked(where(slug)),
    },
    ...(onSkip
      ? [{
        value: "skipped" as Where,
        grade: <EyeOff className="size-[18px]" aria-hidden="true" />,
        label: "Skip",
        name: "Skip: hide it from the list",
        display: SKIPPED,
        disabled: disabled || isLocked(where(slug)),
      }]
      : []),
  ];

  const tile = (i: BallotItem) => {
    const isSkipped = Boolean(skipped?.has(i.slug)) && !tiers[i.slug];
    // A quick Skip (or Unskip) on the tile itself, without opening its card.
    const quick = onSkip && !disabled && !tiers[i.slug];
    return (
      <li
        key={i.slug}
        data-ballot-box={i.slug}
        data-peek-box=""
        className={cn(
          "relative overflow-hidden rounded-xl border border-white/10 bg-white/5 transition-colors",
          isSkipped && "opacity-60 hover:opacity-100",
          landed?.slug === i.slug && "motion-safe:animate-chip-land",
        )}
        data-peek-slot={slotOf(i.slug)}
      >
        {/* Only a handle to drag: Details opens the card. */}
        <div
          data-ballot-tile={i.slug}
          {...grab(i.slug, false)}
          className={cn(
            TILE,
            "relative flex w-full select-none items-center gap-2 overflow-hidden pl-2 text-left transition-opacity duration-150 [-webkit-touch-callout:none]",
            quick ? "pr-[112px] sm:pr-[150px]" : "pr-[44px] sm:pr-[76px]",
            !disabled && "cursor-grab hover:bg-white/[.03]",
            drag?.slug === i.slug && "opacity-40",
            disabled && "opacity-60",
          )}
        >
          {tileFace(i)}
        </div>
        {
          // On the tile's right: Details (its card) and a quick Skip (or Unskip), without
          // opening the card.
        }
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={`Details for ${i.title}`}
            aria-describedby={`${id}-how`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              openPeek(i.slug, e.currentTarget);
            }}
            className={TILE_ACTION}
          >
            <Maximize2 className="size-3.5" aria-hidden="true" />
            {/* On a phone, the icon alone: the tile keeps room for its title. */}
            <span className="max-sm:hidden">Details</span>
          </button>
          {quick && (
            <button
              type="button"
              aria-label={`${isSkipped ? "Unskip" : "Skip"} ${i.title}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                place(i.slug, isSkipped ? "unplaced" : "skipped");
              }}
              className={TILE_ACTION}
            >
              {isSkipped
                ? <Eye className="size-3.5" aria-hidden="true" />
                : <EyeOff className="size-3.5" aria-hidden="true" />}
              {isSkipped ? "Unskip" : "Skip"}
            </button>
          )}
        </div>
      </li>
    );
  };

  /** Phone: a small chip in the mini tier list: the category dot and the title's start. */
  const chip = (i: BallotItem) => {
    const cat = i.card?.initiative.categories[0];
    const settledHere = isLocked(where(i.slug));
    const isFunded = settledHere && Boolean(funded?.has(i.slug));
    const youPaid = isFunded ? paid?.get(i.slug) : undefined;
    const paidText = youPaid ? `$${Math.round(youPaid).toLocaleString("en-US")}` : undefined;
    const label = !settledHere || !funded
      ? i.title
      : isFunded
      ? paidText ? `${i.title}, funded: your share paid ${paidText}` : `${i.title}, funded`
      : `${i.title}, not funded`;
    return (
      <li
        key={i.slug}
        data-ballot-box={i.slug}
        className={cn(
          "relative flex-none",
          landed?.slug === i.slug && "motion-safe:animate-chip-land",
        )}
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={label}
          title={label}
          data-ballot-chip={i.slug}
          data-peek-box=""
          {...grab(i.slug)}
          className={cn(
            "relative flex h-7 w-[84px] select-none overflow-hidden items-center gap-1.5 rounded-lg border border-white/15 bg-white/[.07] px-2 text-left [-webkit-touch-callout:none] hover:bg-white/[.11] sm:h-8 sm:w-[136px]",
            !disabled && !settledHere && "sm:cursor-grab",
            drag?.slug === i.slug && "opacity-40",
            isFunded && "border-vote/50 bg-vote/[.12]",
            settledHere && funded && !isFunded && "opacity-55",
            paidText && "sm:w-[176px]",
          )}
          data-peek-slot={slotOf(i.slug)}
        >
          {cat
            ? <CategoryDot slug={cat} className="size-[7px] flex-none" data-peek-dot="" />
            : (
              <span
                className="size-[7px] flex-none rounded-full bg-white/30"
                aria-hidden="true"
                data-peek-dot=""
              />
            )}
          <span
            data-peek-title=""
            className="truncate text-[11.5px] leading-none text-white/85 sm:text-[12.5px]"
          >
            {i.title}
          </span>
          {paidText && (
            <span className="ml-auto hidden flex-none text-[11.5px] font-semibold leading-none text-vote tnum sm:inline">
              {paidText}
            </span>
          )}
        </button>
      </li>
    );
  };

  const box = (t: Where) =>
    cn(
      "rounded-2xl border bg-white/[.03] p-3 transition-[border-color,background-color,box-shadow] duration-150",
      lit(t)
        ? "border-[rgba(92,183,90,.7)] bg-dao-green/[.06] shadow-[0_0_0_1px_rgba(92,183,90,.35)]"
        : !drag && takes(t)
        ? "cursor-pointer border-[rgba(92,183,90,.35)]"
        : "border-white/10",
    );

  /** A settled tier's hover when it holds picks it didn't fund: they stay in play, ahead
   * of the open tiers, for what this badge has left (the later stages still tally them).
   * Nothing for B-Tier: once it settles the vote is over. */
  const missedNote = (tier: Tier): string | undefined => {
    if (!funded || !isLocked(tier) || tier === "B") return undefined;
    if (!Object.entries(tiers).some(([slug, t]) => t === tier && !funded.has(slug))) {
      return undefined;
    }
    return tier === "S"
      ? "Your S-Tier picks that weren't funded stay first in line for what you have left."
      : "Your A-Tier picks that weren't funded stay ahead of B-Tier for what you have left.";
  };

  return (
    <div className={cn(drag && "cursor-grabbing")}>
      <p id={`${id}-how`} className="sr-only">
        Open an initiative's details to choose its tier, or drag it onto one. Escape cancels a drag.
      </p>

      <div className="grid grid-cols-1 items-start gap-0 sm:grid-cols-2 sm:gap-6">
        {
          /* The tier list: pinned under the top bar on a phone, the left column on wider
            screens, with the send bar under it there. On a phone this wrapper steps aside.
            Wider, the column follows the page's scroll (no scroll of its own), so the tiers
            stay beside the list however long either gets. */
        }
        <StickyAside narrow="(max-width: 639.98px)" className="contents sm:block">
          {head && <div className="order-first mb-4 sm:mb-3">{head}</div>}
          <div className="sticky top-[57px] z-20 -mx-6 mb-4 border-b border-white/10 bg-panel/95 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:mb-0 sm:rounded-2xl sm:border sm:bg-white/[.03] sm:p-3 sm:backdrop-blur-none">
            {
              // Its title: on a phone the tiers are a slim bar
              // pinned under the top bar, with no room for one.
            }
            <h3
              id={`${id}-t`}
              className="mb-3 hidden min-h-7 items-center gap-2 px-1 sm:flex"
            >
              {/* Small capitals, as the ballot box's "Your ballot" label. */}
              <span className="truncate text-[12px] uppercase tracking-[.08em] text-white/55">
                Your tier list
              </span>
              <span className="text-[12px] text-white/40 tnum">
                {(() => {
                  const k = items.filter((i) => isTier(where(i.slug))).length;
                  return `${k} ${k === 1 ? "initiative" : "initiatives"}`;
                })()}
              </span>
            </h3>
            <div className="space-y-1 sm:space-y-2" role="group" aria-labelledby={`${id}-t`}>
              {TIER_LABELS.map((t) => {
                const inHere = items.filter((i) => where(i.slug) === t.tier);
                const note = missedNote(t.tier);
                const row = (
                  <div
                    key={t.tier}
                    data-drop={t.tier}
                    onClick={() => {
                      if (note) setNoteOpen(t.tier);
                    }}
                    className={cn(
                      "relative flex h-9 items-center gap-2 rounded-lg border pl-1.5 transition-colors sm:h-auto sm:min-h-[76px] sm:items-stretch sm:rounded-xl sm:p-1.5",
                      lit(t.tier)
                        ? "border-dao-green bg-dao-green/20"
                        : "border-transparent bg-white/[.03] sm:border-white/10",
                    )}
                  >
                    {landed?.to === t.tier && (
                      <span
                        key={landed.n}
                        aria-hidden="true"
                        className="pointer-events-none absolute -inset-px animate-tier-land rounded-[inherit] border border-dao-green bg-dao-green/20 shadow-[0_0_18px_rgba(92,183,90,.45)]"
                      />
                    )}
                    <div className="flex size-7 flex-none flex-col items-center justify-center rounded-md bg-white/[.06] sm:h-auto sm:w-[76px] sm:gap-1 sm:rounded-lg">
                      <b
                        key={landed?.to === t.tier ? landed.n : 0}
                        className={cn(
                          "font-inter-tight text-[16px] font-bold leading-none text-dao-green sm:text-[26px]",
                          landed?.to === t.tier && "motion-safe:animate-grade-bump",
                        )}
                      >
                        {t.grade}
                      </b>
                      <span className="hidden text-center text-[11px] leading-tight text-white/60 sm:block">
                        {t.label}
                      </span>
                      {isLocked(t.tier) && (
                        <span className="hidden text-[10px] uppercase tracking-[.08em] text-vote sm:block">
                          Settled
                        </span>
                      )}
                    </div>
                    {inHere.length === 0
                      ? (
                        <span className="flex min-w-0 flex-1 items-center truncate text-[11.5px] text-white/35 sm:justify-center sm:text-[13px]">
                          <span className="sm:hidden">{t.label}:&nbsp;</span>
                          drag here, or tap an initiative
                        </span>
                      )
                      : (
                        <ul
                          className="flex min-w-0 flex-1 gap-1 overflow-x-auto pr-1.5 [scrollbar-width:none] sm:flex-wrap sm:content-start sm:gap-1.5 sm:overflow-visible sm:py-0.5"
                          aria-label={t.label}
                        >
                          {inHere.map(chip)}
                        </ul>
                      )}
                  </div>
                );
                if (!note) return <Fragment key={t.tier}>{row}</Fragment>;
                return (
                  <Fragment key={t.tier}>
                    <Tooltip.Root
                      key={t.tier}
                      open={noteOpen === t.tier}
                      onOpenChange={(open) => setNoteOpen(open ? t.tier : undefined)}
                    >
                      <Tooltip.Trigger delay={300} closeOnClick={false} render={row} />
                      <Tooltip.Portal>
                        <Tooltip.Positioner sideOffset={6} className="z-[210]">
                          <Tooltip.Popup className="max-w-[260px] rounded-[14px] border border-edge2 bg-panel px-2.5 py-1.5 font-inter-tight text-[12px] leading-snug text-white shadow-menu outline-none">
                            {note}
                          </Tooltip.Popup>
                        </Tooltip.Positioner>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  </Fragment>
                );
              })}
            </div>
            {
              <div
                className={cn(
                  "mt-1.5 flex items-center justify-end gap-2 text-[12px] sm:mt-2 sm:text-[12.5px]",
                  // On a phone the pinned strip stays short: the row only when it can clear.
                  !(onReplace && (cleared || ((placedCount > 0 || changed) && !disabled))) &&
                    "max-sm:hidden",
                )}
              >
                {cleared
                  ? (
                    <>
                      <span className="min-w-0 flex-1 truncate text-white/60">
                        Ballot cleared.
                      </span>
                      <button
                        type="button"
                        onClick={undoClear}
                        className="rounded-md border border-white/20 px-2 py-1 text-white/75 hover:bg-white/10"
                      >
                        Undo
                      </button>
                    </>
                  )
                  : (
                    <>
                      <span className="min-w-0 flex-1 truncate px-1 text-white/45">
                        Initiatives in the same tier are ranked equally.
                      </span>
                      {onReplace && changed && !disabled && (
                        <button
                          type="button"
                          disabled={Boolean(drag)}
                          onClick={restoreSent}
                          className="inline-flex flex-none items-center gap-1 rounded-md px-1.5 py-1 text-white/50 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                        >
                          <Undo2 className="size-3.5" aria-hidden="true" />
                          Restore sent ballot
                        </button>
                      )}
                      {onReplace && placedCount > 0 && !disabled && (
                        <button
                          type="button"
                          disabled={Boolean(drag)}
                          onClick={clearAll}
                          className="inline-flex flex-none items-center gap-1 rounded-md px-1.5 py-1 text-white/50 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                        >
                          <Eraser className="size-3.5" aria-hidden="true" />
                          Clear ballot
                        </button>
                      )}
                    </>
                  )}
              </div>
            }
          </div>
          {notice && <div className="order-first mb-4 sm:mb-0 sm:mt-3">{notice}</div>}
          {actions && (
            // Phone: a bar pinned to the bottom and both sides of the screen, after the list;
            // wider: under the tier list.
            <div className="sticky bottom-0 z-10 order-last -mx-6 mt-4 sm:static sm:mx-0 sm:mt-3">
              {actions}
            </div>
          )}
          {
            // Phone: first, above the tiers; wider: under the send bar.
            aside && <div className="order-first mb-4 sm:mb-0 sm:mt-3">{aside}</div>
          }
        </StickyAside>

        {/* The list is as long as it needs: the page scrolls, on every screen. */}
        <div className="flex min-w-0 flex-col gap-4">
          {listHead}
          <section
            aria-labelledby={`${id}-u`}
            data-drop="unplaced"
            className={box("unplaced")}
          >
            <div className="mb-3 flex min-h-7 items-center gap-2 px-1">
              <h3 id={`${id}-u`} className="flex min-w-0 items-center gap-2">
                {/* As the tier list's title: small capitals, and a count in words. */}
                <span className="truncate text-[12px] uppercase tracking-[.08em] text-white/55">
                  {UNRANKED}
                </span>
                <span className="whitespace-nowrap text-[12px] text-white/40 tnum">
                  {filtered || ai ? `${shown.length} of ` : ""}
                  {unranked.length} {unranked.length === 1 ? "initiative" : "initiatives"}
                </span>
              </h3>
              <div className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                <CategoryFilter
                  value={view.cats}
                  counts={counts.cats}
                  onChange={(cats) => setView((v) => ({ ...v, cats }))}
                  align="end"
                  className="max-[641px]:h-7 max-[641px]:gap-1.5 max-[641px]:pl-2 max-[641px]:pr-1.5 max-[641px]:text-[12px]"
                />
              </div>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <BoardSearch
                compact
                view={view}
                onFilter={(next) => setView((v) => ({ ...v, ...next }))}
                aiEnabled={Boolean(search.ai)}
                aiAuto={Boolean(search.aiAuto)}
                active={ai}
                onResults={setAiResult}
                onAsking={setAsking}
              />
            </div>
            {shown.length > 0
              ? (
                <ul className="space-y-2" aria-label={UNRANKED}>
                  {shown.map(tile)}
                </ul>
              )
              : (
                <p className="px-1 py-6 text-center text-[13px] text-white/45">
                  {unranked.length === 0
                    ? skippedItems.length ? "All ranked or skipped." : "All ranked. Nice."
                    : asking
                    ? "Asking AI for the best matches…"
                    : "No initiatives match"}
                </p>
              )}
            {onSkip && skippedItems.length > 0 && (
              // At the end of the list: the skipped ones, hidden until asked for.
              <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  data-skipped-toggle=""
                  aria-expanded={showSkipped}
                  aria-controls={`${id}-skipped`}
                  onClick={() => setShowSkipped((v) => !v)}
                  className="mx-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-white/55 underline-offset-4 hover:bg-white/[.05] hover:text-white hover:underline tnum"
                >
                  <EyeOff className="size-3.5" aria-hidden="true" />
                  {
                    // Low-rated: a 1–2★ rating skips an initiative the first time (prefill).
                  }
                  {showSkipped ? "Hide" : "Show"} {skippedItems.length} skipped and low-rated
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform motion-reduce:transition-none",
                      showSkipped && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                </button>
                {showSkipped && (
                  <div
                    id={`${id}-skipped`}
                    data-drop="skipped"
                    className="mt-2 rounded-xl border border-dashed border-white/15 p-2"
                  >
                    <p className="mb-2 px-1 text-[12px] text-white/45">
                      Hidden from the list, and like it they get none of your share.
                    </p>
                    <ul className="space-y-2" aria-label={SKIPPED}>{skippedItems.map(tile)}</ul>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* What follows the pointer: the whole card, from the list or from a tier. */}
      {drag && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 z-[120] flex select-none items-center gap-2 overflow-hidden rounded-xl border border-[rgba(92,183,90,.6)] bg-panel pl-2 pr-3 text-left"
          style={{
            width: drag.w,
            height: drag.h,
            transform: `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px) rotate(-1.5deg)`,
            filter: "drop-shadow(0 14px 20px rgba(0,0,0,.45))",
          }}
        >
          {(() => {
            const i = items.find((it) => it.slug === drag.slug);
            return i && tileFace(i);
          })()}
        </div>
      )}
      {peek && (() => {
        const i = items.find((it) => it.slug === peek.slug);
        return i && (
          <InitiativePeek
            item={i}
            nav={{
              index: peek.order.indexOf(peek.slug),
              count: peek.order.length,
              onStep: stepPeek,
            }}
            choices={choicesFor(peek.slug)}
            current={where(peek.slug)}
            onChoose={movePeek}
            note={noteOf(peek.slug)}
            paid={paidOf(peek.slug)}
            onClose={() => closePeek()}
          />
        );
      })()}
      <p aria-live="polite" className="sr-only">{announce}</p>
    </div>
  );
}
