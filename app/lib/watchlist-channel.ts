/** Tells this browser's other tabs the account watchlist changed. Missing
 * BroadcastChannel: a no-op (tabs still refetch on focus). */
export type WatchlistMessage = { address: string; ids: string[] };

const NAME = "thedao:watchlist";
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(NAME);

export function announce(msg: WatchlistMessage) {
  channel?.postMessage({ address: msg.address.toLowerCase(), ids: msg.ids });
}

export function onAnnounce(fn: (msg: WatchlistMessage) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  // A channel object never receives its own messages: listen on a separate one.
  const listener = new BroadcastChannel(NAME);
  listener.onmessage = (e: MessageEvent<WatchlistMessage>) => fn(e.data);
  return () => listener.close();
}
