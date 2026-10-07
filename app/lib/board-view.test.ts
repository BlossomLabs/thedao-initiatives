import { describe, expect, it } from "vitest";
import type { Card } from "./api-types";
import { CATEGORIES } from "./categories";
import {
  activeFilterCount,
  applyView,
  type BoardView,
  categoryOrder,
  CLEARED,
  DEFAULT_VIEW,
  facetCounts,
  featuredIds,
  groupByPrimary,
  hasFeatured,
  isFiltered,
  readView,
  resultLabel,
  sortCards,
  sortFor,
  SORTS,
  writeView,
} from "./board-view";

let n = 0;
const card = (
  title: string,
  o: {
    type?: "rfp" | "grant";
    cats?: string[];
    goal?: number;
    raised?: number;
    backers?: number;
    at?: number;
    team?: string;
  } = {},
): Card => {
  const goal = o.goal ?? 100_000;
  const raised = o.raised ?? 0;
  n++;
  return {
    initiative: {
      id: String(n),
      slug: title.toLowerCase().replace(/\s+/g, "-"),
      title,
      summary: `Summary of ${title}`,
      goalUsd: goal,
      status: "approved",
      type: o.type ?? "grant",
      sortRank: null,
      safeAddress: "",
      categories: o.cats ?? [],
      recipientTeam: o.team ?? "",
      createdAt: o.at ?? n,
      approvedAt: o.at ?? n,
    },
    summary: {
      pledged: 0,
      received: 0,
      donated: raised,
      total: raised,
      live: true,
      ledger: 0,
      paidOut: 0,
    },
    pct: Math.min(100, Math.round((1000 * raised) / goal) / 10),
    backers: o.backers ?? 0,
    donations: 0,
    logos: [],
    funded: raised >= goal,
    donationsEnabled: true,
  };
};

// Recommended order, as the API sends it.
const board = [
  card("Vyper compiler", {
    cats: ["formal-verification", "compilers"],
    goal: 600_000,
    raised: 100_000,
    backers: 3,
    at: 10,
  }),
  card("Safe lockdown", {
    cats: ["opsec", "wallets-signing"],
    goal: 14_000,
    raised: 14_000,
    backers: 1,
    at: 30,
  }),
  card("Directory of value", {
    type: "rfp",
    cats: ["audits-analysis", "defi"],
    goal: 50_000,
    raised: 5_000,
    at: 20,
  }),
  card("Echidna", { cats: ["fuzzing-testing"], goal: 48_000, raised: 40_000, backers: 5, at: 5 }),
  card("Untagged legacy", { type: "rfp", goal: 10_000, at: 1 }),
];
const titles = (cs: Card[]) => cs.map((c) => c.initiative.title);

