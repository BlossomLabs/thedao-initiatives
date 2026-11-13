import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import MockNav, { exampleAt, exampleUrl, hasView } from "./MockNav";

const show = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <MockNav />
    </MemoryRouter>,
  );
const nav = () => within(screen.getByRole("navigation", { name: "Examples" }));
const view = () => within(nav().getByRole("group", { name: "View" }));

it("reads the example on screen from its path", () => {
  expect(exampleAt("/vote/mock/spent/edit")).toEqual({ kind: "spent", view: "edit" });
  expect(exampleAt("/vote/mock/missed")).toEqual({ kind: "missed", view: "yours" });
  expect(exampleAt("/vote/results/b-settling")).toEqual({ kind: "b-settling", view: "results" });
  // The first name of S-Tier settled's results still opens them.
  expect(exampleAt("/vote/results/s-settled")).toEqual({ kind: "spent", view: "results" });
  expect(exampleAt("/vote/ballot")).toBeNull();
  // A variant's results are its moment's.
  expect(exampleUrl("prefilled", "results")).toBe("/vote/results/started");
});

it("each moment in each view it has", () => {
  expect(hasView("finished", "edit")).toBe(false);
  expect(hasView("missed", "edit")).toBe(false);
  expect(hasView("started", "yours")).toBe(false);
  expect(hasView("started", "results")).toBe(true);
});

it("switching view keeps the moment; what a moment lacks is greyed", () => {
  show("/vote/results/spent");
  expect(view().getByRole("link", { name: "Vote results", current: "page" })).toBeInTheDocument();
  expect(view().getByRole("link", { name: "Ballot" })).toHaveAttribute(
    "href",
    "/vote/mock/spent/edit",
  );
  expect(view().getByRole("link", { name: "Your ballot" })).toHaveAttribute(
    "href",
    "/vote/mock/spent",
  );
  // Its name and time, in the reader's own zone.
  expect(nav().getByText("S-Tier settled")).toBeInTheDocument();
});

it("the dots and arrows go to each moment in this view, or the first one it has", () => {
  show("/vote/mock/s-extended/edit");
  expect(nav().getByRole("link", { current: "page", name: /^S-Tier extended,/ }))
    .toHaveAttribute("href", "/vote/mock/s-extended/edit");
  expect(nav().getByRole("link", { name: "Earlier moment" })).toHaveAttribute(
    "href",
    "/vote/mock/s-settling/edit",
  );
  expect(nav().getByRole("link", { name: "Later moment" })).toHaveAttribute(
    "href",
    "/vote/mock/s-last/edit",
  );
  // The finished vote has no editor: its ballot instead.
  expect(nav().getByRole("link", { name: /^Finished,/ })).toHaveAttribute(
    "href",
    "/vote/mock/finished",
  );
});

it("a moment's variants show beside it, but not in the results", () => {
  show("/vote/mock/prefilled/edit");
  expect(nav().getByRole("link", { name: "Prefilled from ratings", current: "page" }))
    .toBeInTheDocument();
  expect(nav().getByRole("link", { name: "Empty ballot" })).toHaveAttribute(
    "href",
    "/vote/mock/started/edit",
  );
  // No "your ballot" before one counts.
  expect(view().queryByRole("link", { name: "Your ballot" })).toBeNull();
});

it("shows nothing off the examples", () => {
  show("/vote");
  expect(screen.queryByRole("navigation", { name: "Examples" })).toBeNull();
});
