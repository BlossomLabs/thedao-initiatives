import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Countdown, Deadline, timeLeft, When } from "./When";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("time left: days and hours, then hours and minutes, then minutes and seconds", () => {
  expect(timeLeft(2 * 86400 + 4 * 3600 + 59)).toBe("2d 4h");
  expect(timeLeft(4 * 3600 + 5 * 60)).toBe("4h 05m");
  expect(timeLeft(12 * 60 + 5)).toBe("12m 05s");
  expect(timeLeft(0)).toBeNull();
  expect(timeLeft(-5)).toBeNull();
});

it("a date is shown in local time, with UTC in its title", () => {
  const at = Date.UTC(2026, 10, 16, 18, 0) / 1000;
  render(<When at={at} />);
  const t = screen.getByText((_, el) => el?.tagName === "TIME");
  expect(t).toHaveAttribute("datetime", "2026-11-16T18:00:00.000Z");
  expect(t.title).toBe("Nov 16, 18:00 UTC");
  // "Nov 16, 18:00" in the reader's zone: no weekday, no year, no zone name.
  expect(t.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);
});

it("a countdown ticks and disappears once it's due", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_000_000 * 1000));
  render(<Countdown to={1_000_002} />);
  expect(screen.getByRole("timer")).toHaveTextContent("in 0m 02s");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("timer")).toHaveTextContent("in 0m 01s");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.queryByRole("timer")).toBeNull();
});

it("a deadline in the past is just its date", () => {
  render(<Deadline at={1} />);
  expect(screen.queryByRole("timer")).toBeNull();
});