describe("board view", () => {
  it("featured are all the initiatives the team pinned, whatever their rank", () => {
    const at = (title: string, sortRank: number | null) => {
      const c = card(title);
      return { ...c, initiative: { ...c.initiative, sortRank } };
    };
    const one = at("One", 1), four = at("Four", 4), last = at("Last", 999), none = at("None", null);
    expect([...featuredIds([one, four, last, none])].sort()).toEqual(
      [one.initiative.id, four.initiative.id, last.initiative.id].sort(),
    );
    expect(hasFeatured([four, none])).toBe(true);
    expect(hasFeatured([none])).toBe(false);
  });

  it("without featured initiatives, the default order is closest to funded", () => {
    expect(sortFor("recommended", false)).toBe("closest");
    expect(sortFor("recommended", true)).toBe("recommended");
    expect(sortFor("newest", false)).toBe("newest");
  });

  it("the default sort is labelled Featured", () => {
    expect(SORTS.find(([v]) => v === "recommended")?.[1]).toBe("Featured");
  });

  it("Clear filters empties type, categories, funding status and the keyword, keeping sort and view", () => {
    const v: BoardView = {
      ...DEFAULT_VIEW,
      type: "rfp",
      cats: ["opsec"],
      status: "open",
      sort: "newest",
      view: "list",
      q: "x",
    };
    expect({ ...v, ...CLEARED }).toEqual({ ...v, type: "all", cats: [], status: "all", q: "" });
  });

  it("counts the active filters the Filters button shows", () => {
    expect(activeFilterCount(DEFAULT_VIEW)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_VIEW, cats: ["a", "b"], status: "funded" })).toBe(3);
    expect(activeFilterCount({ ...DEFAULT_VIEW, type: "rfp", sort: "newest" })).toBe(1);
  });

  it("labels the results", () => {
    expect(resultLabel(12, 12, false)).toBe("12 initiatives");
    expect(resultLabel(1, 1, false)).toBe("1 initiative");
    expect(resultLabel(3, 12, true)).toBe("3 of 12 initiatives");
    expect(resultLabel(1, 1, true)).toBe("1 of 1 initiative");
  });

  it("URL round trip, defaults omitted, junk ignored", () => {
    const v = readView(
      new URLSearchParams(
        "type=rfp&cat=opsec,defi,nope,opsec&sort=closest&view=list&q=safe&status=bogus",
      ),
    );
    expect(v).toEqual({
      type: "rfp",
      status: "all",
      cats: ["opsec", "defi"],
      sort: "closest",
      view: "list",
      q: "safe",
      watchlist: false,
    });
    expect(writeView(v).toString()).toBe("type=rfp&cat=opsec%2Cdefi&sort=closest&q=safe");
    // The plain board is the list by category; the other layout and sorts are spelled out.
    expect(DEFAULT_VIEW).toMatchObject({ view: "list", sort: "category" });
    expect(writeView({ ...DEFAULT_VIEW, view: "cards", sort: "recommended" }).toString()).toBe(
      "sort=recommended&view=cards",
    );
    expect(readView(new URLSearchParams("view=cards&sort=bogus"))).toMatchObject({
      view: "cards",
      sort: "category",
    });
    expect(writeView(DEFAULT_VIEW).toString()).toBe("");
    expect(readView(new URLSearchParams(""))).toEqual(DEFAULT_VIEW);
  });

  it("filters: categories OR, AND with type, status and keywords", () => {
    const v = { ...DEFAULT_VIEW, cats: ["opsec", "defi"] };
    expect(titles(applyView(board, v))).toEqual(["Safe lockdown", "Directory of value"]);
    expect(titles(applyView(board, { ...v, type: "rfp" }))).toEqual(["Directory of value"]);
    expect(titles(applyView(board, { ...v, status: "funded" }))).toEqual(["Safe lockdown"]);
    expect(titles(applyView(board, { ...v, status: "open" }))).toEqual(["Directory of value"]);
    // keywords: every word, any of title, summary or category label
    expect(titles(applyView(board, { ...DEFAULT_VIEW, q: "FUZZING echidna" }))).toEqual([
      "Echidna",
    ]);
    expect(titles(applyView(board, { ...DEFAULT_VIEW, q: "defi safety" }))).toEqual([
      "Directory of value",
    ]);
    expect(applyView(board, { ...DEFAULT_VIEW, q: "nothing matches this" })).toEqual([]);
  });

  it("every sort, ties falling back to Recommended", () => {
    expect(titles(sortCards(board, "recommended"))).toEqual(titles(board));
    expect(titles(sortCards(board, "closest"))).toEqual([
      "Safe lockdown",
      "Echidna",
      "Vyper compiler",
      "Directory of value",
      "Untagged legacy",
    ]);
    expect(titles(sortCards(board, "least-left"))).toEqual([
      "Safe lockdown",
      "Echidna",
      "Untagged legacy",
      "Directory of value",
      "Vyper compiler",
    ]);
    expect(titles(sortCards(board, "newest"))).toEqual([
      "Safe lockdown",
      "Directory of value",
      "Vyper compiler",
      "Echidna",
      "Untagged legacy",
    ]);
    expect(titles(sortCards(board, "backers"))).toEqual([
      "Echidna",
      "Vyper compiler",
      "Safe lockdown",
      "Directory of value",
      "Untagged legacy",
    ]);
    expect(titles(sortCards(board, "goal-asc"))).toEqual([
      "Untagged legacy",
      "Safe lockdown",
      "Echidna",
      "Directory of value",
      "Vyper compiler",
    ]);
    expect(titles(sortCards(board, "goal-desc"))).toEqual([
      "Vyper compiler",
      "Directory of value",
      "Echidna",
      "Safe lockdown",
      "Untagged legacy",
    ]);
    // most raised first: formal-verification 100k, fuzzing-testing 40k, opsec 14k,
    // audits-analysis 5k; untagged last
    expect(titles(sortCards(board, "category"))).toEqual([
      "Vyper compiler",
      "Echidna",
      "Safe lockdown",
      "Directory of value",
      "Untagged legacy",
    ]);
  });

  it("facet counts apply the other filters", () => {
    const f = facetCounts(board, { ...DEFAULT_VIEW, type: "rfp", cats: ["opsec"] });
    expect(f.type).toEqual({ all: 1, rfp: 0, grant: 1 });
    expect(f.cats.defi).toBe(1);
    expect(f.cats.opsec).toBe(0);
    expect(f.cats["audits-analysis"]).toBe(1);
  });

  it("groups by primary category, the categories that raised most first, untagged last", () => {
    expect(groupByPrimary(board).map((g) => [g.slug, g.cards.length])).toEqual([
      ["formal-verification", 1],
      ["fuzzing-testing", 1],
      ["opsec", 1],
      ["audits-analysis", 1],
      [null, 1],
    ]);
  });

  it("a category's rank is the sum its initiatives raised, whatever the filters show", () => {
    const more = [
      ...board,
      card("Second audit", { cats: ["audits-analysis"], raised: 30_000 }),
      card("Third audit", { cats: ["audits-analysis", "opsec"], raised: 80_000 }),
      card("Rich but untagged", { raised: 900_000 }),
    ];
    // audits-analysis 5k + 30k + 80k = 115k now leads; a second category does not count.
    expect(categoryOrder(more).slice(0, 4)).toEqual([
      "audits-analysis",
      "formal-verification",
      "fuzzing-testing",
      "opsec",
    ]);
    expect(categoryOrder(more).at(-1)).toBeNull();
    // Nothing raised anywhere: the registry order.
    expect(categoryOrder([])).toEqual([...CATEGORIES.map((c) => c.slug), null]);
    // Filtered down to the two smallest raisers, the sections keep the whole board's order.
    const shown = more.filter((c) =>
      ["Directory of value", "Echidna", "Rich but untagged"].includes(c.initiative.title)
    );
    expect(groupByPrimary(shown, more).map((g) => g.slug)).toEqual([
      "audits-analysis",
      "fuzzing-testing",
      null,
    ]);
    expect(titles(applyView(more, { ...DEFAULT_VIEW, type: "rfp" }))).toEqual([
      "Directory of value",
      "Untagged legacy",
    ]);
  });
});

