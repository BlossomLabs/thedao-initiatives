import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "~/context/session";
import { api, ApiError } from "~/lib/api";
import { privateCacheGeneration } from "~/lib/browser-privacy";
import { announce, onAnnounce } from "~/lib/watchlist-channel";
import { useLocalWatchlist, writeLocal } from "~/lib/watchlist-local";

export const watchlistKey = (address: string) => ["watchlist", address.toLowerCase()] as const;

/** The account's list; null when the account has none yet. */
export const fetchAccountWatchlist = (signal?: AbortSignal) =>
  api<{ ids: string[] }>("/api/watchlist", { signal, passive: true }).then(
    (r) => r.ids,
    (e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e)),
  );

/**
 * The watchlist the board shows: the account's once it has one (signed in),
 * else this browser's. Account changes show at once, roll back on failure and
 * reach this browser's other tabs.
 */
export function useWatchlist() {
  const { session, me } = useSession();
  const address = session?.address.toLowerCase() ?? "";
  const qc = useQueryClient();
  const local = useLocalWatchlist();
  const [error, setError] = useState<string | null>(null);
  const key = watchlistKey(address);
  const account = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchAccountWatchlist(signal),
    enabled: Boolean(address && me?.hasWatchlist),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!address) return;
    return onAnnounce((msg) => {
      if (msg.address === address) qc.setQueryData(watchlistKey(address), msg.ids);
    });
  }, [address, qc]);

  const loaded = Array.isArray(account.data);
  // Signed in with an account list: the account is the source even while it loads or fails to
  // load, so a bookmark never lands in the browser list meanwhile. A 404 (null) means no list.
  const onAccount = Boolean(address) &&
    (loaded || (Boolean(me?.hasWatchlist) && account.data === undefined));
  const ids = loaded && onAccount ? account.data as string[] : onAccount ? [] : local;
  const failed = account.isError;

  const toggle = useCallback((id: string) => {
    setError(null);
    if (onAccount && !loaded) {
      if (failed) setError("Couldn't update your watchlist.");
      return;
    }
    const on = ids.includes(id);
    if (!onAccount) {
      writeLocal(on ? ids.filter((x) => x !== id) : [...ids, id]);
      return;
    }
    const before = ids;
    const generation = privateCacheGeneration();
    qc.setQueryData(key, on ? ids.filter((x) => x !== id) : [...ids, id]);
    api<{ ids: string[] }>(`/api/watchlist/${encodeURIComponent(id)}`, {
      method: on ? "DELETE" : "PUT",
    }).then(
      (r) => {
        if (generation !== privateCacheGeneration()) return;
        qc.setQueryData(key, r.ids);
        announce({ address, ids: r.ids });
      },
      () => {
        if (generation !== privateCacheGeneration()) return;
        qc.setQueryData(key, before);
        setError("Couldn't update your watchlist.");
      },
    );
  }, [ids, onAccount, loaded, failed, qc, address]);

  return {
    ids,
    has: (id: string) => ids.includes(id),
    toggle,
    source: onAccount ? "account" as const : "browser" as const,
    error,
  };
}

/** Approved within the last 7 days. */
export const isNew = (approvedAt: number | null, now = Date.now() / 1000) =>
  approvedAt !== null && now - approvedAt < 7 * 86400;
