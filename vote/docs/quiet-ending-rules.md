# Blossom Budgeting: voting rules

Current rules, Nov 16, 2026. These rules describe the implemented three-stage vote. The receipt
contract records ballots and accounting data; deterministic replay derives settlements. The website
and `deno task vote:replay` use the same replay.

## Voting units and ballots

Each eligible NFT ID is one equal voting unit. A holder of several NFTs can submit one ballot per
NFT. Registration, receipts and consecutive nonces belong to the NFT ID. Transferring an NFT changes
who may revise its ballot without creating a new share or resetting its nonce. ERC-721 approvals do
not authorize a vote.

The current owner submits a ballot directly or signs it in this round's EIP-712 domain. Ballot bytes
use the contract's initiative order. A voter places initiatives in S-Tier, A-Tier and B-Tier;
initiatives in one tier are tied. Competition ranks encode ties. Byte 255 withholds support; an
initiative outside the ballot receives none of that badge's money. A shorter ballot leaves later
initiative IDs withheld.

The contract checks ownership, authorization, nonce, ballot syntax and the ballot rules when it
records a receipt. Accepted receipts are not rechecked against later asks, affiliations or pool
amounts. Replay checks readability, registration and settled-tier restrictions. A rejected revision
leaves the previous accepted ballot in place and consumes its recorded nonce. A corrected submission
needs the next nonce. A burn discards that badge's earlier ballots.

First ballots count only before S-Tier actually settles. The contract permits first receipts until
its latest possible settlement; replay determines the actual cutoff. Internal minting and burning
end at the close of S-Tier's first window. No tier can settle before that time. After registration
closes, the accepted NFT roll is fixed. Ownership transfers do not change that roll.

## Ballot rules

The contract applies the configured size and independence rules to asks at inclusion. The size
minimum is `min(ceil(1.5 × poolUsd), sum of all initiative asks)` in micro-USD. Withdrawn
initiatives contribute zero to the size calculation. The independence proof uses the configured
affiliations, with RFPs treated according to the contract's rules. Covered initiatives can still
count for independence. The editor, relayer and signature preview use those same rules.

Once a tier settles, a revision cannot change the set of initiatives the voter placed in that tier,
including initiatives it did not fund. Compare tier membership, not raw rank bytes. There are no
additional provisional supporter locks. Open tiers can still be revised, subject to the contract's
ballot rules.

## Schedule and quiet windows

The round configures an opening timestamp, independent first tally timestamps for S-Tier, A-Tier and
B-Tier, an initial window W and a maximum of N windows per tier. Window k lasts
`floor(W / 2^(k − 1))` seconds. N includes the initial window, and every window must last at least
one second.

Each tier starts its own window count. A-Tier cannot start before S-Tier's latest possible
settlement; B-Tier cannot start before A-Tier's. Gaps are allowed. Each tier can settle early, but
the next tier still waits for its configured start.

A window has an opening tally, a tally after each block containing a tally event, and a closing
tally. The outcome compared is the funded set of the settling tier. Lower tiers, payment shares and
award amounts matter only if they change that set.

- If all tallies match the opening outcome, settle with the closing tally.
- If any differs and a window remains, open the next, shorter window. Its baseline is the preceding
  closing tally.
- If any differs in the last window, settle with that closing tally anyway and record a forced
  settlement.

A temporary change that reverses before the cutoff still extends the window. All events in a block
produce one tally after the block's last event. A block whose timestamp equals a cutoff belongs to
the following window. Opening and closing tallies use the last canonical block strictly before their
boundary.

The contract validates date changes and recalculates dependent deadlines. Opening cannot move after
it starts; a funded tier's first tally cannot move after it starts. Window parameters can be
corrected before opening. Replay refreshes configuration from the contract at its pinned head,
including valid changes to future dates.

## Tally events and historical inputs

Inside a tier's scheduled span, tally events are ballot receipts, burns, pledge updates, pool
updates, initiative configuration changes, withdrawals and their undo, and changes in initiative
balances in registered currencies. Incoming and outgoing transfers both count. ERC-20 scans use
Transfer logs; native ETH scans compare balances block by block, including internal transfers. Scans
follow the account registered for each initiative at each block.

Each tally uses its own historical asks and pool. An archive node serves `initiativeUsd(i).askUsd`
and `poolUsd()` at that block. The server's board ledger never supplies a voting ask. A price change
alone is not an event, but affects any tally taken for another reason and the window's closing
tally.

Only registered currencies, registered initiative accounts and the round's own chain count. An admin
may record other support as a pledge. Balances already in a registered account count regardless of
their original purpose. Money must remain in initiative accounts until the results are known. A swap
during the vote must complete in one transaction: a gap between its outgoing and incoming legs can
change the tally or settle a tier with a temporarily higher ask.

Missing chain state, failed RPC calls, unavailable ballot bytes or a transcript mismatch make
derivation incomplete. The API returns an error; it never substitutes today's state for historical
state or skips an unread receipt.

## USD funding and valuation

All amounts use integer micro-USD: 1,000,000 units equal one dollar. The common pool is separate
from initiative-specific support. It records secured USD proceeds or an enforceable guarantee; an
oracle valuation alone does not secure an award. The registry records funding assertions and does
not custody or pay the money.

Initial funding, including an explicit zero, must be recorded strictly before S-Tier's first tally.
Before then the total can be corrected in either direction. Afterwards it can only increase. Later
increases use the contract's proposal and activation process and do not reopen settled tiers or
change dates.

An initiative's ask is its dollar goal minus its actual registered-currency balances and outstanding
pledges, floored at zero. Support reduces that initiative's ask; it never enlarges the common pool.
Donations and pledges are converted separately and rounded down before adding. Currency 0 represents
USD pledges and never reads a donation balance.

