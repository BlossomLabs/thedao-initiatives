# Ballot Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a ballot valid only if it spreads money (minimum size, Tier-S independence by hidden project affiliations), enforce that on the page, the relayer, the contract and the tally, prefill ballots from the badge's star ratings, and let voters paste/copy pabutools ballots and use `/vote/llms.txt`.

**Architecture:** One rules core (`shared/vote/rules.ts`) mirrored by a Python reference and the Solidity contract, kept equal by shared fixtures. The contract stores affiliation groups as per-project bitmasks and checks a 3-index independence proof sent with each ballot. The replay refuses invalid ballots (covers blob ballots) and pads ballots recorded before a project was added.

**Tech Stack:** Solidity 0.8.28 + Foundry (`vote/`), Python 3 + pytest (`vote/reference`), Deno + Hono API, React + Vitest app, viem.

**Spec:** `docs/superpowers/specs/2026-11-11-ballot-rules-design.md` (approved 2026-11-11)

## Global Constraints

- In running text a tier is always `Tier-S` / `Tier-A` / `Tier-B` (use `tierName` from `shared/vote/ballot.ts`); the bare letter only in the tier table.
- Never call the results a "projector".
- Affiliations never render in the UI except in ballot-rule errors and the admin initiative edit form; they are listed in `/vote/llms.txt`.
- RFPs can't have affiliations (site and contract both refuse).
- Requested amount = the project's `askUsd` frozen in the contract (micro-USD), never the remaining need.
- Minimum size: `2 × Σ requested(placed) ≥ 3 × pool`. Group rule: `2 × Σ requested(tier ∩ g) ≤ Σ requested(tier)` (exactly half passes).
- Enforced tiers: a bitmask, bit 0 Tier-S, bit 1 Tier-A; Tier-B never; default `1`.
- Proof: `uint8[]`, three project indexes per enforced tier, Tier-S first. Not signed.
- Do not stage the user's uncommitted files: `vote/README.md`, `vote/docs/quiet-ending*.md`, `vote/docs/settlement-policy.md`, `vote/reference/quiet_ending_*.py`, `vote/reference/test_quiet_ending_on_time.py`, and the untracked files listed by `git status`. Stage by explicit path only.
- No pushes or merges.
- Verify per task with the commands named; the whole branch at the end: `npx vitest run`, `deno test -A api/ scripts/`, `deno task typecheck`, `deno lint`, `deno fmt --check`, `cd vote && forge test`, `cd vote/reference && python3 -m pytest -q`.

**Ruling (plan):** the manifest keeps `slugs: string[]` (20 call sites) and gains an aligned `projects` array, `groups` (names) and `independentTiers`, rather than turning `slugs` into objects as the spec words it. Same information, append-only, less churn.

## Review Focus

1. A ballot recorded before a project was added (shorter than the list) must still record, count, and read the new project as unplaced — tests in Tasks 3 and 5.
2. The pool rises between the page's check and the send: the relayer judges with the chain's current pool and refuses with the size error, not a bare 500 — test in Task 6.
3. Pasted text with CRLF line endings, spaces around `=`/`,`, or a header-less vote line must parse — test in Task 10.
4. Ratings for initiatives outside the round (or archived) must be ignored by the prefill, and a counted ballot or saved draft must beat ratings — tests in Task 9.
5. Boundary ballots: exactly 1.5× the pool, a group at exactly half, a Tier-S of two RFPs plus one tagged project — valid; tests in Task 1 (and the fixtures carry them to Python and Solidity).

---

### Task 1: The rules core

