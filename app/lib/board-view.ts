/**
 * The board's filters and sorts as pure functions over the cards /api/board
 * returns (already in Recommended order). The URL is the state:
 * ?type=rfp&cat=opsec,defi&status=open&sort=closest&view=cards&q=safe
 * A plain URL is the list, in sections by category.
 */
import type { Card } from "~/lib/api-types";
import { CATEGORIES, CATEGORY_INDEX, categoryOf } from "~/lib/categories";
import { plural } from "~/lib/format";

export const TYPES = ["all", "rfp", "grant"] as const;
export const STATUSES = ["all", "open", "first-goal", "funded"] as const;
export const SORTS = [
  ["recommended", "Featured"],
  ["closest", "Closest to funded"],
  ["least-left", "Least left to raise"],
  ["newest", "Newest"],
  ["backers", "Most backers"],
  ["goal-asc", "Goal: low to high"],
  ["goal-desc", "Goal: high to low"],
  ["category", "By category"],
] as const;
export const VIEWS = ["cards", "list"] as const;
/** Where this device remembers the layout it used last. */
export const LAYOUT_KEY = "thedao:board-layout";

export type BoardType = typeof TYPES[number];
export type BoardStatus = typeof STATUSES[number];
export type BoardSort = typeof SORTS[number][0];
export type BoardViewMode = typeof VIEWS[number];

export interface BoardView {
  type: BoardType;
  status: BoardStatus;
  cats: string[];
  sort: BoardSort;
  view: BoardViewMode;
  q: string;
  /** Only the initiatives on this browser's watchlist. */
  watchlist: boolean;
}

export const DEFAULT_VIEW: BoardView = {
  type: "all",
  status: "all",
  cats: [],
  sort: "category",
  view: "list",
  q: "",
  watchlist: false,
};

const pick = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? v as T : fallback;

/** The view a URL asks for; unknown values fall back to the defaults. */
export function readView(params: URLSearchParams): BoardView {
  const cats = (params.get("cat") ?? "").split(",").filter((s) => categoryOf(s));
  return {
    type: pick(params.get("type"), TYPES, "all"),
    status: pick(params.get("status"), STATUSES, "all"),
    cats: [...new Set(cats)],
    sort: pick(params.get("sort"), SORTS.map((s) => s[0]), DEFAULT_VIEW.sort),
    view: pick(params.get("view"), VIEWS, DEFAULT_VIEW.view),
    q: (params.get("q") ?? "").slice(0, 100),
    watchlist: params.get("watchlist") === "1",
  };
}

/** The URL for a view, defaults left out so a plain board is a plain URL. */
export function writeView(v: BoardView): URLSearchParams {
  const p = new URLSearchParams();
  if (v.type !== "all") p.set("type", v.type);
  if (v.cats.length) p.set("cat", v.cats.join(","));
  if (v.status !== "all") p.set("status", v.status);
  if (v.sort !== DEFAULT_VIEW.sort) p.set("sort", v.sort);
  if (v.view !== DEFAULT_VIEW.view) p.set("view", v.view);
  if (v.q.trim()) p.set("q", v.q.trim());
  if (v.watchlist) p.set("watchlist", "1");
  return p;
}

/** Whether any filter narrows the board (sort and view do not). */
export const isFiltered = (v: BoardView) =>
  v.type !== "all" || v.status !== "all" || v.cats.length > 0 || v.q.trim() !== "" ||
  v.watchlist;

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** The text the keyword filter searches: title, summary, team, category labels. */
const haystack = (c: Card) =>
  [
    c.initiative.title,
    c.initiative.summary,
    c.initiative.recipientTeam ?? "",
    ...c.initiative.categories.map((s) => categoryOf(s)?.label ?? ""),
  ].join(" ").toLowerCase();

type Facet = "type" | "status" | "cats" | "q";

/** One card against the view; `skip` leaves one facet out (for that facet's counts).
 * Categories are OR among themselves and AND with everything else. */
export function matches(c: Card, v: BoardView, skip?: Facet, watched?: string[]): boolean {
  if (v.watchlist && watched && !watched.includes(c.initiative.id)) return false;
  if (skip !== "type" && v.type !== "all" && c.initiative.type !== v.type) return false;
  if (skip !== "status" && v.status === "open" && c.funded) return false;
  if (skip !== "status" && v.status === "funded" && !c.funded) return false;
  // First goal reached: past the vote floor. The cards carry it only while the display is on.
  if (skip !== "status" && v.status === "first-goal" && c.vote === "below") return false;
  if (
    skip !== "cats" && v.cats.length && !c.initiative.categories.some((s) => v.cats.includes(s))
  ) {
    return false;
  }
  if (skip !== "q" && v.q.trim()) {
    const h = haystack(c);
    if (!words(v.q).every((w) => h.includes(w))) return false;
  }
  return true;
}

const left = (c: Card) => Math.max(0, c.initiative.goalUsd - c.summary.total);
const when = (c: Card) => c.initiative.approvedAt ?? c.initiative.createdAt;
/** The category an initiative is filed under: its first, when the registry knows it. */
const primary = (c: Card): string | null =>
  categoryOf(c.initiative.categories[0] ?? "") ? c.initiative.categories[0] : null;

