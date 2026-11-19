import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ReviewCard from "./ReviewCard";
import type { AdminReview } from "~/hooks/use-admin-ratings";

vi.mock("~/components/wallet/Identity", () => ({
  default: ({ address }: { address: string }) => <span>{address}</span>,
}));

afterEach(cleanup);

const review = {
  id: "r1",
  address: "0x1",
  tokenId: 11,
  stars: 4,
  body: "Good",
  current: true,
  createdAt: 0,
} as unknown as AdminReview;

it("a review by the signed-in account gets the You chip, even one it can no longer delete", () => {
  render(<ReviewCard r={review} mine={false} yours onDelete={vi.fn()} />);
  expect(screen.getByText("You")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
});

it("no You chip on someone else's review", () => {
  render(<ReviewCard r={review} mine={false} onDelete={vi.fn()} />);
  expect(screen.queryByText("You")).toBeNull();
});
