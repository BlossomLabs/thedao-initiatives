/** Keeps a tab that stays open on the build the server is serving.
 *
 * A single-page app runs the scripts it loaded until someone reloads it, so a
 * tab left open across a deploy keeps calling the API with code that may no
 * longer match it (issue #66: a search box from before an API change). Every
 * API answer names the build being served (`X-App-Version`, api/app.ts); when
 * it differs from this page's own, the page moves to the new build, but never
 * under the eyes of someone reading it:
 * - on the next page change, where a reload shows the same page;
 * - while the tab is hidden, or in the moment someone comes back to it;
 * - otherwise a notice (<AppUpgrade>) says a refresh is due and stays up.
 * It never reloads by itself over something a reload would lose (something
 * typed or picked on this page, a dialog open, a donation in flight): the
 * notice waits for the visitor instead. A hidden tab never asks the server;
 * it finds out when someone returns to it. */

/** How often an open tab asks, when no other request has told it. */
export const CHECK_EVERY = 10 * 60_000;
/** After a reload that did not bring the new build (a deploy still rolling
 * out), wait this long before another one for the same build. */
export const RETRY_AFTER = 5 * 60_000;

/** Coming back to a tab, the reload has to land within this long; later, the
 * visitor has started reading and gets the notice instead. */
export const ARRIVAL = 3_000;

const HEADER = "X-App-Version";
const RELOADED_KEY = "thedao:upgraded-to";
const TICK = 60_000;

/** The browser calls a test replaces. */
export const page = {
  reload: () => location.reload(),
  now: () => Date.now(),
};

let served: string | null = null;
let dirty = false;
let holds = 0;
let checkedAt = 0;
let offered = false;
const listeners = new Set<() => void>();

function offer(next: boolean): void {
  if (offered === next) return;
  offered = next;
  for (const listener of listeners) listener();
}

/** Whether the visitor is being told to refresh (for useSyncExternalStore). */
export const upgradeOffered = (): boolean => offered;
export function subscribeUpgrade(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** This page's build: React Router's manifest version, the id the server reads from the HTML. */
export const ownVersion = (): string | null =>
  (globalThis as { __reactRouterManifest?: { version?: string } }).__reactRouterManifest
    ?.version || null;

/** Read the served build off any API answer (absent in dev and from another origin). */
export function noteServerVersion(res: Pick<Response, "headers">): void {
  const version = res.headers?.get(HEADER);
  if (!version) return;
  served = version;
  checkedAt = page.now();
}

/** Whether a reload was already spent on this build a moment ago. Storage that
 * cannot be read counts as yes: without the record a reload could repeat. */
function alreadyTried(version: string): boolean {
  try {
    const raw = sessionStorage.getItem(RELOADED_KEY);
    if (!raw) return false;
    const last = JSON.parse(raw) as { to?: unknown; at?: unknown };
    return last.to === version && typeof last.at === "number" &&
      page.now() - last.at < RETRY_AFTER;
  } catch {
    return true;
  }
}

/** The server serves another build than this page runs. */
export function isStale(): boolean {
  const own = ownVersion();
  return Boolean(own && served && own !== served);
}

/** Keep the page as it is while something is in flight (a donation waiting on
 * the wallet). Returns the release. */
export function holdUpgrade(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
  };
}

/** A new page: whatever was typed on the last one is gone or saved. */
export function markClean(): void {
  dirty = false;
  offer(false);
}

function reload(): boolean {
  if (!isStale() || holds > 0 || alreadyTried(served!)) return false;
  try {
    sessionStorage.setItem(RELOADED_KEY, JSON.stringify({ to: served, at: page.now() }));
  } catch {
    return false;
  }
  page.reload();
  return true;
}

/** Reload onto the served build when the caller knows nothing is lost by it
 * (a page change; a search whose text is in the URL). False when this page is
 * current or the reload has to wait. */
export function upgradeNow(): boolean {
  return reload();
}

/** Act on a build that is behind. Hidden, or `arriving` (the visitor is only
 * now coming back to the tab), it reloads if that loses nothing. In front of
 * someone it never reloads: it says a refresh is due. */
export function upgradeOrTell(arriving = false): void {
  if (!isStale() || holds > 0) return;
  const hidden = document.visibilityState !== "visible";
  const keep = dirty || Boolean(document.querySelector('[role="dialog"], dialog[open]'));
  if ((hidden || arriving) && !keep && reload()) return;
  if (!hidden) offer(true);
}

/** Ask the server which build it serves. The answer is in the header every
 * API reply carries, so a refusal (a preview's password gate) still tells.
 * No cookie is sent: the check must not touch the session. */
export async function checkVersion(): Promise<void> {
  checkedAt = page.now();
  try {
    noteServerVersion(await fetch("/api/version", { credentials: "omit", cache: "no-store" }));
  } catch { /* offline: the next check asks again */ }
}

/** Start watching; returns the stop. Mounted once, by <AppUpgrade> in root.tsx. */
export function watchForUpgrade(): () => void {
  checkedAt = page.now();
  // Typing, picking a file, ticking a box: this page now holds something a
  // reload would lose. `data-upgrade-safe` marks controls whose state is in the URL.
  const edited = (e: Event) => {
    if (!(e.target instanceof Element && e.target.closest("[data-upgrade-safe]"))) dirty = true;
  };
  // Only a tab someone is looking at asks the server; one left in the
  // background for days asks when they come back to it.
  const recheck = async (arriving = false) => {
    const since = page.now();
    if (page.now() - checkedAt >= CHECK_EVERY) await checkVersion();
    upgradeOrTell(arriving && page.now() - since <= ARRIVAL);
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") void recheck(true);
    else upgradeOrTell(); // already known to be behind: the unseen moment to reload
  };
  const onPageShow = (e: PageTransitionEvent) => {
    // Back from the browser's page cache: possibly days old.
    if (e.persisted) void recheck(true);
  };
  const onTick = () => {
    if (document.visibilityState === "visible") void recheck();
  };
  addEventListener("input", edited, true);
  addEventListener("change", edited, true);
  document.addEventListener("visibilitychange", onVisibility);
  addEventListener("pageshow", onPageShow);
  const timer = setInterval(onTick, TICK);
  return () => {
    removeEventListener("input", edited, true);
    removeEventListener("change", edited, true);
    document.removeEventListener("visibilitychange", onVisibility);
    removeEventListener("pageshow", onPageShow);
    clearInterval(timer);
  };
}

/** Forget everything (tests). */
export function resetUpgrade(): void {
  served = null;
  dirty = false;
  holds = 0;
  checkedAt = 0;
  offered = false;
}
