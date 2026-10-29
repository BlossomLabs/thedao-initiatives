import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { COMMENT_BODY_MAX, COMMENT_NAME_MAX } from "@shared/comments";
import { goRate } from "~/components/ratings/rate-here";
import Composer from "./Composer";

vi.mock("~/context/wallet", () => ({
  useWallet: () => ({ address: undefined, isConnected: false }),
}));
vi.mock("~/context/session", () => ({
  useSession: () => ({ session: null, requireSession: vi.fn(), connecting: false }),
}));
vi.mock("~/hooks/use-identity", () => ({ useIdentity: () => ({ name: "" }) }));
vi.mock("~/components/wallet/ConnectInline", () => ({ default: () => null }));

afterEach(cleanup);

/** jsdom does not enforce maxLength on a change event, which is exactly the
 * case the guard is for: the browser lets a paste land one character past
 * the cap so the box can say "too long" instead of cutting the tail. */
function fill(text: string, name: string) {
  fireEvent.change(screen.getByPlaceholderText("Add a comment"), { target: { value: text } });
  fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: name } });
}

it("refuses a comment past the cap with the site's too-long wording, never cutting it", () => {
  const onPost = vi.fn();
  render(<Composer onPost={onPost} />);
  fill("c".repeat(COMMENT_BODY_MAX + 1), "Alice");
  fireEvent.click(screen.getByRole("button", { name: "Comment" }));
  expect(onPost).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "The comment is too long (2,000 characters at most).",
  );
  // the box holds the overflow so the writer can trim it themselves
  expect(screen.getByPlaceholderText("Add a comment")).toHaveAttribute(
    "maxlength",
    String(COMMENT_BODY_MAX + 2),
  );
});

it("refuses a name past the cap", () => {
  const onPost = vi.fn();
  render(<Composer onPost={onPost} />);
  fill("Fine comment", "N".repeat(COMMENT_NAME_MAX + 1));
  fireEvent.click(screen.getByRole("button", { name: "Comment" }));
  expect(onPost).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "The name is too long (60 characters at most).",
  );
});

it("posts a comment exactly at the cap", () => {
  const onPost = vi.fn().mockResolvedValue(null);
  render(<Composer onPost={onPost} />);
  fill("c".repeat(COMMENT_BODY_MAX), "Alice");
  fireEvent.click(screen.getByRole("button", { name: "Comment" }));
  expect(onPost).toHaveBeenCalledWith("c".repeat(COMMENT_BODY_MAX), "Alice", "", false);
});

it("picking stars turns the box into a private review: says so, text optional", async () => {
  const onPost = vi.fn();
  const onReview = vi.fn().mockResolvedValue(undefined);
  render(<Composer onPost={onPost} onReview={onReview} />);
  expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
  expect(screen.getByText("Voting Badge Holder review")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Why this rating? (optional)")).toBeInTheDocument();
  expect(screen.queryByPlaceholderText("Your name")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Post review" }));
  expect(onReview).toHaveBeenCalledWith(4, "");
  expect(onPost).not.toHaveBeenCalled();
  expect(await screen.findByText("Review saved. Your latest review is your voting badge’s rating."))
    .toBeInTheDocument();
});

it("clicking the picked star clears it, back to a public comment", () => {
  render(<Composer onPost={vi.fn()} onReview={vi.fn()} />);
  const two = screen.getByRole("radio", { name: "2 stars" });
  fireEvent.click(two);
  expect(two).toHaveAttribute("aria-checked", "true");
  fireEvent.keyDown(two, { key: "ArrowRight" });
  expect(screen.getByRole("radio", { name: "3 stars" })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("radio", { name: "3 stars" }));
  expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
});

it("the side card's Rate it scrolls here, then focuses the stars and outlines them once", () => {
  vi.useFakeTimers();
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  render(<Composer onPost={vi.fn()} onReview={vi.fn()} />);
  const one = screen.getByRole("radio", { name: "1 star" });
  const rings = () => screen.getByRole("radiogroup").querySelectorAll(".animate-star-ring");
  expect(rings()).toHaveLength(0);
  act(() => goRate());
  // Smooth, unless motion is off (as in the tests).
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
  // Not before the scroll ends.
  expect(one).not.toHaveFocus();
  act(() => globalThis.dispatchEvent(new Event("scrollend")));
  expect(one).toHaveFocus();
  // The arrow, then one outline per star.
  expect(document.querySelector(".animate-arrow-fade")).not.toBeNull();
  expect(rings()).toHaveLength(5);
  vi.useRealTimers();
});

it("Undo rating takes a review back to a public comment, keeping the text", () => {
  render(<Composer onPost={vi.fn()} onReview={vi.fn()} />);
  // Only once there are stars.
  expect(screen.queryByRole("button", { name: "Undo rating" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
  const box = screen.getByPlaceholderText("Why this rating? (optional)");
  fireEvent.change(box, { target: { value: "Looks solid" } });
  fireEvent.click(screen.getByRole("button", { name: "Undo rating" }));
  expect(screen.getByRole("radio", { name: "4 stars" })).toHaveAttribute("aria-checked", "false");
  expect(screen.getByText("Join the discussion")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Add a comment")).toHaveValue("Looks solid");
  expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
});
