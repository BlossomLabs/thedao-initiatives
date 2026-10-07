import { useSyncExternalStore } from "react";

/** This browser's watchlist (initiative ids). */
export const LOCAL_KEY = "thedao:watchlist";
/** Per account (lowercased address): whether to offer moving it there. */
export const ASK_KEY = "thedao:watchlist-ask";

// storage events reach other tabs only; this one tells the hooks in this tab.
const SAME_TAB = "thedao:watchlist-local";

// In-memory cache: when localStorage is unavailable, keeps the watchlist for this page
// view. localStorage is the source of truth when it works (so other tabs' writes are seen).
const cache = new Map<string, string | null>();

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return cache.get(key) ?? null;
  }
}

function set(key: string, value: string | null) {
  cache.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage off: lasts for this page view (kept in cache) */ }
  dispatchEvent(new CustomEvent(SAME_TAB, { detail: key }));
}

function parse(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export const readLocal = (): string[] => parse(get(LOCAL_KEY));
export const writeLocal = (ids: string[]) => set(LOCAL_KEY, JSON.stringify(ids));
export const clearLocal = () => set(LOCAL_KEY, null);

/** "always": move on sign-in without asking; "never": do not ask; "later:<expiresAt>": not
 * during this sign-in. */
export type AskChoice = "always" | "never" | `later:${number}`;

function askMap(raw: string | null): Record<string, AskChoice> {
  try {
    const v = JSON.parse(raw ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export const readAsk = (address: string): AskChoice | null =>
  askMap(get(ASK_KEY))[address.toLowerCase()] ?? null;
export const writeAsk = (address: string, choice: AskChoice) =>
  set(ASK_KEY, JSON.stringify({ ...askMap(get(ASK_KEY)), [address.toLowerCase()]: choice }));

function subscribe(key: string) {
  return (notify: () => void) => {
    const onStorage = (e: StorageEvent) => e.key === key && notify();
    const onLocal = (e: Event) => (e as CustomEvent).detail === key && notify();
    addEventListener("storage", onStorage);
    addEventListener(SAME_TAB, onLocal);
    return () => {
      removeEventListener("storage", onStorage);
      removeEventListener(SAME_TAB, onLocal);
    };
  };
}

const subscribeLocal = subscribe(LOCAL_KEY);
const subscribeAsk = subscribe(ASK_KEY);

// useSyncExternalStore compares snapshots with Object.is: cache the parsed list per raw string.
let lastRaw: string | null | undefined;
let lastIds: string[] = [];
const localSnapshot = () => {
  const raw = get(LOCAL_KEY);
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastIds = parse(raw);
  }
  return lastIds;
};
const EMPTY: string[] = [];

/** The browser list, re-read on every write in this tab or another. */
export const useLocalWatchlist = (): string[] =>
  useSyncExternalStore(subscribeLocal, localSnapshot, () => EMPTY);

export const useAsk = (address: string): AskChoice | null =>
  useSyncExternalStore(subscribeAsk, () => readAsk(address), () => null);

// Test-only: clear the in-memory cache to prevent leakage between tests.
export const __resetCache = () => cache.clear();
