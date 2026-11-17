# Vote screens: results and mid-vote — design

2026-11-11. Branch `vote`. Follows the [vote design](2026-11-11-vote-design.md) and the
[ballot rules](2026-11-11-ballot-rules-design.md). Covers two states of the vote results
page (`VoteResults`, on `/` for the real vote, `/vote` for a test vote): **after the vote
closes** and **while it runs**. Copy rules carry over: "vote results", never "projector";
always "S-Tier", the bare letter only in the tier table.

## 1. Results screen (round closed, `rv.closed`)

### What it shows

- **Only qualifying projects:** the round's initiatives (`ROUND.slugs` plus projects added
  mid-vote). Nothing else from the board, as today.
- **Two lists**, in this order:
  1. **Funded** — every project with an award in a settled tier. Sorted by tier
     (S-Tier, then A, then B), then by the order the tally funded them.
  2. **Not funded** — the rest. Sorted by how far they got (% of the ask covered by what
     they raised), largest first.
  Each list has a heading with its count, e.g. "Funded · 7" and "Not funded · 12".
  The board's filter bar and sort control are hidden on this screen: the split is the order.
- **The hero keeps the pool line:** total spent vs. the pool, e.g. "$600K of $900K"
  (sum of settled awards against `ROUND.poolUsd` plus later increases). The tiers'
  breakdown ("S-Tier: $X to N initiatives · …") stays under it.

### Each project's card

- **Amount:** replace "raised X of Y" with one figure, the final completed amount, short
  form (`usdShort`): e.g. **"279K"**.
  - Funded: what it ends with, raised + vote award (equal to its ask, since the vote
    covers the remaining need in full).
  - Not funded: what it raised.
- **Tier chip** on funded cards (existing `VoteTierChip`); none on not-funded cards.
- **Removed:** the "Qualified for the vote" callout/tick (`VoteMark`) — every project
  shown qualified, so it says nothing. The vote filter option "Qualified for the vote"
  goes with the filter bar.
- **Hidden:** the project type label (`CardLabel`).
- **Bar:** kept: green for raised, gold for the vote's share. Not-funded cards show
  green only.
- **Backers and sponsors:** both stay (backer count on the card, Sponsors strip on the
  page). See decision 1.

### Acceptance

- Closed round with N funded / M not funded renders two headed lists with N and M cards,
  no project outside the round.
- No card contains "of $", "Qualified", or a type label.
- Hero reads "$<spent> of $<pool>".
- Phone width: lists stack, headings stay visible above each list.

## 2. Mid-vote screen (round open)

### The one number: what it takes to reach the next tier

Each project card shows **how much more backing it needs to be funded one tier higher**,
e.g. **"$42K to S-Tier"**. This replaces the amount line as the card's headline figure
during the vote.

- *Next tier* = the tier above the one it is funded in now (live tally, `rv.live.tiers`):
  funded in A → S-Tier; funded in B → A; not funded → B-Tier. Funded in S-Tier, or its target tier is
  settled: no number, just the tier chip ("S-Tier" / "Settled in A").
- *How much* = the smallest extra backing, in USD of voters' shares placed at that tier,
  that makes the tally fund it at that tier's stage. Computed by re-running the stage
  tally (`shared/vote/stage.ts` `stageTally`) with one added phantom ballot that
  ranks only this project, at the target tier, with weight `w`; binary search on `w`
  to $1K precision, rounded **up** (like `VoteMark`'s `upShort`, never reads as less
  than it is). Budget unchanged.
- If no `w` up to the remaining pool works (the project doesn't fit the budget left
  at that stage), show "Out of reach for S-Tier" instead of a number.
- Computed on the client from the ballots the page already polls, with the same
  inputs as the live tally; recomputed on each poll (5 s). Must stay under ~50 ms for
  ~40 projects × ~12 search steps; otherwise move it to `/api/vote/round` and cache per
  tally.

### Hover: the knock-on effect

Hovering (focus or tap on phones) the "to S-Tier" figure opens a popover with the
tally re-run at that `w`:

