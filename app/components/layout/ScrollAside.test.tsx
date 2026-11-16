import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ScrollAside from "./ScrollAside";

// #95: two columns side by side; the wheel over this one moves only it, never the page.
const media = (matches: boolean) =>
  vi.stubGlobal("matchMedia", () => ({
    matches,
    addEventListener() {},
    removeEventListener() {},
  }));
afterEach(() => vi.unstubAllGlobals());

/** jsdom lays nothing out: say how tall the column's content is, and the column. */
const sized = (el: HTMLElement, content: number, box = 800) => {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: content });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: box });
  return el;
};
const mount = (props: Partial<React.ComponentProps<typeof ScrollAside>> = {}, content = 1000) => {
  render(
    <ScrollAside aria-label="Left" {...props}>
      <p>Tall content</p>
    </ScrollAside>,
  );
  return sized(screen.getByRole("complementary", { name: "Left" }), content);
};
const wheel = (el: HTMLElement, init: WheelEventInit) => {
  const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  fireEvent(el, e);
  return e;
};

it("side by side, the wheel scrolls the column itself and never the page", () => {
  media(false);
  const el = mount();
  const e = wheel(el.querySelector("p")!, { deltaY: 120 });
  expect(e.defaultPrevented).toBe(true);
  expect(el.scrollTop).toBe(120);
  // At its top, scrolling up still doesn't pass to the page.
  el.scrollTop = 0;
  expect(wheel(el, { deltaY: -300 }).defaultPrevented).toBe(true);
  // Lines count as such (jsdom doesn't clamp at 0 as a browser does: start again there).
  el.scrollTop = 0;
  wheel(el, { deltaY: 3, deltaMode: 1 });
  expect(el.scrollTop).toBe(48);
});

it("a pinch or ctrl-wheel zoom, and a sideways scroll, are left to the browser", () => {
  media(false);
  const el = mount();
  expect(wheel(el, { deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
  expect(wheel(el, { deltaX: 100 }).defaultPrevented).toBe(false);
});

it("in one column (narrow screens) it is part of the page: the wheel scrolls the page", () => {
  media(true);
  const el = mount();
  expect(wheel(el, { deltaY: 120 }).defaultPrevented).toBe(false);
  expect(el.scrollTop).toBe(0);
});

it("a column with nothing to scroll lets the wheel through to the page", () => {
  media(false);
  const el = mount({}, 600);
  expect(wheel(el, { deltaY: 120 }).defaultPrevented).toBe(false);
  // Grown taller than its box (a donation's preview, more initiatives): its own again.
  sized(el, 1200);
  expect(wheel(el, { deltaY: 120 }).defaultPrevented).toBe(true);
});

it("from the phone breakpoint up (the ballot editor), its classes start at sm", () => {
  media(false);
  const el = mount({ from: "sm" });
  expect(el.className).toContain("sm:sticky");
  expect(el.className).toContain("sm:overflow-y-auto");
  expect(el.className).not.toContain("lg:sticky");
});

it("pinned under the top bar, no taller than the screen, scrolling on its own when wide", () => {
  media(false);
  const el = mount();
  expect(el.className).toContain("lg:sticky");
  expect(el.className).toContain("lg:overflow-y-auto");
  expect(el.className).toContain("lg:max-h-[calc(100dvh-102px)]");
});