/**
 * "By category" order: the categories whose initiatives have raised the most
 * money come first, each initiative counted under its primary category. Equal
 * sums keep the registry order, and untagged is always last. `cards` is the
 * whole board, so the sections do not move around as filters narrow it.
 */
export function categoryOrder(cards: Card[]): (string | null)[] {
  const raised = new Map<string | null, number>();
  for (const c of cards) raised.set(primary(c), (raised.get(primary(c)) ?? 0) + c.summary.total);
  const slugs = CATEGORIES.map((c) => c.slug as string);
  return [
    ...slugs.sort((a, b) =>
      (raised.get(b) ?? 0) - (raised.get(a) ?? 0) || CATEGORY_INDEX[a] - CATEGORY_INDEX[b]
    ),
    null,
  ];
}

const KEYS: Record<Exclude<BoardSort, "category">, ((c: Card) => number) | null> = {
  recommended: null,
  closest: (c) => -c.pct,
  "least-left": left,
  newest: (c) => -when(c),
  backers: (c) => -c.backers,
  "goal-asc": (c) => c.initiative.goalUsd,
  "goal-desc": (c) => -c.initiative.goalUsd,
};

/** Sorted copy; ties keep the Recommended order the cards arrived in. `all` is
 * the whole board, which By category ranks its categories from. */
export function sortCards(cards: Card[], sort: BoardSort, all: Card[] = cards): Card[] {
  let key: ((c: Card) => number) | null;
  if (sort === "category") {
    const order = categoryOrder(all);
    key = (c) => order.indexOf(primary(c));
  } else key = KEYS[sort];
  if (!key) return [...cards];
  return cards.map((c, i) => [c, key(c), i] as const)
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .map(([c]) => c);
}

/** The cards the view shows, in its order. */
export const applyView = (cards: Card[], v: BoardView, watched?: string[]): Card[] =>
  sortCards(cards.filter((c) => matches(c, v, undefined, watched)), v.sort, cards);

/** Live counts for the controls: each facet counted with the other filters applied. */
export function facetCounts(cards: Card[], v: BoardView, watched?: string[]) {
  const type = { all: 0, rfp: 0, grant: 0 };
  for (const c of cards) {
    if (!matches(c, v, "type", watched)) continue;
    type.all++;
    type[c.initiative.type]++;
  }
  const cats: Record<string, number> = Object.fromEntries(CATEGORIES.map((c) => [c.slug, 0]));
  for (const c of cards) {
    if (!matches(c, v, "cats", watched)) continue;
    for (const s of c.initiative.categories) if (s in cats) cats[s]++;
  }
  return { type, cats };
}

/** "By category": sections by primary category in categoryOrder (ranked from
 * `all`, the whole board), untagged last. */
export function groupByPrimary(
  cards: Card[],
  all: Card[] = cards,
): { slug: string | null; cards: Card[] }[] {
  const groups = new Map<string | null, Card[]>();
  for (const c of cards) groups.set(primary(c), [...(groups.get(primary(c)) ?? []), c]);
  return categoryOrder(all)
    .filter((s) => groups.has(s))
    .map((slug) => ({ slug, cards: groups.get(slug)! }));
}

export const STATUS_LABELS = {
  open: "Open for funding",
  funded: "Fully funded",
  "first-goal": "First goal reached",
} as const;

/** What Clear filters resets: every applied filter (type, categories, funding
 * status, keyword, watchlist). Sort, view and the AI order stay as they are. */
export const CLEARED: Pick<BoardView, "type" | "cats" | "status" | "q" | "watchlist"> = {
  type: "all",
  cats: [],
  status: "all",
  q: "",
  watchlist: false,
};

export const TYPE_LABELS = { rfp: "RFPs", grant: "Grants" } as const;

/** The number the Filters (N) button shows: a type, the categories and a funding restriction. */
export const activeFilterCount = (v: BoardView): number =>
  (v.type !== "all" ? 1 : 0) + v.cats.length + (v.status !== "all" ? 1 : 0);

/** "12 initiatives", or "3 of 12 initiatives" while filters narrow the board. */
export const resultLabel = (shown: number, total: number, filtered: boolean): string =>
  filtered ? `${shown} of ${plural(total, "initiative")}` : plural(total, "initiative");

/** The featured initiatives: those the team pinned (an admin sort rank, 1 = top). */
export const featuredIds = (cards: Card[]): Set<string> =>
  new Set(cards.filter((c) => (c.initiative.sortRank ?? 0) > 0).map((c) => c.initiative.id));

/** Whether anything is featured (see featuredIds). */
export const hasFeatured = (cards: Card[]): boolean => featuredIds(cards).size > 0;

/** The sort the board uses: Featured (the server's order, pins first) only
 * while something is featured; a URL that still asks for it otherwise gets
 * closest to funded. */
export const sortFor = (sort: BoardSort, featured: boolean): BoardSort =>
  sort === "recommended" && !featured ? "closest" : sort;
