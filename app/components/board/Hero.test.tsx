import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Hero from "./Hero";

// The real CountUp needs IntersectionObserver and the motion runtime; the
// contract under test is what Hero feeds it and when the amount is visible.
vi.mock("~/components/text-animations/CountUp", () => ({
  default: ({ to, from }: { to: number; from: number }) => (
    <span data-testid="amount" data-from={from}>{to}</span>
  ),
}));

afterEach(() => {
  delete globalThis.__heroCount;
});

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
  // CountUp mounts afresh once the amount is known, to start from where it should.
  expect(screen.getByTestId("amount")).toHaveTextContent("1234567");
});

it("the homepage's Hero carries the early count script right after the amount", () => {
  const { container, rerender } = render(<Hero />);
  expect(container.querySelector("script")).toBeNull();
  rerender(<Hero earlyCount />);
  const script = container.querySelector("script")!;
  expect(script.previousElementSibling).toBe(screen.getByTestId("amount").parentElement);
  expect(script.textContent).toContain("__heroCount");
});

it("without an overlay the count starts from countFrom and fades in", () => {
  const { rerender } = render(<Hero countFrom={500_000} earlyCount />);
  rerender(<Hero raised={655_215} countFrom={500_000} earlyCount />);
  const amount = screen.getByTestId("amount");
  expect(amount).toHaveAttribute("data-from", "500000");
  expect(amount.parentElement).toHaveClass("opacity-100", "transition-opacity");
});

it("takes over from the overlay's number at once and removes it", () => {
  const stop = vi.fn();
  globalThis.__heroCount = { value: () => 612_345, stop };
  const { rerender } = render(<Hero countFrom={500_000} earlyCount />);
  expect(stop).not.toHaveBeenCalled();
  rerender(<Hero raised={655_215} countFrom={500_000} earlyCount />);
  const amount = screen.getByTestId("amount");
  expect(amount).toHaveAttribute("data-from", "612345");
  expect(amount.parentElement).toHaveClass("opacity-100");
  expect(amount.parentElement).not.toHaveClass("transition-opacity");
  expect(stop).toHaveBeenCalledOnce();
});

it("ignores an overlay unless it is the homepage's Hero", () => {
  const stop = vi.fn();
  globalThis.__heroCount = { value: () => 612_345, stop };
  const { rerender } = render(<Hero />);
  rerender(<Hero raised={42} />);
  expect(screen.getByTestId("amount")).toHaveAttribute("data-from", "0");
  expect(stop).not.toHaveBeenCalled();
});
