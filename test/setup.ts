import "@testing-library/jest-dom/vitest";
import { environmentManager } from "@tanstack/react-query";

// vitest runs under Deno here, and TanStack Query treats any runtime with a
// `Deno` global as a server: no refetchInterval, no stale timers. The tests
// emulate a browser, so tell it so.
environmentManager.setIsServer(() => false);
