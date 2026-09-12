# Funding from Safe balances

Decided 2026-09-12 (Sem + Claude), after the first live donations showed that a
ledger built from discovered transactions is slow by construction: it waits for
confirmations, an indexer, and a trigger before the page moves.

## The two numbers

| On the page                                   | Source                                          | Freshness            |
| --------------------------------------------- | ----------------------------------------------- | -------------------- |
| "raised" in the funding bar and board cards   | the Safe's balances over RPC, priced by Chainlink | seconds after mining |
| donations table, donor rows, vote eligibility, terms records | donation rows in KV, filled by the Safe indexer cron | up to one cron interval |

**raised = pledged + donated**, where **donated = balance value + paid out**.

- Balance value: every accepted token's `balanceOf(safe)` plus the ETH balance,
  each priced with the same Chainlink feeds the verifier uses. Read by the API,
  cached 15 s per Safe, one call set per refresh regardless of viewers.
- Paid out: an admin-entered USD amount on the initiative (`paidOutUsd`), so a
  milestone payment does not make "raised" go backwards.
- Fallback: when the RPC read fails, `donated` is the ledger's confirmed total
  and the summary says `live: false`.

`funded` follows the displayed total. Stablecoins dominate donations, so market
drift around the goal is accepted rather than engineered around.

## What the ledger keeps doing

The Safe Transaction Service cron (`SAFE_SYNC_CRON`, default every 10 min) keeps
walking each Safe's incoming transfers and re-verifying every hash over RPC.
Nothing on the page waits for it any more, so its interval only bounds how late
a donor row appears. Wallet-tab donations still land in the ledger at once
through the confirm endpoint. The minimum-donation floor stays a ledger rule;
dust reaches the balance and is worth pennies.

The initiative page tells readers where the ledger stands: "Checked 4 min ago.
New transfers appear here within about 10 minutes", "Not checked yet", or "Last
check failed, retrying". The interval is derived from the cron expression.

## What goes away

The Alchemy Address Activity webhook, the KV queue that ran syncs from it, the
`kv.watch` SSE endpoint and the page's `EventSource` hook. All were ways to make
the ledger faster; the balance read makes the headline number instant without
them. The by-Safe index fix and the failed-row revisit in the sync stay.

The page polls the API every 15 s while visible (board every 30 s) and refetches
immediately after the donor's own transaction confirms.

## Cost

Per Safe per refresh: one `balanceOf` per accepted token plus one
`eth_getBalance`, about ten RPC calls, at most every 15 s and only when someone
is looking. Chainlink rates are cached ten minutes. A Multicall3 batch can
replace the individual calls later without changing anything above.
