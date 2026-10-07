// @vitest-environment node
import { expect, it, vi } from "vitest";
import { announce, onAnnounce } from "./watchlist-channel";

it("a message reaches listeners in other contexts, not the sender's own", async () => {
  if (typeof BroadcastChannel === "undefined") return; // the fallback is the focus refetch
  const other = new BroadcastChannel("thedao:watchlist");
  const got = new Promise((resolve) => (other.onmessage = (e) => resolve(e.data)));
  announce({ address: "0xabc", ids: ["a"] });
  expect(await got).toEqual({ address: "0xabc", ids: ["a"] });
  other.close();
});

it("onAnnounce delivers messages from other contexts and unsubscribes", async () => {
  if (typeof BroadcastChannel === "undefined") return;
  const fn = vi.fn();
  const off = onAnnounce(fn);
  const other = new BroadcastChannel("thedao:watchlist");
  other.postMessage({ address: "0xabc", ids: ["b"] });
  await vi.waitFor(() => expect(fn).toHaveBeenCalledWith({ address: "0xabc", ids: ["b"] }));
  off();
  other.close();
});