- **Comes in:** projects newly funded (anywhere), with their tier.
- **Drops out:** projects no longer funded, with the tier they lose.
- **Moves:** projects that stay funded but change tier (optional line, only if any).
- "Nothing else changes" when the sets match.

Settled tiers never appear in either list (they're locked). The popover is a
`role="tooltip"`; the figure is a button with an `aria-describedby`, so keyboard and
screen readers get the same text.

### Messaging: there may be no B-Tier

Voters should expect that B-Tier may fund nothing if ballots don't spread across enough
projects (the pool is spent on S and A, or B's backing is too thin to cover any need).

- **Ballot page** (`TierBallot`), next to the B column: "B-Tier is funded only if the
  pool lasts and enough voters back the same projects. It may fund nothing."
- **Vote results hero**, before B starts: when the live tally funds nothing in B, the
  stage line says "B-Tier: nothing funded yet, the pool may not reach it."
- **Results screen**, if B funded nothing: the tier line says "B-Tier: no projects
  funded", not omitted.

### Acceptance

- A project funded in A shows "$X to S-Tier"; adding a test ballot of `X` (rounded)
  at S-Tier to the fixture funds it in the S stage; `X − $1K` does not.
- Hover lists match a diff of funded sets between the live tally and the phantom tally
  (unit test against `quiet-ending.test.ts` fixtures).
- S-Tier projects and settled tiers show no figure.
- With a fixture where B funds nothing, all three B messages render.

## Decisions (2026-11-11)

1. **Backers and sponsors stay** on the results screen. "Raised" is replaced by the final amount.
2. **"279K" is the final total**: what the initiative raised plus its vote award (its ask, when funded).
3. **The phantom ballot is good enough** for the gap and the knock-on, even though real voters moving an initiative up also bring backing they had given to others.
4. **Unfunded initiatives show the gap to the next tier up** (B-Tier), not always to S-Tier.

## 3. What-ifs on every initiative (2026-11-12)

Asked after seeing the screens: every initiative should say how close it is to the next
tier, S-Tier initiatives how far ahead they are, and an unfunded initiative's "needed $X"
what would happen if it went in.

### Decisions
5. **After the vote, each figure is judged at the settlement that decided it**, with the
   ballots, needs and remaining shares of that moment (the replay's inputs as that tier
   settled). Earlier tiers stay locked.
6. **"Ahead" for S-Tier = how much less its backers could give** between them and it would still be funded in S-Tier, in $1K
   steps rounded **down** (for a loss spread evenly; one backer pulling out can hurt more).
7. **The figures show during the vote too**: S-Tier initiatives show their lead; the
   others keep their gap. The final result shows the same figures frozen at each settlement.

### What each initiative shows (final result)
- **S-Tier:** "$12k ahead" — judged at S-Tier's settlement.
- **A-Tier / B-Tier:** "$Xk to S-Tier" / "$Xk to A-Tier" with the hover — judged at the
  settlement of the tier above (that's where it would have had to win).
- **Not funded:** "needed $X" (ask − raised) becomes the hover's trigger: "With $G more
  backing it would have made B-Tier", and which initiatives it would have pushed out —
  judged at B-Tier's settlement.
- **Knock-on lists after the vote only cover the target tier** (who would have come into
  or dropped out of it): lower tiers were decided later, so where a dropped initiative
  would finally have landed isn't known. The hover says "drops out of S-Tier".
- A tier that settled with nothing to compare against (no ballots) shows no figure.

### During the vote
- S-Tier initiatives (while S-Tier is open) show "$12k ahead"; everything else as before.

### How "ahead" is measured
Take L away from the initiative's backers, spread evenly: each gives up a share of L in
proportion to their weight (exact integer shares, any remainder on the last backer, as
the tally deducts payments). A backer is a voter whose rank for it opens within S-Tier's
stage; a voter who left it unplaced, ranked past that, is not one. Cost and pool stay as
they are. L is the largest $1K step (rounded down) at which it is still funded in
S-Tier, found by a search that only returns a step it has checked; the most it can be is
everything its backers hold. Less backing lowers its support, so a rival that shares its
backers can now be picked before it, and the lead counts that.

So "$12k ahead" reads "still funded in S-Tier if its backers gave $12k less, spread
evenly". It is one scenario: the same loss from a single backer can be worse (that
backer may also be what kept a rival behind, or carry most of its support), and the
initiative can drop out with less.

## 4. The what-ifs on the bar (2026-11-12)

Asked after seeing section 3 on screen: the figures should read like the bar's "qualify"
mark, not like links.

### Decisions
8. **A tick on the bar marks where the next tier is reached**, on the bar's own scale
   (the ask): at **raised by donors and pledgers + the gap**, capped at the bar's end.
   E.g. raised $0, ask $44k, "$23k to S-Tier" → the tick at 52%. Tiered rows and
   not-funded rows both get one; S-Tier (nothing above) and out-of-reach rows don't.
9. **The callout is the "qualify" callout** (`VoteCallout`'s look: panel, border, arrow on
   the tick): it shows on hover or tap of the row/card (`useVoteReveal`), the tick always.
   - Content: the value big, the words small — `<big>$23k</big> <small>to S-Tier</small>`,
     `<big>$46k</big> <small>ahead</small>` — then the knock-on lines when there are any
     ("Comes into S-Tier: …", "Drops out of S-Tier: …"; during the vote "Comes in" /
     "Drops out" / "Moves"), or "Nothing else changes."; S-Tier adds "Its backers could
     give this much less between them and it would still be funded in S-Tier."
   - S-Tier and out of reach: the callout sits at the bar's end, without a tick.
10. **Not funded shows its gap to B-Tier**, not "needed $X": tick + callout
    "<big>$186k</big> <small>to B-Tier</small>" and who it would have pushed out.
11. **The vote results list drops its Funded column** (the tick and callout carry it);
    the board outside the vote keeps it. The not-funded section's columns read
    Initiative · Backers · Raised; the tier sections' Initiative · Backers · Final.
12. **Figures are plain text**: no underline, no help cursor, no button look. On cards the
    figure stays in the amount row as `<big>value</big> <small>words</small>` with room
    around it; the details live in the bar's callout.

### Acceptance
- An A-Tier row with raised $0, ask $44k, gap $23k draws its tick at 52.3%; hovering the
  row shows the callout "$23k to S-Tier" with its knock-on.
- A not-funded row shows no "needed"; its tick is at (raised + gap) / ask.
- S-Tier rows: no tick; hover shows "$46k ahead" and the explanation at the bar's end.
- The vote results list has no Funded column; the board's list still has it.
- No figure has an underline, a help cursor, or a button.

## 5. Addendum: exact gaps and the green numbers (Nov 16, 2026)

The donation and extra-backing gaps can be calculated from thresholds along a tally
trace, without binary search. The green **ahead** numbers measure a different change
to the inputs and need a separate solution. This addendum records the derivation and
a reproduced lead-search limitation; it does not change the application or choose a
new meaning for "ahead".

### The figures the application currently computes

| Figure | Input changed | Scope | Precision |
| --- | --- | --- | --- |
| Red donation gap (`live.give`, `giftGaps`, `giftGapTo`) | Reduce this initiative's ask | Reach the target tier or higher across the open tiers | $10 up in the live list; `giftGapTo` accepts a step |
| Extra-backing gap (`live.next`, `gapTo`) | Add one voter backing only this initiative at rank 1; leave `ballots` and the pool unchanged | Reach the target tier or higher | $1K up |
| Green live lead (`live.lead`, `liveLeads`) | Reduce its existing backers' weights proportionally | Remain funded in the tier settling now | $10 down |
| Final lead (`final.lead`, `leadIn`) | The same proportional loss, using settlement inputs | Remain funded in S-Tier at its settlement | $1K down |

The live green figures now apply to whichever tier is settling, including A-Tier and
B-Tier. This updates section 3's original restriction to S-Tier. A zero live lead shows
"In {tierName(tier)}" without a green dollar pill. Covered, withdrawn and already
settled initiatives do not get a live lead. The green figure is a backing-loss scenario,
not excess donations, a refund amount, or the inverse of the red donation gap.

Source: `shared/vote/next-tier.ts` (`giftSearch`, `gapSearch`, `leadSearch`),
`shared/vote/stage.ts`, and `app/components/vote/GiveList.tsx` (`RowFigure`).

### Exact donation and extra-backing gaps

Until the initiative is selected, changing only its cost or adding a voter who backs
only it cannot change any other selection or payment. Run the baseline tally through
the target tier and inspect each decision point before that initiative is selected.
For initiatives seeking a higher tier, these prefixes can be shared across initiatives.
More generally, run the trace with the subject excluded from selection, keeping the
original ballots, ranks and stage bounds, and calculate its support from the remaining
weights at each point.

At decision point `j`, let `C` be the subject's original ask, `s_j` its remaining
support, `r_j` the remaining pool, and `b_j` the best eligible rival. The tally selects
the greatest support, then the smaller ask, then the earlier manifest index. All
arithmetic below is integer micro-USD; a strict inequality costs `1n`, not one dollar.

For a donation, the largest positive ask that would win at that point is:

```text
q_j = min(s_j, r_j)                         if no rival exists, or s_j > support(b_j)
q_j = min(s_j, r_j, cost(b_j) - epsilon)     if s_j = support(b_j)
no opportunity                             if s_j < support(b_j)

epsilon = 0 if the subject precedes b_j in manifest order, otherwise 1 micro-USD
q       = max of the positive q_j through the target tier
gift    = h * max(1, ceil(max(0, C - q) / h))
```

`h` is the caller's step ($10 for the live list). No positive `q`, or a rounded gift
`>= C`, means no donation-only entry into the target: a zero ask is covered by
donations and excluded from the tiers. The minimum of one step preserves the current
positive-gap API; a caller asking about an already reached tier should handle that
case explicitly.

For extra backing, inspect only points with `C <= r_j`:

```text
x_j = max(0, C - s_j, support(b_j) - s_j + epsilon_j)

epsilon_j = 1 micro-USD if the subject loses an equal-support tie to b_j,
            considering its unchanged ask and manifest order; otherwise 0
gap       = h * max(1, ceil(min(x_j) / h))
```

Omit the rival term when there is no eligible rival. Here `h = $1K`; retain the
existing cap `floor((poolUsd - spent) / h) * h` and the settled, covered and withdrawn
exclusions. An empty set of opportunities or a gap above that cap gives `null`.

The trace must inspect every permitted rank opening, including those after the
ordinary tally stops because no current ask fits the remaining pool. A reduced ask
can fit there and acquire support at a later opening. After calculating a gap, run
the modified tally once to obtain the exact knock-on lists. Preserve the final
figures' target-only diff and the live figures' diff across open tiers.

The reason the minimum works is the first changed decision: if a modification wins
earlier than the point used by the formula, it has already reached the target or a
higher tier. Otherwise the unmodified prefix remains valid up to that point. This
argument concerns the subject's entry, not whether everyone else's tier improves.

A scratch prototype matched exhaustive enumeration and the existing binary searches
for 5,579 eligible initiative/target combinations across 1,200 generated rounds,
using $10 and $1K steps, integer boundary amounts, valid competition ranks, pool
limits, and settled/withdrawn exclusions. This is evidence for the gap derivation,
not validation of a replacement for the green leads. Commit equivalent regression
coverage when implementing it.

### Green numbers: the exact loss scenario

For the tier being measured, take the backers whose effective rank for the initiative
opens within that stage's bound. Use their weights at the start of the stage, in voter
order, exactly as `leadSearch` does. Let their weights be `w_1 ... w_n`, their total
`W`, and `P_i = w_1 + ... + w_i`, with `P_0 = 0`. For a tested loss `L`:

```text
deduction_i(L) = floor(P_i * L / W) - floor(P_(i-1) * L / W)
weight_i(L)    = w_i - deduction_i(L)
F(L)          = the initiative is funded by the target stage using these weights
```

Other voters' weights, asks, pool and earlier settlements stay fixed. The deductions
sum exactly to `L`; this is `cumulativeDeductions`, including its integer rounding.
If `W = 0`, do not divide: evaluate the unchanged tally only. An initiative not funded
at `L = 0` has no lead (`null`).

Reducing these weights also reduces support for rivals sharing the same backers,
and changes their proportional payments. Therefore other decisions can change
before the subject wins. The unchanged-prefix argument for the gap formulas does
not apply. Neither `support - ask` nor reversing the phantom-gap formula computes
the green figure in general.

### A reproduced non-monotone green lead

This fixture uses two initiatives and two voters, with a $100,000 pool, no earlier
spend, no settled or withdrawn initiatives, and S-Tier as the open tier:

| Item | Ask or weight | Ballot |
| --- | --- | --- |
| Subject, manifest index 0 | $15,000 ask | — |
| Rival, manifest index 1 | $30,000 ask | — |
| Voter 0 | $50,000 weight | Both in S-Tier: `[1, 1]` |
| Voter 1 | $10,000 weight | Subject withheld, rival in S-Tier: `[255, 1]` |

The subject has only voter 0 as a backer, so all of the tested loss comes from that
voter. Re-running the actual `chainTally` gives:

| Backing removed | Subject funded in S-Tier? |
| --- | --- |
| $0 | Yes |
| $10,000 | Yes |
| $11,130 | Yes |
| $11,140 | No |
| $12,000 | No |
| $25,000 | No |
| $30,000 | No |
| $30,010 | Yes |
| $35,000 | Yes |
| $35,010 | No |

Initially the rival is selected first and spends some of their shared backer's
weight. Beyond a $30,000 loss, the rival cannot cover its own ask, so the subject
can win again. Exhaustive checks of all 5,001 $10 steps from $0 to $50,000 find the
first failure at $11,140, recovery at $30,010, and the last success at $35,000.
The current `liveLeads` returns $11,130 for this fixture.

This demonstrates why checking only the returned amount and the next step is
insufficient to establish a global maximum. The current binary search retains a
verified success, but it can skip later successful intervals. It also does not check
all smaller losses, so it cannot generally establish a safe buffer.

The opposite failure is reproducible too: keep the same voters, ballots and pool,
but use a $7,000 subject ask and a $50,000 rival ask. `liveLeads` returns **$43,000**,
yet the first failing $10 step is **$1,560**, and a $2,000 loss leaves the subject
unfunded. The reported $43,000 loss does fund it again. This is a valid single loss
scenario but would overstate a safe buffer, which is only $1,550 on this step grid.

### What a future green calculation must promise

There are two distinct quantities on the supported step grid `0, h, ... floor(W/h)*h`:

```text
largest successful loss = max { L : F(L) }
safe buffer             = max { L : F(x) for every grid amount 0 <= x <= L }
```

For the fixture above these are **$35,000** and **$11,130**, respectively. Section 3
describes the first quantity; the word "ahead" can be read as the second. Recommend
the safe buffer for a safety-margin interpretation, but settle that product meaning
explicitly before changing the calculation or copy. This addendum records the
distinction without silently changing the existing definition. Neither definition
guarantees safety when a different mix of backers withdraws.

Only in a restricted case where all relevant support is available together, no rival
spends any of those backers' weights before selection, and the pool is guaranteed to
fit the initiative throughout the loss range, does the lead reduce to
`h * floor((W - C) / h)`. The general proportional-loss case needs a separately
proved method that handles changing winners, payments and integer rounding. Until
then, describe the current result as a verified loss scenario, not an exact maximum
or guaranteed safe buffer. Do not present the gap optimization as solving leads.
