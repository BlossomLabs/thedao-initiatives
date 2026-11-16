# Green Number Implementation Plan

**Current decision, Nov 16, 2026:** The [approved correctness follow-up](#approved-correctness-follow-up-nov-16-2026)
and the spec's [checked-threat addendum](../specs/2026-11-16-green-number-design.md#addendum-checked-threats-and-entry-probes-nov-16-2026)
supersede the historical "smallest", "ahead" and "safe" requirements below. Tasks
1–6 describe their original implementation; use the new wording in final review.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the vote results' list, a green row's number becomes the smallest single donation to another initiative that pushes it out of the tier settling now ("safe" when none does); only two green rows show until expanded; an open green row suggests the donations to it at which that number jumps.

**Architecture:** A new pure module `shared/vote/threat.ts` (browser and Deno) holds the searches. The server runs the all-rows search in its existing background step instead of today's lead search and serves `live.threat`. The browser runs the one-row searches (jump chips, typed amount) on `live.inputs` in a web worker, the open row first, then the two visible green rows, then the rest.

**Tech Stack:** TypeScript, Deno (API, `deno test`), React + React Router, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-16-green-number-design.md`

**Nov 16, 2026 addendum:** The [formula-spike addendum](../specs/2026-11-16-green-number-design.md#addendum-formulas-and-the-follow-up-spike-nov-16-2026)
records exact entry thresholds, the separate donation-displacement problem for green
numbers, and the scan's precision limits. Tasks 1–5 are done and Task 6's instructions
are already copied. Read this in Task 7 and final review; the formula spike is follow-up
work, not a retroactive change to Tasks 1–6 or the agreed donation-based meaning.

Work in the worktree `/home/sem/Projects/thedao-initiatives-vote-issues`, branch `vote-issues` (`node_modules` is a symlink to the main checkout's).

## Global Constraints

- Tier names in copy, comments and test names: "S-Tier", "A-Tier", "B-Tier"; in running text from code, `tierName()` (`shared/vote/ballot.ts`). Never "S tier", "tier S", "S/A/B".
- Amounts are micro-USD bigints in `shared/`; whole dollars on the page (`dollars()` in `app/lib/vote-results.ts`).
- The number is searched in **$250 steps** (`THREAT_STEP = 250_000_000n`), each hit narrowed to **$10** (`FINE`), never above the smallest amount checked that pushes the row out.
- Jump amounts are searched on a **$1k** grid (`STEP`); the number each leads to at $250 steps.
- Pills use `usd2(n, false)` (rounds down), sentences `usd(n)` (`app/lib/format.ts`).
- Red is only for missing money; green rows stay green.
- The server never runs a search because a visitor asked for one.
- The other initiative is never named or previewed.
- Every task ends with `deno fmt` and `deno lint` clean on the files it touched.

## Review Focus

1. **The data refreshes (5 s poll) while an open green row's jump chips are being worked out**: the work restarts on the new inputs, and chips from old inputs never show under new figures. → Task 6, test "jump chips are worked out again when the round's inputs change".
2. **Opening another row, or closing it, mid-work**: the old work stops (no chips appear on the wrong row, no state update after close). → Task 6, test "closing a green row stops its work".
3. **A green row that is already safe**: no jump chips (only the usual amounts and the #102 cap), the field empty, no "working out" line left behind. → Task 6, test "a safe row has no jump chips".
4. **A typed amount that is blank, not a number, or covers the whole ask**: no number line (covered keeps today's wording). → Task 6, test "no number for a blank, mistyped or covering amount".
5. **The server's threat search fails or the round has no green rows**: the red figures are still served; green rows read "In S-Tier" as today when `live.threat` lacks them. → Task 3, test "a failed threat search keeps the gaps".

---

### Task 1: The all-rows search

**Files:**
- Create: `shared/vote/threat.ts`
- Create: `shared/vote/threat.test.ts`
- Create: `shared/vote/fixtures/test-round-2026-11-15.json` (copy of the closed test round's `/api/vote/round` body; the session scratchpad has it as `spike/round.json`, or fetch `https://initiatives.thedao.fund/api/vote/round` if that round is still served)
- Modify: `shared/vote/next-tier.ts` (export `drive`, `driveAsync`, `withGift`; no behaviour change)

**Interfaces:**
- Produces:
  - `export const THREAT_STEP = 250_000_000n;`
  - `export type Threats = Map<number, bigint | null>;` — every initiative the live tally funds in tier `first`; value: the smallest donation found (a multiple of `FINE`) to another initiative that pushes it out, or `null` (safe).
  - `export function threats(inp: ChainInputs, first: number, tally: Tally = chainTally, step: bigint = THREAT_STEP): Threats`
  - `export function threatsAsync(inp: ChainInputs, first: number, tally: Tally = chainTally, sliceMs = 0, step: bigint = THREAT_STEP): Promise<Threats>`
  - `export function rivalAmounts(inp: ChainInputs, first: number, r: number, step: bigint): bigint[]` — the amounts worth trying for rival `r` (used again in Task 2).
  - From `next-tier.ts`: `export function drive<T>(…)`, `export async function driveAsync<T>(it, sliceMs = 0, signal?: AbortSignal)` (throws `signal.reason` when aborted, checked at each hand-back), `export function withGift(…)`.

- [ ] **Step 1: Write the failing tests** in `shared/vote/threat.test.ts`. Build inputs with a local `inputs(costsK, weightsK, ballots, poolK = 100, done = [])` helper like the one in `next-tier.test.ts` (with `withdrawn: new Set()`), and a local brute force:

```ts
/** Every $step from one step to the last below each other initiative's cost, full tallies. */
function brute(inp: ChainInputs, first: number, step: bigint): Map<number, bigint | null>
```

Tests:
- `"a green row's number is the smallest donation to another initiative that pushes it out"`: on three made-up rounds (e.g. `inputs([40, 40, 30], [25, 25], [[1, 2, 3], [2, 1, 3]], 60)` and two with 6–8 initiatives and 10 voters from a seeded generator), for every key of `threats(inp, 0, chainTally, K)`, the value is `null` exactly when `brute(…, K)` is null, else `<=` the brute value and `> bruteValue - K`, and a multiple of `FINE`; and giving that amount to some other initiative really pushes it out (check by tally).
- `"no single donation pushes it out: safe (null)"`: one voter backs only initiative 0 in S-Tier with plenty of pool, nobody ranks the others: `threats(...).get(0)` is `null`.
- `"a donation to another green initiative counts"`: a round where the only threat to green `x` is a donation to another green `y` (find one with the seeded generator and pin it), value not null.
- `"a withdrawn initiative is no rival"`: the same round with that rival in `withdrawn`: the number is null or larger.
- `"only the tier settling now: keys are what the live tally funds there"`: keys equal `chainTally(inp, first, first + 1)[0].order` as a set, also with `first = 1` and `done`.
- `"the real test round, cut to 60 initiatives, matches brute force at $1k steps"`: load the fixture, cut to the 60 initiatives most ballots place (as the spike `fastlib.ts` `round(60)` does), compare `threats(inp, 0, chainTally, K)` with `brute(inp, 0, K)` per key (equal up to the $10 narrowing: `brute - K < v <= brute`).
- `"$250 steps find the narrow range $1k steps jump over"`: full fixture (96 initiatives), the initiative at index 81: `threats(inp, 0)` gives a value below `45_000n * 1_000_000n`, while `threats(inp, 0, chainTally, K)` gives one above `160_000n * 1_000_000n`. (Slow, a few seconds; that's fine.)
- `"the async variant gives the same result"`.

- [ ] **Step 2: Run them to see them fail**

Run: `deno run -A npm:vitest run shared/vote/threat.test.ts`
Expected: FAIL, cannot resolve `./threat`.

- [ ] **Step 3: Implement `threats`/`threatsAsync` in `shared/vote/threat.ts`** as a generator `threatsSearch` that yields after every tally, driven by `drive`/`driveAsync`:
  - Tally only tier `first`: `tally(inp, first, first + 1)[0].order` as a `Set`.
  - `rivalAmounts`: `bound = first >= 2 ? inp.m : stageBound(inp.ballots, first, 3, inp.m)`; `most` = sum of `inp.weights[i]` over voters with `inp.ranks[i][r] <= Math.min(inp.m, bound)`; none → `[]`; else from `max(step, ceil((cost − most) / step) · step)` by `step` while `< cost`. Rivals: not `done`, not `withdrawn`, `costs[r] > 0n`, `r` itself included even when green (its start is then `step`).
  - One scan per rival over `rivalAmounts`; each tally marks every green `x ≠ r` no longer in the tier; keep the smallest amount per `x`; stop a rival's scan once the amount is `>=` every green's best so far (greens with no best keep it going).
  - Narrow each hit: binary search on `FINE` multiples in `(hit − step, hit]` for the least amount whose tally pushes `x` out by that same rival, keeping only amounts actually checked (as `giftSearch` does).
  - In `next-tier.ts`, add the optional `signal` to `driveAsync` and export `drive`, `driveAsync`, `withGift` unchanged otherwise.

- [ ] **Step 4: Run the tests**

Run: `deno run -A npm:vitest run shared/vote/`
Expected: PASS (all of `shared/vote`).

- [ ] **Step 5: Commit**

```bash
git add shared/vote/threat.ts shared/vote/threat.test.ts shared/vote/next-tier.ts shared/vote/fixtures/test-round-2026-11-15.json
git commit -m "Vote: the smallest donation elsewhere that pushes an initiative out (#98)"
```

### Task 2: One row's number and its jumps

**Files:**
- Modify: `shared/vote/threat.ts`
- Modify: `shared/vote/threat.test.ts`

**Interfaces:**
- Consumes: Task 1's `rivalAmounts`, `THREAT_STEP`, `driveAsync`, `withGift`.
- Produces:
  - `export function threatOfAsync(inp: ChainInputs, first: number, x: number, opts?: { tally?: Tally; step?: bigint; sliceMs?: number; signal?: AbortSignal }): Promise<bigint | null | undefined>` — `undefined` when `x` is not in tier `first`; else as `threats` gives for `x` (smallest first across all rivals, stop at the first that pushes it out, narrowed to `FINE`).
  - `export function threatOf(inp, first, x, opts?)` — the same, synchronous (tests).
  - `export type Jump = { usd: bigint; threat: bigint | null };`
  - `export function jumpsAsync(inp: ChainInputs, first: number, x: number, opts?: { tally?: Tally; sliceMs?: number; signal?: AbortSignal }): Promise<Jump[]>` — at most two, ascending `usd`: the least `STEP` multiple given to `x` after which its number (at `THREAT_STEP`) is higher than now or null, and the least after which it is null; one entry when they are the same amount; `[]` when it is safe now or no amount below its cost reaches either.
  - `export function jumps(inp, first, x, opts?)` — synchronous.

- [ ] **Step 1: Write the failing tests:**
  - `"one row's number is the all-rows search's"`: for every key of `threats(inp, 0, chainTally, K)` on the made-up rounds of Task 1, `threatOf(inp, 0, x, { step: K })` equals it.
  - `"not in the tier settling now: no number"`: `threatOf` of an unfunded initiative is `undefined`.
  - `"the jumps raise its number, ending safe"`: for each green with a number on the made-up rounds, `jumps(...)` is ascending, has length 1 or 2, the last `threat` is `null` when any entry is, each `usd` is a multiple of `STEP` below its cost, and `threatOf(withGift(inp, x, j.usd), 0, x)` equals `j.threat`; one step less does not reach it (`threatOf` at `j.usd − STEP` is not higher / not null).
  - `"a safe row has no jumps"`: `jumps` of the safe round in Task 1 is `[]`.
  - `"aborting stops the work"`: `jumpsAsync(..., { signal })` with `signal` aborted after the first slice rejects with the abort reason.

- [ ] **Step 2: Run them to see them fail**

Run: `deno run -A npm:vitest run shared/vote/threat.test.ts`
Expected: FAIL, `threatOf` is not exported.

- [ ] **Step 3: Implement** in `shared/vote/threat.ts`: `threatOf` gathers `[amount, rival]` for every rival over `rivalAmounts(…, step)`, sorts by amount then rival, returns the first that pushes `x` out (narrowed as in Task 1), else `null`. `jumps` binary-searches `k` in `[1, (cost − 1) / STEP]` twice with the predicates "number higher than now or null" and "null", treating them as monotone, returning only amounts whose search was run.

- [ ] **Step 4: Run the tests**

Run: `deno run -A npm:vitest run shared/vote/threat.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/vote/threat.ts shared/vote/threat.test.ts
git commit -m "Vote: one green row's number and the donations at which it jumps (#98)"
```

### Task 3: The server serves `live.threat`

**Files:**
- Modify: `api/routes/vote.ts:206-262` (version, JSON helpers, `KnownNext`), `:425-490` (background search), `:800-820` (`withAhead`)
- Modify: `app/hooks/use-vote.ts:94-107` (the `live` type)
- Modify: `app/components/vote/mock-round.ts:455-486` (`withFigures`)
- Test: `api/tests/vote-round.test.ts:832-866`, `api/tests/vote-replay.test.ts:137,192`, `app/components/vote/mock-round.test.ts`

**Interfaces:**
- Consumes: Task 1's `threatsAsync`.
- Produces: the round JSON's `live.threat?: Record<string, string | null>` — slug → micro-USD string, or `null` for safe, for every initiative the live tally funds in the tier settling now; `live.lead` is no longer served (`final.lead` stays). `aheadStale` covers `threat` too. `WHAT_IFS_VERSION = 7`.

- [ ] **Step 1: Rewrite the two lead tests** in `api/tests/vote-round.test.ts` (same `leadSetup`, renamed `threatSetup`):
  - `"an open round serves each S-Tier initiative's threat"`: first read has no `live.threat`; after `h.settle()`, `live.threat` is `{ a: null }` (a $3K ask backed by both voters, nothing else ranked: no donation elsewhere pushes it out) and `live.lead` is `undefined`.
  - `"once S-Tier has settled, the threats are A-Tier's"`: `live.threat` is `{}`.
  - Add `"a failed threat search keeps the gaps"`: with `threatsAsync` made to throw (inject through the module's deps the way the existing search is counted in the test above line 820, or by a round whose search throws), `live.next` and `live.give` are served and `live.threat` is absent.
  - In `api/tests/vote-replay.test.ts`, strip `threat` instead of `lead` at lines 137 and 192.
- In `mock-round.test.ts`, the `"%s: below the tier settling now…"` test checks `live.threat` keys are exactly the rows in the settling tier and each value is `null` or a multiple of `10_000_000`.

- [ ] **Step 2: Run them to see them fail**

Run: `deno test -A api/tests/vote-round.test.ts api/tests/vote-replay.test.ts` and `deno run -A npm:vitest run app/components/vote/mock-round.test.ts`
Expected: FAIL on `live.threat`.

- [ ] **Step 3: Implement**: in the background block replace the `liveLeadsAsync` call with `threatsAsync(liveInputs, firstOpen)` into `threat` (same try/catch and log tag `vote threat`), a `threatJson(t: Threats, slugs): Record<string, string | null>` helper beside `leadJson`, `KnownNext.threat` instead of `lead`, `Ahead` picks `threat`, `withAhead` serves `threat`; bump `WHAT_IFS_VERSION` to 7. In `use-vote.ts` replace `lead` in `live` with `threat` (doc: "micro-USD, or null: safe from any single donation"). In `withFigures` compute `threat` with `threatsAsync(inp, first, chainTally, 10)` instead of the leads. Leave `liveLeads`, `leadIn` and `final.lead` in place (the closed round still uses them).

- [ ] **Step 4: Run the tests**

Run: `deno task test:api` and `deno run -A npm:vitest run app/components/vote`
Expected: PASS except `VoteResults.test.tsx` tests that read `live.lead` (Task 4 updates them).

- [ ] **Step 5: Commit**

```bash
git add api app/hooks/use-vote.ts app/components/vote/mock-round.ts app/components/vote/mock-round.test.ts
git commit -m "Vote: serve each green row's threat instead of its lead (#98)"
```

### Task 4: Green rows in the list

**Current presentation update (supersedes the original folding instructions below):**
Show every finite checked amount as "$Xk ahead", with up to three significant digits
and the exact amount in the hover title. Leave missing and `null` figures
blank; only `null` rows are hidden above by default. One bottom "+ N more initiatives"
link reveals these rows and the out-of-reach rows together, and toggles to "Show fewer".
Search reveals matching rows from both ends, and open rows remain visible on collapse.
Suggested donations show the increase ("+1k ahead") or "to stay ahead". The last
button always shows the full remaining funding amount, labelled "to be funded".

**Files:**
- Modify: `app/components/vote/GiveList.tsx` (`GiveRow`, sort, collapse, closed and open green row)
- Modify: `app/components/vote/VoteResults.tsx:130-170` (rows from `live.threat`)
- Test: `app/components/vote/VoteResults.test.tsx` (the tests around lines 529–540 and 730–745 that read leads; the `openWith` helper's leads argument)

**Interfaces:**
- Consumes: Task 3's `live.threat`.
- Produces: `GiveRow.threat?: number | null` (whole dollars; `null` safe; absent: not known) replacing `GiveRow.lead`. `GiveList` props unchanged except what Task 5 adds.

- [ ] **Step 1: Write the failing tests** (change `openWith`'s fourth argument to threats: `Record<string, string | null>` served as `live.threat`):
  - `"green rows: closest to being pushed out first, safe last"`: three S-Tier rows with threats `$12k`, `$1k`, `null`: order `$1k`, `$12k`, safe; the pill text `"$1kahead"`; the safe row shows `"safe"` and no pill.
  - `"only two green rows show, with a link above them for the rest"`: four green rows: two rows visible, a button `"Show all 4 in S-Tier"` placed before the first green row (DOM order); clicking it shows four and the button reads `"Show fewer"`; with three or fewer, no button.
  - `"an open green row stays visible while the rest are collapsed"`: four green rows, the fourth opened (via `onOpen`/the page's `open`): it shows with the first two.
  - `"a filter shows every matching green row"`: typing in the list's search box a word all four share shows four, no button.
  - `"an open green row's sentence"`: opening the `$1k` row: `"$1,000 given to another initiative could push it out of S-Tier if the vote ended now."`; opening the safe one: `"No single donation to another initiative pushes it out of S-Tier now."`; no other initiative's title appears in that sentence.
  - Update the old order/lead tests to the new figure.

- [ ] **Step 2: Run them to see them fail**

Run: `deno run -A npm:vitest run app/components/vote/VoteResults.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**:
  - `VoteResults` rows: `threat: t === undefined ? undefined : t === null ? null : dollars(t)` from `rv.live.threat?.[slug]`.
  - `GiveList`: sort green rows by `threat` ascending (`null` last, `undefined` after `null`), AI order unchanged; state `showGreen`; when no filter/AI and more than two green rows, render a link-styled button above them (`"Show all {n} in {name}"` / `"Show fewer"`, small white/55 text as "+ N more out of reach") and only the first two unless expanded or one is open; closed pill `usd2(threat, false)` + `"ahead"`, `null` → `"safe"` in the same 46px small green text, `undefined` → `"In {name}"` as today.
  - Open green row sentence, with a number: `<b>{usd(threat)}</b> given to another initiative could push it out of {name} if the vote ended now. A donation to it makes that harder.`; safe: `No single donation to another initiative pushes it out of {name} now. A donation lowers what it asks of the pool.`; unknown: today's "In {name} if it settled now, with little to spare." line without the lead part.

- [ ] **Step 4: Run the tests**

Run: `deno run -A npm:vitest run app/components/vote`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/vote/GiveList.tsx app/components/vote/VoteResults.tsx app/components/vote/VoteResults.test.tsx
git commit -m "Vote results: green rows say what a donation elsewhere takes to push them out; two show (#98)"
```

### Task 5: The jump queue and its web worker

The maintainer's call: jump chips are worked out ahead of a click, in a web worker, in this
order: the open row (and a typed amount), then the two visible green rows, then the other
green rows. It pauses while the tab is hidden and starts over when the round's figures
change.

**Files:**
- Create: `app/lib/threat-queue.ts` (the scheduler, no Worker or DOM: testable)
- Create: `app/lib/threat-queue.test.ts`
- Create: `app/workers/threat.worker.ts` (thin glue: messages in, `ThreatQueue`, messages out)
- Create: `app/hooks/use-threat-jumps.ts` (starts the worker; in tests and browsers without `Worker`, runs the same `ThreatQueue` on the page's thread)
- Create: `app/hooks/use-threat-jumps.test.tsx`

**Interfaces:**
- Consumes: Task 2's `jumpsAsync`, `threatOfAsync`, `withGift`; `liveInputsFrom` (`shared/vote/live-inputs.ts`).
- Produces:
  - `app/lib/threat-queue.ts`:
    - `export type JumpUsd = { usd: number; threat: number | null };` (whole dollars)
    - `export type QueueEvent = { kind: "jumps"; key: string; c: number; jumps: JumpUsd[] } | { kind: "typed"; key: string; c: number; given: number; threat: number | null | undefined };`
    - `export class ThreatQueue { constructor(emit: (e: QueueEvent) => void, work?: { jumps: typeof jumpsAsync; threatOf: typeof threatOfAsync }); setInputs(key: string, inputs: LiveInputsJson): void; setOrder(open: number | undefined, visible: number[], rest: number[]): void; typed(c: number, given: number | undefined): void; pause(): void; resume(): void; stop(): void }`
      - `setInputs` with a new key aborts all work, drops every result, and starts again from the top of the order.
      - Priority: a pending typed amount, then `open`, then `visible` in order, then `rest` in order; a row already done for the current key is skipped. One job at a time; a new `open` or `typed` aborts a lower-priority job in progress and it is redone later.
      - `typed(c, undefined)` cancels the typed job. `given` covering the row's whole ask is not sent (the page handles it).
      - Every event carries the inputs `key` it was computed on.
  - Worker messages: page → worker `{ type: "inputs", key, inputs } | { type: "order", open, visible, rest } | { type: "typed", c, given } | { type: "pause" } | { type: "resume" }`; worker → page: `QueueEvent`.
  - `app/hooks/use-threat-jumps.ts`: `export function useThreatJumps(args: { key?: string; inputs?: LiveInputsJson; open?: number; visible: number[]; rest: number[]; typed?: { c: number; given: number } }): { jumps: Map<number, JumpUsd[]>; typed?: { c: number; given: number; threat: number | null | undefined } }` — results only for the current `key`; `visibilitychange` pauses and resumes; the worker is ended on unmount.

- [ ] **Step 1: Write the failing tests** in `app/lib/threat-queue.test.ts`, with fake `work` functions that resolve when the test says (to control timing) and record calls:
  - `"works out the open row, then the two visible rows, then the rest"`: order of `jumps` calls is open, visible[0], visible[1], rest…
  - `"opening a row puts it first, and the job it interrupts is done again later"`.
  - `"new figures start over: old results are dropped and never emitted with the new key"`: an event from a job begun under key A, finishing after `setInputs(B)`, is not emitted.
  - `"a typed amount goes before everything; clearing it cancels it"`.
  - `"paused: nothing starts until it resumes"`.
  - `"a row done for these figures is not worked out again"`.
  - `"stop aborts the job in progress"` (the fake's signal is aborted).
  - In `use-threat-jumps.test.tsx` (no `Worker` in jsdom: the page-thread fallback), with real `jumpsAsync` on a small made-up round: `"the hook returns the open row's jumps for the current figures"`, `"a hidden tab pauses the work"` (dispatch `visibilitychange` with `document.hidden` mocked true: no new results until visible again).

- [ ] **Step 2: Run them to see them fail**

Run: `deno run -A npm:vitest run app/lib/threat-queue.test.ts app/hooks/use-threat-jumps.test.tsx`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement** `ThreatQueue`, the worker (`self.onmessage` → queue methods, `emit` → `postMessage`) and the hook (`new Worker(new URL("../workers/threat.worker.ts", import.meta.url), { type: "module" })` when `typeof Worker !== "undefined"`, else a `ThreatQueue` in the page). Jobs call `jumpsAsync`/`threatOfAsync` with `{ sliceMs: 10, signal }`; dollars via `dollars()`-style division of the bigints.

- [ ] **Step 4: Run the tests**

Run: `deno run -A npm:vitest run app/lib app/hooks`
Expected: PASS

- [ ] **Step 5: Check the worker builds**

Run: `deno task build`
Expected: the build emits a separate worker chunk and no error.

- [ ] **Step 6: Commit**

```bash
git add app/lib/threat-queue.ts app/lib/threat-queue.test.ts app/workers app/hooks/use-threat-jumps.ts app/hooks/use-threat-jumps.test.tsx
git commit -m "Vote results: a web worker works out green rows' jumps, open and visible rows first (#98)"
```

### Task 6: Jump chips and the typed amount on a green row

**Files:**
- Modify: `app/components/donate/DonateWidget.tsx`, `app/components/vote/TestDonate.tsx` (a `preselect` prop)
- Modify: `app/components/vote/VoteResults.tsx` (feeds `useThreatJumps`; the `effect` line)
- Modify: `app/components/vote/GiveList.tsx` (reports which green rows are visible and in what order; passes jumps as suggestions; "working out" line)
- Test: `app/components/donate/DonateWidget.test.tsx`, `app/components/vote/TestDonate.test.tsx`, `app/components/vote/VoteResults.test.tsx`

**Interfaces:**
- Consumes: Task 5's `useThreatJumps`, `JumpUsd`; Task 4's `GiveRow.threat`.
- Produces:
  - `DonateWidget` / `TestDonate` prop `preselect?: boolean` (default `true`): `false` starts the field empty and never replaces the amount when suggestions change.
  - `GiveList` props `onGreenOrder?: (visible: string[], rest: string[]) => void` (slugs, in display order, each time it changes) and `jumps?: Map<string, JumpUsd[]>` (slug → chips for the current figures; a green row absent from it is still being worked out).

- [ ] **Step 1: Write the failing tests:**
  - `DonateWidget`/`TestDonate`: `"preselect false: the field starts empty and suggestions don't fill it"` (two suggestions, `preselect={false}`: value `""`; rerender with new suggestions: still `""`).
  - `VoteResults` (rounds with `live.inputs` giving green rows with numbers; no `Worker` in jsdom, so the hook's page-thread fallback runs):
    - `"an open green row suggests the donations at which its number jumps"`: the mocked form's "Suggested amounts" list shows each jump with label like `"$41k ahead"` or `"safe"` (values from `jumps()` on the same inputs), plus the cap; while not yet known, `"Working out what a donation does…"` shows.
    - `"the two visible green rows are worked out before anything is opened"`: with no row open, after the work settles, opening the first visible green row shows its chips at once (no working line).
    - `"a safe row has no jump chips"`: only the cap, no working line.
    - `"jump chips are worked out again when the round's inputs change"`: rerender with new `live.inputs`: the chips match `jumps()` on the new inputs.
    - `"closing a green row stops its work"`: open then close before it finishes; no console error, no chips later.
    - `"a typed amount on a green row says the new number"`: typing `2000` shows `"It asks the pool for $2,000 less, and it would then take $Y given to another initiative to push it out."` with `Y` from `threatOf(withGift(...))`, or `"…, and no single donation to another initiative pushes it out."`.
    - `"no number for a blank, mistyped or covering amount"`: `""` and `"abc"`: no line; the whole ask: today's covered wording, no number.

- [ ] **Step 2: Run them to see them fail**

Run: `deno run -A npm:vitest run app/components/vote app/components/donate`
Expected: FAIL

- [ ] **Step 3: Implement**:
  - `preselect` in both forms (initial state and the suggestion-follow effect skip when `false`).
  - `GiveList` calls `onGreenOrder` with the green rows it shows (the two, or all when expanded/filtered) and the rest; green row `suggested` = `jumps.get(slug)` mapped to `{ usd, note: threat === null ? "makes it safe from any single donation" : \`then ${usd(threat)} given to another initiative would push it out\`, label: threat === null ? "safe" : \`${usd2(threat, false)} ahead\` }`, `preselect={false}`, the #102 `cap` as now; no entry yet → the line `Working out what a donation does…` above the form.
  - `VoteResults`: `useThreatJumps({ key: <inputs digest, e.g. JSON of live.inputs hashed or rv.head>, inputs: rv.live.inputs, open: open green row index, visible, rest, typed: open green row && finite given below its ask ? { c, given } : undefined })` after typing pauses 400 ms; `effect` on a green row shows the typed sentence from the hook's `typed` (or "Working out what it does…" meanwhile); covered and blank cases as the test says.

- [ ] **Step 4: Run the tests**

Run: `deno task test` (whole suite)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app
git commit -m "Vote results: an open green row suggests the donations at which its number jumps (#98)"
```

### Task 7: Check it in the browser and close out

**Files:** none new.

- [ ] **Step 1: Full checks**

Run: `deno task test && deno task test:api && deno task typecheck && deno lint && deno fmt --check`
Expected: all pass (the one file `deno fmt --check` already flagged on `main` may remain; nothing new).

- [ ] **Step 2: See it**: start the app (the `run` skill or the project's dev task) and open `/vote/results/s-settling`: all green rows with checked dollar amounts and "ahead", blank figures for rows with no amount, and one bottom "+ N more initiatives" link revealing both hidden green rows and out-of-reach rows, the visible green rows' chips ready on opening (the worker shows in the browser's devtools), typing an amount updates the line, scrolling stays smooth while it works. Check narrow-screen wrapping of the longer labels and screenshot it for the maintainer.

- [ ] **Step 3: Note the timings** of the server search on the example round in the final message (from a quick `performance.now()` around `threatsAsync` in a scratch script, not committed).

- [ ] **Step 4: Review the formula-spike addendum and hand off accurately.** Record that
  this delivery uses exact $10 entry probes plus the $250 scan, checked $10 results,
  and the $1K jump grid;
  neither a checked result nor a `null` proves completeness at all $10 amounts.
  Confirm `live.threat` uses donations elsewhere and `final.lead` retains its old
  meaning. Include known search limitations and benchmark evidence in final review.
  The approved follow-up below implements entry probes and changes live copy to
  describe checked threats. The interval solver remains research, not shipped code.
  Include the $2,810 regression and the failed seeded-interval timing experiment.

## Follow-up formula spike (separate from Tasks 1–7)

Use the [spec addendum](../specs/2026-11-16-green-number-design.md#addendum-formulas-and-the-follow-up-spike-nov-16-2026)
as the handoff. This checklist describes future work; no formula replacement is
included in the documentation commit.

- [ ] Preserve reproducible inputs and an exhaustive oracle. State the search domain
  ($10 grid or every integer micro-USD), full-coverage exclusion, and meaning of safe.
  Test all green subjects against all eligible rivals, including green rivals.
- [ ] Prototype the exact red/phantom entry thresholds. Reproduce their proof and
  the integer tie rules; inspect later rank openings when no current ask fits.
  Retain the modified tally for knock-on lists. Use the red entry threshold only as
  a lower bound for a rival entering the settling tier, not as its green threat value.
- [ ] Investigate donation intervals with a fixed selection history, starting with
  the exact cumulative payment formula in the spec. Carry changes through shared
  backing, remaining pool, later openings and subsequent payments. Skip an interval
  only with a correctness bound; report complexity rather than assuming few splits.
- [ ] Require minimality and completeness evidence beyond a returned witness:
  separated danger intervals, narrow ranges inside a $250 bracket, equal coarse
  hits with different refined minima, strict ties, and integer-rounding boundaries.
  Do not infer absence of threats from agreement with a coarse scan's `null`.
- [ ] Evaluate self-donation jumps separately. Prove monotonicity or handle changing
  intervals; use exact typed amounts and retain the suggestion grid. Keep legacy
  backing-loss counterexamples separate from the donation-based threat fixtures.
- [ ] Compare small exhaustive rounds and the existing 60- and 96-initiative fixtures.
  For every mismatch retain the rival and amount internally with its tally trace.
  Benchmark all-rows, one-row, typed-amount and jump work separately, including cold
  time, work counts, memory and cancellation/worker responsiveness.
- [ ] Write up the proof, remaining approximation, counterexamples and measured
  tradeoffs before proposing a production replacement. Keep rival identities out of
  the API/UI and keep visitor-triggered searches off the server.

### Worktree and commit discipline for the earlier documentation-only update

The documentation update edits and commits only this plan and
`docs/superpowers/specs/2026-11-16-green-number-design.md` in `vote-issues`.
Task 6 is concurrently changing and committing `app/` files. Stage these two paths
explicitly, never `git add -A`, and commit only these paths so another task's staged
changes are not captured. Do not reset, stash, reformat or amend the other task's work.
Never merge `main` into `vote-issues`: it contains reverts of the #98 commits.

## Approved correctness follow-up (Nov 16, 2026)

The maintainer approved the following after the formula spike. This is a separate
follow-up to Tasks 1–6, not a change to copies held by their earlier implementers.
The [spec addendum](../specs/2026-11-16-green-number-design.md#addendum-checked-threats-and-entry-probes-nov-16-2026)
records the formula, counterexample, value semantics and timing evidence.

- [x] Run the bounded optimization attempt: seed exact interval verification with
  the coarse scan's checked amounts. Totals of 9.06 seconds for 60 initiatives and
  13.74 seconds for 96 fail the 2–4 second target. Keep that prototype out of production.
- [x] Add a first-entry $10 probe before each rival's coarse scan in
  `shared/vote/threat.ts`. Use it in all-rows and one-row searches, including worker
  work. Keep checked refinement, exclusions and the existing API shape.
- [x] Add the two-initiative regression: asks $1,900/$4,700, one shared $3,700 voter,
  pool $3,700. $2,800 does not displace the subject; $2,810 does; $2,900 does not.
  Assert all four search entry points find $2,810, and retain the real 96-initiative
  fixture. Check that the new probe never covers the rival's entire ask.
- [x] Replace live "ahead"/"safe" wording in rows, expanded text, suggestions and
  typed-amount results with checked-threat wording. Show full checked dollar amounts;
  keep null distinct from missing data. Update types/comments and UI regression tests.
- [x] Bump `WHAT_IFS_VERSION` to 8. Preserve `final.lead` and the worker lifecycle.
- [x] Check performance of the production search with entry probes: 1.89 seconds
  for 60 initiatives and 2.68 seconds for 96 in single local runs. The two fixtures
  agree with exhaustive $10 results; broader completeness remains unproven.
- [x] Run the full app/shared suite (174 files, 1,482 tests), relevant API integration
  suites (`vote-round` and `vote-replay`, 90 tests), typechecking, scoped lint,
  formatting and whitespace checks.
- [x] Build production assets successfully, including the separate threat worker.
- [ ] Complete visual verification in Task 7, including narrow screens. Attempted
  here, but the browser access host was unavailable; component tests cover the copy
  and behavior, not the rendered layout.

For this authorized code follow-up, stage only its explicit source/test paths and
these two docs. Keep other changes untouched and never merge `main` into
`vote-issues`. Do not describe a `null` as proof of safety or a witness as an exact
minimum in the commit, final review or handoff.

### Integration with main (Nov 16, 2026)

Regroup the branch into entry formulas, the complete checked-threat feature, and
documentation. Preserve main's newer scrolling, pool display, confirmed donations,
amount retention, animations and round corrections. Already-integrated #99 and #101
changes must not replace their newer versions on main.

The shared row figure retains the red countdown and flip to green. Green figures
show their full checked value immediately, without interpolating unchecked amounts.
Keep both the donation amount-retention tests and the empty green-form tests, plus
the animation test and a direct green-update regression. The effects example uses
the same checked-threat figure.

Integration validation passed: 179 app/shared test files (1,532 tests), 633 API and
deployment-planning tests, 165 contract tests, app/API typechecks, lint, dependency
audit and production build. The full format check reports two unchanged baseline
files (`api/README.md` and `shared/vote/fixtures/ballot-rules.json`); no changed file
fails it. Browser verification remains outstanding as recorded above.
