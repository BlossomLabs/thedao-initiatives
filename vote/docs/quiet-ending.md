# Quiet Ending · Blossom Budgeting

Current mechanism overview, 15 October 2026. The [contract requirements and rules](quiet-ending-rules.md)
define the round; the [public explanation](https://blossom.software/budgeting/)
provides an introduction and an interactive example.

## Who votes

The contract can issue its own voter NFTs or use an existing NFT collection.
Each NFT ID with an accepted ballot is one equal voting unit, independent of owner address.
A voter places projects in S, A and B tiers, with projects in the same tier tied.
By default, projects left outside those tiers receive none of that voter's share.

Admins use roles to configure the round and record funding, projects and pledges.
Their permissions do not include choosing the voting result.

## The schedule

Voting has an initial date, a first tally date for each of S, A and B, an initial
quiet-window duration and a maximum number of windows per tier. Registration always closes
at the first S tally plus the initial quiet-window duration. It is not an independent
setting. Afterwards, only NFT IDs already on the accepted roll can revise open tiers.
Admins can change future dates independently. Both deployment and updates check
that the maximum tier windows do not overlap. Opening cannot change after voting
starts; each funded tier's first tally date locks when it occurs. Initial funding
must be set strictly before S's first tally and never changes dates. Without funding,
the round waits; if S's date passes, admins must explicitly reschedule it first.

Each tier starts with its own first tally and initial quiet window. At its end,
derive the next tally from on-chain data and compare it with the first:

1. If they agree, settle the tier as a whole.
2. If they differ and windows remain, open another window half as long. The latest
   tally becomes the comparison baseline.
3. If they differ after the last allowed window, settle the latest tally anyway.

The maximum includes the initial window and must be at least one. For example,
a 24-hour initial window and a maximum of four windows allow 24, 12, 6 and 3 hours,
at most 45 hours in all. A maximum of one allows only the initial 24-hour window.
A tier can settle sooner. There is no separate minimum-duration parameter.

The first A tally must leave enough time for S to settle under the longest possible
schedule, and the first B tally must do the same for A. Gaps between tiers are allowed.
Once a tier settles, its membership is locked; lower tiers can still be revised.
Presentation dates can be derived from the configured schedule.

## Funding and project support

The pool records secured USD from actual net conversion proceeds or an enforceable
guarantee in the award currency. Its recorded total can increase but never decrease.
Registration closes at the end of S's first window, fixing the NFT count and equal
initial shares. Later increases add equally to those NFTs' remaining shares, without
changing settled awards or charges.

Project addresses hold donations in allowed native/ERC-20 currencies. Admins also
record outstanding pledges, which may be currency-denominated or fixed USD.
Project need is the original dollar ask minus the USD value of its donations and
pledges, floored at zero. Project support is separate from the common pool.

The contract exposes donated, pledged and total USD, the remaining ask, and pool
USD in six-decimal units. These views read current balances and oracle state;
historical tallies require calls at their historical canonical block.

The accepted [settlement policy](settlement-policy.md) locks USD awards and NFT
charges at the tally that finalizes each tier. Earlier tallies commit no money.
Later support changes do not reprice settled awards or create automatic top-ups;
lower tiers use current needs and remaining NFT shares, including their share of
added funding. Results may differ from a
fresh tally of all final inputs. Material increases in need or payment burden must
also prevent quiet agreement; exact thresholds remain open.

## Results anyone can derive

There is no checkpoint-publication step. Anyone can replay the on-chain ballots,
funding, project and pledge history at the scheduled cutoffs to derive the same
checkpoints, settled tiers and next windows. An admin or server does not choose
when a checkpoint takes effect.

Every receipt must be accounted for. A recorded revision counts only after its
contents and revision pass the [acceptance rules](quiet-ending-rules.md#how-a-recorded-ballot-becomes-an-accepted-ballot).
A rejected revision leaves the previous accepted ballot in place. Missing committed
blob data leaves replay incomplete; it cannot be a reason to skip a vote.

The draft comparison also tracks changes in who pays, and its supporter rule
prevents stepping back from a provisionally funded project. The exact stability
threshold and final supporter policy remain to be fixed in the detailed rules.

## Implementation status

The Solidity registry now supports internal/external NFTs, per-NFT receipts and
nonces, role permissions, validated date updates, maximum windows, currency
configuration, pledge updates and Chainlink valuation views. Its USD budget may only
increase. Funding increases and pledges remain open until the effective maximum
round end. These are funding assertions, not custody or proof of conversion.

Receipt collection stops at the latest possible scheduled end. Actual early tier
settlement, supporter restrictions and the accepted NFT roll still require full
deterministic replay, including decoding and validating all committed blob ballots.
Final USD awards, NFT charges and remaining shares also belong to that replay,
not additional contract storage.

The Python/TypeScript tallies and historical simulations remain fixed-input
references. Their evidence does not establish guarantees for changing market values.
Their results and limitations remain in the
[detailed rules](quiet-ending-rules.md#historical-simulation-evidence).

## Reference material

- [The Python models](../reference/quiet_ending_steps.py): earlier Quiet Ending and Slow Quiet Ending variants.
- [The simulator](../reference/quiet_ending_sim.py): invented voters and the TheDAO initiative fixture.
- [Quiet-ending tests](../reference/test_quiet_ending_on_time.py), [tier tests](../reference/test_quiet_ending_daily.py) and [scale tests](../reference/test_quiet_ending_scale.py).
- [PB-EAR paper](papers/aziz2021.pdf) and [expanding-approvals paper](papers/aziz2019.pdf).
