# The green number: how much it takes to push an initiative out (#98)

Status: design, 2026-11-16. Issue: #98 (spec comment and spike results there).

**Current decision, Nov 16, 2026:** The [correctness addendum](#addendum-checked-threats-and-entry-probes-nov-16-2026)
supersedes the original claims of a smallest green number, "ahead", "safe", and
minimum or guaranteed safety-improving jump suggestions below. The donation-based
definition remains the research target; the shipped search reports checked threats.

## Intent

On the vote results page (`/vote` for a test round, the front page for the real one),
the list "What it takes to move up" shows every open initiative. Red rows are below
the tier settling now, with the donation that moves them up. Green rows are in the
tier settling now, with a green number: today, "$800 ahead".

Today's green number is how much backing an initiative could lose, spread over its own
backers, and still be funded in that tier. Readers take it as a safety margin, and then
see a "$800 ahead" initiative drop out when a red one moves up. That happens because a
donation to another initiative lowers that initiative's cost, gets it paid earlier, and
takes money from voters who back both and room from the pool. The current number does
not look at that at all.

The maintainer's decision: keep the green rows (no reorder, which is what #98 first
asked for) and give the green number a meaning that matches the risk the page invites,
donations.

## Goals

- **Green number** = the smallest single donation to any other open initiative (red or
  green) that pushes this one out of the tier settling now, if the vote ended now.
  "Safe from any single donation" when none does.
- **Jump chips on green rows**: the donations to the green initiative itself at which
  its number jumps, ending at "safe", then the #102 cap ("to be funded").
- **Typed amount**: on an open green row, the form says what the amount does to the
  number.
- **Two green rows show** at the top of the list, with a link above them that expands
  the rest.
- Works for rounds of at least 60 initiatives without slowing the server down noticeably.

## Non-goals

- Naming the other initiative, or previewing what its donation would do. The row is
  about what helps this one. Naming it would point donors at the exact donation that
  knocks it out, and the claim only holds for a range of amounts. Red rows keep their
  knock-on lists as they are.
- Two or more donations together: the number is for one donation to one initiative.
- The closed round's results: their "$X ahead" figures (`final.lead`, judged at each
  settlement) stay as they are.
- #99 (only qualifying initiatives in test rounds): it isn't needed for this, and it's a
  separate issue.

## Anti-goals

- A number that promises "+$1,000 ahead for $1,000 given". It moves in jumps: unchanged,
  much higher, or safe.
- Any search a visitor can make the server run on demand. The server only works from
  on-chain changes, as it does now.
- Telling donors which initiative to give to in order to push another out.

## What the spikes found (16 Nov, scripts in the session scratchpad, results on #98)

- Reading the number from the red rows' knock-ons does not work (0 of 10 right on the
  real round). It needs its own search.
- Donations to other green initiatives count: 9 of 57 drop cases on the real round.
- Only an initiative that, with the donation, is funded in the tier settling now ever
  pushes one out (no exception in any run). A green one already is, so this is no reason
  to skip green initiatives: they are searched like the others.
- The danger is a range of amounts, not a threshold: e.g. $20k to $28k to one initiative
  pushes another out, $30k or more lets it back in.
- Giving to a green initiative never made it less safe (952 checks); it reaches "safe" in
  1 to 4 jumps.
- On the real round (96 initiatives) 11 of 21 green initiatives are safe from any single
  donation.
- $1k steps can jump over a narrow danger range: on the real round one row read "$166k
  ahead" when about $44k (a range under $1k wide) pushed it out. $250 steps caught it;
  $100 steps found nothing more. No "safe" verdict changed at finer steps.
- Speed of the fast search below ($1k steps), identical to brute force initiative by
  initiative. At $250 steps the green numbers took 1.8 s (60) and 3.2 s (96) on a cold
  run:

  | | 60 initiatives | 96 |
  |---|---|---|
  | red figures today (`giftGaps`) | 0.26 s | 0.42 s |
  | "ahead" today (`liveLeads`) | 0.02 s | 0.04 s |
  | new green numbers, all rows ($1k steps) | 0.27 s | 0.55 s |
  | jump chips, one row | 2–4 s | 2–7 s |

