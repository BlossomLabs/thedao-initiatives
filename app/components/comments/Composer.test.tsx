import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { COMMENT_BODY_MAX, COMMENT_NAME_MAX } from "@shared/comments";
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
  expect(screen.getByText("Only admins will see this review. The text is optional."))
    .toBeInTheDocument();
  expect(screen.queryByPlaceholderText("Your name")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Post private review" }));
  expect(onReview).toHaveBeenCalledWith(4, "");
  expect(onPost).not.toHaveBeenCalled();
  expect(await screen.findByText("Review saved. Your latest review is your rating."))
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
