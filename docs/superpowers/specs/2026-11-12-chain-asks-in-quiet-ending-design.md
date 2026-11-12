# Asks from the chain in the quiet ending

Design, Nov 12, 2026. Status: waiting for approval.

## Why

Donations lower a project's ask, and the vote's tally depends on the asks. Today
the replay (`shared/vote/quiet-ending.ts`) gets one list of asks from the site's
board ("goal minus raised", `needsOf` in `api/routes/vote.ts`) at the moment of
the request. Three things follow, all wrong:

- **Nobody else can replay the round.** The asks are the site's own ledger, not
  chain data, and the asks a tier settles with are whatever the server saw the
  first time it noticed the tier settled (`settle-needs` in KV).
- **A donation is not a tally event.** Only ballot receipts trigger a tally inside
  a window. A donation changes every earlier tally of the open tier after the
  fact and is never compared.
- **A donation can decide a tier unseen.** The tally is not monotone in costs: a
  donation to one project can push another out of Tier-S. Measured on the real
  `stageTally`: in 59,344 random small rounds a donation before Tier-S settled
  dropped 1,532 projects from Tier-S, and 874 of them ended funded in no tier.
  Example: costs `[62,12,42,32]`, ballots `[[2,2,3,1],[1,2,1,2]]`, pool 152 funds
  `[3,2]` in Tier-S; lower project 0 to 40 and it funds `[3,0]`.

What already holds and must keep holding (checked in the same test):

- The three chained per-tier runs equal one plain PB-EAR run when asks do not
  change (0 differences in 59,344 rounds).
- A settled tier never changes, whatever happens to asks afterwards.

## Decisions (the owner's)

1. **Everything the tally needs is on-chain**: each project's ask, the pool,
   pledges and donations. The round must be replayable by anyone from the chain.
   The server is a cache, never a source.
