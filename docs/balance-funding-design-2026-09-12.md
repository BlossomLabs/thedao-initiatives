# Funding from Safe balances

Decided 2026-09-12 (Sem + Claude), after the first live donations showed that a
ledger built from discovered transactions is slow by construction: it waits for
confirmations, an indexer, and a trigger before the page moves.

Updated 2026-09-16: the initial 15-second process cache caused excessive RPC use.
Funding now uses a request-driven shared snapshot with stale-while-revalidate.

## The two numbers

| On the page                                   | Source                                          | Freshness            |
| --------------------------------------------- | ----------------------------------------------- | -------------------- |
| "raised" in the funding bar and board cards   | saved Safe balances over RPC, priced by Chainlink | refreshed when viewed and at least 2 minutes old |
| donations table, donor rows, vote eligibility, terms records | donation rows in KV, refreshed from the Safe indexer when viewed | refreshed after 10 minutes by default |

**raised = pledged + donated**, where **donated = balance value + paid out**.

- Pledged: open pledges only. A withdrawn pledge never counts, and one the admin
  marks `received` stops counting, because its money arrived as a donation and is
  in the balance already (`summary.received` reports it, outside the total).
  The card's backer count follows the same rule: open pledges plus the distinct
  addresses with a confirmed donation.
- Balance value: every accepted token's `balanceOf(safe)` plus the ETH balance,
  each priced with the same Chainlink feeds the verifier uses. Read by the API,
  saved in KV for two minutes per Safe, with an atomic refresh lease shared by
  all server instances. Reads return the saved value even when stale.
- Paid out: an admin-entered USD amount on the initiative (`paidOutUsd`), so a
  milestone payment does not make "raised" go backwards.
- Fallback: when the RPC read fails, keep the last saved balance and retry no
  sooner than 60 seconds later. Before any successful read, use the ledger's
  confirmed total and report `live: false`. `live: true` means a saved chain
  balance exists; it does not promise that balance is current.

`funded` follows the displayed total. Stablecoins dominate donations, so market
drift around the goal is accepted rather than engineered around.

## Donation-ledger refreshes

The ledger uses the same request-driven mechanism as balances. Normal page GETs
return saved donations and freshness from KV. A visible page with a stale ledger
starts `?refresh=1`, keeps its saved rows visible, and shows “Updating donations…”.
The request checks the Safe indexer and pending submissions, verifies donations,
and saves them in KV before returning the updated page. New rows fade in; existing
funding numbers keep their number animation.

`SAFE_SYNC_TTL_SECS` is the cache lifetime (default ten minutes, minimum one).
A per-initiative KV lease prevents concurrent visitors and instances from repeating
the refresh; it expires after two minutes if a worker dies. Other visitors poll KV
every two seconds while a lease is active, then return to normal polling. Failed
refreshes keep the saved rows and wait sixty seconds before retrying. Incomplete
backfills also resume after sixty seconds while viewed. Late workers cannot replace
newer sync metadata or cursors. Admin sync uses the same lease but can refresh early.

The board refreshes the published Safes whose donation counts it displays; an
initiative page refreshes only its own Safe, including its pending donations.
The old ten-minute donation cron and startup chain check are removed.
`SAFE_SYNC_CRON` is obsolete. A daily production fallback at 03:00 UTC refreshes
stale ledger and balance snapshots for approved initiatives, even on quiet days.
The handler checks Deno's runtime `DENO_TIMELINE` before any KV or upstream work;
only the exact value `production` proceeds. Branches, previews and local runs
keep visitor-driven refreshes only. The daily job reuses the same freshness,
retry cooldowns and KV leases, so it skips fresh entries and work already claimed
by visitors. No forced invalidation or extra retry schedule is introduced.
Wallet-tab donations still enter the ledger through the confirm endpoint.
The minimum-donation floor remains a ledger rule; dust still reaches the balance.

A refresh batch shares one lazy head lookup for confirmations. Empty or known
indexer results cause no ledger RPC calls. New/pending donations still require
receipt checks and sometimes price reads, and must meet the confirmation threshold.

## What goes away

The Alchemy Address Activity webhook, the KV queue that ran syncs from it, the
`kv.watch` SSE endpoint and the page's `EventSource` hook. All were ways to make
the ledger faster; the balance read makes the headline number instant without
them. The by-Safe index fix and the failed-row revisit in the sync stay.

The page polls the saved snapshot every 15 s while visible (board every 30 s).
It paints that result immediately. When funding, token state, or a ledger is due for refresh, it
requests the same endpoint with `?refresh=1`, keeping the saved values visible
until the new values arrive and animate. The server rechecks freshness and uses
a version-checked KV lease so concurrent callers cannot duplicate the refresh
or overwrite a newer result. The lease expires after two minutes if a worker dies.
The refresh stays attached to an HTTP request rather than detached server work
that could be terminated after the first response on Deno Deploy.
Cold token-verification state also sets a top-level `refreshDue` flag so the
initial page does not block on token verification. Donation actions still
verify token configuration on the server as before.

A newly confirmed wallet donation invalidates that Safe's snapshot freshness,
preserving the displayed value while making an earlier refresh eligible. Repeated
confirmation of the same donation does not invalidate it again. Global profile,
support and submission UI use `/api/board/settings` and never poll the board.

## Cost

Per Safe per refresh: one `balanceOf` per accepted token plus one
`eth_getBalance`, about ten RPC calls, at most every two minutes across instances
when someone is looking (or after a newly confirmed wallet donation), plus the
daily production fallback for quiet days.
With 19 Safes and a continuously visible board, the balance baseline falls from
22,800 to about 5,700 requests/hour; idle visitors within the shared freshness
window add no balance RPC calls. Chainlink rates are cached ten minutes. A Multicall3 batch can
replace the individual calls later without changing anything above.
