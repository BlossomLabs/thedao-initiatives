import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { FLASH_MS, TWEEN_MS, useTweenedNumber } from "./use-tweened-number";
import Money from "~/components/ui/Money";

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

describe("useTweenedNumber", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    mockMatchMedia(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the first value at once, then rolls to a new one and flashes", () => {
    const { result, rerender } = renderHook(({ v }) => useTweenedNumber(v), {
      initialProps: { v: 100 },
    });
    expect(result.current).toEqual({ shown: 100, changed: false });

    rerender({ v: 200 });
    expect(result.current.changed).toBe(true);
    act(() => {
      vi.advanceTimersByTime(TWEEN_MS / 2);
    });
    const mid = result.current.shown;
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(200);
    act(() => {
      vi.advanceTimersByTime(TWEEN_MS);
    });
    expect(result.current.shown).toBe(200);
    expect(result.current.changed).toBe(true);
    act(() => {
      vi.advanceTimersByTime(FLASH_MS);
    });
    expect(result.current.changed).toBe(false);
  });

  it("jumps straight to the value under reduced motion, but still flashes", () => {
    mockMatchMedia(true);
    const { result, rerender } = renderHook(({ v }) => useTweenedNumber(v), {
      initialProps: { v: 5 },
    });
    rerender({ v: 9 });
    expect(result.current).toEqual({ shown: 9, changed: true });
  });

  it("Money formats the rolling value and marks the change", () => {
    const { rerender } = render(<Money value={2.34} />);
    expect(screen.getByText("$2.34")).not.toHaveAttribute("data-changed");
    rerender(<Money value={2.57} />);
    act(() => {
      vi.advanceTimersByTime(TWEEN_MS); // rolled to the target, still highlighted
    });
    const el = screen.getByText("$2.57");
    expect(el).toHaveAttribute("data-changed", "true");
    expect(el.className).toContain("text-dao-bright");
  });
});