**Files:**
- Create: `shared/vote/rules.ts`, `shared/vote/rules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RulesProject = { askUsd: bigint; rfp: boolean; groups: number[] };
  export type RulesRound = {
    projects: RulesProject[]; groupNames: string[]; poolUsd: bigint; independentTiers: number;
  };
  export type RuleError =
    | { rule: "shape" }                                   // bad bytes, or longer than projects
    | { rule: "tiers" }                                   // more than three rank groups
    | { rule: "size"; requested: bigint; needed: bigint; pool: bigint }
    | { rule: "independent"; tier: 0 | 1; count: number; related: { group: number; projects: number[] }[] }
    | { rule: "group"; tier: 0 | 1; group: number; groupUsd: bigint; tierUsd: bigint };
  export type RulesResult = { ok: boolean; errors: RuleError[]; proof: number[] };
  export function tiersOf(ballot: Uint8Array): number[][];          // project indexes per rank group, in order
  export function checkBallot(ballot: Uint8Array, round: RulesRound): RulesResult;
  export function checkProof(ballot: Uint8Array, round: RulesRound, proof: number[]): boolean;
  ```
  `ballot` may be shorter than `projects` (missing = unplaced, 255). `needed = ceil(3 × pool / 2)`. `count` = size of the largest set of pairwise-unrelated projects in that tier, capped at 3 (search triples; RFPs and group-less projects are unrelated to everything). `related` lists each group with ≥2 projects in the tier. `proof` is non-empty only when `ok`: for each enforced tier, the first unrelated triple found in index order.

