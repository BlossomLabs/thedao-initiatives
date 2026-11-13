# Quiet Ending · Blossom Budgeting

Current mechanism overview, 15 October 2026. The [contract requirements and rules](quiet-ending-rules.md)
define the round; the [public explanation](https://blossom.software/budgeting/)
provides an introduction and an interactive example.

## Who votes

The contract can issue its own voter NFTs or use an existing NFT collection.
Each NFT ID with an accepted ballot is one equal voting unit, independent of owner address.
A voter places projects in S-Tier, A-Tier and B-Tier, with projects in the same tier tied.
By default, projects left outside those tiers receive none of that voter's share.

Admins use roles to configure the round and record funding, projects and pledges.
Their permissions do not include choosing the voting result.

## The schedule

Voting has an initial date, a first tally date for each of S, A and B, an initial
quiet-window duration and a maximum number of windows per tier. Registration (an NFT's
first ballot) stays open until S settles: the contract takes first ballots until S's
latest possible settlement, and replay accepts one only before S's actual settlement.
It is not an independent setting. Afterwards, only NFT IDs already on the accepted roll
can revise open tiers. Minting and burning internal NFTs close earlier, at the end of
S's first window, before any tier can settle.
Admins can change future dates independently. Both deployment and updates check
that the maximum tier windows do not overlap. Opening cannot change after voting
starts; each funded tier's first tally date locks when it occurs. Initial funding
must be set strictly before S's first tally and never changes dates. Without funding,
the round waits; if S's date passes, admins must explicitly reschedule it first.

Each tier starts with its own first tally and initial quiet window. During the
window, derive a tally from on-chain data after every block with a vote, burn,
pledge, pool increase or project balance change (internal transactions included),
and one more at the window's end. Each tally's outcome is the set of funded projects
in the tier being settled; lower tiers and who pays do not count.

1. If every tally of the window agrees with the first, settle the tier as a whole
   with the closing tally.
2. If any differs and windows remain, open another window half as long. The closing
   tally becomes the comparison baseline.
3. If any differs in the last allowed window, settle the closing tally anyway.

A project that is funded for part of a window and drops out again still extends
the tier.

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
guarantee in the award currency. Its recorded total can be corrected before S's first tally and only increases after it.
Registration closes when S settles, fixing the NFT count and equal initial shares;
until then every tally splits the pool among the NFTs with an accepted ballot, so a
newcomer shrinks every share. Later increases add equally to those NFTs' remaining shares, without
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
fresh tally of all final inputs. Changes in need or payment burden extend a window
only when they change which projects of the settling tier are funded.

## Results anyone can derive

There is no checkpoint-publication step. Anyone can replay the on-chain ballots,
funding, project and pledge history at the scheduled cutoffs, and at every block
with a tally event in between, to derive the same checkpoints, settled tiers and
next windows. An admin or server does not choose
when a checkpoint takes effect.

Every receipt must be accounted for. A recorded revision counts only after its
contents and revision pass the [acceptance rules](quiet-ending-rules.md#how-a-recorded-ballot-becomes-an-accepted-ballot).
A rejected revision leaves the previous accepted ballot in place. Missing committed
blob data leaves replay incomplete; it cannot be a reason to skip a vote.

The comparison does not track who pays. The draft supporter rule prevents stepping
back from a project funded at the preceding checkpoint; in-window tallies bind no
one. The final supporter policy remains to be fixed in the detailed rules.

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