## Approaches considered

1. **Green numbers on the server, jump chips in the browser** (chosen). The green
   numbers replace today's "ahead" search in the server's background work, after each
   on-chain change. With $250 steps the server's work per change goes from about 0.5 s
   to 2–4 s at 60–96 initiatives (still one search at a time, after on-chain changes
   only), and they show on first paint. The jump
   chips, seconds per row, run only in the browser of someone who opens a green row.
2. **Everything on the server.** Jump chips for all rows take about 50 s at 96
   initiatives after every change; a stream of cheap on-chain events (tiny donations,
   re-sent ballots) would keep the server busy. Rejected for that DoS risk.
3. **Everything in the browser.** The server does less than today, but every visitor
   spends up to a second or more before the green pills appear, and they are blank on
   first paint. Kept as the fallback if the server's doubled work turns out to matter.

Also considered and dropped: reading the number from the red rows' knock-ons (wrong,
see spikes); a Rust/WASM tally (a tally is 0.3–0.6 ms; the search, not the tally, was
the cost, and a third tally implementation would need its own parity fixtures).

## The search

All amounts micro-USD bigints, as the rest of `shared/vote/next-tier.ts`.

- **The number is searched in $250 steps** (maintainer's decision, after the $1k miss
  above), then each hit is narrowed to $10 (`FINE`) between the last step that didn't
  push the row out and the one that did, so the number shown is never above the
  smallest amount found. Shown rounded down, as leads are today.
- "Safe" means no amount on the $250 grid pushes it out. A range narrower than $250
  could still be missed; the spikes found none.

- Only the tier settling now is tallied (`chainTally(inp, first, first + 1)`): later
  tiers don't change whether a row stays in this one.
- **Amounts worth trying for a rival r**: a donation can only bring r in once its cost
  after the donation is at most the most support it could get in this tier (the weights
  of the voters whose rank for r opens within the stage's bound, `stageBound`). So
  start at `cost − that support` (at least one step), up to the last step below its
  cost. A rival with no possible support is skipped. For a green rival that start is
  at or below zero, so its whole range is scanned (the spike timings include this).
- Withdrawn initiatives (on `main` since 899ab0e) are never candidates in the tally, so
  they are never rivals either.
- **All green numbers at once**: one scan per rival; each tally shows every green row
  that drops out. A rival's scan stops once the amount is at or above every green row's
  best so far.
- **One row's number** (for the jumps): every rival's amounts together, smallest first;
  stop at the first that pushes the row out. None: safe.
- **Jump chips**: giving to the green row is treated as monotone (never less safe, per
  the spikes). The amounts to give are searched on a $1k grid (they are suggestions, and
  each check is a whole one-row search), from one step to the last step below its cost;
  the number each chip leads to is then worked out at $250 steps, as the server's.
  *My call: $250 steps throughout would make a row's chips take tens of seconds.* The
  search: the smallest donation after which its number is higher (or safe), and the
  smallest after which it is safe. At most these two chips; when they're the same
  amount, one. The new number at the first chip goes in its label.
- The search treats "reaching" as found, not assumed: as `giftSearch` does today, only
  an amount whose tally was actually checked is ever returned.

## Server

- `live.lead` is replaced by the new figure, worked out in the same background step
  that computes it today (`api/routes/vote.ts`, the `searching` block), with the same
  one-at-a-time rule, the same "being updated" state (`aheadStale`) and a
  `WHAT_IFS_VERSION` bump.
- A green row with no donation that pushes it out must be told apart from a row whose
  figure is missing. Today `leadJson` drops zero leads, and a missing lead reads as "In
  S-Tier". The new figure needs an explicit "safe" value.
- The served figure has a new name, so a page from before the change can't read the
  new meaning as the old one. Naming and JSON shape are the builder's.
- The example pages (`app/components/vote/mock-round.ts`, `withFigures`) compute the
  same figure in the browser, as they compute `lead` today.

## The page

### List order and shared expansion

```
What it takes to move up
S-Tier is the tier settling now. …

Open initiatives · 31 initiatives        [Category ▾]
[ search … ]

● Initiative A   Needs $25,000 · now in S-Tier     $3k  ahead  ˅
● Initiative B   Needs $20,000 · now in S-Tier     $7k  ahead  ˅
● …all other green rows with a checked amount…
● Initiative C   Needs $30,000 · not included    −$4.1k to S-Tier ˅
● …the red rows, as today…
+ 3 more initiatives
```

- All green rows with a checked amount remain visible, smallest amount first.
- Green rows with no displacement found (`null`) are hidden by default. Pending
  figures remain visible until known; they are not treated as completed searches.
- One link below the list reveals the hidden green rows above the red rows and the
  out-of-reach rows below them. It counts both groups and changes to "Show fewer"
  when expanded. There is no separate link above the list.
- Search, category filters and AI ordering reveal all matching rows from both ends.
- An open row stays visible when the list is collapsed. Closing it returns it to
  the hidden group when appropriate.

### A green row, closed

- Pill: green, the checked amount in thousands with up to three significant digits
  ("$62k", "$12.3k"), with "ahead" after it. Keep the exact amount in its hover title.
- With no checked amount, leave the figure area blank. The subtitle still names
  the initiative's current tier.

### A green row, open

Sentence:

- With a number: "**$3,000** given to another initiative could push it out of S-Tier if
  the vote ended now. A donation to it makes that harder." (wording the builder's,
  meaning fixed: one donation, to another initiative, not named.)