- [ ] **Step 1: Write the failing tests** in `shared/vote/rules.test.ts`, with a round of six projects asking `[100, 100, 100, 100, 50, 50]` (micro-USD units fine), groups `["Seal"]`, projects 0 and 1 in Seal, project 5 an RFP, pool `200`, enforced `1`:
  - `"a valid ballot: three unrelated in Tier-S, 1.5× the pool requested"` — S = {0,2,3} → `ok`, `proof` `[0,2,3]`.
  - `"related projects count as one"` — S = {0,1,2} plus B = {3,4} → error `{rule:"independent", tier:0, count:2, related:[{group:0, projects:[0,1]}]}`.
  - `"an RFP is independent of everything"` — S = {0,2,5} with B = {3} → `ok`.
  - `"a group may hold exactly half, not more"` — S = {0,1,2,3} (Seal 200 of 400) → ok, proof `[0,2,3]`; S = {0,1,2,5} (Seal 200 of 350) → `{rule:"group", tier:0, group:0, groupUsd:200n, tierUsd:350n}`.
  - `"minimum size is 1.5× the pool, exactly allowed"` — S = {0,2,3} (300) with pool 200 → ok; same ballot with pool 201 → `{rule:"size", requested:300n, needed:302n, pool:201n}`.
  - `"more than three tiers is invalid"` → `{rule:"tiers"}`.
  - `"Tier-A is checked only when enforced, and must then exist"` — enforced `3`, S valid and A empty → `independent` error for tier 1 with `count:0`; enforced `1` → ok.
  - `"a shorter ballot reads missing projects as unplaced"` — 4-byte ballot on the 6-project round → same result as the padded one.
  - `"checkProof accepts any valid triple and rejects related or misplaced ones"`.
  - `"tiersOf groups by competition rank"` — bytes `[1,1,3,255,3,1]` → `[[0,1,5],[2,4]]`.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run shared/vote/rules.test.ts` → cannot resolve `./rules`.

- [ ] **Step 3: Implement `shared/vote/rules.ts`** — group masks as `bigint` (`1n << BigInt(g)`); related = masks AND ≠ 0. Shape: bytes are 255 or `1..projects.length`, no rank gaps (same as `isValidOnchainBallot`), length ≤ projects.

- [ ] **Step 4: Run, expect PASS** — same command, 10 tests.

- [ ] **Step 5: Commit** — `git add shared/vote/rules.ts shared/vote/rules.test.ts && git commit -m "Vote: the ballot rules core (size, Tier-S independence, groups, proof)"`

### Task 2: Python reference and shared fixtures

**Files:**
- Create: `vote/reference/ballot_rules.py`, `vote/reference/test_ballot_rules.py`, `vote/reference/export_rules_fixtures.py`, `shared/vote/fixtures/ballot-rules.json`
- Modify: `shared/vote/rules.test.ts` (parity test)

**Interfaces:**
- Consumes: Task 1's semantics.
- Produces: `check_ballot(ballot: list[int], projects: list[dict], pool: int, independent_tiers: int) -> dict` returning `{"ok", "errors", "proof"}` with the same field names as Task 1 (`errors[i]["rule"]` etc., ints for amounts). Fixture JSON: `[{ "name", "projects": [{"askUsd": str, "rfp": bool, "groups": [int]}], "groupNames", "poolUsd": str, "independentTiers", "ballot": [int], "ok": bool, "rules": [str], "proof": [int] }]`, ≥40 cases: Task 1's ten plus seeded random rounds (6–30 projects, 0–4 groups, multi-group projects, RFPs).

- [ ] **Step 1: Write the failing pytest** `test_ballot_rules.py` mirroring Task 1's ten cases by name.
- [ ] **Step 2: Run, expect FAIL** — `cd vote/reference && python3 -m pytest -q test_ballot_rules.py` → ImportError.
- [ ] **Step 3: Implement `ballot_rules.py`**, then `export_rules_fixtures.py` (seed 2026, writes `../../shared/vote/fixtures/ballot-rules.json`), and run it.
- [ ] **Step 4: Add the parity test** `"matches the Python reference on every fixture"` in `shared/vote/rules.test.ts`: for each case `checkBallot(...)` has the same `ok`, the same `errors.map(e => e.rule)`, and the same `proof`.
- [ ] **Step 5: Run both, expect PASS** — the pytest command and `npx vitest run shared/vote/rules.test.ts`.
- [ ] **Step 6: Commit** — the four files plus the test, by path.

### Task 3: The contract

**Files:**
- Modify: `vote/contracts/RoundAccounting.sol`, `vote/contracts/SignedBallots.sol`, `vote/foundry.toml` (`fs_permissions = [{ access = "read", path = "../shared/vote/fixtures" }]`)
- Create: `vote/test/BallotRules.t.sol`
- Modify: `vote/test/SignedBallots.t.sol`, `vote/test/helpers/Fixtures.sol` (new `addInitiative` signature, proofs)

**Interfaces:**
- Produces (Solidity):
  - `struct Initiative { address account; uint256 askUsd; bool rfp; uint256 groups; }`
  - `function addGroup(bytes32 name) external returns (uint8 id)`; `event GroupAdded(uint8 indexed id, bytes32 name)`; `function groupCount() view returns (uint256)`; max 256 (`TooManyGroups`).
  - `function addInitiative(address account, uint256 askUsd, bool rfp, uint256 groups) external returns (uint256 id)`; `event InitiativeConfigured(uint256 indexed initiativeId, address indexed account, uint256 askUsd, bool rfp, uint256 groups)`. Reverts `RfpWithGroups`, `UnknownGroup` (bit ≥ groupCount), `AddingClosed`.
  - `function setInitiative(uint256 id, address account, uint256 askUsd, bool rfp, uint256 groups)` — setup-only as today.
  - `function setIndependentTiers(uint8 mask) external` — setup-only; `mask & ~3 != 0` reverts; default 1 set in the constructor.
  - `function vote(uint256 tokenId, uint64 nonce, bytes calldata ballot, uint8[] calldata proof)`; `recordFor(..., bytes calldata signature, uint8[] calldata proof)`; `struct Vote { ...; bytes ballot; uint8[] proof; }`. EIP-712 digest unchanged.
  - Errors: `TooManyTiers()`, `BallotTooSmall()`, `TooFewIndependent(uint8 tier)` (tier has < 3 projects), `BadProof(uint8 tier)`, `GroupOverHalf(uint8 tier, uint8 group)`.
- Adding window: `addGroup`/`addInitiative` allowed when `block.timestamp < opensAt`, or when for every tier t NOT `firstTallyAt[t] <= now < latestSettlementAt(t)`, and `now < hardDeadline`.
- Ballot length: `1 <= ballot.length <= projectCount()`.

- [ ] **Step 1: Write failing tests** in `BallotRules.t.sol`:
  - `test_fixtures` — reads `ballot-rules.json`, deploys a round per case (groups, initiatives, pool, tiers), records the ballot with the fixture proof (or a dummy proof when `ok` is false) and expects success iff `ok`.
  - `test_shortBallotRecordsAfterAnAddition` — record a ballot of length m, `addInitiative` in a gap, record a length-m ballot again: succeeds.
  - `test_addingClosedInsideQuietEnding` — warp to `firstTallyAt[0]` → `AddingClosed`; warp to `latestSettlementAt(0)` (before `firstTallyAt[1]`) → succeeds; at `hardDeadline` → `AddingClosed`.
  - `test_rfpCannotHaveGroups`, `test_unknownGroupReverts`, `test_badProofReverts` (related pair in the proof), `test_tooManyTiers`, `test_frozenAfterOpen` (`setInitiative`, `setIndependentTiers` → `ConfigurationFrozen`).
- [ ] **Step 2: Run, expect FAIL** — `cd vote && forge test --match-contract BallotRules` → compile errors.
- [ ] **Step 3: Implement** in the two contracts; update existing tests and `Fixtures.sol` to the new signatures (existing ballots need valid shapes and proofs: give fixtures 3 group-less projects in Tier-S and a pool ≤ ⅔ of asks).
- [ ] **Step 4: Run, expect PASS** — `cd vote && forge test` (all suites).
- [ ] **Step 5: Commit** — the contract, test and toml files by path.

### Task 4: Round file, ABI and send helpers

**Files:**
- Modify: `shared/vote/manifest.ts`, `shared/vote/manifest.test.ts`, `shared/vote/abi.ts`, `shared/vote/record.ts`, `shared/vote/record.test.ts`, `app/lib/vote-flow.ts` (+ its test), `api/services/vote-chain.ts` (send path)

**Interfaces:**
- Produces:
  - `VoteManifest` gains `projects: { askUsd: string; rfp: boolean; groups: number[] }[]` (aligned with `slugs`), `groups: string[]`, `independentTiers: number`. `checkManifest` throws when `projects.length !== slugs.length`, when an RFP has groups, or when a group index is out of range.
  - `export function rulesRound(m: VoteManifest, poolUsd?: bigint): RulesRound` in `manifest.ts` (pool defaults to `BigInt(m.poolUsd)`).
  - `recordVote(s & { proof: number[] })` returns the `Vote` tuple with `proof`.
  - ABI: the Task 3 signatures and events.
  - The browser self-send and the relayer pass `proof`.
- [ ] **Step 1: Failing tests** — `manifest.test.ts`: `"checkManifest refuses misaligned projects, tagged RFPs and unknown groups"`, `"rulesRound maps the manifest"`; `record.test.ts`: `"carries the proof"`; `vote-flow` test: self-send calls `recordFor` with the proof argument.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run shared/vote app/lib/vote-flow`.
- [ ] **Step 3: Implement**; update `manifest-data.ts` by hand to the new shape for the existing round (`projects` from its asks if known, else `askUsd: "0"`, `groups: []`, `rfp: false`; it is replaced by the next deploy) so the app still builds.
- [ ] **Step 4: Run, expect PASS** — same, plus `deno task typecheck`.
- [ ] **Step 5: Commit.**

