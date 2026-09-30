import { useCallback, useEffect, useState } from "react";

const KEY = "thedao:watchlist";

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** This browser's watchlist (initiative ids), in localStorage; other tabs stay in step. */
export function useWatchlist() {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    setIds(read());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setIds(read());
    };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, []);
  const toggle = useCallback((id: string) => {
    setIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch { /* storage off: the watchlist lasts for this page view */ }
      return next;
    });
  }, []);
  return { ids, has: (id: string) => ids.includes(id), toggle };
}

/** Approved within the last 7 days. */
export const isNew = (approvedAt: number | null, now = Date.now() / 1000) =>
  approvedAt !== null && now - approvedAt < 7 * 86400;
