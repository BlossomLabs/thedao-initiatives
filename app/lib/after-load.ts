/**
 * Runs `task` once the page has loaded and the browser is idle, so code the first
 * view does not need (the wallet chooser, the profile dialog, the board's filter
 * menus) downloads without competing with the board's data and the page's own
 * scripts on a slow link. Returns a cancel function (an effect's cleanup).
 */
export function afterLoad(task: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const g = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  let idle = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    // Safari has no requestIdleCallback: a short timeout instead.
    if (g.requestIdleCallback) idle = g.requestIdleCallback(task, { timeout: 3000 });
    else timer = setTimeout(task, 200);
  };
  if (document.readyState === "complete") run();
  else addEventListener("load", run, { once: true });
  return () => {
    removeEventListener("load", run);
    if (idle) g.cancelIdleCallback?.(idle);
    if (timer) clearTimeout(timer);
  };
}