### Task 5: The replay refuses invalid ballots

**Files:**
- Modify: `shared/vote/quiet-ending.ts`, `shared/vote/quiet-ending.test.ts`, `api/services/vote-chain.ts` (+ fake chain in `api/tests/vote-round.test.ts`), `api/routes/vote.ts` (wiring)

**Interfaces:**
- Consumes: `checkBallot`, `RulesRound` (Task 1), `rulesRound` (Task 4).
- Produces:
  - `Rejection.reason` adds `"invalid_ballot"`.
  - `replay` input gains `rules?: { round: RulesRound; addedAt: number[]; pool: { timestamp: number; poolUsd: bigint }[] }` — `addedAt[i]` = timestamp of project i's `InitiativeConfigured` (0 for deploy-time projects); at a receipt, the round's projects are those with `addedAt <= timestamp` and the pool is the last entry with `timestamp <= receipt` (else `round.poolUsd`). Invalid → rejected like `tier_settled` (earlier ballot keeps counting). Every accepted ballot is padded with 255 to `m`.
  - `VoteChain` gains `projectsAdded(): Promise<{ id: number; timestamp: number }[]>` and `poolChanges(): Promise<{ timestamp: number; poolUsd: bigint }[]>` (logs `InitiativeConfigured`, `PoolUsdSet`, stamped like ballots).
