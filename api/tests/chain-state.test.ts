/** The token check is shared through KV, so a new instance does not report a refresh due. */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { harness, j } from "./app-helpers.ts";
import { createChain } from "../chain/mod.ts";
import { CHAIN_STATE_KEY } from "../services/chain-state.ts";

type Board = { refreshDue: boolean; flags: { tokensOk: boolean } };

Deno.test("chain state: a new instance adopts the saved token check instead of asking for a refresh", async () => {
  const h = await harness({ env: { BOARD_CACHE_SECS: "0" } });
  try {
    assert((await j(await h.req("/api/board")) as Board).refreshDue, "nothing checked yet");
    assertFalse((await j(await h.req("/api/board?refresh=1")) as Board).refreshDue);
    assert(await h.db.meta.get(CHAIN_STATE_KEY), "the check is saved for other instances");

    // A fresh isolate: same chain, no token check in memory.
    const rpc = h.deps.chain.rpc;
    h.deps.chain = createChain({ rpc, now: () => h.clock.now });
    h.script.calls.length = 0;
    const board = await j(await h.req("/api/board")) as Board;
    assertFalse(board.refreshDue);
    assert(board.flags.tokensOk);
    assertEquals(h.script.calls, [], "no token RPC on the new instance");
  } finally {
    h.close();
  }
});

Deno.test("chain state: a check that verified no token is not shared", async () => {
  const h = await harness({ env: { BOARD_CACHE_SECS: "0" } });
  try {
    const rpc = h.deps.chain.rpc;
    h.deps.chain = createChain({
      rpc: () => Promise.reject(new Error("rpc down")),
      now: () => h.clock.now,
    });
    await h.req("/api/board?refresh=1");
    assertEquals(await h.db.meta.get(CHAIN_STATE_KEY), null);
    h.deps.chain = createChain({ rpc, now: () => h.clock.now });
  } finally {
    h.close();
  }
});
