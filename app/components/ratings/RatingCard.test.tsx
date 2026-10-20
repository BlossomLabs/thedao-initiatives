import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RatingSummary } from "@shared/ratings";
import { RATE_HERE } from "./rate-here";
import RatingCard from "./RatingCard";

let summary: RatingSummary | undefined;
vi.mock("~/hooks/use-admin-ratings", () => ({
  useReviews: () => ({ summary }),
}));

afterEach(cleanup);

// 4 and 5; the viewer's is the 4.
const rated: RatingSummary = { avg: 4.5, count: 2, dist: [0, 0, 0, 1, 1], mine: 4 };

it("shows the bars and yours; Change sends the viewer to the comment box to rate", () => {
  summary = rated;
  const go = vi.fn();
  globalThis.addEventListener(RATE_HERE, go);
  render(<RatingCard initiativeId="i1" canRate />);
  expect(screen.getByText("4.5")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "4 of 5 stars" })).toBeInTheDocument();
  // The page rates in one place: nothing to pick or send here.
  expect(screen.queryByRole("radiogroup")).toBeNull();
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Change" }));
  expect(go).toHaveBeenCalledOnce();
  globalThis.removeEventListener(RATE_HERE, go);
});

it("not rated yet: Rate it", () => {
  summary = { avg: 0, count: 0, dist: [0, 0, 0, 0, 0], mine: null };
  render(<RatingCard initiativeId="i1" canRate />);
  expect(screen.getByText("Not rated")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Rate it" })).toHaveAttribute("href", "#reviews");
});

it("archived: the bars and your rating, nothing to click", () => {
  summary = rated;
  render(<RatingCard initiativeId="i1" canRate={false} />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText(/Your rating/)).toBeInTheDocument();
});

it("nothing for anyone without the ratings (not an admin)", () => {
  summary = undefined;
  const { container } = render(<RatingCard initiativeId="i1" canRate />);
  expect(container).toBeEmptyDOMElement();
});