- [ ] **Step 1: Failing tests** in `quiet-ending.test.ts`: `"an invalid ballot is refused; the earlier one still counts"`, `"a first ballot that breaks a rule leaves the badge unvoted"`, `"validity uses the projects and pool at that receipt"` (pool raised after the ballot: still valid; raised before: refused), `"a ballot recorded before a project was added reads it as unplaced"`. In `vote-round.test.ts`: `"round: an invalid ballot shows as refused with invalid_ballot"`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run shared/vote/quiet-ending.test.ts` and `deno test -A api/tests/vote-round.test.ts`.
- [ ] **Step 3: Implement**; `/api/vote/round` and `/api/vote/ballots` pass `rules` from the chain reads; `/round` JSON adds `poolUsd` (current, string).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

### Task 6: The relayer checks and proves

**Files:**
- Modify: `api/routes/vote.ts`, `api/tests/vote-round.test.ts`

**Interfaces:**
- Consumes: `checkBallot`, `rulesRound`, `VoteChain.poolChanges`.
- Produces: `POST /api/vote/ballot` → `422 { code: "invalid_ballot", message, errors: RuleError[] (bigints as strings) }` before signing anything; when valid, sends `record` with the computed proof. Pool = the latest `poolChanges()` value, else the manifest's.
- [ ] **Step 1: Failing tests**: `"ballot: a ballot breaking a rule is refused with its errors, nothing sent"`, `"ballot: a valid ballot is relayed with its proof"`, `"ballot: judged with the chain's current pool"` (pool raised on the fake chain → size error).
- [ ] **Step 2: Run, expect FAIL** — `deno test -A api/tests/vote-round.test.ts`.
- [ ] **Step 3: Implement.** `message`: `"This ballot breaks the ballot rules."`
- [ ] **Step 4: Run, expect PASS** — plus `deno test -A api/ scripts/`.
- [ ] **Step 5: Commit.**

### Task 7: Affiliations on initiatives

**Files:**
- Modify: `api/db/types.ts` (`Initiative.affiliations: string[]`), `api/db/initiatives.ts`, `api/routes/initiatives.ts` (admin update accepts `affiliations`), `api/services/content.ts` (front matter `affiliations:` list), `content/initiatives/README.md` (document `affiliations`), `app/routes/admin.initiative.tsx` (a Affiliations field), tests next to each.

**Interfaces:**
- Produces: `normalizeAffiliations(raw: string[]): string[]` in `shared/affiliations.ts` — trims, drops empties, 1–32 chars (else error "Affiliations are 1–32 characters"), dedupes case-insensitively keeping the first spelling. An RFP with affiliations → 400 `"RFPs can't have affiliations."` (API) / parse error (content). Affiliations are an admin field saved directly, outside the proposer edit review. Missing `affiliations` reads as `[]`.
- [ ] **Step 1: Failing tests**: `shared/affiliations.test.ts` (`normalizeAffiliations` cases); API: `"admin sets affiliations; an RFP's affiliations are refused"`; content: `"affiliations parse; an RFP with affiliations is an error"`; feeds: `"affiliations appear in no public feed"` — `/llms.txt`, `/llms-full.txt`, `/api/initiatives.json` and `/initiative/<slug>.md` don't contain an affiliation value set on a grant; admin form test: the field saves.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Public API responses that already spread the whole `Initiative` must drop `affiliations` (check `toPublic`/card builders; the feed test catches leaks).
- [ ] **Step 4: Run, expect PASS** — `npx vitest run app/routes/admin.initiative.test.tsx shared/affiliations.test.ts` and `deno test -A api/`.
- [ ] **Step 5: Commit.**

### Task 8: Deploy and add projects

**Files:**
- Modify: `scripts/vote-deploy.ts`, `scripts/vote-deploy.test.ts`, `deno.json` (task flags unchanged)

**Interfaces:**
- Consumes: board cards (add `type` and `affiliations` to `BoardCard`), Task 3 ABI, Task 4 manifest.
- Produces:
  - `planGroups(cards): { names: string[]; maskOf: (slug) => bigint }` — one group per distinct affiliation (case-insensitive, first spelling), ordered by first appearance in board order.
  - `planInitiatives` returns `{ slug, account, askUsd, rfp, groups }`.
  - Deploy sends `addGroup` per name before `addInitiative`, `setIndependentTiers(--independent-tiers, default 1)`, and writes `projects`, `groups`, `independentTiers` to the manifest.
  - `--add <slug>[,<slug>…]` with `--contract`: reads the manifest, refuses when `addingOpen(schedule, now)` is false with `"Adding is closed until <ISO time>"` (the next gap), sends `addGroup` for new affiliations and `addInitiative` per slug, appends to the manifest. `export function addingOpen(s: Schedule, latestEnds: number[], hardDeadline: number, now: number): boolean`.
- [ ] **Step 1: Failing tests**: `"planGroups: one group per affiliation, case-insensitive"`, `"planInitiatives carries rfp and groups; an RFP with affiliations throws"`, `"addingOpen: before opening, between tiers, never inside a span or after the deadline"`, `"--add appends to the manifest without reordering"`.
- [ ] **Step 2: Run, expect FAIL** — `deno test -A scripts/vote-deploy.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

