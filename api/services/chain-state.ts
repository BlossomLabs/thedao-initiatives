/** The token check (decimals and symbol of every accepted token, verified on
 * chain) shared across instances through KV. Each instance used to start with
 * none, so its first board said a refresh was due and a visitor's request ran
 * the check again; now a new instance adopts the last saved one. */
import { type ChainState, chainStateFresh } from "../chain/mod.ts";
import type { Deps } from "../middleware/context.ts";

/** Under meta: the last successful token check. */
export const CHAIN_STATE_KEY = "chain_token_check";

/** This instance's token check, seeded from KV when it has none fresh. With
 * `refresh`, a stale check is run again and saved for the other instances. */
export async function sharedChainState(
  deps: Pick<Deps, "chain" | "db" | "now">,
  refresh = false,
): Promise<ChainState> {
  let state = await deps.chain.state(false);
  if (!chainStateFresh(state, deps.now())) {
    const saved = await deps.db.meta.getPublic<ChainState>(CHAIN_STATE_KEY);
    if (saved) {
      deps.chain.seed(saved);
      state = await deps.chain.state(false);
    }
  }
  if (refresh && !chainStateFresh(state, deps.now())) {
    state = await deps.chain.state(true);
    // Only a check that verified tokens is shared: one run while the RPC was
    // down marks every token failed, and must not spread to other instances.
    if (
      chainStateFresh(state, deps.now()) && Object.values(state.tokens).some((t) => t.ok)
    ) await deps.db.meta.set(CHAIN_STATE_KEY, state);
  }
  return state;
}
