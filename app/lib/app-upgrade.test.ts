import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ARRIVAL,
  CHECK_EVERY,
  checkVersion,
  holdUpgrade,
  isStale,
  markClean,
  noteServerVersion,
  page,
  resetUpgrade,
  RETRY_AFTER,
  subscribeUpgrade,
  upgradeNow,
  upgradeOffered,
  upgradeOrTell,
  watchForUpgrade,
} from "./app-upgrade";

const manifest = globalThis as { __reactRouterManifest?: { version?: string } };
const answer = (version?: string) =>
  new Response("{}", { headers: version ? { "X-App-Version": version } : {} });
let reload: ReturnType<typeof vi.fn>;
let stop: (() => void) | undefined;
let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  resetUpgrade();
  sessionStorage.clear();
  manifest.__reactRouterManifest = { version: "old" };
  reload = vi.fn();
  page.reload = reload as unknown as () => void;
  hidden = false;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible"
  );
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const watch = () => (stop = watchForUpgrade());
const hide = (value: boolean) => {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
};

it("is stale only when the server names another build than this page's", () => {
  expect(isStale()).toBe(false);
  noteServerVersion(answer());
  expect(isStale()).toBe(false);
  noteServerVersion(answer("old"));
  expect(isStale()).toBe(false);
  noteServerVersion(answer("new"));
  expect(isStale()).toBe(true);
  // Dev has no manifest version: never stale, never reloaded.
  manifest.__reactRouterManifest = undefined;
  expect(isStale()).toBe(false);
  expect(upgradeNow()).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

it("a current page is never reloaded", () => {
  watch();
  noteServerVersion(answer("old"));
  hide(true);
  hide(false);
  vi.advanceTimersByTime(CHECK_EVERY / 2);
  expect(upgradeNow()).toBe(false);
  expect(reload).not.toHaveBeenCalled();
  expect(upgradeOffered()).toBe(false);
});

it("a hidden tab neither asks the server nor reloads; it catches up when someone returns", async () => {
  const fetchMock = vi.fn((..._a: unknown[]) => Promise.resolve(answer("new")));
  vi.stubGlobal("fetch", fetchMock);
  watch();
  hide(true);
  await vi.advanceTimersByTimeAsync(CHECK_EVERY * 300); // days in the background
  expect(fetchMock).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  hide(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/version");
  expect(init.credentials).toBe("omit");
  await vi.advanceTimersByTimeAsync(0);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(upgradeOffered()).toBe(false);
});

it("a visible tab asks the server now and then, and never reloads under the reader", async () => {
  const fetchMock = vi.fn((..._a: unknown[]) => Promise.resolve(answer("old")));
  vi.stubGlobal("fetch", fetchMock);
  watch();
  await vi.advanceTimersByTimeAsync(CHECK_EVERY - 1000);
  expect(fetchMock).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(upgradeOffered()).toBe(false);
  fetchMock.mockImplementation(() => Promise.resolve(answer("new")));
  await vi.advanceTimersByTimeAsync(CHECK_EVERY * 3);
  expect(reload).not.toHaveBeenCalled();
  expect(upgradeOffered()).toBe(true); // the notice, for as long as they stay
  // They switch to another tab: now it can reload unseen.
  hide(true);
  expect(reload).toHaveBeenCalledTimes(1);
});

it("a stale build learned from an API answer while reading shows the notice only", () => {
  watch();
  noteServerVersion(answer("new"));
  upgradeOrTell();
  vi.advanceTimersByTime(60_000);
  expect(reload).not.toHaveBeenCalled();
  expect(upgradeOffered()).toBe(true);
});

it("a stale build learned while hidden waits for the tab to come back", () => {
  watch();
  hide(true);
  noteServerVersion(answer("new"));
  vi.advanceTimersByTime(CHECK_EVERY / 2);
  expect(reload).not.toHaveBeenCalled();
  hide(false);
  expect(reload).toHaveBeenCalledTimes(1);
});

it("a slow answer on coming back is too late to reload: the visitor is reading by then", async () => {
  let reply!: (r: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (reply = r))));
  watch();
  hide(true);
  vi.setSystemTime(Date.now() + CHECK_EVERY);
  hide(false);
  await vi.advanceTimersByTimeAsync(ARRIVAL + 1000);
  reply(answer("new"));
  await vi.advanceTimersByTimeAsync(0);
  expect(reload).not.toHaveBeenCalled();
  expect(upgradeOffered()).toBe(true);
});

function typeSomething() {
  document.body.innerHTML = "<textarea></textarea>";
  const field = document.querySelector("textarea")!;
  field.value = "half a comment";
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

it("text the visitor typed is never reloaded away: a notice says to refresh, and stays", () => {
  const heard = vi.fn();
  const off = subscribeUpgrade(heard);
  watch();
  typeSomething();
  noteServerVersion(answer("new"));
  hide(true);
  expect(upgradeOffered()).toBe(false); // nobody is looking: nothing to say yet
  expect(reload).not.toHaveBeenCalled(); // and the text is not reloaded away unseen
  hide(false);
  expect(reload).not.toHaveBeenCalled();
  expect(upgradeOffered()).toBe(true);
  expect(heard).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(CHECK_EVERY / 2);
  hide(true);
  hide(false);
  expect(upgradeOffered()).toBe(true);
  expect(reload).not.toHaveBeenCalled();
  // The router moved on: that page's text is gone or saved, so nothing is lost now.
  markClean();
  expect(upgradeOffered()).toBe(false);
  expect(upgradeNow()).toBe(true);
  expect(reload).toHaveBeenCalledTimes(1);
  off();
});

it("a control whose state lives in the URL does not need the notice", () => {
  watch();
  document.body.innerHTML = '<form data-upgrade-safe><input type="search"></form>';
  document.querySelector("input")!.dispatchEvent(new Event("input", { bubbles: true }));
  noteServerVersion(answer("new"));
  hide(true);
  expect(reload).toHaveBeenCalledTimes(1);
});

it("an open dialog gets the notice too; a held operation is not interrupted even by it", () => {
  watch();
  noteServerVersion(answer("new"));
  const release = holdUpgrade();
  typeSomething();
  upgradeOrTell();
  expect(upgradeOffered()).toBe(false);
  expect(upgradeNow()).toBe(false);
  release();
  release(); // releasing twice does not free someone else's hold
  const other = holdUpgrade();
  expect(upgradeNow()).toBe(false);
  other();
  markClean();
  document.body.innerHTML = '<div role="dialog"></div>';
  hide(true);
  hide(false);
  expect(reload).not.toHaveBeenCalled();
  expect(upgradeOffered()).toBe(true);
});

it("does not reload again for the same build until a while has passed", () => {
  noteServerVersion(answer("new"));
  expect(upgradeNow()).toBe(true);
  // The reloaded page is still the old build (the deploy is rolling out).
  resetUpgrade();
  noteServerVersion(answer("new"));
  expect(upgradeNow()).toBe(false);
  vi.advanceTimersByTime(RETRY_AFTER);
  expect(upgradeNow()).toBe(true);
  expect(reload).toHaveBeenCalledTimes(2);
});

it("without session storage it never reloads by itself", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  noteServerVersion(answer("new"));
  expect(upgradeNow()).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

it("a failed check changes nothing", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
  await checkVersion();
  expect(isStale()).toBe(false);
});
