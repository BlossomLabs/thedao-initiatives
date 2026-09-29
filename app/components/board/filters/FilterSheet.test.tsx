import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import FilterSheet from "./FilterSheet";
import { DEFAULT_VIEW } from "~/lib/board-view";
import type { Card } from "~/lib/api-types";

const mk = (id: string, cats: string[], funded = false) =>
  ({
    initiative: { id, type: "rfp", categories: cats, title: id, summary: "", goalUsd: 1 },
    summary: { total: 0 },
    funded,
  }) as unknown as Card;
const cards = [mk("a", ["opsec"]), mk("b", ["defi"]), mk("c", ["opsec", "defi"], true)];

const sheet = (view = DEFAULT_VIEW, onApply = vi.fn(), list = cards) => {
  const utils = render(<FilterSheet cards={list} view={view} onApply={onApply} />);
  return { ...utils, onApply };
};
const openSheet = () => fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
const dialog = () => screen.getByRole("dialog", { name: "Filters" });
const box = (name: RegExp) => within(dialog()).getByRole("checkbox", { name });

it("the button counts the active filters", () => {
  sheet({ ...DEFAULT_VIEW, cats: ["opsec"], status: "open" });
  expect(screen.getByRole("button", { name: "Filters (2)" })).toBeInTheDocument();
});

it("changes are provisional: the count previews, Show applies", () => {
  const { onApply } = sheet();
  openSheet();
  expect(within(dialog()).getByRole("button", { name: "Show 3 initiatives" })).toBeInTheDocument();
  fireEvent.click(box(/OpSec/));
  expect(onApply).not.toHaveBeenCalled();
  expect(within(dialog()).getByRole("button", { name: "Show 2 initiatives" })).toBeInTheDocument();
  fireEvent.click(within(dialog()).getByRole("radio", { name: "Open for funding" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Show 1 initiative" }));
  expect(onApply).toHaveBeenCalledWith({ cats: ["opsec"], status: "open" });
});

it("closing discards, and reopening shows the applied state", async () => {
  const { onApply } = sheet({ ...DEFAULT_VIEW, cats: ["defi"] });
  openSheet();
  fireEvent.click(box(/OpSec/));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(onApply).not.toHaveBeenCalled();
  openSheet();
  expect(box(/OpSec/)).not.toBeChecked();
  expect(box(/DeFi/)).toBeChecked();
});

it("Reset clears the provisional state only", () => {
  const { onApply } = sheet({ ...DEFAULT_VIEW, cats: ["defi"], status: "funded" });
  openSheet();
  fireEvent.click(within(dialog()).getByRole("button", { name: "Reset" }));
  expect(box(/DeFi/)).not.toBeChecked();
  expect(within(dialog()).getByRole("radio", { name: "Any funding status" })).toBeChecked();
  expect(onApply).not.toHaveBeenCalled();
});

it("searches categories inline", () => {
  sheet();
  openSheet();
  fireEvent.change(within(dialog()).getByRole("searchbox", { name: "Search categories" }), {
    target: { value: "wall" },
  });
  expect(within(dialog()).getAllByRole("checkbox")).toHaveLength(1);
});

it("focus returns to the Filters button on close", async () => {
  sheet();
  const btn = screen.getByRole("button", { name: /^Filters/ });
  btn.focus();
  fireEvent.click(btn);
  fireEvent.keyDown(dialog(), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(btn));
});

it("a board refetch while open keeps the provisional picks", () => {
  const { rerender } = sheet();
  openSheet();
  fireEvent.click(box(/OpSec/));
  rerender(<FilterSheet cards={[...cards]} view={{ ...DEFAULT_VIEW }} onApply={vi.fn()} />);
  expect(box(/OpSec/)).toBeChecked();
});