- Safe: "No single donation to another initiative pushes it out of S-Tier now. A
  donation lowers what it asks of the pool."

Donate form (`DonateWidget`, or `TestDonate` on a test round):

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│   $500   │ │  $2,000  │ │ $10,000  │ │ $25,000  │
│          │ │ $41k     │ │  safe    │ │ to be    │
│          │ │ ahead    │ │          │ │ funded   │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
With your $2,000, it would take $41,000 given to another initiative to push it out.
```

- The jump chips are the form's `suggested` amounts, labelled with the number they lead
  to ("$41k ahead") or "safe". No chip is picked when the row opens: the field starts
  empty, unlike the red rows, since nothing is missing. *My call.*
- While they are worked out, the form shows the usual chips and a line "Working out what
  a donation does…"; they appear when ready. Opening another row stops the work for the
  first.
- The #102 cap stays the last chip.
- **Typed amount**: after typing pauses, the line under the form says what it does to
  the number, worked out at $250 steps. *My calls on how it fits what's there today:*
  - It replaces today's "It asks the pool for $X less. Nothing else changes." on a green
    row: "It asks the pool for $X less, and it would then take $Y given to another
    initiative to push it out." (or "…, and no single donation to another initiative
    pushes it out.").
  - When the amount also changes other initiatives, TheDAO's ballot preview and its
    sentence above the tier table stay as today, and the line under the form still says
    the number.
  - When the amount covers its whole ask, the existing "covered by donations" wording
    stays and there is no number: it is in no tier.
  - While it is being worked out the line says so; a new amount stops the old work.

### Browser work

The jump chips and the typed-amount line run on `live.inputs`, which the round already
serves, in the browser only. They must not freeze the page: the work is cut in slices
(as `driveAsync(..., sliceMs)` does for the examples) or run in a web worker; the
builder's choice.

## Constraints

- `AGENTS.md`: tier names as S-Tier, A-Tier, B-Tier (via `tierName()`); dates with the
  helpers in `app/lib/format.ts`.
- Red is only for missing money; green rows use green.
- Figures said with `usd2` in pills, `usd` in sentences, as today.
- The server never runs a search because a visitor asked for one.

## Branch

Built on branch `vote-issues`, rebased on `main` (3297b87) on 2026-11-16: it has the
#101 and #102 commits this design relies on (the cap chip) and `main`'s withdrawn
initiatives.

## Left to the builder

- Names, JSON shape and where the new search lives (in `next-tier.ts` or its own module).
- Slicing versus a web worker for the browser work.
- Exact wording within the meanings above, and the expand link's words.
- Test fixtures; the spikes' rounds (the closed test round rebuilt at the S-Tier moment,
  and 60-initiative cuts of it) are good ones to keep as parity checks against a brute
  force.

## Addendum: formulas and the follow-up spike (Nov 16, 2026)

This addendum is for Task 7, final review, and a subsequent formula spike. Tasks 1–5
are complete and Task 6 already has its instructions; this text does not change their
scope. The implementation above remains the $250 scan with checked $10 results and
$1K jump suggestions. Replacing those searches is separate work.

This spec's donation-based meaning of the live green number is authoritative. An
earlier addendum in `2026-11-11-vote-screens-design.md` investigated the former
proportional-backing-loss lead and left a choice between a largest successful loss
and a safe buffer. That choice is superseded for the live page by #98. Those results
remain relevant to `final.lead`, which this design explicitly leaves unchanged.

### Three different calculations

| Figure | What changes | Success condition |
| --- | --- | --- |
| Red donation gap (`live.give`) | Reduce the subject's ask | The subject reaches the target tier or higher |
| Extra-backing gap (`live.next`) | Add one voter backing only the subject at rank 1 | The subject reaches the target tier or higher |
| New green number (`live.threat`) | Reduce another initiative's ask | The subject leaves the tier settling now |

The first two have exact thresholds along an unchanged tally prefix. The third
requires following what happens after the other initiative is selected and pays.
The gap formulas below do not establish an exact green-number formula.

### Exact entry thresholds available to the spike

Until an initiative is selected, changing only its ask or adding a voter who backs
only it cannot change the other selections or payments. Record the baseline tally's
decision points through the target tier, before that initiative is selected. More
generally, exclude it from selection while retaining the original ballots, stage
bounds and ranks; calculate its support from the remaining weights at each point.

At a decision point `j`, let `C` be its original ask, `s_j` its current support,
`R_j` the remaining pool, and `b_j` the best eligible rival. Selection favors greater
support, then a smaller ask, then an earlier manifest index. All amounts and strict
tie adjustments below are integer micro-USD.

The largest positive reduced ask that would win here is:

```text
q_j = min(s_j, R_j)                         if no rival exists, or s_j > support(b_j)
q_j = min(s_j, R_j, cost(b_j) - epsilon)     if s_j = support(b_j)
no opportunity                             if s_j < support(b_j)

