import { K } from "./keys.ts";
import { WATCHLIST_MAX } from "../../shared/watchlist.ts";

interface Watchlist {
  ids: string[];
  updatedAt: number;
}

/** One account's watchlist. Every write re-reads and checks the entry, so concurrent
 * writes (two tabs, an import racing an add) never lose an id. */
export function watchlistsRepo(kv: Deno.Kv, now: () => number) {
  const get = async (address: string): Promise<string[] | null> =>
    (await kv.get<Watchlist>(K.watchlist(address))).value?.ids ?? null;

  const has = async (address: string): Promise<boolean> => (await get(address)) !== null;

  /** Apply `change` to the current ids (null = no record yet) and write it back.
   * "full" = the result would pass WATCHLIST_MAX; nothing is written.
   * With `existing`, no record yet means null and nothing is written. */
  async function update(
    address: string,
    change: (ids: string[] | null) => string[],
    existing = false,
  ): Promise<string[] | "full" | null> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const cur = await kv.get<Watchlist>(K.watchlist(address));
      if (existing && !cur.value) return null;
      const next = change(cur.value?.ids ?? null);
      if (next.length > WATCHLIST_MAX) return "full";
      const ok = (await kv.atomic().check(cur)
        .set(K.watchlist(address), { ids: next, updatedAt: now() }).commit()).ok;
      if (ok) return next;
    }
    throw new Error("watchlist: too much contention");
  }

  const merge = (cur: string[], add: string[]) => [...new Set([...cur, ...add])];

  return {
    get,
    has,
    /** Adds the allowed ids (creating the record), in the order first seen. */
    importIds: (address: string, ids: string[], allowed: Set<string>) =>
      update(address, (cur) => merge(cur ?? [], ids.filter((id) => allowed.has(id)))) as Promise<
        string[] | "full"
      >,
    /** Only import creates the record: add and remove give null when there is none. */
    add: (address: string, id: string) => update(address, (cur) => merge(cur ?? [], [id]), true),
    remove: async (address: string, id: string): Promise<string[] | null> => {
      const r = await update(address, (cur) => (cur ?? []).filter((x) => x !== id), true);
      return r === "full" ? [] : r; // removing never grows the list
    },
  };
}
