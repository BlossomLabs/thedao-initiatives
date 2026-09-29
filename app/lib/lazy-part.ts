import { type ComponentType, lazy } from "react";

/**
 * A part of a page that loads after it: `preload` starts the download (the
 * page calls it once it has mounted), `Component` renders it. The stand-in is
 * a plain look-alike shown while loading (as the Suspense fallback) and, if
 * the chunk fails to load, in its place: the page keeps working without the
 * enhancement, and a later preload tries the download again.
 */
export function lazyPart<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  StandIn: ComponentType<P>,
) {
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const preload = () =>
    pending ??= load().catch(() => {
      pending = null;
      return { default: StandIn };
    });
  return { Component: lazy(preload), preload };
}
