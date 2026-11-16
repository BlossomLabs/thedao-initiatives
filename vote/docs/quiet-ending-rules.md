# Blossom Budgeting: contract requirements and quiet-ending rules

Current requirements, 15 October 2026, with the rules for asks read from the chain
added in the Nov 12, 2026 design and adapted on Nov 15, 2026. These incorporate the round-specific
decisions made after the [public mechanism explanation](../README.md#published-mechanism).
The [registry](../contracts/SignedBallots.sol) now implements NFT-ID receipts,
roles, the fixed schedule and [currency accounting](../contracts/RoundAccounting.sol).
The [USD settlement decision](settlement-policy.md) is accepted and the contract
enforces increase-only funding, its initial deadline and validated date updates.
Settlement accounting and the complete replay live outside the contract, in
`shared/vote/` and `deno task vote:replay`; [how to run it](../README.md#replay-the-round-yourself).

## Voters and administration

The contract issues voter NFTs itself, or uses one external ERC-721 collection.
**Each NFT ID is one equal voting unit.** Owners of several NFTs may submit a
separate ballot for each. Registration, revisions and nonce sequences are keyed by
token ID, not address. Token ID zero is valid for an external collection.

The current owner authorizes a ballot. Transferring an NFT changes who can revise
that token's ballot without creating another voting unit or resetting its nonce.
ERC-721 transfer approvals do not grant voting permission. Signed ballots bind
the token ID and current owner in the round's EIP-712 domain, so old-owner
signatures do not authorize submissions after a transfer.

Administrative permissions use OpenZeppelin AccessControl. DEFAULT_ADMIN_ROLE
grants/revokes roles; ADMIN_ROLE manages setup and the USD pool budget; PLEDGE_ROLE
records pledges; MINTER_ROLE issues internal NFTs, and burns mistaken ones, before
S's first window ends (no tier can settle earlier). A burn revokes the token's receipt and records a revocation in
the transcript, so replay voids its earlier ballots.
The deployment admin initially has all these roles.

External NFT mode disables internal minting. Currency definitions, project order,
addresses and dollar asks freeze when voting opens. No role publishes, approves
or selects checkpoint outcomes.

## Round parameters and timing

| Parameter | Meaning |
| --- | --- |
| Voting start | Initial timestamp at which ballots may be recorded. |
| First S tally | Configured start of S's first quiet window; initial funding must precede it. |
| First A tally | Independently configured start of A, at or after S's latest possible settlement. |
| First B tally | Independently configured start of B, at or after A's latest possible settlement. |
| Initial quiet window, W | Duration of each tier's first quiet window. |
| Maximum windows, N | Total windows allowed per tier, including the initial window; N must be at least one. |

First ballots are taken until **S settles**: the contract's registration deadline is
S's latest possible settlement (first S tally plus the maximum tier duration), and
replay accepts a first ballot only before S's actual settlement. Minting and burning
close at **first S tally + W**. There is no independently configurable registration
deadline or minimum quiet-window duration.

ADMIN_ROLE can call setDates(opensAt, firstTallyAt) to change dates independently.
The same window-overlap validation runs on deployment and every update. Each changed
date must be in the future. Opening cannot change after it starts, preventing setup
from reopening. Once funded, a tier's first tally date cannot change at or after
that timestamp. Unchanged dates remain untouched, including dates of started tiers.
Window duration and maximum windows are fixed. Registration, minting and maximum
round end are recalculated from S and B respectively. ScheduleConfigured records every update.

The first setPoolUsd call, including an explicit zero, must be strictly before
S's first tally; otherwise InitialFundingTooLate reverts without changing state.
Funding never moves dates. If funding is absent, no tally settles and registration,
minting, receipts and pledges remain open past the configured dates, subject to the
opening and setup freeze. Admins must explicitly replace an expired S date with a
valid future date before recording initial funding. Later increases do not alter dates.

Each tier starts its own window count at one. Window k lasts floor(W / 2^(k - 1))
seconds, for k from 1 through N. Thus N = 1 allows only the initial window.
With W = 24 hours and N = 4, the windows are 24, 12, 6 and 3 hours.

Each window has an opening tally, a tally after every block in the window that
holds a [tally event](#tally-events), and a closing tally at its end. The outcome
compared is the set of funded projects in the tier being settled; changes in lower
tiers and in who pays do not count. If every tally of the window gives the same
outcome as the opening tally, settle the tier with the closing tally. Otherwise,
if windows remain, the closing tally becomes the next window's baseline. If any
tally differs during window N, settle the closing tally anyway. A project that
becomes funded and drops out again within one window extends the tier, even when
the closing tally matches the opening one.

Configuration must ensure the final window has at least one second. The maximum
tier duration is the sum of floor(W / 2^(k - 1)) for k = 1 through N, always less than 2W.
The first S tally cannot precede voting start. The first A tally must not precede
the latest possible S settlement, and the first B tally must not precede the latest
possible A settlement. Gaps are allowed. Each tier's latest settlement is derivable.

### Tally events

A block holds a tally event when it contains any of these:

- a ballot receipt or a burn;
- a pledge record, including a change or cancellation;
- a pool increase;
- a change in a project address's balance in an allowed currency, incoming or
  outgoing. Native transfers through internal transactions count; they emit no
  log, so replay must find them with transaction traces or by comparing each
  project's balance block by block, both of which need an archive node.

A block with several events gets one tally, after its last event, so the order of
transactions inside a block never matters. **Each tally uses the asks and the pool at
its own block**: the pool is the total `PoolUsdSet` recorded by then, not one total for
the whole window. The opening tally of a window uses the last block strictly before the
window opens, the closing tally the last block strictly before its cutoff. A price
change alone is not an event: it triggers no tally, but every tally values currencies at
its block, so a price move can change the closing tally. In-window tallies are
comparisons only. They settle nothing and do not bind supporters; the scheduled
checkpoints do. Blocks outside every tier's windows need no tally.

Only the round's own chain counts, only the account the project registered, and only the
registered currencies. Other chains, other addresses and unlisted tokens are never counted;
an admin may record such money as a pledge. The board's "still needs" and the vote's ask can
therefore differ. Any balance already in a project's account counts, whatever it was for.
Balances count, not incoming transfers, so a swap from ETH to DAI inside an account is not
new money.

**Swaps are a rule for people.** A swap inside a project's account must happen in one
transaction, or wait until the project's tier has settled. If ETH leaves in one block and
DAI arrives in a later one, the ask jumps in between. That is a tally event, and a cutoff
in the gap can settle the tier without the project.

## Ballot size minimum

A ballot passes when the asks of its placed projects add up to at least
min(1.5× the pool, the sum of every project's ask), sums saturating. That is at least 1.5×
the pool, or every project the ballot leaves out asks $0 (owner's decision, Nov 15, 2026):
donations can push the sum of all asks below 1.5× the pool, and without this no ballot could
pass. Asks and pool are those at the block that records the ballot. The contract checks the
sum of all asks only when the placed asks fall short, so a normal ballot pays no extra gas.

## Dollar funding, projects and pledges

There are two distinct sources of value: the pool, and project-specific support.

**The pool** records secured USD from actual net conversion proceeds or an
enforceable guarantee in the award currency. An oracle valuation alone does not
secure funding. setPoolUsd records one total in six-decimal USD. Strictly before
S's first tally, when no tally has committed money, a mistyped total may be
corrected downward; from then on every decrease reverts with PoolCannotDecrease.
Replay uses the total in force at each tally. Later increases are allowed strictly before the
effective hardDeadline. An unchanged total adds nothing. PoolUsdSet logs previous
and new totals so replay can derive every funding increment. The registry records
an admin funding assertion; it does not custody funds or prove their conversion.
This supersedes both the earlier fluctuating-currency pool and the fixed-budget rule.

**Project support** is actual donations plus outstanding admin-recorded pledges.
Donations are the allowed native/ERC-20 balances at each project's address.
A pledge has a unique ID, initiative ID, currency ID and amount. Updating its ID
replaces the prior contribution, including when changing initiative or currency.
Amount zero cancels it. When a pledge becomes a donation, an admin must reduce or
cancel the outstanding pledge to avoid double counting. Pledges do not turn into transfers
during the vote, so no other double-count rule is needed.

**Signed pledges.** `setPledgeBySig(pledgeId, initiativeId, currencyId, amount, signer,
nonce, deadline, signature)` may be submitted by anyone. The contract checks the signature
over an EIP-712 `Pledge` struct in the round's domain against the `signer` it names
(`SignatureChecker`: ECDSA for an EOA, ERC-1271 for an admin's smart wallet) and requires
`signer` to hold PLEDGE_ROLE. It then does exactly what
`setPledge` does and emits the same `PledgeSet`, so replay needs nothing new, under the same
accounting-open limit. The nonce is per signer and must be the next one, and the signature
is void after its deadline, so a signed pledge cannot be submitted twice or held back.
`setPledge` stays for direct calls. During the real vote an admin adds, changes or cancels a
pledge from the initiative's admin page: the admin signs (the site asks for a deadline of 10
minutes), the relayer, which never holds PLEDGE_ROLE, submits it, and the site records the
pledge only once the chain has it. Admin pledges are on-chain only; a refused transaction
saves nothing.

Each project's goal is denominated in dollars (`goalUsd`, fixed when voting opens). Its
**ask** is what remains of the goal. At a tally's block, compute:

- pool funding = the recorded USD budget at that block;
- project support = allowed-currency balances plus outstanding pledges, valued in USD;
- ask = max(goal minus project support, zero).

The ask at block `b` is `initiativeUsd(i).askUsd` read at `b`, which never reverts and
applies the price rule below. Nobody re-implements the arithmetic; a replayer reads the
view with an `eth_call` at `b` on an archive node, and the pool with `poolUsd()` the same
way. Project support reduces that project's ask; it is not added to the fungible pool.
Withdrawals, spending, pledge corrections and changing prices can raise or lower
the ask. Transfers from the pool to project addresses would also need explicit
treatment to avoid counting a payout as new outside support.

The accounting implementation uses USD with six decimal places and rounds down.
Currency ID zero is a virtual USD unit, suitable for dollar-denominated commitments
or pledges. It is not a stablecoin, and its project donation balance is always zero.
Other currencies are a native asset or ERC-20 with a registered pricing rule. Native ETH
requires a Chainlink USD feed and its decimal precision. An ERC-20
can use a feed or explicitly select fixed $1-per-token accounting by registering
a zero feed address. Fixed-dollar pricing respects
token decimals but ignores depegs; the mainnet preset selects it for USDC.
Currency definitions, including pricing rules, freeze when voting opens.

Prices never block valuation. A feed answer is good when the read succeeds, the round is
not 0, the answer is positive and fits a uint192, `updatedAt` is not 0 and not in the future,
and the feed's decimals are unchanged; its age never matters. A feed that is not good falls
back to the last good price the contract stored (`PriceStored`, seeded at registration), never
to $1. A token whose balance read fails counts as $0.
Donations and pledges are converted as separate components before their USD totals
are added.

initiativeUsd returns donated, pledged and total USD plus the ask (the dollar goal less that
total, never below zero). A test pins the ask at a block to the contract's view.
poolUsd returns the recorded USD budget separately, without consulting feeds or
project balances; it can only increase during the active round. The initiative views
remain live block-state views. Historical
checkpoint valuation requires the historical canonical block state, including
balances, recorded quantities, pledges and oracle state together. An old oracle
round paired with current balances is not a historical valuation.

Registration closes when S settles, fixing the accepted NFT count and equal initial
shares of the USD budget at that cutoff. Until then every tally splits the budget
among the NFTs with an accepted ballot, so a first ballot during S's windows shrinks
every share and can move S like any revision: the quiet ending extends for it the same
way. Simulated (`reference/quiet_ending_sim.py`, `main_registration`, 200 rounds): about
5-7% more holders counted, S a few hours longer on average; a group holding first
ballots back to drip one in per tally can push S to its last window, but loses money
by doing so. Subsequent funding
increases add equally to those same NFT IDs' remaining shares. Each NFT's remaining
share is its initial share plus its share of added funding, minus settled charges.
Settled awards and charges do not change, and transfers do not create new shares.
Exact integer rounding still needs specification.

## Checkpoints derived from on-chain data

A checkpoint is the deterministic result of replay at a scheduled tally cutoff.
It is not published, approved or activated by an operator. Its data includes:

- the canonical block prefix before the cutoff;
- the configured schedule and authoritative funding, project and pledge records;
- the NFT ownership evidence and the accepted token-ID roll;
- every ballot receipt in order and its acceptance or rejection;
- the tally, previously settled tiers, supporter restrictions and next window;
- the tally after every block of the window that holds a tally event.

Receipt order is block, transaction, then record within the transaction. The prefix
ends at the last canonical block whose timestamp is strictly before the cutoff.
A signature timestamp or a server acknowledgement does not establish inclusion.

Initial funding must precede S, so its ordinary strict-before prefix includes the
funding record. No funding-block exception is needed. Replay uses the valid date
configuration in effect at each boundary; updates cannot rewrite started funded tiers.

Anyone can derive the same checkpoints from the same chain history and rules.
Indexes or cached displays are conveniences, not authoritative inputs. A scheduled
checkpoint's restrictions govern subsequent revisions without waiting for an
administrator to announce a result. The rules are determined at that boundary;
a later calculation must not use later inputs to rewrite an earlier decision.

A chain reorganization requires replay from the common canonical history. The
confirmation/finality policy for displaying a result as final still needs to be
defined, but it creates no checkpoint publisher or discretionary activation step.

## How a recorded ballot becomes an accepted ballot

The registry checks current NFT ownership, signatures, per-token nonces, valid
calldata ranks and the ballot rules, opening, registration receipts and the latest
possible ending. Every ballot reaches the registry as calldata; there is no
hash-only path. It does not compute actual early settlement.
Its hasRegistrationReceipt flag and registrationReceiptCount are candidate receipt
state, not an accepted-ballot roll.

Recording is a receipt, not acceptance. Replay must establish:

1. **Authorization and eligibility.** The signature or account call belongs to this
   round and the current owner of the eligible NFT ID at inclusion. Once S has
   settled, that token ID must already be on the accepted roll. A transfer changes
   the authorized owner, not the token's registration or equal voting unit.
2. **Timely inclusion.** The receipt belongs to the canonical prefix for its window.
   A receipt exactly at a cutoff belongs to the next window, if one is open.
3. **A valid ballot.** The ballot has one byte per project in the fixed project
   order. Positive ranks form a competition ranking; 255 means withheld. The
   low-level reference also supports 0 as unplaced but open to leftover support.
   The current calldata registry rejects 0 and requires proposals outside the
   voter's tiers to be explicitly withheld with 255.
   Withheld proposals do not count when validating ranks; the project limit is 254.
4. **An allowed revision.** Settled tier membership cannot change. A supporter
   bound by the governing checkpoint cannot remove a bound proposal or move it
   below its tier. Withholding it also withdraws support. Compare tier membership,
   not raw rank numbers, which can change when an open tier is rearranged.

Process every receipt. An allowed revision replaces the voter's accepted ballot.
A disallowed revision is rejected whole; the previous accepted ballot remains.
Never merge parts of an invalid revision or silently repair it. The registry's
per-NFT nonce watermark records receipts, not which revision was accepted: a corrected
submission needs the next nonce even if its predecessor was rejected. The registry
accepts only nonceOf + 1, never a skipped nonce. A transcript record with voter
address zero is a burn: discard every earlier ballot of that NFT ID.

An NFT ID enters the accepted roll only through an accepted ballot before S settles. Rejected records do not add voting units. If no NFT has an
accepted ballot, there is no division by zero or voting allocation.

The interface distinguishes recorded/pending validation, accepted and rejected,
and identifies the previous ballot still counted after a rejection. Its signing
preview must use the same rules as replay.

**Missing data is not invalid data.** If committed bytes are unavailable, derivation
is incomplete; it cannot skip the receipt or silently reject the ballot. Complete
derivation accounts for every receipt, including reasons for rejecting revisions.

## Tier settlement and supporter commitments

The accepted policy is [fixed_usd](settlement-policy.md): the tally that finalizes
a tier locks its accepted USD awards and per-NFT USD charges at that cutoff through
deterministic replay. Awards, charges, remaining shares and settlement checkpoints
are not additional contract state.
Earlier provisional tallies are comparison baselines and commit no money. Project
asks remain current at every provisional cutoff; inputs are not frozen at the
tier's first tally, as in the alternative tier_lock policy.

Each tally uses the asks and the pool at its own block. A tier settles with the asks at the
last block strictly before its cutoff; awards and per-NFT charges are fixed there. The stored
settlement (the `settled` record the site keeps) is a cache of a value
anyone can recompute from the chain, never the only place a settlement's asks exist; a
stored value that disagrees with the chain is a bug, not the truth.

Later prices, donations, withdrawals and pledge corrections do not reprice settled
awards or trigger automatic top-ups. A resulting project funding gap or excess
coverage is outside that allocation decision. Unsettled tiers use current project
needs and the shares remaining after settled charges, including equal shares of
any subsequent funding increase. These increases do not reopen settled tiers.

### Covered projects

- A project whose ask is $0 at a tally's block is not a candidate in that tally: it is not
  funded, takes no money and is not part of any funded set the quiet comparison looks at.
- A project whose ask is $0 at the block a tier settles with is **covered** at that
  settlement, with a $0 award, unless it was funded in an earlier tier or covered earlier.
  That is final, like any settlement: it is never a candidate in a later tier, even if ETH
  falls afterwards. The settlement carries the covered set.
- A covered project on a ballot is skipped: the voter is not charged for it and their money
  goes to their other choices in this tier or the next runs.
- A project covered during a window but not at the settlement block is an ordinary candidate
  at settlement, with its ask at that block.
- A project funded in a settled tier whose ask later reaches $0 keeps its award; the pool
  still pays it.
- When two tallies are compared, projects at $0 in either tally are dropped from both funded
  sets first. Crossing $0 alone never extends a window: it does so only when another project
  enters or leaves because of it.
- With no $0 asks and no changes, the result is plain PB-EAR. **The staged tally differs from
  plain PB-EAR only for $0 projects**: plain PB-EAR funds them (zero support meets zero cost),
  the staged tally does not.

### Withdrawn projects

An admin can withdraw a project at any time before the hard deadline and can undo it. A project
that is withdrawn at a tally's block is not a candidate in that tally, and a withdrawn project
that also asks $0 counts as withdrawn, not covered. When two tallies are compared, projects
withdrawn at either are dropped from both funded sets, as covered ones are, so withdrawing and
undoing alone never extend a window. A project withdrawn at the block a tier settles with is
recorded apart from the covered ones, with a $0 award, and unlike covered that is not final:
if the withdrawal is undone, it is an ordinary candidate in the tiers still open. A withdrawal
of a project that is already settled, funded in a settled tier or covered at a settlement, is
ignored: its award stands. The supporter lock is unchanged.

The quiet comparison looks only at which projects in the settling tier are funded.
Shifts in who pays, and changes in project need or per-NFT payment burden, matter
only when they change that set at some tally of the window. The maximum-window
limit and forced-close rule still apply.

The draft supporter rule prevents a supporter of a provisionally funded proposal
from stepping back until that tier settles. Derive the bound set from the preceding
checkpoint; a changed checkpoint can release support for a proposal that dropped
out. The current one-tier-at-a-time schedule makes the active tier explicit.
The final choice of supporter restrictions is still a round-rule decision.

Accepted tradeoff: the final allocation may differ from a fresh PB-EAR tally using
all final economic inputs. That tally's proportionality guarantee does not
automatically extend to this sequence of changing inputs.

## Ballot files and complete replay

Keep [pbear.py](../reference/pbear.py) as the readable integer-exact core and
[withhold.py](../reference/withhold.py) as its withholding adapter. The current
window models in [quiet_ending_steps.py](../reference/quiet_ending_steps.py) need
fixed first tally dates, a maximum-window limit and time-varying currency valuations.

Ballot bytes come from BallotRecorded events. Receipt order controls replay. Use all
revisions, including rejected ones, and the on-chain history needed to derive every
checkpoint. A final accepted-ballot snapshot is insufficient.

The replay is implemented: one TypeScript function in `shared/vote/` behind a small read
interface, used by the site's server and by `deno task vote:replay`, which needs only an
archive RPC for the round's chain ([how to run it](../README.md#replay-the-round-yourself)).
The replayer first checks the ballots it counts against the contract's `transcript`,
`recordCount` and `ballotHashOf`, then reads the states. The Python reference and the
browser tally agree with it on shared examples. A chain-derived checkpoint does not require
a separate checkpoint-publication transaction.

## Remaining decisions

- Securing the USD funds.
- Exact equal-NFT share accounting and rounding for initial USD funding and increases.
- Supporter restrictions and chain finality policy.
- Treatment of pool payouts and spent donations to avoid double counting after the vote.

## Historical simulation evidence

These results describe the earlier fixed-budget models and their alternative
closing rules. They do not validate settlement with changing project support.
Their minute-based stopping conditions are historical; the current interface uses N.


Simulated on the 49 initiatives of TheDAO Security Fund (asks reduced by 25% and capped
at $200,000), a $1,000,000 pool and 200 invented badge holders, 30 rounds each. Unless
it says otherwise, a late group votes during the last day, which moves S-Tier in
every round.

| | Quiet Ending | Slow Quiet Ending |
| --- | --- | --- |
| Rounds ending on the plain tally of the final ballots | 30 of 30 | 30 of 30 |
| Time after the deadline, nothing moving on the last day | none | about 73 hours |
| Time after the deadline, with the late group | about 17 hours on average, 30 at most | about 85 hours on average, 96 at most |
| A group stepping out of funded proposals, without payment-shift checks or supporter locks | its category gains about 22% | its category gains about 21% |
| The same, with payment-shift checks and supporter locks | no gain; about 51 ballots refused per round | no gain; about 59 ballots refused per round |
| A group flip-flopping to reach the last window, without supporter locks | 45 tiers closed by the schedule in 30 rounds | S-Tier closed by the schedule in every round |
| The same, with supporter locks | no tier closed by the schedule; five tallies at most | the tier is confirmed in two or three tallies |
| A group pushing a proposal over the line for one block in every window, then taking it off before the closing tally (in-window tallies, 11 November 2026) | 51 tiers closed by the schedule in 30 rounds, about 50 hours after the deadline on average, 72 at most; supporter locks from the checkpoints do not stop it, and locks on every open tier only bring it to 35 | not modelled |
| A group pushing a new proposal every window | runs out after 10 tallies at most, and loses funding for its own category | runs out after 9 windows at most, and loses funding for its own category |
| A group stepping out of A and B proposals on the last day | the crude version tried lost the group funding; it is refused in full only if supporter locks bind every open tier | cannot happen: A and B have no tally yet |

The model gives the unplaced proposals a window of their own in Slow Quiet Ending,
which the current default does not. It also takes a tier's first tally at the moment the tier
before it is confirmed, not at the start of a fixed slot, so its times for Slow Quiet
Ending do not implement the configured first tally dates.

Alternatives that were tried and set aside:

- **Locking individual proposals in or out** (the first proposal). Locked-out proposals
  could not be funded however much support they gained, and the result depended on how
  locked-in costs were charged.
- **Accepting proposals one by one inside a tier.** It usually gave the plain result
  but not always, because it fixes the order of payment before the tier is settled.
- **Letting new voters join after the deadline.** It moved the result away from the
  plain tally and lengthened S-Tier.
- **Sealing the last day's ballots with a hard deadline.** A group stepping out gained
  about as much as with public ballots.

The model and tests are in [`reference/`](../reference):

- Quiet Ending is `run_on_time` in [`quiet_ending_steps.py`](../reference/quiet_ending_steps.py),
  tested in [`test_quiet_ending_on_time.py`](../reference/test_quiet_ending_on_time.py).
- Slow Quiet Ending is `run_daily` in the same file, tested in
  [`test_quiet_ending_daily.py`](../reference/test_quiet_ending_daily.py) and
  [`test_quiet_ending_scale.py`](../reference/test_quiet_ending_scale.py).
- [`quiet_ending_sim.py`](../reference/quiet_ending_sim.py) is the simulator:
  `python3 reference/quiet_ending_sim.py 30` prints the figures for both.

The mechanism overview is [Quiet Ending · Blossom Budgeting](quiet-ending.md).