2. **What counts as a donation**: the balance of the project's Safe, on the
   round's chain only (mainnet for the real round), in the whitelisted tokens
   only (the contract's registered currencies). Balances, not incoming
   transfers: money does not leave the Safes before the results are known, and a
   swap from ETH to DAI inside a Safe must not count as new money.
3. **Donations are tally events.** A block where a project's balance changed gets
   a tally, and the window is not quiet if the settling tier's funded set differs
   from the window's opening tally. This is `fixed_usd` as written on Oct 15,
   2026; nothing in that decision is undone.
4. **ETH is on the whitelist.** A native transfer is still a chain event; replay
   tracks it.
5. **Pledges** are admin records on-chain, valued with the same prices. They do
   not turn into transfers during the vote, so no double-count rule is needed.
   During the real vote an admin adds, changes or cancels a pledge from the
   dashboard; the admin signs it and the relayer puts it on-chain
   (`setPledgeBySig`, below). The relayer never holds `PLEDGE_ROLE`.
6. **A settled project stays settled.** Its award is fixed in USD at settlement.
   If ETH falls afterwards there is no top-up and no second chance in a lower
   tier; the project keeps its ETH as it is.
7. **Covered is final.** A project whose ask is $0 at the block a tier settles
   with is recorded as covered by donations and never competes in a later tier,
   even if ETH falls afterwards.
8. **Money the chain cannot see is not counted**: other chains, other addresses,
   unlisted tokens. An admin may record it as a pledge. The board's "still
   needs" and the vote's ask can therefore differ. Any balance already in a
   project's Safe counts, whatever it was for.
9. **An archive RPC for mainnet will be provided.**
10. **Crossing $0 does not extend the vote.** A project becoming covered, or
    stopping being covered, is not by itself a change in the funded set. It
    extends a window only when another project enters or leaves because of it.
11. **Pledges are recorded where admins record them today**: the pledge form on
    the admin page of each initiative. While the real vote is on, a pledge is
    allowed only if it is on-chain.

## Rules to add

These are the builder-facing rules. Items marked *(my call)* were proposed by
Claude and not objected to; the rest follow from the decisions above.

### The ask at a block

For project `i` at block `b`, all read from the chain state at `b`:

```
support_i(b) = Σ over registered currencies c of
                 usd(c, balance of account_i in c at b)
               + usd(c, pledged amount for (i, c) at b)
ask_i(b)     = max(askUsd_i − support_i(b), 0)
```

- `askUsd_i` and `account_i` come from `InitiativeConfigured`; pledges from
  `PledgeSet`; currencies from `CurrencyRegistered`.
- `usd()` is the contract's conversion exactly (`RoundAccounting._convert`):
  six-decimal USD, rounded down, donations and pledges converted separately per
  currency before adding. Currency 0 (virtual USD) has pledges only.
- A feed-priced currency uses the feed's `latestRoundData()` answer at block
  `b`. **Replay does not apply the age limit** *(my call)*: a stale price is
  used as it stands, so a tally is never undefined. The contract's
  `initiativeUsd()` view keeps its `StalePrice` revert; replay must therefore
  compute the ask itself rather than call that view. A non-positive answer or a
  changed decimals value still makes derivation incomplete (not zero).
- The result must equal `initiativeUsd(i).remainingAskUsd` at `b` whenever that
  view does not revert. Test this.

### Tally events

Inside a tier's window, a block holds a tally event when it contains any of:

- a ballot receipt or a burn (as today);
- a `PledgeSet`;
- a `PoolUsdSet`;
- a change in any project account's balance in any registered currency,
  compared with the block before. For ERC-20s that is a `Transfer` log to or
  from the account. For native ETH there may be no log (internal transfers), so
  the definition is the balance difference between consecutive blocks; how to
  find those blocks (traces, or reading balances block by block over the
  window) is the builder's choice.

One tally per block, after its last event. Each tally uses the asks **and the
pool** at its own block (today `replay()` uses the manifest's pool for every
tally; that changes too). The opening tally of a window uses the last block
strictly before the window opens, the closing tally the last block strictly
before its cutoff. A price move alone is not an event, but every tally uses the
price at its block, so a price move can change the closing tally.

Blocks outside every tier's windows need no tally.

### Settlement

A tier settles with the asks at the last block strictly before its cutoff.
Awards and per-badge charges are fixed there. The stored settlement
(`settled` and `settle-needs` in KV) becomes a cache of a value anyone can
recompute; it must never be the only place a settlement's asks exist, and a
stored value that disagrees with the chain is a bug, not the truth. Keeping the
existing wait for finality (`FINAL_AFTER_SECS`) before caching is fine.

### Fully covered projects *(my call)*

- A project whose ask is $0 at a tally's block is not a candidate in that
  tally: it is not funded, takes no money and is not part of any funded set
  that the quiet comparison looks at. (Today it enters Tier-S with no votes,
  because 0 support ≥ 0 cost.)
- A project whose ask is $0 at the block a tier settles with is recorded as
  **covered** at that settlement, with a $0 award. That is final, like any
  settlement (decision 7, confirmed by the owner): it is never a candidate in a
  later tier, even if ETH falls. The settlement record carries the covered set.
- **The quiet comparison** (decision 10): when two tallies are compared, a
  project that is covered at either of them is left out of both funded sets
  first. So a project flickering around $0 with the ETH price never extends a
  window; a donation that covers a funded project extends it only if the freed
  money brings another project in (or, when a project stops being covered, its
  new cost pushes another out).
- A covered project on a ballot is skipped: the voter is not charged for it, and
  their money goes to their other choices in this tier or the next runs.
- A project covered during a window but not at the settlement block is an
  ordinary candidate at settlement, with its ask at that block.
- A project funded in a settled tier whose remaining ask is later covered keeps
  its award; the pool still pays it (decision 6).
- With no $0 asks and no changes, the result is still plain PB-EAR. Plain
  PB-EAR funds $0 projects; the staged tally now does not. State that
  difference in the rules doc and in the reference tests.

### Signed pledges

`setPledgeBySig(pledgeId, initiativeId, currencyId, amount, nonce, deadline,
signature)`: anyone may submit; the contract recovers the signer over an EIP-712
`Pledge` struct in the round's existing domain and requires it to hold
`PLEDGE_ROLE`. It then does exactly what `setPledge` does and emits the same
`PledgeSet`, so replay needs nothing new. `setPledge` stays for direct calls
(the deploy uses it). *(My calls:)* a per-signer nonce that must be the next one,
and a `deadline` after which the signature is void, so a signed pledge cannot be
submitted twice or held back; `SignatureChecker`, so an admin's smart wallet
works; the same `_requireAccountingOpen` limit as `setPledge`.

### Swaps (a rule for people, not code)

A swap inside a project's Safe must happen in one transaction, or wait until the
project's tier has settled. If ETH leaves in one block and DAI arrives in a
later one, the ask jumps in between; that is a tally event, and a cutoff in the
gap can settle the tier without the project. Goes in
`vote/docs/quiet-ending-rules.md`.

## What gets built

1. **Deploy** (`scripts/vote-deploy.ts`): register the round's currencies before
   opening (they freeze at opening): native ETH with its Chainlink USD feed, and
   the dollar stablecoins at fixed $1 (USDC and DAI at least). The exact list
   and feed addresses are configuration; the manifest records them. Grant
   `PLEDGE_ROLE` to each admin's wallet address, and copy the board's current
   pledges on-chain as currency-0 (USD) pledges in the setup transaction. Test
   rounds (Sepolia, placeholder accounts) register no tokens: their asks are the
   ask minus pledges, so they never read past balances.
2. **Chain reader** (`api/services/vote-chain.ts`): a history of asks. For each
   tier window that has opened: the blocks holding a tally event, and the asks
   and pool at each of them and at the opening and closing blocks. Needs
   historical state (an archive RPC). Results for final blocks are deterministic
   and may be cached in KV by block.
3. **Replay** (`shared/vote/quiet-ending.ts`): takes that history instead of one
   `needs` list. Tallies per block with that block's asks and pool; ask events
   trigger the quiet check like receipts do; settlement uses the cutoff block's
   asks; $0 projects handled as above. `snapshots` / `settleNeeds` become an
   optional cache, and the replay must give the same answer without them.
   Stays pure (no RPC inside), browser and Deno.
4. **API** (`api/routes/vote.ts`): `needsOf` (the board) leaves the vote. The
   "if it settled now" live view uses the asks at the head block.
5. **Python reference** (`vote/reference/`): `run_on_time` already takes costs
   per in-window tally (`between`, `asks_for_day`). Add the $0 rule, and tests:
   the Tier-S example above extends the window; a donation after settlement
   changes nothing; chained equals plain when nothing changes. Regenerate the
   shared fixtures the TypeScript tests read.
6. **Docs**: `vote/docs/quiet-ending-rules.md` and
   `vote/docs/settlement-policy.md`: stale-price rule, $0 rule, swap rule, pool
   at each tally, and remove "replay … remain unimplemented" where it no longer
   applies.
7. **Contract** (`vote/contracts/`): `setPledgeBySig` as above, with Solidity
   tests, the ABI in `shared/vote/abi.ts` and the typed data next to the
   ballot's (`shared/vote/typed-data.ts`).
8. **Admin pledges**: the existing pledge form on the admin page of an
   initiative (`POST/PATCH/DELETE /admin/initiatives/:id/pledges`) stays the one
   place. While the real (mainnet) round is on, meaning from its deployment
   until the contract stops taking pledges, and the initiative is in it: adding,
   changing or removing a pledge asks the admin to sign, the API checks the
   signer is an admin and relays `setPledgeBySig`, and the site saves the pledge
   only once the chain has it. No signature or a refused transaction saves
   nothing. Outside the real vote the form works as today. *(My calls:)* the
   on-chain pledge id is derived from the site's pledge id; the on-chain amount
   is the pledge's USD amount in currency 0; a pledge marked "received" is
   cancelled on-chain (amount 0), since that money is then expected in the Safe.
9. **Screens**: a covered project needs a plain label in the vote results
   ("covered by donations", not a tier). Smallest change that reads correctly.

## Non-goals

- No contract change beyond `setPledgeBySig`. Everything else reads what
  `SignedBallots.sol` / `RoundAccounting.sol` already record. If the builder
  finds another is needed, stop and ask. A round already deployed is not
  migrated: the real round is a new deployment.
- No change to the tally itself (`stageTally`), the supporter locks, the window
  schedule or the ballot rules.
- No freezing of asks (`tier_lock`), no counting of incoming transfers.
- Other chains, other addresses, unlisted tokens: never counted.

## Anti-goals

- A result that depends on when the server looked.
- A tally that silently values something at zero because data was missing
  (missing data is incomplete derivation, as the rules already say).
- A settled tier that changes.

## Accepted costs

- Replaying needs an archive node, with traces or block-by-block balance reads
  for ETH. Without one, the mainnet results cannot follow donations.
- An ETH price move can change a funded set at a cutoff with no event.
- Anyone can extend a window by donating enough to change the funded set; the
  maximum number of windows bounds it, and the last window settles anyway.

## Left to the builder

- How ETH balance changes are found, and how RPC reads are batched and cached.
- The shape of the asks history passed to `replay()`.
- How admin wallet addresses reach the deploy (the site's existing admin list).
- Wording and placement of the "covered" label.
