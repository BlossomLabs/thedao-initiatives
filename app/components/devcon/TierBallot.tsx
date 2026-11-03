import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, GripVertical, RotateCcw, X } from "lucide-react";
import CategoryDot from "~/components/ui/CategoryDot";
import { LinkButton } from "~/components/ui/Button";
import type { Card } from "~/lib/api-types";
import type { AiSearchResult } from "../../../shared/ai-search";
import BoardSearch from "~/components/board/BoardSearch";
import CategoryFilter from "~/components/board/filters/CategoryFilter";
import { type BoardView, DEFAULT_VIEW, facetCounts, isFiltered, matches } from "~/lib/board-view";
import { categoryOf } from "~/lib/categories";
import { usd } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { Tier } from "../../../shared/devcon/ballot";

/** Ported from blossomlabs.eth's budgeting TierList.
 * A tier list (S, A and B rows of small chips) beside the initiatives not ranked yet;
 * on a phone it is pinned at the top, over the full-width list.
 * Drag a tile (press and hold on a phone) onto a tier, or tap it and then tap a tier.
 * Dragging or placing it back on the list unranks it. Same tier = equal priority. */
export const TIER_LABELS: { tier: Tier; grade: string; label: string }[] = [
  { tier: "S", grade: "S", label: "Must fund" },
  { tier: "A", grade: "A", label: "Should fund" },
  { tier: "B", grade: "B", label: "Nice to have" },
];

export type BallotItem = { slug: string; title: string; card?: Card };

type Where = Tier | "unplaced";