### Task 9: The ballot page — rules, prefill, instructions

**Files:**
- Create: `app/components/vote/BallotRules.tsx` (+ test), `app/lib/vote-prefill.ts` (+ test), `app/lib/vote-rules-copy.ts` (+ test)
- Modify: `app/components/vote/VotePage.tsx`, `app/components/vote/TierBallot.tsx` (a `notice` slot: between the tier list and the send bar on wider screens, `order-first` on a phone), `app/hooks/use-vote.ts` (`useRatingsPrefill`), `app/routes/vote.code.test.tsx`

**Interfaces:**
- Consumes: `checkBallot`, `rulesRound`, `/round` `poolUsd` (Task 5), `RuleError`.
- Produces:
  - `ruleMessage(e: RuleError, titleOf: (i: number) => string, groupName: (g: number) => string): string` with exactly this copy (whole dollars, `$1,234`):
    - size: `Your ballot requests {requested}. It must request at least {needed} (1.5× the {pool} pool). Add more projects; Tier-B is a good place for them.`
    - independent: `{Tier-X} needs at least 3 independent projects. ` + per related group `{A and B} are affiliated with {Seal}, so they count as one.` (names joined "A, B and C")
    - group: `Projects affiliated with {Seal} take {groupUsd} of {Tier-X}'s {tierUsd}. One affiliation can hold at most half.`
    - tiers: `Use at most three tiers.` · shape: `This ballot can't be read.`
  - `prefillFromRatings(mine: Record<string /*slug*/, number /*stars*/>, slugs: string[]): Partial<Record<string, Tier>>` — 5→S, 4→A, 3→B, else nothing; slugs outside the round ignored.
  - `useRatingsPrefill(tokenId: string | null)` → `{ data?: Record<slug, stars> }` from `/api/reviews/ratings?tokenId=` mapped id→slug through the board cards. Token: the badge number in the real vote; in a test round the signed-in account's lowest review-badge token id (`/api/reviews/identity`), none → no prefill.
  - VotePage: prefill only when `rv` is loaded, the badge has no counted ballot and `loadTiers(n)` is empty; checks with `rulesRound(ROUND, BigInt(rv.poolUsd ?? ROUND.poolUsd))`; Send and Send-it-yourself disabled while `!ok`; self-send passes `proof`; `invalid_ballot` refusal line: `Not counted: it breaks the ballot rules. Your earlier ballot still counts.`
  - Header instructions add, after the pool sentence: `A ballot needs at least 3 unrelated projects in Tier-S and must request at least 1.5× the pool in total. Anything you leave unranked gets nothing from you; your share of it returns to TheDAO. Put every project you'd be glad to see funded in Tier-B: it only takes money once Tier-S and Tier-A are done.`
- [ ] **Step 1: Failing tests**: copy tests for each `ruleMessage` case with exact strings; `prefillFromRatings` (incl. a slug outside the round, 1–2★ dropped); page tests: `"a ballot breaking a rule shows why and can't be sent"`, `"a fresh badge opens with its ratings as tiers"`, `"a counted ballot or a saved draft wins over ratings"`, `"in a test round the signed-in reviewer's ratings fill it"`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run app/lib app/components/vote app/routes/vote.code.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**; screenshot `?mock=spent` (extend the mock with `projects`/`groups` making Tier-S invalid via a `?mock=invalid` variant) at 1400 and 390 widths.
- [ ] **Step 5: Commit.**

### Task 10: Paste and copy (pabutools, Blossom ties)

**Files:**
- Create: `shared/vote/pb.ts`, `shared/vote/pb.test.ts`, `app/components/vote/PasteBallot.tsx` (+ test)
- Modify: `app/components/vote/VotePage.tsx`