describe("watchlist", () => {
  it("keeps only watchlisted initiatives and round-trips in the URL", () => {
    const v = { ...DEFAULT_VIEW, watchlist: true };
    expect(
      titles(applyView(board, v, [
        board.find((c) => c.initiative.title === "Echidna")!.initiative.id,
      ])),
    ).toEqual(["Echidna"]);
    expect(writeView(v).toString()).toBe("watchlist=1");
    expect(readView(new URLSearchParams("watchlist=1")).watchlist).toBe(true);
    expect(isFiltered(v)).toBe(true);
  });
});

describe("keyword filter", () => {
  it("matches a grant's recipient team too", () => {
    const cards = [card("Fuzzing grant", { team: "Trail of Bits" }), card("Other grant")];
    const v = { ...DEFAULT_VIEW, q: "trail bits" };
    expect(applyView(cards, v).map((c) => c.initiative.title)).toEqual(["Fuzzing grant"]);
  });
});

describe("First goal reached filter", () => {
  it("keeps the cards past the vote floor; without the display on it narrows nothing", () => {
    const below = { ...card("Below"), vote: "below" as const };
    const past = { ...card("Past"), vote: "eligible" as const };
    const gap = { ...card("Gap"), vote: "gap" as const };
    const v = { ...DEFAULT_VIEW, status: "first-goal" as const };
    expect(applyView([below, past, gap], v).map((c) => c.initiative.title)).toEqual([
      "Past",
      "Gap",
    ]);
    expect(applyView([card("Off")], v)).toHaveLength(1);
  });
});
