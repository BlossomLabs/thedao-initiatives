import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import FilterBar from "./FilterBar";
import { type BoardView, DEFAULT_VIEW } from "~/lib/board-view";
import { CATEGORIES } from "~/lib/categories";

const counts = {
  type: { all: 12, rfp: 7, grant: 5 },
  cats: Object.fromEntries(CATEGORIES.map((c, i) => [c.slug, i + 1])),
};

const bar = (
  view: Partial<BoardView> = {},
  onChange = vi.fn(),
  onSort = vi.fn(),
  watchlistCount = 0,
) => {
  render(
    <FilterBar
      view={{ ...DEFAULT_VIEW, ...view }}
      onChange={onChange}
      counts={counts}
      shown={view.cats?.length || view.status ? 3 : 12}
      total={12}
      ai={false}
      onSort={onSort}
      sheet={null}
      watchlistCount={watchlistCount}
    />,
  );
  return { onChange, onSort };
};

it("a focused Category stand-in hands focus to the real dropdown", async () => {
  bar();
  const standIn = screen.getByRole("button", { name: "Category" });
  standIn.focus();
  // the lazy chunk can take a while under a full, parallel test run
  await waitFor(
    () => expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Category" })),
    { timeout: 5000 },
  );
});

it("has a Type pill with counts, and no row of category chips", async () => {
  const { onChange } = bar();
  const type = screen.getByRole("combobox", { name: "Type" });
  expect(type).toHaveTextContent("All types 12");
  type.focus();
  fireEvent.keyDown(type, { key: "ArrowDown" });
  const rfps = await screen.findByRole("option", { name: /RFPs\s*7/ });
  for (let i = 0; i < 4 && !rfps.hasAttribute("data-highlighted"); i++) {
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 20));
  }
  fireEvent.keyDown(rfps, { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith({ type: "rfp" });
  expect(screen.queryByRole("button", { name: /OpSec/ })).toBeNull();
});

it("the Category dropdown lists dot, name and count; a pick adds to the filter and stays open", async () => {
  const { onChange } = bar({ cats: ["defi"] });
  // the combobox loads after the first render; a plain button stands in until then
  fireEvent.click(await screen.findByRole("combobox", { name: /Category/ }));
  const list = await screen.findByRole("listbox");
  const opsec = within(list).getByRole("option", { name: /OpSec/ });
  expect(opsec).toHaveTextContent(String(counts.cats.opsec));
  expect(opsec.querySelector("span[aria-hidden]")).not.toBeNull();
  const search = screen.getByRole("combobox", { name: "Search categories" });
  fireEvent.change(search, { target: { value: "ops" } });
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith({ cats: ["defi", "opsec"] });
  await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
});

it("says N of M when filtered", () => {
  bar({ cats: ["opsec"] });
  expect(screen.getAllByText("3 of 12 initiatives").length).toBeGreaterThan(0);
});

it("the pills say what they filter by: one category by name, several as Categories", () => {
  bar({ cats: ["opsec"] });
  expect(screen.getByRole("combobox", { name: /Category/ })).toHaveTextContent("OpSec");
});

it("several categories read N Categories", () => {
  bar({ cats: ["opsec", "defi"] });
  const pill = screen.getByRole("combobox", { name: /Category/ });
  expect(pill).toHaveTextContent("2 Categories");
  expect(pill).not.toHaveTextContent("OpSec");
});

it("no row of applied filters: the pills carry the state", () => {
  bar({ type: "grant", cats: ["opsec"], status: "open" });
  expect(screen.queryByRole("group", { name: "Active filters" })).toBeNull();
  expect(document.querySelector("hr")).toBeNull();
  expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("Grants");
  expect(screen.getByRole("combobox", { name: "Funding status" })).toHaveTextContent(
    "Open for funding",
  );
});

it("Clear filters shows only while something is filtered, and resets it all but sort", () => {
  const { onChange } = bar({ cats: ["opsec"], status: "open", sort: "newest" });
  fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
  expect(onChange).toHaveBeenLastCalledWith({
    type: "all",
    cats: [],
    status: "all",
    q: "",
    watchlist: false,
  });
});

it("no Clear filters with nothing filtered, and the count reads N initiatives", () => {
  bar();
  expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  expect(screen.getAllByText("12 initiatives").length).toBeGreaterThan(0);
  expect(screen.getByText("Filters:")).toBeInTheDocument();
});

it("the Type pill and its options carry a type icon", async () => {
  bar({ type: "grant" });
  const type = screen.getByRole("combobox", { name: "Type" });
  expect(type.querySelector("[data-type-glyph='grant']")).not.toBeNull();
  type.focus();
  fireEvent.keyDown(type, { key: "ArrowDown" });
  await screen.findByRole("listbox");
  for (const t of ["all", "rfp", "grant"]) {
    expect(document.querySelector(`[role=option] [data-type-glyph='${t}']`), t).not.toBeNull();
  }
});

it("the empty Category pill shows three plain dots, without the rings", async () => {
  bar();
  const pill = await screen.findByRole("combobox", { name: "Category" });
  const dots = pill.querySelectorAll(".rounded-full");
  expect(dots).toHaveLength(3);
  for (const d of dots) expect(d.className).not.toMatch(/shadow-/);
});

it("My watchlist appears once this browser has one, and toggles the filter", () => {
  bar();
  expect(screen.queryByRole("button", { name: /My watchlist/ })).toBeNull();
  cleanup();
  const { onChange } = bar({}, vi.fn(), vi.fn(), 2);
  const pill = screen.getAllByRole("button", { name: /My watchlist 2/ })[0];
  expect(pill).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(pill);
  expect(onChange).toHaveBeenLastCalledWith({ watchlist: true });
});
