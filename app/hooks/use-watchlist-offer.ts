import type { QueryClient } from "@tanstack/react-query";
import { useSession } from "~/context/session";
import { api } from "~/lib/api";
import { privateCacheGeneration } from "~/lib/browser-privacy";
import { announce } from "~/lib/watchlist-channel";
import {
  clearLocal,
  readLocal,
  useAsk,
  useLocalWatchlist,
  writeLocal,
} from "~/lib/watchlist-local";
import { watchlistKey } from "~/hooks/use-watchlist";

/**
 * What to do with this browser's watchlist for the signed-in account: nothing,
 * ask (the card), or move it without asking (the account answered "always").
 */
export function useWatchlistOffer() {
  const { session, me } = useSession();
  const local = useLocalWatchlist();
  const address = session?.address.toLowerCase() ?? "";
  const ask = useAsk(address);
  const expiresAt = me?.expiresAt ?? 0;
  const ready = Boolean(address && me) && local.length > 0;
  const mode = !ready || ask === "never" || ask === `later:${expiresAt}`
    ? "none" as const
    : ask === "always"
    ? "auto" as const
    : "ask" as const;
  return { mode, count: local.length, address, expiresAt };
}

/**
 * Moves the browser list into the account: import, cache, tell the other tabs, clear what was
 * sent (a bookmark added meanwhile stays). Returns the account's ids, or null when the viewer
 * signed out meanwhile (the server has the ids, but nothing is cached or announced).
 */
export async function moveToAccount(qc: QueryClient, address: string): Promise<string[] | null> {
  const generation = privateCacheGeneration();
  const sent = readLocal();
  const r = await api<{ ids: string[] }>("/api/watchlist/import", { json: { ids: sent } });
  const rest = readLocal().filter((id) => !sent.includes(id));
  if (rest.length) writeLocal(rest);
  else clearLocal();
  if (generation !== privateCacheGeneration()) return null;
  qc.setQueryData(watchlistKey(address), r.ids);
  announce({ address, ids: r.ids });
  return r.ids;
}