epsilon = 0 if the subject precedes b_j in manifest order, otherwise 1 micro-USD
q       = max of the positive q_j through the target tier
gift    = h * max(1, ceil(max(0, C - q) / h))
```

Here `h` is the requested step, $10 for the red list. No positive `q`, or `gift >= C`,
means no donation-only entry: a zero ask is covered by donations, not placed in a
tier. The minimum of one step preserves the positive-gap API; callers asking about
an already reached tier should handle that case explicitly.

For phantom backing, at points where `C <= R_j`:

```text
x_j = max(0, C - s_j, support(b_j) - s_j + epsilon_j)
gap = h * max(1, ceil(min(x_j) / h))

epsilon_j = 1 micro-USD if the unchanged ask and manifest order lose an
            equal-support tie to b_j, otherwise 0
```

Omit the rival term when none is eligible. Here `h = $1K`; keep the existing
`floor((poolUsd - spent) / h) * h` cap. No opportunity or a gap above the cap means
`null`. Keep the settled, withdrawn and covered exclusions for both calculations.

Inspect every permitted rank opening, including those after the ordinary tally
stops because no current ask fits: a reduced ask may fit and acquire support at a
later opening. For several subjects seeking a higher tier, the baseline prefixes
can be shared. After finding a gap, one modified tally supplies its knock-on lists;
retain the live and final diff scopes.

The first changed decision proves the entry threshold: either the subject wins at
the chosen point, or it has already won earlier in the same or a higher tier. A
scratch prototype matched exhaustive enumeration and the existing gap searches for
5,579 initiative/target combinations across 1,200 generated rounds. This validates
the tested entry cases, not displacement of another initiative or jump monotonicity.
The spike must retain reproducible fixtures and a proof alongside any replacement.

### Exact target for the new green number

Fix the live inputs `I`, the tier settling now `t`, and a subject `x` funded there.
For each other open initiative `r`, let `C_r` be its ask. Include both red and green
rivals; exclude settled, withdrawn and covered initiatives. Define:

```text
W_t(I)   = set funded by chainTally(I, t, t + 1)[0]
I_r(d)   = I with only cost[r] changed to C_r - d
D_(x,r)  = { d : 0 < d < C_r and x is not in W_t(I_r(d)) }
T_x      = min over r != x of min D_(x,r)
```

The donation domain must be explicit. For an exact $10 result, intersect each set
with `FINE, 2*FINE, ...`; for an exact micro-USD result use every positive integer
micro-USD below `C_r`. An empty union means safe **on the chosen domain**. A subject
not funded in the baseline has no threat value (`undefined`), not a safe value
(`null`). Full coverage `d >= C_r` remains outside this model, as in the implemented
search. Do not silently expand that domain in the spike.

Each `D_(x,r)` may contain several separated intervals. A small donation can push
`x` out and a larger one let it back in. Therefore:

- Entry of `r` is necessary but not sufficient to remove `x`. While `r` is never
  selected, its changed positive ask cannot affect the other decisions or payments.
  Once it pays, both shared backing and remaining pool change. Green rivals already
  qualify and must still be considered from the first permitted donation.
- The red entry formula can skip amounts below a red rival's first possible entry
  into this tier. It cannot replace the subsequent displacement calculation, or
  identify all green threats from that rival's first-entry knock-on.
- A verified displacing amount is a witness, not proof that it is the smallest.
  Binary narrowing can miss earlier successful subintervals even inside one $250
  bracket. If several rivals first hit at the same coarse amount, their refined
  minima can differ; compare every rival that can improve the final minimum.
- The implemented `null` says the $250 scan found no witness. It does not prove that
  no smaller interval, or even every untested $10 amount, could displace the subject.
  Do not call $10 output precision $10 search completeness.
- Rounding an exact displacing amount up to $10 can leave a narrow danger interval.
  Intersect the interval with the chosen grid and verify the returned amount. A
  rounded-down pill is display formatting, not a new amount proven to displace it.

### A possible route beyond amount scanning

Investigate intervals of donations that share a selection history. The entry
thresholds above identify when the changed initiative can first win. At that point,
its positive ask is `q(d) = C_r - d`. If its payers' current weights are `w_i`, their
total is `S`, and their cumulative weights in voter order are `P_i`, the exact first
payment is:

```text
paid_i(d) = floor(P_i * q(d) / S) - floor(P_(i-1) * q(d) / S)
w_i'(d)   = w_i - paid_i(d)
R'(d)     = R - q(d)
```

Before this payment, those weights are fixed along a particular unchanged prefix.
After it, each remaining initiative's support is a sum of the applicable remaining
weights; later rank openings add the then-remaining weights of new approvers.
Subsequent payments can have donation-dependent denominators, so a complete path is
not generally one linear expression. Preserve the actual cumulative floor rounding.

The spike should derive or conservatively bound the next change in eligibility,
selection order or payment on each interval, split where necessary, and continue the
tally to determine which green rows leave. Skip an interval only with a proof that
no amount in the chosen domain can improve a row's minimum. An interval solver may
still need many splits; no constant-time formula or performance gain is established
for the green metric yet.

Run this analysis once per rival and collect effects for every green subject, as the
current all-rows scan does. Keep rival identities internal to fixtures and diagnostics;
the served value and donor-facing UI must not name or preview the rival.

### Jump chips and the spike's acceptance criteria

For a donation `a` to the subject itself, the quantity to evaluate is
`T_x(withGift(I, x, a))`, with `0 < a < cost[x]`, and only while the subject remains
in the tier. The implementation treats improvement and becoming safe as monotone
on its suggestion grid based on the earlier spikes. That observation is not a proof.
An exact replacement must prove the relevant predicate or inspect all intervals
that could contain an earlier valid suggestion. Preserve the separate $1K grid for
suggestions unless a later decision changes it; the typed-amount calculation uses
the actual typed donation, not a suggestion rounded to that grid.

Acceptance for a replacement, separate from Tasks 1–7:

1. State whether it is exact on the $10 grid or over all integer micro-USD, and state
   the meaning of safe. Keep `null`, missing and not-currently-funded distinct.
2. Compare every subject against exhaustive enumeration on small reproducible
   rounds, including red and green rivals, separated danger intervals, ranges inside
   a $250 bracket, equal coarse hits with different refined minima, manifest-order
   ties, integer rounding and all three possible settling tiers. Use finer exhaustive
   amounts on tiny fixtures to expose rounding-induced boundaries.
3. Preserve the real 96-initiative narrow-range case and the 60-initiative fixture.
   Comparing with today's scan establishes compatibility where it finds a hit, not
   completeness. Every disagreement needs a concrete rival, amount and tally trace;
   fixtures may retain identities even though the product does not expose them.
4. Check self-donation jump predicates separately, including a safe baseline, full
   coverage, and any loss of membership. Checking a returned chip and its immediate
   predecessor alone does not prove it is the first valid chip without monotonicity.
5. Report cold-run time, tally calls or interval counts, peak memory and responsiveness
   separately for all green numbers, one subject, typed amounts and jump suggestions
   on 60 and 96 initiatives. Preserve cancellation, yielding/worker behavior, cache
   invalidation and the rule against visitor-triggered server searches.

### Historical backing-loss evidence, outside this implementation

The former `leadSearch` removes a proportional amount `L` from the subject's own
backers using cumulative integer deductions. This also changes rivals' support
before the subject is selected, so the entry proof does not apply to it either.

Two reproduced fixtures use a $100,000 pool, weights `[$50,000, $10,000]`, ballots
`[[1, 1], [255, 1]]`, subject index 0, and no earlier spend or exclusions:

| Subject / rival asks | Former `liveLeads` result | Exhaustively checked behavior on $10 steps |
| --- | --- | --- |
| $15,000 / $30,000 | $11,130 | First failure $11,140; recovery $30,010; last success $35,000 |
| $7,000 / $50,000 | $43,000 | First failure $1,560; a $2,000 loss fails even though $43,000 succeeds |

These are backing-loss counterexamples, not measurements of `live.threat`. They
explain the earlier addendum's caution about the word "ahead" and are retained for
future work on final leads. They do not reopen the chosen #98 definition, change
`final.lead`, or become new acceptance requirements for Task 6.

## Addendum: checked threats and entry probes (Nov 16, 2026)

The maintainer approved a correctness fix and a bounded optimization attempt after
the formula spike. Keep the fast approximate search, add the exact entry probe that
catches a demonstrated miss, and describe its evidence accurately. Do not ship the
slower interval prototype as the default. This decision supersedes the original
"smallest", "ahead" and "safe" promises for live green numbers and suggestions.
It does not change the historical backing-loss meaning of `final.lead`.

### Reproduced miss and the formula used in the fix

Two initiatives ask $1,900 and $4,700. One voter backs both in S-Tier with $3,700,
and the pool is $3,700. The $1,900 subject comes first in manifest order. A donation
`d` to the rival displaces the subject exactly when `$2,800 < d < $2,900`:

- At $2,800 their asks tie and the subject wins the manifest-order tie.
- At $2,810 the rival is picked first and the subject no longer fits.
- At $2,900 the rival asks $1,800 and both fit in the pool.

The old $250 scan starts at $3,000, after the entire danger range, and returns
`null`. The first dangerous $10 amount is $2,810. The regression now exercises
all-rows and one-row searches, both synchronous and asynchronous.

Let `C_r` be a rival's ask and `Q_r` its largest winning ask in the settling tier
from `maxWinningAsk` (including strict integer tie rules). For `F = $10`, probe:

```text
d_entry = max(F, F * ceil(max(0, C_r - Q_r) / F))
```

Skip it if `Q_r = 0` or `d_entry >= C_r`. This is the first positive $10 entry
amount for an unfunded rival; an already funded rival starts at $10. Test it even
when rounding to the $250 grid would skip it or leave no permitted coarse amount.
Then retain the coarse scan and checked refinement. Both searches use this rule,
including the searches used for typed amounts and jump suggestions. Full coverage
remains excluded, and rival identities remain internal.

This formula establishes entry, not displacement. Each result still needs its
modified tally. Later danger ranges can fall between samples, and binary refinement
does not establish minimality when displacement disappears and returns.

### Meaning and presentation of the shipped values

- A finite `live.threat` is a checked donation elsewhere that displaces the subject
  in the current inputs: an **upper bound** on the true minimum. Show a compact
  amount in thousands with up to three significant digits and "ahead". Keep the
  exact checked amount in the hover title and expanded explanation, which also
  says that smaller donations elsewhere may move it out of the tier.
  When integrating the results animations from `main`, retain the red countdown
  and flip to green, but show a green amount directly. Counting between green
  values would display donations that were never checked.
- `null` leaves the figure area blank and hides the row behind the shared bottom
  expansion link alongside out-of-reach rows. The expanded row explains that none
  of the donations to other initiatives checked would move it out, but other
  amounts may still do so. It never means safe.
- Missing data also leaves the figure blank, but stays visible until known and its
  expanded explanation makes no claim about checked donations.
- Jump chips show the increase over the current checked amount: from $62k to
  $63k means "+1k ahead". Use up to three significant digits in thousands. When no
  displacement is found after the donation, label it "to stay ahead". Keep the
  exact resulting amount and limitations in the notes. Without a known baseline,
  omit the numeric increase.
- Always reserve the last donation button for the full amount still needed,
  labelled "to be funded", even when all other suggestions are smaller. This
  label takes precedence if a suggested amount equals the full-funding amount.
- Typed-amount results explain the reduction in the subject's ask and whether a
  checked donation elsewhere would move it out. Neither promises the minimum
  useful self-donation or a guaranteed increase in safety.
- Sorting still uses checked amounts, then no hit, then missing data. This is an
  ordering of search results, not a proven ranking of actual safety margins.

The API shape stays unchanged. `WHAT_IFS_VERSION` becomes 8 so cached searches are
recomputed with entry probes. Background execution, worker yielding, cancellation
and input-key invalidation remain in place.

### Bounded experiment and decision

The scratch interval prototype bounds exact integer payments over donation
intervals, splits ambiguous intervals and checks singleton amounts. It matched
exhaustive $10 enumeration on 5,000 generated rounds (10,867 green subjects), 3,754
additional checked interval certificates, and the existing 60- and 96-initiative
fixtures. This is validation evidence for the prototype, not a closed-form green
formula or a completeness claim for the production scan.

Single local all-rows timings, in seconds:

| Method | 60 initiatives | 96 initiatives |
| --- | ---: | ---: |
| Previous $250 scan | 1.88 | 2.23 |
| Exact interval prototype | 7.44 | 11.80 |
| Exhaustive $10 enumeration | 33.39 | 55.67 |
| Coarse witnesses followed by exact interval verification | 9.06 | 13.74 |
| Production scan plus entry probes | 1.89 | 2.68 |

Seeding the interval solver with existing checked amounts did not meet the 2–4
second target; verification still dominated. The entry-probe version did meet it
in these runs and matched the exhaustive results on these two fixtures, including
the known narrow-range miss in the 96-initiative round. Those two matches do not
establish general completeness. The prototype remains research code outside the
repository; it can degenerate to enumeration and has not met the worker,
cancellation, memory or per-interaction acceptance criteria above.

Further exact-solver work needs a concrete performance improvement and the earlier
acceptance evidence. The current delivery is the entry-probe correction and honest
presentation of checked threats, not an exact replacement for the green search.
