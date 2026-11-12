# Vote screens: results and mid-vote — design

2026-11-11. Branch `vote`. Follows the [vote design](2026-11-11-vote-design.md) and the
[ballot rules](2026-11-11-ballot-rules-design.md). Covers two states of the vote results
page (`VoteResults`, on `/` for the real vote, `/vote` for a test vote): **after the vote
closes** and **while it runs**. Copy rules carry over: "vote results", never "projector";
always "Tier-S", the bare letter only in the tier table.

## 1. Results screen (round closed, `rv.closed`)

### What it shows

- **Only qualifying projects:** the round's initiatives (`ROUND.slugs` plus projects added
  mid-vote). Nothing else from the board, as today.
- **Two lists**, in this order:
  1. **Funded** — every project with an award in a settled tier. Sorted by tier
     (Tier-S, then A, then B), then by the order the tally funded them.
  2. **Not funded** — the rest. Sorted by how far they got (% of the ask covered by what
     they raised), largest first.
  Each list has a heading with its count, e.g. "Funded · 7" and "Not funded · 12".
  The board's filter bar and sort control are hidden on this screen: the split is the order.
- **The hero keeps the pool line:** total spent vs. the pool, e.g. "$600K of $900K"
  (sum of settled awards against `ROUND.poolUsd` plus later increases). The tiers'
  breakdown ("Tier-S: $X to N initiatives · …") stays under it.

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
e.g. **"$42K to Tier-S"**. This replaces the amount line as the card's headline figure
during the vote.

- *Next tier* = the tier above the one it is funded in now (live tally, `rv.live.tiers`):
  funded in A → Tier-S; funded in B → A; not funded → Tier-B. Funded in Tier-S, or its target tier is
  settled: no number, just the tier chip ("Tier-S" / "Settled in A").
- *How much* = the smallest extra backing, in USD of voters' shares placed at that tier,
  that makes the tally fund it at that tier's stage. Computed by re-running the stage
  tally (`shared/vote/stage.ts` `stageTally`) with one added phantom ballot that
  ranks only this project, at the target tier, with weight `w`; binary search on `w`
  to $1K precision, rounded **up** (like `VoteMark`'s `upShort`, never reads as less
  than it is). Budget unchanged.
- If no `w` up to the remaining pool works (the project doesn't fit the budget left
  at that stage), show "Out of reach for Tier-S" instead of a number.
- Computed on the client from the ballots the page already polls, with the same
  inputs as the live tally; recomputed on each poll (5 s). Must stay under ~50 ms for
  ~40 projects × ~12 search steps; otherwise move it to `/api/vote/round` and cache per
  tally.

### Hover: the knock-on effect

Hovering (focus or tap on phones) the "to Tier-S" figure opens a popover with the
tally re-run at that `w`:

- **Comes in:** projects newly funded (anywhere), with their tier.
- **Drops out:** projects no longer funded, with the tier they lose.
- **Moves:** projects that stay funded but change tier (optional line, only if any).
- "Nothing else changes" when the sets match.

