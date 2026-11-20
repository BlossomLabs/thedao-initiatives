import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminReview } from "~/hooks/use-admin-ratings";
import type { CommentEntry } from "~/lib/api-types";
import { OthersList, RatingLine } from "./OthersSay";

vi.mock("~/components/wallet/Identity", () => ({
  default: ({ address }: { address: string }) => <span>{address}</span>,
}));
afterEach(cleanup);

const item = { slug: "alpha", title: "ALPHA" };
const review = (id: string, stars: number, createdAt: number, body = "") =>
  ({ id, address: `0x${id}`, tokenId: id, stars, body, createdAt, current: true }) as AdminReview;
const comment = (id: string, votes: number, extra: Partial<CommentEntry> = {}) =>
  ({
    id,
    type: "question",
    topic: "",
    body: `Comment ${id}`,
    displayName: id,
    address: `0x${id}`,
    roles: [],
    answered: false,
    reviewed: false,
    accepted: false,
    featured: 0,
    featuredAt: 0,
    votes,
    createdAt: 0,
    ...extra,
  }) as CommentEntry;

it("the rating line gives the average only from three reviews on", () => {
  const { rerender, container } = render(
    <RatingLine summary={{ avg: 4.33, count: 7, dist: [0, 1, 0, 2, 4], mine: null }} />,
  );
  expect(container).toHaveTextContent("4.3· 7 reviews");
  rerender(<RatingLine summary={{ avg: 5, count: 1, dist: [0, 0, 0, 0, 1], mine: null }} />);
  expect(container).toHaveTextContent("1 review");
  expect(container).not.toHaveTextContent("5.0");
  rerender(<RatingLine summary={undefined} />);
  expect(container).toBeEmptyDOMElement();
});

it("lists the reviews as given, with their text, and comments with the proposer's reply", () => {
  const data = {
    reviews: [review("b", 2, 20, "Too costly"), review("a", 5, 10, "Great")],
    comments: [
      comment("q1", 9, {
        replies: [comment("r1", 0, { roles: ["PROPOSER"], body: "We will" })],
      }),
    ],
    failed: false,
  };
  render(
    <OthersList
      item={item}
      tab="reviews"
      data={data}
      rating={{ avg: 3.5, count: 2, dist: [0, 1, 0, 0, 1], mine: null }}
    />,
  );
  // The 5★ to 1★ bars come first, over the reviews.
  expect(screen.getByRole("list", { name: "Ratings by stars" })).toBeInTheDocument();
  const reviews = within(screen.getByRole("list", { name: "Reviews" })).getAllByRole("listitem");
  expect(reviews.map((li) => li.textContent)).toEqual([
    expect.stringContaining("Too costly"),
    expect.stringContaining("Great"),
  ]);
  cleanup();
  render(<OthersList item={item} tab="comments" data={data} />);
  const c = within(screen.getByRole("list", { name: "Comments" })).getByRole("listitem");
  expect(c).toHaveTextContent("Comment q1");
  expect(c).toHaveTextContent("Proposer · We will");
  expect(c).toHaveTextContent("9 votes");
});

it("none yet points to the page to write the first one", () => {
  render(
    <OthersList item={item} tab="reviews" data={{ reviews: [], comments: [], failed: false }} />,
  );
  expect(screen.getByRole("link", { name: "Write the first review" }))
    .toHaveAttribute("href", "/initiative/alpha#qa");
});

it("text is markdown; Show more opens a comment's replies in full", () => {
  const data = {
    reviews: [],
    comments: [
      comment("q1", 0, {
        body: "Is it **underfunded**?",
        replies: [comment("r1", 0, { roles: ["PROPOSER"], body: "Yes:\n\n- one\n- two" })],
      }),
    ],
    failed: false,
  };
  render(<OthersList item={item} tab="comments" data={data} />);
  expect(screen.getByText("underfunded").tagName).toBe("STRONG");
  expect(screen.queryByRole("list", { name: "Replies" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  const replies = screen.getByRole("list", { name: "Replies" });
  expect(within(replies).getByText("Proposer")).toBeInTheDocument();
  expect(within(replies).getByText("two").tagName).toBe("LI");
  expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});
