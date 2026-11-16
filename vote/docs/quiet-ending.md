# Quiet Ending · Blossom Budgeting

Current mechanism overview, Nov 16, 2026. The [voting rules](quiet-ending-rules.md) define the
round; [Blossom Budgeting](https://blossom.software/budgeting/) provides an introduction and an
interactive example.

## Who votes

Each eligible NFT ID with an accepted ballot is one equal voting unit. A holder of several NFTs can
vote separately with each. Transferring an NFT changes who may revise its ballot without creating
another share.

Voters place initiatives in S-Tier, A-Tier and B-Tier. Initiatives in a tier are tied. An initiative
left outside the ballot receives none of that voter's money.

First ballots count until S-Tier actually settles. Afterwards only registered badges may revise open
tiers. Once a tier settles, its membership on each voter's ballot is locked. There are no additional
provisional supporter locks.

## Three sequential settlements

The round sets an opening date, a first tally date for each tier, an initial quiet window and a
maximum number of windows per tier. A-Tier starts at or after the latest possible S-Tier settlement;
B-Tier does the same for A-Tier. Each tier starts with its own full initial window.

A window has an opening tally, a tally after each block with a vote, burn, pledge, pool update,
initiative correction, withdrawal or registered-currency balance change, and a closing tally. Native
ETH changes include internal transfers. Every tally uses the asks and pool at its own historical
block.

1. If every tally funds the same initiatives in the settling tier, settle with the closing tally.
2. If any tally differs and a window remains, open another window half as long.
3. If any differs in the last allowed window, settle with its closing tally anyway.

A temporary change that reverses before the end still extends the window. Lower tiers, award amounts
and who pays matter only when they change the compared funded set. For a 24-hour initial window and
four maximum windows, each tier can run for 24, 12, 6 and 3 hours: 45 hours at most.

## Money and changing asks

The common pool records secured USD funding and only increases after S-Tier's first tally.
Initiative-specific donations and outstanding pledges reduce that initiative's ask; they never
enlarge the pool. Only the registered accounts, currencies and chain count. Admins may record other
support as a pledge.

Each tally splits the pool among the accepted voting units. Once S-Tier settles, the roll freezes.
Each badge's entitlement is the pool divided by that fixed count, rounded down, minus what it
already paid for settled awards. Pool increases use cumulative rounding, so splitting an increase
into several transactions does not change the final entitlement. With no accepted ballots, nothing
is allocated.

Each tier fixes its USD awards and voter charges at settlement. Later donations, price changes,
pledge corrections and spending do not change those awards or create automatic top-ups. The next
tier uses updated asks and remaining voter shares. The results compare fixed awards with current
asks separately, assuming pool awards have not yet been paid.

An initiative asking zero is covered by donations and takes nothing from the pool. Covered at
settlement, it never returns in a later tier even if its ask rises. Withdrawn initiatives are
excluded too, but can return to open tiers when their withdrawal is undone. Withdrawing cannot undo
an earlier settlement.

Three firm settlements can produce a different result from one fresh PB-EAR tally of all final
inputs. Earlier funding commitments remain fixed. The fixed-input proportionality guarantee does not
automatically extend to changing inputs.

## Results anyone can reproduce

The website and standalone replay read the same contract views at historical blocks. They verify all
ballot receipts against the contract's transcript and last ballot hashes. No administrator publishes
or approves a checkpoint. Stored settlement results cannot override the chain-derived calculation.

Scheduled settlements govern revisions at their cutoffs. Until a finalized chain block reaches a
cutoff, the page labels that settlement as awaiting chain finality. A reorganization can change a
provisional result. Historical input caches are bound to canonical block hashes; elapsed time alone
never establishes finality.

The results expose valuation evidence for stored-price fallbacks, failed token balance reads and
retained token precision under Funding details. Missing RPC history makes replay incomplete; it
never becomes a zero ask or a skipped ballot.

## Reference material

- [Voting rules](quiet-ending-rules.md) and [USD settlement policy](settlement-policy.md).
- [Independent scheduled replay](../reference/scheduled_replay.py): the complete three-stage
  process.
- [Shared-history fixture generator](../reference/export_scheduled_fixtures.py): examples checked
  against TypeScript.
- [PB-EAR paper](papers/aziz2021.pdf) and [expanding-approvals paper](papers/aziz2019.pdf).
