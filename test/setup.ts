import "@testing-library/jest-dom/vitest";
import { environmentManager, notifyManager } from "@tanstack/react-query";
import { MotionGlobalConfig } from "motion/react";

// vitest runs under Deno here, and TanStack Query treats any runtime with a
// `Deno` global as a server: no refetchInterval, no stale timers. The tests
// emulate a browser, so tell it so.
environmentManager.setIsServer(() => false);

// Reveal and Pop keep a closing panel mounted until its exit animation ends.
// With animations skipped they mount and unmount in the same tick, so tests
// can assert on a closed panel without waiting.
MotionGlobalConfig.skipAnimations = true;

// Deliver query updates synchronously so `act()` sees them without a timer tick.
notifyManager.setScheduler((cb) => cb());

// Deno's own `Worker` leaks into jsdom, which has none. A page that starts a web worker
// (the vote results' green-row jumps) would load the module over a dev server that isn't
// there and crash the test run; without one it works on the page's thread, as in jsdom.
Object.defineProperty(globalThis, "Worker", {
  configurable: true,
  writable: true,
  value: undefined,
});
