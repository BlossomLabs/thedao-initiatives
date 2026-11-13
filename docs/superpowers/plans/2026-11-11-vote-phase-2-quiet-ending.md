# The vote, phase 2: the slow quiet ending — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voters can change their ballot until the tier it concerns has settled. The
site follows the contract's schedule (S, then A, then B, each with halving quiet
windows), shows each tier's state, locks settled tiers on the ballot, and shows
settled money apart from the settling tier's "if it settled now".

**Architecture:** A pure TypeScript replay (`shared/vote/quiet-ending.ts`) turns the
round's schedule, the ballot receipts (with real block times) and the projects' needs
into the round's state. Its tally step is an exact port of the Python `_ear` stage
tally, checked against fixtures the Python writes. The API replays on request (cached
5 s), stores each settled tier once in KV (so later donations never change it), and
refuses ballots the replay would reject. The ballot page and the results read
`GET /api/vote/round`.

**Tech Stack:** as phase 1. Python 3 (standard library) for the fixture export.

**Spec:** `docs/superpowers/specs/2026-11-11-vote-design.md`, "Phase 2". Rules:
`vote/docs/quiet-ending-rules.md` as of 2026-11-11 (uncommitted user changes in the
tree; read, never edit). Reference: `vote/reference/quiet_ending.py` (`_ear`),
`vote/reference/quiet_ending_steps.py` (`tier_levels`, `tier_of`, `run_on_time`).

## Global Constraints

- One tier at a time, on the contract's dates: tier t's window 1 runs
  `[firstTallyAt[t], firstTallyAt[t] + W)`, window k lasts `W >> (k-1)`, at most
  `maxWindows` windows. A receipt exactly at a cutoff belongs to the next window.
- A window's tallies: the opening tally (receipts strictly before the window start),
  one after each block in the window holding a receipt or a burn (after the block's
  last receipt), and the closing tally (receipts strictly before the window end).
  The compared outcome is the settling tier's funded set only. Every tally equal to
  the opening one → settle with the closing tally. Any different → next window, the
  closing tally is the new baseline. Any different in window `maxWindows` → settle
  with the closing tally anyway (`forced: true`).
- Registration closes at `firstTallyAt[0] + W`. After it, a token without an accepted
  ballot cannot vote (`registration_closed`).
- A revision that changes which proposals the voter has in a settled tier (by tier
  index of distinct ranks, `tier_of`) is rejected whole (`tier_settled`); the earlier
  accepted ballot stands. A burn voids the token's ballots (as today).
- Weights: every token on the roll gets `floor(pool / rollSize)` micro-USD; the
  remainder is never spent. Before registration closes the roll is the tokens with an
  accepted ballot at that tally; after, it is frozen.