Settled tiers never appear in either list (they're locked). The popover is a
`role="tooltip"`; the figure is a button with an `aria-describedby`, so keyboard and
screen readers get the same text.

### Messaging: there may be no Tier-B

Voters should expect that Tier-B may fund nothing if ballots don't spread across enough
projects (the pool is spent on S and A, or B's backing is too thin to cover any need).

- **Ballot page** (`TierBallot`), next to the B column: "Tier-B is funded only if the
  pool lasts and enough voters back the same projects. It may fund nothing."
- **Vote results hero**, before B starts: when the live tally funds nothing in B, the
  stage line says "Tier-B: nothing funded yet, the pool may not reach it."
- **Results screen**, if B funded nothing: the tier line says "Tier-B: no projects
  funded", not omitted.

### Acceptance

- A project funded in A shows "$X to Tier-S"; adding a test ballot of `X` (rounded)
  at Tier-S to the fixture funds it in the S stage; `X − $1K` does not.
- Hover lists match a diff of funded sets between the live tally and the phantom tally
  (unit test against `quiet-ending.test.ts` fixtures).
- Tier-S projects and settled tiers show no figure.
- With a fixture where B funds nothing, all three B messages render.

## Decisions (2026-11-11)

1. **Backers and sponsors stay** on the results screen. "Raised" is replaced by the final amount.
2. **"279K" is the final total**: what the initiative raised plus its vote award (its ask, when funded).
3. **The phantom ballot is good enough** for the gap and the knock-on, even though real voters moving an initiative up also bring backing they had given to others.
4. **Unfunded initiatives show the gap to the next tier up** (Tier-B), not always to Tier-S.

## 3. What-ifs on every initiative (2026-11-12)

Asked after seeing the screens: every initiative should say how close it is to the next
tier, Tier-S initiatives how far ahead they are, and an unfunded initiative's "needed $X"
what would happen if it went in.

### Decisions
5. **After the vote, each figure is judged at the settlement that decided it**, with the
   ballots, needs and remaining shares of that moment (the replay's inputs as that tier
   settled). Earlier tiers stay locked.
6. **"Ahead" for Tier-S = how much less its backers could give** between them and it would still be funded in Tier-S, in $1K
   steps rounded **down** (for a loss spread evenly; one backer pulling out can hurt more).
7. **The figures show during the vote too**: Tier-S initiatives show their lead; the
   others keep their gap. The final result shows the same figures frozen at each settlement.

### What each initiative shows (final result)
- **Tier-S:** "$12k ahead" — judged at Tier-S's settlement.
- **Tier-A / Tier-B:** "$Xk to Tier-S" / "$Xk to Tier-A" with the hover — judged at the
  settlement of the tier above (that's where it would have had to win).
- **Not funded:** "needed $X" (ask − raised) becomes the hover's trigger: "With $G more
  backing it would have made Tier-B", and which initiatives it would have pushed out —
  judged at Tier-B's settlement.
- **Knock-on lists after the vote only cover the target tier** (who would have come into
  or dropped out of it): lower tiers were decided later, so where a dropped initiative
  would finally have landed isn't known. The hover says "drops out of Tier-S".
- A tier that settled with nothing to compare against (no ballots) shows no figure.

### During the vote
- Tier-S initiatives (while Tier-S is open) show "$12k ahead"; everything else as before.

### How "ahead" is measured
Take L away from the initiative's backers, spread evenly: each gives up a share of L in
proportion to their weight (exact integer shares, any remainder on the last backer, as
the tally deducts payments). A backer is a voter whose rank for it opens within Tier-S's
stage; a voter who left it unplaced, ranked past that, is not one. Cost and pool stay as
they are. L is the largest $1K step (rounded down) at which it is still funded in
Tier-S, found by a search that only returns a step it has checked; the most it can be is
everything its backers hold. Less backing lowers its support, so a rival that shares its
backers can now be picked before it, and the lead counts that.

So "$12k ahead" reads "still funded in Tier-S if its backers gave $12k less, spread
evenly". It is one scenario: the same loss from a single backer can be worse (that
backer may also be what kept a rival behind, or carry most of its support), and the
initiative can drop out with less.

## 4. The what-ifs on the bar (2026-11-12)

Asked after seeing section 3 on screen: the figures should read like the bar's "qualify"
mark, not like links.

### Decisions
8. **A tick on the bar marks where the next tier is reached**, on the bar's own scale
   (the ask): at **raised by donors and pledgers + the gap**, capped at the bar's end.
   E.g. raised $0, ask $44k, "$23k to Tier-S" → the tick at 52%. Tiered rows and
   not-funded rows both get one; Tier-S (nothing above) and out-of-reach rows don't.
9. **The callout is the "qualify" callout** (`VoteCallout`'s look: panel, border, arrow on
   the tick): it shows on hover or tap of the row/card (`useVoteReveal`), the tick always.
   - Content: the value big, the words small — `<big>$23k</big> <small>to Tier-S</small>`,
     `<big>$46k</big> <small>ahead</small>` — then the knock-on lines when there are any
     ("Comes into Tier-S: …", "Drops out of Tier-S: …"; during the vote "Comes in" /
     "Drops out" / "Moves"), or "Nothing else changes."; Tier-S adds "Its backers could
     give this much less between them and it would still be funded in Tier-S."
   - Tier-S and out of reach: the callout sits at the bar's end, without a tick.
10. **Not funded shows its gap to Tier-B**, not "needed $X": tick + callout
    "<big>$186k</big> <small>to Tier-B</small>" and who it would have pushed out.
11. **The vote results list drops its Funded column** (the tick and callout carry it);
    the board outside the vote keeps it. The not-funded section's columns read
    Initiative · Backers · Raised; the tier sections' Initiative · Backers · Final.
12. **Figures are plain text**: no underline, no help cursor, no button look. On cards the
    figure stays in the amount row as `<big>value</big> <small>words</small>` with room
    around it; the details live in the bar's callout.

### Acceptance
- A Tier-A row with raised $0, ask $44k, gap $23k draws its tick at 52.3%; hovering the
  row shows the callout "$23k to Tier-S" with its knock-on.
- A not-funded row shows no "needed"; its tick is at (raised + gap) / ask.
- Tier-S rows: no tick; hover shows "$46k ahead" and the explanation at the bar's end.
- The vote results list has no Funded column; the board's list still has it.
- No figure has an underline, a help cursor, or a button.
