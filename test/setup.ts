import "@testing-library/jest-dom/vitest";
import { environmentManager } from "@tanstack/react-query";
import { MotionGlobalConfig } from "motion/react";

// vitest runs under Deno here, and TanStack Query treats any runtime with a
// `Deno` global as a server: no refetchInterval, no stale timers. The tests
// emulate a browser, so tell it so.
environmentManager.setIsServer(() => false);

// Reveal and Pop keep a closing panel mounted until its exit animation ends.
// With animations skipped they mount and unmount in the same tick, so tests
// can assert on a closed panel without waiting.
MotionGlobalConfig.skipAnimations = true;
