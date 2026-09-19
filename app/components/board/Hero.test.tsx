import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Hero from "./Hero";

// The real CountUp needs IntersectionObserver and the motion runtime; the
// contract under test is what Hero feeds it and when the amount is visible.
vi.mock("~/components/text-animations/CountUp", () => ({
  default: ({ to }: { to: number }) => <span data-testid="amount">{to}</span>,
}));

it("keeps the amount invisible until the total is known, then counts up to it", () => {
  const { rerender } = render(<Hero />);
  const amount = screen.getByTestId("amount");
  const figure = amount.parentElement!;
  expect(figure).toHaveClass("opacity-0");
  expect(figure).toHaveAttribute("aria-hidden", "true");
  expect(amount).toHaveTextContent("0");

  rerender(<Hero raised={1234567.4} />);
  expect(figure).toHaveClass("opacity-100");
  expect(figure).not.toHaveAttribute("aria-hidden", "true");
  expect(amount).toHaveTextContent("1234567");
});
