import { render } from "@testing-library/react";
import StickyAside, { type Frame, GAP, nextMode, TOP } from "./StickyAside";

const VIEWPORT = 900;
/** A sidebar taller than the viewport, with its top edge at `top`. */
const tall = (top: number, height = 1400): Frame => ({
  top,
  bottom: top + height,
  height,
  viewport: VIEWPORT,
});

describe("StickyAside modes", () => {
  it("a sidebar that fits always pins under the top bar", () => {
    const f = tall(TOP, 500);
    expect(nextMode("top", "down", f)).toBe("top");
    expect(nextMode("bottom", "up", f)).toBe("top");
    expect(nextMode("float", "down", f)).toBe("top");
  });

  it("scrolling down: floats from the top pin until the bottom edge meets the viewport bottom", () => {
    expect(nextMode("top", "down", tall(TOP))).toBe("float");
    // still floating: the bottom edge is below the viewport
    expect(nextMode("float", "down", tall(-200))).toBe("float");
    // bottom edge reached the viewport bottom minus the gap: pin there
    const pinned = tall(VIEWPORT - GAP - 1400);
    expect(nextMode("float", "down", pinned)).toBe("bottom");
    expect(nextMode("bottom", "down", pinned)).toBe("bottom");
  });

  it("scrolling up: floats from the bottom pin until the top edge meets the top bar", () => {
    const bottomPinned = tall(VIEWPORT - GAP - 1400);
    expect(nextMode("bottom", "up", bottomPinned)).toBe("float");
    // still floating: the top edge is above the top bar
    expect(nextMode("float", "up", tall(-100))).toBe("float");
    // top edge reached the top bar: pin there
    expect(nextMode("float", "up", tall(TOP))).toBe("top");
    expect(nextMode("top", "up", tall(TOP))).toBe("top");
  });

  it("a direction change mid-float keeps floating until an edge is met", () => {
    const mid = tall(-300);
    expect(nextMode("float", "down", mid)).toBe("float");
    expect(nextMode("float", "up", mid)).toBe("float");
  });
});

/**
 * The wiring, against a fake layout: the aside's slot starts at document
 * y=SLOT, sticky pins at max(slot, top), relative adds its offset.
 */
describe("StickyAside in the page", () => {
  const SLOT = 200;
  const H = 1400;
  let frames: FrameRequestCallback[] = [];
  const flush = () => {
    const q = frames;
    frames = [];
    q.forEach((cb) => cb(0));
  };
  const scrollTo = (y: number) => {
    Object.defineProperty(globalThis, "scrollY", { value: y, configurable: true });
    globalThis.dispatchEvent(new Event("scroll"));
    flush();
  };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("innerHeight", VIEWPORT);
    vi.stubGlobal("scrollY", 0);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const mount = () => {
    const { container } = render(<StickyAside>cards</StickyAside>);
    const el = container.querySelector("aside")!;
    Object.defineProperty(el, "offsetHeight", { value: H });
    el.getBoundingClientRect = () => {
      const slot = SLOT - globalThis.scrollY;
      const top = parseFloat(el.style.top || "0");
      const t = el.style.position === "relative" ? slot + top : Math.max(slot, top);
      return { top: t, bottom: t + H } as DOMRect;
    };
    return el;
  };

  it("pins top, floats down, pins bottom, floats up, pins top again", () => {
    const el = mount();
    // the effect ran with a zero-height rect: re-run its reset through a scroll step
    expect(el.style.top).toBe(`${TOP}px`);
    expect(el.style.position).toBe("");

    scrollTo(100); // down from the top pin: float from where it sits (its slot, offset 0)
    expect(el.style.position).toBe("relative");
    expect(el.style.top).toBe("0px");

    scrollTo(2000); // bottom edge passed the viewport bottom: pin there
    expect(el.style.position).toBe("");
    expect(el.style.top).toBe(`${VIEWPORT - H - GAP}px`);

    scrollTo(1900); // up from the bottom pin: float, keeping its place below the slot
    expect(el.style.position).toBe("relative");
    expect(el.style.top).toBe(`${VIEWPORT - H - GAP - (SLOT - 1900)}px`);

    scrollTo(500); // top edge reached the top bar: pin there
    expect(el.style.position).toBe("");
    expect(el.style.top).toBe(`${TOP}px`);
  });

  it("does nothing on narrow screens, where the callers make it static", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    const el = mount();
    expect(el.style.top).toBe("");
    scrollTo(2000);
    expect(el.style.position).toBe("");
    expect(el.style.top).toBe("");
  });
});
