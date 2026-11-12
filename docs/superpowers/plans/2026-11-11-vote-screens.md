# Vote Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The closed vote shows funded / not funded lists with final amounts; the open vote shows each initiative's gap to the next tier, with a hover of who comes in and who drops out, and warns that Tier-B may fund nothing.

**Architecture:** The replay's chained tally moves into a pure function (`shared/vote/chain.ts`) so a second module (`shared/vote/next-tier.ts`) can re-run it with a phantom ballot and binary-search the gap. The server computes the gaps once per replay and adds them to `GET /api/vote/round` as `live.next` (the browser lacks the needs and weights, which the spec allows: "otherwise move it to `/api/vote/round`"). The results split is a pure helper in `app/lib/vote-results.ts`; `BoardPage`, `InitiativeCard` and `BoardList` get small optional props.

**Tech Stack:** Deno + Hono API, React Router + React Query, Tailwind, vitest (`deno task test`), `deno test` for `api/` (`deno task test:api`). Amounts in micro-USD bigints server-side.

**Spec:** `docs/superpowers/specs/2026-11-11-vote-screens-design.md`

## Global Constraints

- Tier names in copy: always "Tier-S", "Tier-A", "Tier-B" (`tierName` in `shared/vote/ballot.ts`); the bare letter only in the tier table.
- Say "vote results", never "projector".
- Copy says "initiatives", as the rest of the page does (the spec's "projects" copy becomes "initiatives").
- Gap precision: $1K steps, rounded **up**; `STEP = 1_000_000_000n` micro-USD.
- Short amounts use `usdShort` (`app/lib/format.ts`); rounded-up short amounts use the existing `upShort` logic from `app/components/board/VoteMark.tsx`, moved to `app/lib/format.ts` as `usdShortUp`.
- Backers and Sponsors strip stay on both screens (spec decision 1).
- Commit messages follow the branch: `Vote: …`.

## Review Focus

1. **No ballots yet** (round open, zero accepted): every unfunded initiative still gets a gap (the phantom alone funds it if it fits); no crash on empty `weights`. → Task 2 test `no ballots: the gap is the need`.
2. **Target tier already settled** (S settled, initiative funded in A): no figure, not "to Tier-S". → Task 2 test `a settled target tier gives no entry`.
3. **Gap under $1K** shows "$1K to Tier-S", never "$0". → Task 2 test `gaps round up to the next $1K`.
4. **A results list that is empty** (nobody funded, or everybody funded): its heading is not drawn. → Task 5 test `an empty list draws no heading`.
5. **Pool increased during the vote:** the results hero's "of" uses the pool on-chain (`rv.poolUsd`), not the manifest's. → Task 5 test `spent of the pool uses the pool on-chain`.

---

### Task 1: The chained tally as a pure function

**Files:**
- Create: `shared/vote/chain.ts`
- Modify: `shared/vote/quiet-ending.ts` (the `tally` closure inside `replay`, ~lines 183–216; `RoundState`)
- Test: `shared/vote/quiet-ending.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ChainInputs = {
    m: number;
    costs: bigint[];                 // needs, by candidate index
    voters: string[];                // tokenIds, sorted
    weights: bigint[];               // each voter's remaining share, same order
    ranks: number[][];               // effectiveRanks per voter
    ballots: <the type replay passes stageBound today>[]; // for stage bounds only
    poolUsd: bigint;
    spent: bigint;                   // settled awards so far
    done: ReadonlySet<number>;       // settled initiatives
  };
  export type ChainStage = { order: number[]; shares: Map<number, Map<string, bigint>> };
  export function chainTally(inp: ChainInputs, first: number, upTo?: number): ChainStage[];
  ```
  `RoundState` gains `liveInputs: ChainInputs | null` (null once closed) and `firstOpen: number`.

- [ ] **Step 1: Write the failing test** — `it("chainTally on liveInputs reproduces the live tally")`: on the existing "A settling" fixture, `chainTally(st.liveInputs!, st.firstOpen)` flattened (order, tier = `["S","A","B"][st.firstOpen + k]`) equals `st.live.order` and `st.live.tiers`; and calling it twice gives equal results (it must not mutate `inp.weights`).
- [ ] **Step 2: Run** `deno task test shared/vote/quiet-ending.test.ts` — FAIL (`chainTally` not exported).
- [ ] **Step 3: Implement** `chainTally` by moving the closure's loop body; copy `weights` (`[...inp.weights]`) and `done` before `stageTally` mutates them. `replay`'s `tally` builds a `ChainInputs` and calls it; the live block also stores it as `liveInputs`.
- [ ] **Step 4: Run** `deno task test shared/vote/` — all PASS, including every existing quiet-ending and stage test unchanged.
- [ ] **Step 5: Commit** `Vote: the chained tally as a pure function`

### Task 2: The gap to the next tier and its knock-on

**Files:**
- Create: `shared/vote/next-tier.ts`, `shared/vote/next-tier.test.ts`

**Interfaces:**
- Consumes: `chainTally`, `ChainInputs` (Task 1); `Tier` from `shared/vote/ballot.ts`.
- Produces:
  ```ts
  export const STEP = 1_000_000_000n;
  export type NextTier = {
    tier: Tier;                      // the target
    gap: bigint | null;              // micro-USD, a multiple of STEP; null = out of reach
    comesIn: [number, Tier][];       // newly funded, with their tier
    dropsOut: [number, Tier][];      // no longer funded, with the tier they lose
    moves: [number, Tier, Tier][];   // still funded, from → to
  };
  export function nextTiers(inp: ChainInputs, firstOpen: number): Map<number, NextTier>;
  ```

**Rules (from the spec):**
- Live result = `chainTally(inp, firstOpen)` as candidate → tier.
- Target: funded at tier index k → k−1, omitted when k = 0 or k−1 < `firstOpen`; not funded → Tier-B (index 2), omitted when `firstOpen > 2`.
- Phantom: a voter `"phantom"` with weight `w`, ranks `1` for the candidate and `m + 2` (never opens) for every other; appended to `voters`/`weights`/`ranks` only, **not** to `ballots`, so stage bounds are unchanged. Budget unchanged.
- "Reaches" = the candidate's tier index in the phantom result ≤ target.
- Search: `hi = poolUsd − spent` rounded down to STEP; if `hi` doesn't reach → `gap: null`, empty lists. Else smallest `k·STEP` in `[STEP, hi]` that reaches (binary search). Knock-on = diff of the phantom result at that gap vs. live, excluding the candidate itself.

- [ ] **Step 1: Write the failing tests** (small hand-built `ChainInputs`: 3–4 candidates, 2–3 voters, pool $100K):
  - `funded in A: the gap is the least $1K step that funds it in Tier-S` — gap `g` reaches; `g − STEP` doesn't (re-run `chainTally` with the phantom at both to assert).
  - `gaps round up to the next $1K` — need short by $300: gap === STEP.
  - `not funded: the target is Tier-B`.
  - `funded in Tier-S: no entry`.
  - `a settled target tier gives no entry` — `firstOpen = 1`, candidate in A → absent.
  - `out of reach: null gap and no knock-on` — need > pool − spent.
  - `the knock-on lists who comes in, drops out and moves` — fixture where funding X knocks Y out of A: `dropsOut` contains `[Y, "A"]`.
  - `no ballots: the gap is the need` — zero voters; gap === need rounded up to STEP.
  - `fast enough` — 40 candidates, 200 voters: `nextTiers` under 500 ms.
- [ ] **Step 2: Run** `deno task test shared/vote/next-tier.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** `nextTiers` per the rules above.
- [ ] **Step 4: Run** the same — PASS.
- [ ] **Step 5: Commit** `Vote: the gap to the next tier, with its knock-on`

### Task 3: `live.next` on `GET /api/vote/round`

**Files:**
- Modify: `api/routes/vote.ts` (the round view builder, ~line 150–172)
- Modify: `app/hooks/use-vote.ts` (`RoundView.live`)
- Test: `api/tests/vote-round.test.ts`

**Interfaces:**
- Consumes: `nextTiers` (Task 2), `st.liveInputs`, `st.firstOpen` (Task 1).
- Produces on `RoundView.live`:
  ```ts
  next?: Record<string, {
    tier: Tier; gap: string | null;          // micro-USD decimal string
    comesIn: { slug: string; tier: Tier }[];
    dropsOut: { slug: string; tier: Tier }[];
    moves: { slug: string; from: Tier; to: Tier }[];
  }>;
  ```
  Absent when the round is closed.

- [ ] **Step 1: Write the failing test** — `the round lists each initiative's gap to the next tier`: on the existing open-round harness, `body.live.next` has an entry for an unfunded slug with `tier: "B"` and a numeric-string `gap`; after the round closes, `live.next` is undefined.
- [ ] **Step 2: Run** `deno task test:api api/tests/vote-round.test.ts` — FAIL.
- [ ] **Step 3: Implement** — call `nextTiers` once per replay result (same place `live` is mapped), map indices to slugs with the existing `named`/`slugs`, amounts with `.toString()`.
- [ ] **Step 4: Run** `deno task test:api api/tests/vote-round.test.ts` and `deno task check:api` — PASS.
- [ ] **Step 5: Commit** `Vote: the round view carries each initiative's next tier`

### Task 4: The results split

**Files:**
- Create: `app/lib/vote-results.ts`, `app/lib/vote-results.test.ts`

**Interfaces:**
- Consumes: `Card` (board), `RoundTier` (`app/hooks/use-vote.ts`).
- Produces:
  ```ts
  export type ResultRow = { card: Card; finalUsd: number; tier?: Tier };
  export function splitResults(cards: Card[], tiers: RoundTier[]):
    { funded: ResultRow[]; notFunded: ResultRow[] };
  ```
  Funded = an award in a settled tier; `finalUsd = summary.total + award` (USD); sorted S, A, B, then by position in that tier's `funded`. Not funded: `finalUsd = summary.total`; sorted by `pct` desc, then title.

- [ ] **Step 1: Write the failing tests** — `funded first by tier, then in the order the tally funded them`; `the final amount is raised plus the award`; `not funded by how far they got`.
- [ ] **Step 2: Run** `deno task test app/lib/vote-results.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Vote: split the results into funded and not funded`

### Task 5: The results screen

**Files:**
- Modify: `app/components/vote/VoteResults.tsx`, `app/components/board/BoardPage.tsx`, `app/components/board/InitiativeCard.tsx`, `app/components/board/BoardList.tsx`
- Test: `app/components/vote/VoteResults.test.tsx` (extend "once B settles, the final result")

**Interfaces:**
- Consumes: `splitResults`, `ResultRow` (Task 4).
- Produces:
  - `BoardPage` prop `results?: { funded: ResultRow[]; notFunded: ResultRow[] }`. When set: no `BoardSearch`, no `FilterBar`; groups = `Funded` and `Not funded` headings with the count (as the `closest` groups draw theirs), a group with no rows draws nothing; cards get `final`, `voteTier`, and **no** `vote` prop (so no "Qualified" callout or tick).
  - `InitiativeCard` prop `final?: number`: amount line is `usdShort(final)` alone (no "of $…"), and `TypeBadge` is not drawn. Backers stay.
  - `BoardList` prop `finals?: ReadonlyMap<string /* initiative id */, number>`: same in rows (both desktop and phone amount spans; the phone `TypeBadge` hidden).
  - Hero when closed: `{usdShort(spent)} of {usdShort(pool)} pool spent`, pool = `rv.poolUsd ?? ROUND.poolUsd`; under it one line per tier `Tier-S: $X to N initiatives`, and for a tier with nothing funded `Tier-B: no initiatives funded`.

- [ ] **Step 1: Write the failing tests:**
  - `the final result: funded and not funded lists` — headings "Funded" with 1 and "Not funded" with 1 (fixture: alpha funded in S, beta not).
  - `cards show the final amount only` — alpha's card text contains "60K"-style short amount, no card contains "of $", "Qualified", or the type label text.
  - `an empty list draws no heading` — everyone funded → no "Not funded".
  - `spent of the pool uses the pool on-chain` — `rv.poolUsd` larger than the manifest's → hero shows the larger.
  - `a tier that funded nothing says so` — "Tier-B: no initiatives funded".
  - `no search or filters on the final result`.
- [ ] **Step 2: Run** `deno task test app/components/vote/VoteResults.test.tsx` — FAIL.
- [ ] **Step 3: Implement** the props above; `VoteResults` passes `results` only when `rv.closed`.
- [ ] **Step 4: Run** `deno task test app/components` and `deno task typecheck` — PASS (existing `InitiativeCard`/`BoardList` tests unchanged).
- [ ] **Step 5: Commit** `Vote: the final result as funded and not funded lists`

### Task 6: The gap figure and its hover

**Files:**
- Create: `app/components/vote/NextTier.tsx`, `app/components/vote/NextTier.test.tsx`
- Modify: `app/lib/format.ts` (add `usdShortUp`, moved from `VoteMark.tsx`'s `upShort`; `VoteMark` imports it), `app/components/board/InitiativeCard.tsx`, `app/components/board/BoardList.tsx`, `app/components/board/BoardPage.tsx`, `app/components/vote/VoteResults.tsx`

**Interfaces:**
- Consumes: `RoundView.live.next` (Task 3).
- Produces:
  - `export function NextTierFigure({ next, titles }: { next: NonNullable<RoundView["live"]["next"]>[string]; titles: ReadonlyMap<string, string> /* slug → title */ })`
  - `BoardPage` prop `next?: ReadonlyMap<string /* initiative id */, NextTierEntry>` passed to cards (`next` prop) and `BoardList` (`next` map); drawn on the right of the amount row in place of the % / `FundingStatus`, both layouts.
  - Copy: button `"{usdShortUp(gap)} to {tierName(tier)}"`; null gap → `"Out of reach for {tierName(tier)}"` (plain text, no button). Popover (`role="tooltip"`, id wired by `aria-describedby`; opens on hover, focus, and tap): heading `"With {usdShortUp(gap)} more at {tierName(tier)}:"`, then `Comes in: Title (Tier-A), …`, `Drops out: Title (Tier-B), …`, `Moves: Title Tier-A → Tier-S` (each line only if non-empty), or `Nothing else changes.`

- [ ] **Step 1: Write the failing tests** (`NextTier.test.tsx`):
  - `shows the gap to the next tier, rounded up` — gap `"41200000000"` → "$42K to Tier-S".
  - `out of reach` → "Out of reach for Tier-B", no button.
  - `the hover lists who comes in and who drops out` — focus the button → tooltip has "Comes in: Beta audits (Tier-A)" and "Drops out: …".
  - `nothing else changes` — empty lists.
  - and in `VoteResults.test.tsx`: `an open round shows each initiative's gap` (mock `live.next`), and `a closed round shows no gap`.
- [ ] **Step 2: Run** `deno task test app/components/vote` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `deno task test app/components` and `deno task typecheck` — PASS (`VoteMark` tests unchanged after the move).
- [ ] **Step 5: Commit** `Vote: each initiative's gap to the next tier, with what it would change`

### Task 7: Tier-B may fund nothing

**Files:**
- Modify: `app/components/vote/TierBallot.tsx` (by the Tier-B column's heading), `app/components/vote/VoteResults.tsx` (`stageLine` / the open-round hero)
- Test: `app/components/vote/TierBallot.test.tsx`, `app/components/vote/VoteResults.test.tsx`

**Copy (exact):**
- Ballot, by Tier-B: `Tier-B is funded only if the pool lasts and enough voters back the same initiatives. It may fund nothing.`
- Results hero, round open, Tier-B not settled and no slug in `rv.live.tiers` has `"B"`: append ` · Tier-B: nothing funded yet, the pool may not reach it.`
- (Closed round: Task 5's `Tier-B: no initiatives funded`.)

- [ ] **Step 1: Write the failing tests** — `the ballot warns that Tier-B may fund nothing`; `the hero says when Tier-B funds nothing yet`; and its negative: `no warning while Tier-B funds something`.
- [ ] **Step 2: Run** `deno task test app/components/vote` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `deno task test` and `deno task typecheck` — all PASS.
- [ ] **Step 5: Commit** `Vote: say Tier-B may fund nothing`