**Interfaces:**
- Produces:
  - `parseBallotText(text: string, slugs: string[]): { tiers: Partial<Record<string, Tier>> } | { error: string }` — accepts a full `.pb` (sections `META`/`PROJECTS`/`VOTES`, `;` columns, takes the single `VOTES` row's `vote` column) or a bare vote line; groups split by `,`, ties by `=`, whitespace and CRLF ignored; group k → `["S","A","B"][k]`. Errors: `Unknown project: {id}`, `{id} is listed twice`, `Use at most three tiers.`, `No vote found.`
  - `formatBallotPb(tiers, round: { slugs: string[]; titles: (slug) => string; askUsd: (slug) => bigint }): string` — META `description;TheDAO vote ballot`, `vote_type;ordinal`, `blossom_ties;1`; PROJECTS `project_id;cost;name` (whole dollars) for every round project; VOTES `voter_id;vote` with one row `1;…`. Round-trips through `parseBallotText`.
  - `PasteBallot` — buttons "Paste a ballot" (textarea + Apply, shows the parse error, applying calls `replaceTiers`), "Copy my ballot", and a link "Build your ballot with an LLM" → `/vote/llms.txt`. Placed under the send buttons. After applying, if settled tiers were overridden by the sync, a line: `Settled tiers stay as they were counted.`
- [ ] **Step 1: Failing tests**: `pb.test.ts` — the spec's example; bare line; CRLF and spaces; unknown/duplicate/four groups; round-trip of format→parse; component test: paste applies, error shows, nothing is sent.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

### Task 11: `/vote/llms.txt`

**Files:**
- Create: `api/services/vote-llms.ts`, `api/tests/vote-llms.test.ts`
- Modify: `api/routes/feeds.ts` (route + `FEED_PATHS`), `vite.config.ts` (dev proxy `"/vote/llms.txt"`)

**Interfaces:**
- Consumes: manifest, board cards (titles, needs, type), `formatBallotPb` example, `tierName`.
- Produces: `voteLlms(m: VoteManifest, cards, origin: string): string` — `# TheDAO vote: build your ballot`, `> ` summary (pool, dates in UTC, kind), sections `## How the tally spends your share` (same words as the page instructions), `## Ballot rules` (the three rules with the 1.5× amount in dollars and the enforced tiers), `## Ballot format` (the pabutools/Blossom example), `## Projects` (one line each: `- {slug} — {title} · {RFP|Grant} · requests ${ask} · still needs ${need} · affiliations: {affiliations or none} · [details]({origin}/initiative/{slug}.md)`), `## What to do` (ask the voter for ratings/priorities, output one vote line that passes the rules, name the three unrelated Tier-S projects). Served `text/plain; charset=utf-8`, `Cache-Control: max-age=300`, ETag like the other feeds; 404 when no round is deployed.
- [ ] **Step 1: Failing tests**: `"lists every round project with type, amounts and affiliations"`, `"states the rules with the pool's 1.5× in dollars"`, `"includes a format example that parses"` (`parseBallotText` on the example), `"404 without a round"`.
- [ ] **Step 2: Run, expect FAIL** — `deno test -A api/tests/vote-llms.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.**

### Task 12: Docs

**Files:**
- Modify: `vote/docs/withholding.md` (a note at the top: historical; the vote has no optional withholding choice and no tail — unplaced gets nothing), `docs/superpowers/specs/2026-11-11-vote-design.md` (link to the ballot rules spec), the ballot page's "How Blossom Budgeting works" link if blossom.software describes a tail or a C tier (check it; if it does, link `/vote/llms.txt#how` instead).
- `vote/README.md` holds the user's uncommitted edits: write the new rules/groups/proof/additions section there but **do not stage it**; report it as left for the user.

- [ ] **Step 1:** Edit; `deno fmt --check`.
- [ ] **Step 2: Commit** `vote/docs/withholding.md` and the spec link by path only.

---

## Self-review notes

- Spec coverage: prefill (9), no C tier/no checkbox copy (9, 12), minimum size (1–3, 5, 6, 9), independence + RFP + half (1–3), Tier-A setting (1, 3, 8), affiliations hidden (7, 9, 11), RFP no affiliations (3, 7, 8), invalid blocks everywhere (3, 5, 6, 9), proof (1, 3, 4, 6), additions during the vote (3, 5, 8), paste/copy (10), llms.txt (11), test-round prefill (9), docs (12).
- The contract can't see blob ballots' bytes; Task 5's replay check covers them.