A configured fixed-dollar token counts at $1 per whole token using registered precision, regardless
of market depegs. A feed-priced asset uses the latest valid answer at the tally's block. A valid
answer has a nonzero round, a positive value fitting uint192, a nonzero timestamp no later than the
block, and the registered feed precision. Price age has no limit. Invalid or unavailable feeds use
the last good price stored by the contract, seeded at registration. They never fall back to $1.
Token precision changes do not reinterpret amounts: registered precision stays in use.

A failed token balance read contributes zero by the contract's valuation rule. This differs from a
valid read returning zero. `valuationDiagnostics()` records which currencies used a stored price,
had an unavailable balance, or had changed or unavailable token precision. The API exposes that
evidence for the head and each settlement; the results show it under Funding details. An older
contract without the diagnostic view is explicitly marked as having unavailable diagnostics.
Diagnostic information never changes the contract's ask.

Pledges have unique IDs. Updating an ID replaces its previous initiative, currency and amount;
amount zero cancels it. Authorized admins sign relayed updates with consecutive signer nonces and a
deadline. If a pledge is fulfilled, its outstanding amount must be reduced or cancelled to avoid
double counting its donation.

## Equal shares and integer rounding

Before S-Tier settles, each tally splits its current pool among badges with an accepted ballot at
that tally. If there are no accepted badges, each share and all voting allocations are zero. When
S-Tier settles, freeze that accepted roll. For a pool P and N registered badges:

```
entitlement = floor(P / N)
remaining share of badge i = entitlement − settled charges of badge i
```

An increase from Pold to Pnew adds `floor(Pnew / N) − floor(Pold / N)` to every badge's entitlement.
Splitting an increase across transactions does not change the resulting entitlement. The rounding
remainder `P mod N` stays unallocated; previously unallocated micro-USD can enter shares when the
pool grows.

Payment rounding uses canonical decimal NFT-ID strings in lexicographic order, matching replay's
deterministic voter order. For a project of cost C with total supporting weight U, each supporter
pays the difference between `floor(C × cumulative
weight / U)` after and before its weight. Charges
sum exactly to C, never exceed the supporter's remaining share, and are fixed when the tier settles.

## Settlements, coverage and withdrawals

Three chained PB-EAR stage tallies carry remaining voter shares forward. Each settlement fixes the
funded set, USD awards and per-badge charges from its cutoff state. Settlements are always
recomputed from canonical historical inputs. Saved settlement results cannot override a funded set,
a cutoff or ballot acceptance.

Later prices, donations, spending, goal corrections and pledge changes do not reprice settled awards
or create automatic top-ups. Unsettled tiers use current asks and remaining shares. A settled
initiative has no second chance in a later tier. The results compare its fixed award with its
current ask separately. That comparison assumes pool awards have not yet been paid; a payout
appearing in a Safe balance must not be treated as additional outside support. Any supplemental
funding is a separate allocation decision with its own funding and rules.

An initiative asking zero is covered by donations and is not a candidate. If its ask is zero at a
settlement, it is recorded as covered with a zero award and never competes later, even if its ask
rises. A project covered temporarily during a window but positive at settlement is an ordinary
candidate. An initiative funded earlier keeps its award even when its later ask reaches zero.

An admin can withdraw an unsettled initiative and undo the withdrawal before the hard deadline.
Withdrawn projects are excluded from candidacy. A withdrawal takes precedence over a zero ask, and
is recorded separately from covered projects. A withdrawn initiative can return to an open tier when
the withdrawal is undone. A withdrawal cannot undo an earlier funded or covered settlement.

When comparing two funded sets, remove from both any initiative covered or withdrawn at either
tally. Crossing zero, withdrawing or undoing alone never extends a window; it extends only when
another initiative enters or leaves as a result.

With unchanged ballots, roll, economic inputs and candidate eligibility, the chained stage tally
agrees with one PB-EAR run over the same candidates. The staged mechanism excludes zero-cost and
withdrawn initiatives. With changing inputs and firm earlier settlements, results can differ from a
fresh final-input tally. PB-EAR's fixed-input proportionality guarantee does not automatically
extend to that process.

## Chain finality and caches

A scheduled cutoff governs revisions as soon as the observed canonical prefix reaches it. This
logical settlement is provisional until the chain finalizes it. The page says “settled, awaiting
chain finality” until a finalized block reaches or passes the cutoff. Finality delays do not extend
quiet windows or change cutoffs. A wall-clock age never establishes finality.

Configuration, ballots and accounting reads share one pinned head. Historical state reads verify
their block hash before and after reading, and replay checks that its head remains canonical.
Persistent input caches use block hashes and only retain reads through the RPC's finalized block.
Balance-scan caches verify their canonical anchor before reuse. A reorganization invalidates
dependent input data and replay starts from the canonical history. No persistent result cache can
select an outcome. A source without finalized-block or block-hash evidence cannot persist input
reads or label a settlement confirmed.

## Public replay and verification

Anyone can run `deno task vote:replay` with an archive RPC URL. It needs no site ledger or secret.
The replayer verifies all BallotRecorded and RegistrationRevoked records against the contract's
transcript, record count and last ballot hashes, then derives each checkpoint from chain states. All
revisions, including rejected ones, are retained. A final accepted-ballot snapshot is insufficient.

The independent Python reference is `vote/reference/scheduled_replay.py`. Shared complete-history
fixtures compare settlement times, funded sets, awards, charges, accepted ballots and rejections
with TypeScript. Seeded tests check conservation, per-badge affordability, termination and stable
earlier awards. Simulations and passing tests are evidence, not a proof of guarantees under changing
inputs.