const UNRANKED = "Not ranked yet";

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
  { items, tiers, disabled, onChange, onReplace, search = {}, actions }: {
    items: BallotItem[];
    /** The send bar: under the tier list on wider screens, floating at the bottom on a phone. */
    actions?: React.ReactNode;
    /** The board's AI search flags: the box offers AI only while it is on. */
    search?: { ai?: boolean; aiAuto?: boolean };
    tiers: Partial<Record<string, Tier>>;
    disabled: boolean;
    onChange: (slug: string, tier: Tier | undefined) => void;
    /** Sets the whole ballot at once: Clear ballot, and its Undo. */
    onReplace?: (tiers: Partial<Record<string, Tier>>) => void;
  },
) {
  const id = useId();
  /** The initiative picked up: by a tap (waiting for a tier) or by a drag. */
  const [picked, setPicked] = useState<string>();
  const [drag, setDrag] = useState<Drag>();
  const [over, setOver] = useState<Where>();
  const [expanded, setExpanded] = useState<string>();
  // The front page's search (keywords, or AI) and category filter, over the list.
  const [view, setView] = useState<BoardView>({ ...DEFAULT_VIEW });
  const [aiResult, setAiResult] = useState<AiSearchResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [announce, setAnnounce] = useState("");
  /** What Clear ballot took away, for its Undo, while the offer lasts. */
  const [cleared, setCleared] = useState<Partial<Record<string, Tier>>>();
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
    onReplace({});
    setAnnounce("Ballot cleared. Every initiative is back in the list.");
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
  const where = (slug: string): Where => tiers[slug] ?? "unplaced";
  const labelOf = (w: Where) => TIER_LABELS.find((t) => t.tier === w)?.label ?? UNRANKED;
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
    onChange(slug, dest === "unplaced" ? undefined : dest);
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
  const grab = (slug: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
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
      if (justDragged.current) return;
      setPicked((on) => on === slug ? undefined : slug);
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

  const unranked = useMemo(() => items.filter((i) => !tiers[i.slug]), [items, tiers]);
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
  const takes = (t: Where) => picked !== undefined && where(picked) !== t;
  const lit = (t: Where) => Boolean(drag) && over === t && takes(t);

  /** A card's insides: the grip, the title, and its category and goal. */
  const tileFace = (i: BallotItem) => {
    const r = i.card?.initiative;
    const cat = r?.categories[0];
    return (
      <>
        <GripVertical className="size-4 flex-none text-white/30" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <span className="line-clamp-2 font-inter-tight text-[14px] leading-[1.3] text-white">
            {i.title}
          </span>
          {r && (
            <span className="flex h-[18px] items-center gap-1.5 truncate text-[12px] text-white/45">
              {cat && <CategoryDot slug={cat} className="size-[7px]" />}
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

  const tile = (i: BallotItem) => {
    const on = picked === i.slug;
    const open = expanded === i.slug;
    const r = i.card?.initiative;
    const detailsId = `${id}-details-${i.slug}`;
    return (
      <li
        key={i.slug}
        className={cn(
          "relative overflow-hidden rounded-xl border transition-colors",
          on && !drag
            ? "border-[rgba(92,183,90,.6)] bg-dao-green/10"
            : "border-white/10 bg-white/5",
          landed?.slug === i.slug && "motion-safe:animate-chip-land",
        )}
      >
        <button
          type="button"
          disabled={disabled}
          aria-pressed={on}
          aria-describedby={`${id}-how`}
          data-ballot-tile={i.slug}
          {...grab(i.slug)}
          className={cn(
            TILE,
            "relative flex w-full select-none items-center gap-2 overflow-hidden pl-2 pr-12 text-left transition-opacity duration-150 [-webkit-touch-callout:none]",
            !disabled && "cursor-grab hover:bg-white/[.03]",
            drag?.slug === i.slug && "opacity-40",
            disabled && "opacity-60",
          )}
        >
          {tileFace(i)}
        </button>
        <button
          type="button"
          aria-label={`${open ? "Hide" : "Show"} preview for ${i.title}`}
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(open ? undefined : i.slug);
          }}
          className="absolute right-1 top-[14px] grid size-11 place-items-center rounded-lg text-white/55 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-dao-green"
        >
          <ChevronDown
            className={cn(
              "size-[18px] transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        {open && (
          <div
            id={detailsId}
            className="space-y-3 border-t border-white/10 px-4 py-3.5"
            onClick={(e) => e.stopPropagation()}
          >
            {r?.summary && <p className="text-[13px] leading-relaxed text-white/75">{r.summary}</p>}
            <LinkButton
              variant="ghost"
              sm
              to={`/initiative/${i.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Details for ${i.title} (opens in a new tab)`}
            >
              Details <ArrowRight className="size-3.5" aria-hidden="true" />
            </LinkButton>
          </div>
        )}
      </li>
    );
  };

  /** Phone: a small chip in the mini tier list: the category dot and the title's start. */
  const chip = (i: BallotItem) => {
    const on = picked === i.slug;
    const cat = i.card?.initiative.categories[0];
    return (
      <li
        key={i.slug}
        className={cn(
          "relative flex-none",
          landed?.slug === i.slug && "motion-safe:animate-chip-land",
        )}
      >
        <button
          type="button"
          disabled={disabled}
          aria-pressed={on}
          aria-label={i.title}
          title={i.title}
          data-ballot-chip={i.slug}
          {...grab(i.slug)}
          className={cn(
            "relative flex h-7 w-[84px] select-none overflow-hidden items-center gap-1.5 rounded-lg border px-2 text-left [-webkit-touch-callout:none] sm:h-8 sm:w-[136px] sm:cursor-grab",
            on && !drag
              ? "border-[rgba(92,183,90,.7)] bg-dao-green/15 pr-6 sm:pr-7"
              : "border-white/15 bg-white/[.07]",
            drag?.slug === i.slug && "opacity-40",
          )}
        >
          {cat
            ? <CategoryDot slug={cat} className="size-[7px] flex-none" />
            : <span className="size-[7px] flex-none rounded-full bg-white/30" aria-hidden="true" />}
          <span className="truncate text-[11.5px] leading-none text-white/85 sm:text-[12.5px]">
            {i.title}
          </span>
        </button>
        {on && !drag && !disabled && (
          // Picked in a tier: an x inside the chip takes it out of the ballot.
          <button
            type="button"
            aria-label={`Remove ${i.title} from ${labelOf(where(i.slug))}`}
            onClick={(e) => {
              e.stopPropagation();
              place(i.slug, "unplaced");
            }}
            className="absolute inset-y-0 right-0 grid w-6 place-items-center rounded-r-lg text-white/70 hover:bg-white/10 hover:text-white sm:w-7"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
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

  /** Tapped an initiative, then a tier (or the list): it goes there. */
  const placeTapped = (t: Where) => () => {
    if (picked && !drag && takes(t)) place(picked, t);
  };

  /** The "Tap a tier for…" line: only for a pick from the list (a tiered chip has its own x). */
  const pickedTitle = picked && where(picked) === "unplaced" ? titleOf(picked) : undefined;

  return (
    <div className={cn(drag && "cursor-grabbing")}>
      <p id={`${id}-how`} className="sr-only">
        Pick an initiative up, then choose a tier for it. Escape cancels.
      </p>

      <div className="grid grid-cols-1 items-start gap-0 sm:grid-cols-2 sm:gap-6">
        {
          /* The tier list: pinned under the top bar on a phone, the left column on wider
            screens, with the send bar under it there. On a phone this wrapper steps aside. */
        }
        <div className="contents sm:sticky sm:top-20 sm:block sm:self-start lg:top-24">
          <div className="sticky top-[57px] z-20 -mx-6 mb-4 border-b border-white/10 bg-panel/95 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:mb-0 sm:max-h-[calc(100dvh-19rem)] sm:overflow-y-auto sm:overscroll-contain sm:rounded-2xl sm:border sm:bg-white/[.03] sm:p-3 sm:backdrop-blur-none">
            <div className="space-y-1 sm:space-y-2">
              {TIER_LABELS.map((t) => {
                const inHere = items.filter((i) => where(i.slug) === t.tier);
                return (
                  <div
                    key={t.tier}
                    data-drop={t.tier}
                    onClick={placeTapped(t.tier)}
                    className={cn(
                      "relative flex h-9 items-center gap-2 rounded-lg border pl-1.5 transition-colors sm:h-auto sm:min-h-[76px] sm:items-stretch sm:rounded-xl sm:p-1.5",
                      lit(t.tier)
                        ? "border-dao-green bg-dao-green/20"
                        : !drag && takes(t.tier)
                        ? "cursor-pointer border-[rgba(92,183,90,.4)] bg-dao-green/[.06]"
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
                    <button
                      type="button"
                      aria-label={`Place in ${t.label}`}
                      disabled={!takes(t.tier) || Boolean(drag)}
                      onClick={(e) => {
                        e.stopPropagation();
                        placeTapped(t.tier)();
                      }}
                      className="flex size-7 flex-none flex-col items-center justify-center rounded-md bg-white/[.06] disabled:cursor-default sm:h-auto sm:w-[76px] sm:gap-1 sm:rounded-lg"
                    >
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
                    </button>
                    {inHere.length === 0
                      ? (
                        <span className="flex min-w-0 flex-1 items-center truncate text-[11.5px] text-white/35 sm:justify-center sm:text-[13px]">
                          <span className="sm:hidden">{t.label}:&nbsp;</span>
                          {picked ? "tap to place here" : "drag or tap to fill"}
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
              })}
            </div>
            {pickedTitle && !drag && (
              <div className="mt-2 flex items-center gap-2 text-[12px] sm:text-[12.5px]">
                <span className="min-w-0 flex-1 truncate text-white/60">
                  Tap a tier for <b className="font-medium text-white">{pickedTitle}</b>
                </span>
                <button
                  type="button"
                  onClick={done}
                  className="rounded-md border border-white/20 px-2 py-1 text-white/75 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            )}
            {onReplace && !(pickedTitle && !drag) && (cleared || (placedCount > 0 && !disabled)) &&
              (
                <div className="mt-1.5 flex items-center justify-end gap-2 text-[12px] sm:mt-2 sm:text-[12.5px]">
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
                      <button
                        type="button"
                        disabled={Boolean(drag)}
                        onClick={clearAll}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-white/50 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                      >
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                        Clear ballot
                      </button>
                    )}
                </div>
              )}
          </div>
          {actions && (
            // Phone: a bar pinned to the bottom and both sides of the screen, after the list;
            // wider: under the tier list.
            <div className="sticky bottom-0 z-10 order-last -mx-6 mt-4 sm:static sm:mx-0 sm:mt-3">
              {actions}
            </div>
          )}
        </div>

        <section
          aria-labelledby={`${id}-u`}
          data-drop="unplaced"
          onClick={placeTapped("unplaced")}
          className={box("unplaced")}
        >
          <div className="mb-1 flex min-h-7 items-center gap-2 px-1">
            <h3 id={`${id}-u`} className="flex min-w-0 items-center gap-2">
              <span className="truncate font-inter-tight text-[14px] font-medium text-white">
                {UNRANKED}
              </span>
              <span className="text-[12px] text-white/40 tnum">
                {filtered || ai ? `${shown.length} of ${unranked.length}` : unranked.length}
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
          <p className="mb-3 px-1 text-[12.5px] text-white/45">
            Anything you leave here gets none of your share.
          </p>
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
            ? <ul className="space-y-2" aria-label={UNRANKED}>{shown.map(tile)}</ul>
            : (
              <p className="px-1 py-6 text-center text-[13px] text-white/45">
                {unranked.length === 0
                  ? "All ranked. Nice."
                  : asking
                  ? "Asking AI for the best matches…"
                  : "No initiatives match"}
              </p>
            )}
        </section>
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
      <p aria-live="polite" className="sr-only">{announce}</p>
    </div>
  );
}
