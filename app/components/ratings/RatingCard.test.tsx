import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RatingSummary } from "@shared/ratings";
import RatingCard from "./RatingCard";

const postReview = vi.fn();
let summary: RatingSummary | undefined;
vi.mock("~/hooks/use-admin-ratings", () => ({
  usePostReview: () => postReview,
  useReviews: () => ({ summary }),
}));

afterEach(() => {
  cleanup();
  postReview.mockReset();
});

// 4 and 5; the viewer's is the 4.
const rated: RatingSummary = { avg: 4.5, count: 2, dist: [0, 0, 0, 1, 1], mine: 4 };

it("rates in the side card: changed stars bring Write review and Send, and move the average", async () => {
  summary = rated;
  postReview.mockResolvedValue(undefined);
  render(<RatingCard initiativeId="i1" canRate />);
  expect(screen.queryByRole("link", { name: "Change" })).toBeNull();
  expect(screen.getByText("4.5")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "4 stars" })).toHaveAttribute("aria-checked", "true");
  // Nothing to send until the stars change.
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Write review" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "2 stars" }));
  // (5 + 2) / 2, before it is saved.
  expect(screen.getByText("3.5")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Write review" }));
  const box = screen.getByPlaceholderText("Why this rating? (optional)");
  expect(box).toHaveFocus();
  fireEvent.change(box, { target: { value: "Vague milestones" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(postReview).toHaveBeenCalledWith("i1", 2, "Vague milestones"));
  await waitFor(() => expect(screen.queryByPlaceholderText(/Why this rating/)).toBeNull());
});

it("archived: the bars and your rating, nothing to click", () => {
  summary = rated;
  render(<RatingCard initiativeId="i1" canRate={false} />);
  expect(screen.queryByRole("radiogroup")).toBeNull();
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  expect(screen.getByText(/Your rating/)).toBeInTheDocument();
});

it("nothing for anyone without the ratings (not an admin)", () => {
  summary = undefined;
  const { container } = render(<RatingCard initiativeId="i1" canRate />);
  expect(container).toBeEmptyDOMElement();
});