- No supporter lock. No pool increases (the manifest's pool). Tally events are
  receipts and burns only; pledge, pool and project-balance events wait for the
  archive RPC (spec: blocked).
- Project need = `max(0, goal − raised)` from the board at replay time, micro-USD
  (as `voteTally` does today). Settled tiers keep the need they settled with (KV
  snapshot).
- Ballot bytes: 255 = withheld (never supported). S-Tier, A-Tier and B-Tier on the ballot UI = the
  voter's 1st/2nd/3rd distinct rank. B's stage counts to the last level (Python's
  `bound(stage ≥ tiers) = m`).
- Copy: "S is settling", "window 2 of 4", "settled", "if it settled now"; never
  "projector".

## Review Focus

1. A receipt in the same block as the window's end cutoff (timestamp == cutoff):
   belongs to the next window, not this one. (Task 2 test.)
2. A project funded for one in-window block and dropped before the window end:
   extends the window even though opening and closing tallies match. (Task 2 test.)
3. A voter who moves a proposal out of settled S in a revision: API refuses with
   `tier_settled`, the replay keeps the earlier ballot, and the page says so. (Tasks 2, 3, 5.)
4. Donations after S settles: S's awards on the page don't change. (Task 3 test via
   the KV snapshot.)
5. A token minted/voting first after the registration deadline: refused, and the
   ballot page says registration closed. (Tasks 2, 3, 5.)

---

### Task 1: Stage tally, ported from Python, with parity fixtures

**Files:**
- Create: `vote/reference/export_stage_fixtures.py`, `shared/vote/fixtures/stage-tally.json`
  (generated), `shared/vote/stage.ts`, `shared/vote/stage.test.ts`

**Interfaces:**
- Produces (all bigints are micro-USD):
  ```ts
  export type StageResult = { order: number[]; shares: Map<number, Map<number, bigint>> };
  /** Port of quiet_ending._ear without `reserved`. Mutates `weights`. */
  export function stageTally(costs: bigint[], weights: bigint[], ranks: (number[] | null)[],
    budget: bigint, spent: bigint, candidates: number[], maxLevel: number): StageResult;
  export function tierLevels(ballots: (number[] | null)[], tiers: number): (number | null)[];
  /** quiet_ending_steps bound(): the level stage `stage` counts to (m for stage ≥ tiers). */
  export function stageBound(ballots: (number[] | null)[], stage: number, tiers: number, m: number): number;
  /** quiet_ending_steps.tier_of: 0 for the first distinct rank; withheld/unplaced after all. */
  export function tierOf(ballot: number[] | null, c: number): number;
  ```
  `ranks` are `effectiveRanks` (vote/shared/ranks.ts); a rank above m (255) never opens.

- [ ] **Step 1:** Write `export_stage_fixtures.py`: seeded `random.Random(7)`, 40 cases of
  m ∈ 3..8 proposals, 2..12 voters, ballots with 1..3 tiers and withheld (255 mapped to
  "never" for Python by giving rank m+2), costs 1..10⁶, equal weights `pool // n`; for each
  case and stage 0..3 run the chained stage tallies as `tally_open` does (`_ear` with
  `max_level=bound`), and write `{costs, weights, ballots, budget, stages:[{order, shares}]}`.
  Run: `python3 -I vote/reference/export_stage_fixtures.py > shared/vote/fixtures/stage-tally.json`.
- [ ] **Step 2: Failing test** `stage.test.ts`: for every fixture, chaining `stageTally` over
  stages 0..3 (weights carried, spent accumulated, done removed from candidates,
  `maxLevel = stageBound`) gives the same orders and shares. Plus `tierOf([1,1,3,255],3) === 1`,
  `tierOf([1,1,3,255],0) === 0`, withheld → after every tier.
- [ ] **Step 3:** Run `deno run -A npm:vitest run shared/vote/stage.test.ts` → FAIL (no module).
- [ ] **Step 4:** Implement `stage.ts`.
- [ ] **Step 5:** Test passes. Commit: `Quiet ending: the stage tally, ported from the Python with parity fixtures`.

### Task 2: The quiet-ending replay

**Files:**
- Create: `shared/vote/quiet-ending.ts`, `shared/vote/quiet-ending.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  export type Schedule = { opensAt: number; firstTallyAt: [number, number, number];
    initialWindow: number; maxWindows: number };
  export type Receipt = { tokenId: string; nonce: number; ballot: Uint8Array | null; // null = burn
    block: number; timestamp: number };
  export type Settled = { tier: Tier; at: number; forced: boolean; funded: number[];
    awards: Map<number, bigint>; shares: Map<number, Map<string, bigint>> };
  export type TierState =
    | { tier: Tier; status: "waiting"; startsAt: number }
    | { tier: Tier; status: "settling"; window: number; windowEndsAt: number;
        latestEndAt: number; quiet: boolean; funded: number[] }   // funded: latest tally
    | ({ status: "settled" } & Settled);
  export type Rejection = { tokenId: string; nonce: number; reason: "tier_settled" | "registration_closed" };
  export type RoundState = { registrationClosesAt: number; tiers: [TierState, TierState, TierState];
    accepted: Map<string, Uint8Array>; rejected: Rejection[]; closed: boolean;
    /** "If it settled now": the open tiers' chained tallies from the first unsettled tier. */
    live: { order: number[]; awards: Map<number, bigint> }; };
  export function windowEnds(s: Schedule, tier: number): number[]; // cutoffs of windows 1..N
  export function replay(input: { schedule: Schedule; m: number; poolUsd: bigint;
    needs: bigint[]; receipts: Receipt[]; snapshots?: Settled[] }, now: number): RoundState;
  ```
  Receipts are in chain order. `snapshots` (from KV) replace the replay's own result for
  those tiers (same `at`), so later needs never move a settled tier.

- [ ] **Step 1: Failing tests** (`quiet-ending.test.ts`), with a 3-proposal round, W = 3600,
  N = 3, first tallies T, T+7200, T+14400 (A and B after S's and A's longest run of
  3600+1800+900 = 6300 s), pool 300, needs 100 each:
  - before T: every tier `waiting`; `live` is the full chained tally.
  - quiet S: ballots before T fund {0}; no receipts in window 1 → at T+3600 S `settled`
    with funded [0], `forced: false`; A `waiting` until T+7200.
  - a change extends: a receipt at T+100 makes {1} funded → at T+3600 S still
    `settling` in window 2 ending T+5400, `quiet: false` while it runs.
  - flip-flop: a receipt at T+100 funds {1}, another at T+200 restores {0} → still extends.
  - forced: changing S in every window → settled at T+6300 with `forced: true`.
  - cutoff: a receipt at exactly T+3600 counts in window 2, not window 1.
  - same block: two receipts in one block give one in-window tally (only the block's end state).
  - settled S: a revision moving proposal 0 out of S after S settles → `rejected`
    `tier_settled`, `accepted` keeps the earlier ballot; a revision that only changes A passes.
  - registration: a token whose first receipt is at T+3600 or later → `registration_closed`.
  - weights: 2 voters, pool 301 → each 150 micro-USD-units; 1 never spent.
  - burn: a revoked token's ballot leaves the roll before registration closes.
  - snapshot: passing S's `Settled` with other awards → state uses the snapshot.
  - closed: after B settles `closed: true`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Tallies chain stages from the first unsettled tier with
  settled tiers' shares already deducted (Python `tally_open`). Tier t's compared set
  is stage t's order. Evaluate windows lazily up to `now`: a window whose end is after
  `now` is `settling` with `quiet` = all in-window tallies so far equal the opening one.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit: `Quiet ending: replay the round from the receipts, tier by tier`.

### Task 3: API — round state, settled snapshots, ballot refusals

**Files:**
- Modify: `shared/vote/manifest.ts` (`schedule: Schedule` replaces `closesAt`; keep a
  derived `closesAt = latest possible end` export for callers that only need "over"),
  `shared/vote/manifest-data.ts`, `scripts/vote-deploy.ts` (`manifestFor` writes
  `schedule`), `api/services/vote-chain.ts` (receipts with nonce, block and real block
  time; block times cached in KV `["vote", contract, "block-time", n]`),
  `api/routes/vote.ts`
- Test: `api/tests/vote-round.test.ts`, `scripts/vote-deploy.test.ts`,
  `shared/vote/manifest.test.ts`

**Interfaces:**
- Produces: `GET /api/vote/round` → JSON of `RoundState` with bigints as decimal
  strings, slugs instead of indices, `accepted` as `{ tokenId: hex }`; cached 5 s; final
  (all settled) kept for good. Settled tiers are written once to KV
  `["vote", contract, "settled", tier]` the first time the replay settles them and
  passed back as `snapshots` after. `POST /ballot` refuses `409 tier_settled` ("S has
  settled: its initiatives can't move.") and `403 registration_closed` ("Registration
  closed before this badge voted.") using the current replay; `410 closed` once B has
  settled. `GET /ballots` stays (accepted ballots).
  Needs come from the same board data `/api/board` serves (the builder finds the
  function), `max(0, goal − total)` × 10⁶.

- [ ] **Step 1: Failing tests:** `/round` before T, settling, settled (shape and strings);
  a later need change doesn't change a settled tier (snapshot); `/ballot` refusals for
  `tier_settled`, `registration_closed`, `closed`; receipts carry real block times
  (stampLogs no longer uses the head time) and block-time lookups are cached.
  Manifest: `schedule` required; deploy `manifestFor` writes it.
- [ ] **Step 2:** Run `deno test -A api/tests/vote-round.test.ts scripts/` → FAIL.
- [ ] **Step 3:** Implement. Update the current Sepolia manifest data by hand to its real
  schedule (read `opensAt`, `firstTallyAt`, `initialWindow`, `maxWindows` from the
  contract with a one-off `cast`-free viem read, or from the deploy log: opensAt
  1793649336, maxWindows 1, initialWindow 1, firstTallyAt [C−1, C, C+1], C = 1793989800).
- [ ] **Step 4:** Tests, `deno task check:api`, typecheck pass.
- [ ] **Step 5:** Commit: `Vote API: the round's quiet-ending state, settled tiers kept, refusals`.

### Task 4: Ballot editor locks settled tiers

**Files:**
- Modify: `app/components/vote/TierBallot.tsx`
- Test: `app/routes/vote.code.test.tsx` (or a new `TierBallot.test.tsx`)

**Interfaces:**
- Produces: `TierBallot` prop `locked?: ReadonlySet<Tier>`. A tile in a locked tier has
  no tier buttons and can't be dragged; locked tiers accept no drops; the tier header
  shows "Settled". `onReplace` (AI ordering) keeps locked tiers' tiles where they are.

- [ ] **Step 1: Failing tests:** with `locked={new Set(["S"])}`: an S tile shows no
  "Move to" buttons; an unranked tile offers A and B, not S; the S header reads
  "S · Must fund · Settled".
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit: `Ballot: settled tiers are locked`.

### Task 5: Ballot page follows the round

**Files:**
- Modify: `app/hooks/use-vote.ts` (`useVoteRound(poll)`), `app/components/vote/VotePage.tsx`,
  `app/components/vote/BallotStatus.tsx`, `app/components/vote/VoteClosed.tsx`
- Test: `app/routes/vote.code.test.tsx`

**Interfaces:**
- Consumes: `/api/vote/round` (Task 3), `locked` (Task 4).
- Produces: `useVoteRound(poll: number | false)` → parsed state (bigints back, Sets for
  funded). Copy:
  - before registration closes, badge not yet counted: "Vote before <date> UTC, or this badge can't vote."
  - registration closed, badge not on the roll: "Registration closed before this badge voted."
  - settling: "<T> is settling: window k of N, ends <time> UTC." + quiet ? "No change so far: it settles then." : "It changed in this window: a shorter window follows."
  - settled tiers: "<T> settled: <titles>." and locked on the ballot.
  - rejection of this badge's latest nonce: "Not counted: <reason>. Your earlier ballot still counts."
  - closed (B settled): `VoteClosed`, with each tier's settled initiatives.

- [ ] **Step 1: Failing tests** for each line above, with `/api/vote/round` mocked.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit: `Ballot page: follows the quiet ending, tier by tier`.

### Task 6: Results show settled money and the settling tier

**Files:**
- Modify: `app/components/vote/VoteResults.tsx`, `app/components/ui/Bar.tsx`,
  `app/components/board/InitiativeCard.tsx`, `app/components/board/BoardList.tsx`,
  `app/components/board/BoardPage.tsx` (pass-through), `app/app.css`
- Test: `app/components/vote/VoteResults.test.tsx`, `app/components/board/InitiativeCard.test.tsx`

**Interfaces:**
- Produces: `BoardPage`/cards take `votePct` (settled, solid gold) and
  `votePendingPct` (the settling tier's "if it settled now", lighter gold,
  `data-vote-pending`). Hero sub: "S settled: $X to n initiatives · A settling,
  window 2 ends 15:30 UTC · B starts <date>"; before the first tally: today's text;
  after: "Final result: $X to n initiatives". Legend adds "if it settled now".

- [ ] **Step 1: Failing tests:** settled + settling round → hero line as above; a settled
  initiative's bar has `[data-vote-fill]`, a settling one `[data-vote-pending]`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit: `Vote results: settled money apart from the settling tier`.

### Task 7: Whole-branch check

- [ ] `deno task typecheck`, `deno run -A npm:vitest run`, `deno test -A api/ scripts/`,
  `deno lint`, `deno fmt --check` all pass.
- [ ] Final review by a fresh reviewer; fix Critical/Important with failing tests first.
