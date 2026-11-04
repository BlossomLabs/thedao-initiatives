import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Hero from "./Hero";

// The real CountUp needs IntersectionObserver and the motion runtime; the
// contract under test is what Hero feeds it and when the amount is visible.
vi.mock("~/components/text-animations/CountUp", () => ({
  default: ({ to, from, duration, startWhen }: {
    to: number;
    from: number;
    duration: number;
    startWhen: boolean;
  }) => (
    <span
      data-testid="amount"
      data-from={from}
      data-duration={duration}
      data-start={String(startWhen)}
    >
      {to}
    </span>
  ),
}));

const reduced = vi.hoisted(() => ({ on: false }));
vi.mock("motion/react", async (orig) => ({
  ...(await orig<typeof import("motion/react")>()),
  useReducedMotion: () => reduced.on,
}));

afterEach(() => {
  reduced.on = false;
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
  expect(amount).toHaveTextContent("1234567");
});

it("the homepage counts from countFrom while the amount loads, then to it", () => {
  const { rerender } = render(<Hero countFrom={500_000} countEarly />);
  const amount = screen.getByTestId("amount");
  const figure = amount.parentElement!;
  // Shown once mounted: creeping toward 10% more, slowly, still hidden from screen readers.
  expect(figure).toHaveClass("opacity-100");
  expect(figure).toHaveAttribute("aria-hidden", "true");
  expect(amount).toHaveAttribute("data-from", "500000");
  expect(amount).toHaveTextContent("550000");
  expect(amount).toHaveAttribute("data-duration", "8");
  expect(amount).toHaveAttribute("data-start", "true");

  rerender(<Hero raised={655_215.2} countFrom={500_000} countEarly />);
  expect(amount).toHaveTextContent("655215");
  expect(amount).toHaveAttribute("data-duration", "1");
  expect(figure).not.toHaveAttribute("aria-hidden", "true");
});

it("with reduced motion the homepage waits for the amount, as before", () => {
  reduced.on = true;
  const { rerender } = render(<Hero countFrom={500_000} countEarly />);
  const amount = screen.getByTestId("amount");
  expect(amount.parentElement).toHaveClass("opacity-0");
  expect(amount).toHaveAttribute("data-start", "false");
  rerender(<Hero raised={655_215} countFrom={500_000} countEarly />);
  expect(amount.parentElement).toHaveClass("opacity-100");
  expect(amount).toHaveTextContent("655215");
});

it("elsewhere (the DevCon projector) it waits for the amount and counts from 0", () => {
  render(<Hero />);
  const amount = screen.getByTestId("amount");
  expect(amount.parentElement).toHaveClass("opacity-0");
  expect(amount).toHaveAttribute("data-from", "0");
  expect(amount).toHaveAttribute("data-start", "false");
});
