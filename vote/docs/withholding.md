# Withholding · Blossom Budgeting

Oct 6, 2026 · @Sem

Design background and optional ballot behavior. See the [contract requirements](../README.md#contract-requirements)
for the current round and the [published mechanism](../README.md#published-mechanism)
for the default ballot behavior. References to "today" below describe the earlier baseline;
the simulations assume fixed funding and do not cover later currency-price changes.

> **Your share only funds what you chose.** Today, money a voter has left after their S, A and B tiers can still fund proposals they never placed. With withholding, a voter can keep their share away from those proposals, one by one or all at once. Whatever is left goes back to TheDAO.

## Leftover money funds what nobody chose

In Blossom Budgeting a voter sorts the proposals they want into S, A and B tiers and leaves the rest unplaced. The tally then treats the unplaced proposals as one more tier at the bottom of the ballot, all tied. Once a voter's own tiers have been counted, whatever is left of their share backs every unplaced proposal equally.

That has two effects we do not want.

- **Money goes where nobody sent it.** When every voter's leftover backs every remaining proposal equally, nothing separates them, and the tie is broken by price: the cheapest one is funded first. In our simulations about $73,000 of a $1,000,000 pool is paid by voters for proposals they had not placed, and about three proposals per round are funded mostly that way.
- **Short ballots lose their own choices.** A voter who places only a few proposals reaches the unplaced tier early, while others are still on their A tier. Their money can be spent on something they never chose before one of their own choices has gathered enough support.

Today a voter has no way to say no. Leaving a proposal unplaced means "not a priority", and the tally reads it as "fine, if money is left".

## What withholding is

Withholding lets a voter mark proposals their share must not fund. A ballot then reads, from top to bottom:

1. **S, A and B tiers.** What the voter wants, exactly as today.
2. **Unplaced.** Proposals the voter did not rank and did not withhold. Leftover money may still reach them, as today.
3. **Return to TheDAO.** A line every ballot has, at the same place. Whatever the voter has left when the tally gets here goes back.
4. **Withheld.** Proposals below that line. The voter's money never reaches them.

A voter can withhold proposals one by one, or withhold everything they did not place with a single choice. Withholding everything means "my share funds my tiers, and the rest goes back".

Nothing changes above the line. The tiers are counted in the same order, a proposal is funded when its backers hold enough to cover its cost, and they pay for it in proportion to what they hold.

## A small example

Three proposals: Audit and Bounty cost $3,000 each, Catalog costs $2,000. Three voters share a $7,000 pool.

| Voter | Share | Ballot |
| --- | --- | --- |
| Ana | $2,000 | Audit. Nothing else placed. |
| Ben | $3,000 | Bounty first, then Audit and Catalog together. |
| Cleo | $2,000 | Bounty and Catalog first, then Audit. |

Bounty is funded first in both cases, paid by Ben and Cleo. Ben has $2,000 left and Cleo nothing. What happens next depends on Ana's unplaced proposals.

| | Today | Ana withholds Bounty and Catalog |
| --- | --- | --- |
| Backing for Audit | $4,000 (Ana and Ben) | $4,000 (Ana and Ben) |
| Backing for Catalog | $4,000 (Ben, plus Ana's leftover) | $2,000 (Ben) |
| Funded next | Catalog: a tie, and it is cheaper | Audit: it has more backing |
| Ana pays | $1,000 for Catalog | $1,000 for Audit |
| Then | Audit is $1,000 short and fails | Catalog has no money behind it and fails |
| Result | Bounty and Catalog | Bounty and Audit |

Today Ana pays for a proposal she never placed, and the one proposal she asked for fails. With withholding she gets Audit, and her remaining $1,000 goes back to TheDAO.

## What it changes in a round

The more voters withhold, the more money goes back and the less is spent on proposals the payers did not choose. We simulated 30 rounds on the 49 initiatives of TheDAO Security Fund, with a $1,000,000 pool and 200 invented voters who each place between 9 and 23 proposals.

| What voters do with unplaced proposals | Proposals funded | Spent | Returned | Paid for proposals the payer did not place |
| --- | --- | --- | --- | --- |
| Nobody withholds (today) | 24.0 | $981,000 | $19,000 | $73,000 |
| A quarter withhold everything | 23.4 | $962,000 | $38,000 | $55,000 |
| Half withhold everything | 22.8 | $939,000 | $61,000 | $36,000 |
| Everyone leaves their next 10 open | 21.7 | $923,000 | $77,000 | $20,000 |
| Everyone leaves their next 5 open | 21.2 | $900,000 | $100,000 | $8,000 |
| Everyone withholds everything | 20.3 | $872,000 | $128,000 | $0 |

If every voter withholds everything they did not place, about 13% of the pool goes back and about four fewer proposals are funded. Those are the proposals that today get through on leftover money.

A voter who withholds alone does not lose by it. In 360 tries, what that voter had placed was funded the same in 358 and better in 2.

The voters are invented, so the share returned depends on how many proposals real voters place. Longer ballots return less.

## What withholding is not

**It is not a veto.** A voter only withholds their own share. If other voters hold enough to pay for a proposal, it is funded all the same, and the voter who withheld pays nothing towards it.

**It does not make leftover money smarter.** Among the proposals a voter leaves unplaced and does not withhold, leftover money still goes to the cheapest first. Withholding narrows that set; it does not rank it. A voter who cares which of them is funded should place it in a tier.

**It does not stop a group from acting together.** A group can agree to withhold from a rival's proposal. That takes only their own leftover away from it, which is what the feature is for.

**It leaves some money unspent on purpose.** A round can end with money left and proposals that money could have paid for. That is the voters saying they would rather have it back.

## Why it is still the same algorithm

Blossom Budgeting uses the tally of Aziz and Lee (2021), which comes with a proportionality guarantee. Withholding does not change that tally. It changes what a ballot says.

Read a ballot with withholding as a longer ballot with one extra candidate, Return to TheDAO:

- The voter ranks Return below everything they placed or left open, and above everything they withheld. In words: "I would rather have the money back than fund these."
- Return sits at the same position on every ballot, just after the longest ballot anyone could write. Where a ballot is shorter, the positions in between are filled with placeholder candidates that cost more than the whole pool, so they can never be funded.
- Return costs whatever the voters have left when the tally reaches it. It opens for everyone at once, takes all of it, and the withheld proposals come after it, when nobody has money.

The original tally run on those longer ballots funds the same proposals, in the same order, as the tally with withholding. So the guarantee carries over, with one change in what it says: a group gets its proportional share of what it placed or left open, and the rest of its share goes back.

Two things differ from the paper, and both are deliberate:

- **How an unranked proposal is read.** The paper puts every unranked candidate in a tied last tier. That is still the reading for unplaced proposals. A withheld proposal is one the voter has ranked, below Return.
- **Return's cost is not known in advance.** The paper takes every cost as given. Here Return costs what is left. Nothing before Return's position depends on its cost, so the tally can run, read off what is left, and that is the cost under which the same run is a valid run of the original algorithm.

## Sources

- Aziz, H., and Lee, B. E. 2021. [Proportionally Representative Participatory Budgeting with Ordinal Preferences.](https://ojs.aaai.org/index.php/AAAI/article/view/16646/16453) Proceedings of AAAI 2021. The tally and its proportionality guarantee.
- [How the vote works · Blossom Budgeting](https://blossom.software/budgeting/), Blossom Labs: the tiered ballots this change builds on.

The example and the simulated voters are invented for illustration. The 49 initiatives and their costs are those of TheDAO Security Fund, with asks reduced by 25% and capped at $200,000.
