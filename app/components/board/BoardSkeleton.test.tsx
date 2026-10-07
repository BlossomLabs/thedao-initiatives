import { render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import BoardSkeleton, { BOARD_SCRIPT, markBoardLayout } from "./BoardSkeleton";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.board;
});

it("carries both layouts' shapes for the head script to pick from", () => {
  const { container } = render(<BoardSkeleton />);
  expect(container.querySelector(".board-skeleton-list")).toBeInTheDocument();
  expect(container.querySelectorAll(".board-skeleton-cards > *")).toHaveLength(4);
});

it("the head script marks cards from the URL, else from this device's last choice", () => {
  const run = (url: string, saved?: string) => {
    delete document.documentElement.dataset.board;
    localStorage.clear();
    if (saved) localStorage.setItem("thedao:board-layout", saved);
    const { pathname, search } = new URL(url, "https://x.test");
    new Function("location", BOARD_SCRIPT)({ pathname, search });
    return document.documentElement.dataset.board;
  };
  expect(run("/")).toBeUndefined(); // the list is the default
  expect(run("/?view=cards")).toBe("cards");
  expect(run("/", "cards")).toBe("cards");
  expect(run("/", "list")).toBeUndefined();
  expect(run("/?view=list", "cards")).toBeUndefined(); // the URL wins
  expect(run("/?sort=newest", "cards")).toBe("cards");
  expect(run("/submit?view=cards", "cards")).toBeUndefined(); // the board only
});

it("the board keeps the mark in step with the layout in use", () => {
  markBoardLayout("cards");
  expect(document.documentElement.dataset.board).toBe("cards");
  markBoardLayout("list");
  expect(document.documentElement.dataset.board).toBeUndefined();
});
