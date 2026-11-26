# On the ballot, the round leads: locked facts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once an initiative is on the production ballot, its goal, type and affiliations can't change on the site alone; a site admin changes them on the round and the site copies the round.

**Architecture:** One server helper reads the stored production manifest (KV, no RPC) and every write path asks it before touching goal/type/affiliations. The existing round refresh in `api/bootstrap.ts` gains a follow step that copies the round's values into on-ballot rows. The initiative edit page gets a "Set on the round" panel that reuses the corrections API and either sends `setInitiative` from an `ADMIN_ROLE` wallet or downloads the Safe batch.

**Tech Stack:** Deno, Hono, Deno KV, React + TanStack Query, viem/wagmi, `deno test`.

**Spec:** `docs/superpowers/specs/2026-11-26-ballot-locked-facts-design.md`

## Global Constraints

- "On the ballot" = slug in `onBallotSlugs(manifest)` of the stored `voteSettingKey("production")` setting (`roundOf`). No production round: nothing locks, nothing follows. Test rounds never lock or write rows.
- The lock never lifts (settled, closed rounds included).
- The Safe is never changed from the website: not by the follow step, not by the corrections form.
- Affiliations follow only groups held by 2+ initiatives in the round; a group only one initiative holds is ignored in both copy and comparison.
- Refusal copy (exact): `ON_BALLOT = "On the ballot: a round admin changes this on the round."`
- Held-goal refusal copy (exact): `` `This edit sets the goal to ${usd(goal)}. On the ballot, set it on the round first, then accept the edit.` `` where `usd` renders like `$78,000`.
- Proposer note under a disabled goal (exact): `On the ballot: ask a round admin to change the goal.`
- AGENTS.md copy rules apply (tier names, dates via `app/lib/format.ts`).
- Run the suite with the project's task (`deno task test`); format with `deno fmt`, lint with `deno lint`.

## Review Focus

1. A goal sent equal to the current one (an edit form that always posts `goal`) must not be refused — only a change is. Pinned in Task 2.
2. Site affiliations differing from the round only by case or order must not be rewritten every refresh. Pinned in Task 5.
3. A held revision with no `goalUsd`, or the same goal, must still be acceptable on a ballot initiative. Pinned in Task 3.
4. The follow step must not touch a row of a test (Sepolia) round, nor rows not in the round. Pinned in Task 5.
5. sync-content of an on-ballot row must keep goal/type/affiliations but still apply the text revision and other facts. Pinned in Task 3.

---

### Task 1: The lock helper

**Files:**
- Create: `api/services/ballot-lock.ts`
- Test: `api/tests/ballot-lock.test.ts`

**Interfaces:**
- Produces:
  - `ON_BALLOT: string` (exact copy above)
  - `ballotSlugs(db: Db): Promise<Set<string>>` — `onBallotSlugs(roundOf(await db.meta.get<VoteRoundSetting>(voteSettingKey("production")))?.manifest)`
  - `assertOffBallot(ballot: Set<string>, slug: string, changed: boolean): void` — throws `new HttpError(409, ON_BALLOT)` when `changed && ballot.has(slug)`
  - `productionManifest(db: Db): Promise<VoteManifest | undefined>` (used by Tasks 5–6)

- [ ] **Step 1: Write the failing tests** (`harness()`; seed with `h.db.meta.set(voteSettingKey("production"), { round: { manifest, by: ADMIN, at: 1 } })`, manifest `{ ...NO_ROUND, kind: "real", chainId: 1, badge: …, slugs: ["a", "b"] }` as in `vote-environments.test.ts`)
  - `ballotSlugs: production round slugs` → `new Set(["a","b"])`
  - `ballotSlugs: none without a production round` (only a test setting stored) → empty set
  - `assertOffBallot: refuses a change on the ballot` → throws `HttpError` status 409, message `ON_BALLOT`
  - `assertOffBallot: allows no change, or off the ballot` → no throw for `(set, "a", false)` and `(set, "z", true)`
- [ ] **Step 2: Run** `deno test -A api/tests/ballot-lock.test.ts` — FAIL (module missing)
- [ ] **Step 3: Implement** `api/services/ballot-lock.ts` with the signatures above.
- [ ] **Step 4: Run** the same — PASS
- [ ] **Step 5: Commit** `feat(vote): ballot lock helper for chain-stored facts (#149)`

### Task 2: Lock the initiative routes, and say so in GET

**Files:**
- Modify: `api/routes/initiatives.ts` (GET `/:slug` ~L207 response; `POST /:slug/revisions` ~L348; `PATCH /:slug` ~L383)
- Modify: `app/lib/api-types.ts` (the initiative detail response type: add `onBallot: boolean`)
- Test: `api/tests/ballot-lock.test.ts`

**Interfaces:**
- Consumes: `ballotSlugs`, `assertOffBallot` (Task 1)
- Produces: GET `/api/initiatives/:slug` JSON gains `onBallot: boolean`

- [ ] **Step 1: Write the failing tests** (on-ballot slug, approved row with `goalUsd: 108000`, `type: "grant"`)
  - `PATCH goal on the ballot: 409` — admin PATCH `{ goal: 78000 }` → 409, `error === ON_BALLOT`; row still 108000
  - `PATCH type on the ballot: 409` — admin PATCH `{ type: "rfp" }` → 409
  - `PATCH same goal and other facts on the ballot: 200` — `{ goal: 108000, durationMonths: 12 }` → 200, duration saved
  - `revision with a new goal on the ballot: 409` — proposer POST revisions with `goal: 78000` → 409; with `goal: 108000` or no goal → 201
  - `GET says onBallot` — `true` for the ballot slug, `false` for another
- [ ] **Step 2: Run** `deno test -A api/tests/ballot-lock.test.ts` — the new tests FAIL
- [ ] **Step 3: Implement** — in PATCH, after `readPageFacts`: `assertOffBallot(ballot, slug, (patch.goalUsd !== undefined && patch.goalUsd !== initiative.goalUsd) || (patch.type !== undefined && patch.type !== initiative.type))`; in revisions, after `parseGoal`: `assertOffBallot(ballot, slug, goalUsd !== initiative.goalUsd)`; GET adds `onBallot: (await ballotSlugs(db)).has(initiative.slug)`.
- [ ] **Step 4: Run** — PASS; then `deno task test` — all green
- [ ] **Step 5: Commit** `feat(vote): goal and type of a ballot initiative change only on the round (#149)`

### Task 3: Lock the admin paths (accept, affiliations, content sync)

**Files:**
- Modify: `api/routes/admin.ts` (accept ~L1060; `PATCH /initiatives/:id` affiliations ~L1014; `/sync-content` ~L1828)
- Modify: `api/services/content.ts` (`syncContent`, `syncStaged`, `SyncResult`)
- Modify: `api/db/initiatives.ts` (`upsertContent` ~L627)
- Test: `api/tests/ballot-lock.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces: `syncContent(db, files, audit?, locked?: Set<string>)`; `SyncResult.kept: string[]` (slugs whose goal/type/affiliations were kept); `upsertContent(slug, f, opts?: { keepChainFacts?: boolean })`

- [ ] **Step 1: Write the failing tests**
  - `accept a held goal change on the ballot: 409` — held revision with `goalUsd: 78000` on a 108000 row → 409, message equals the held-goal copy with `$78,000`; row unchanged, revision still waiting
  - `accept a held edit without a goal change on the ballot: 200` — held revision with no `goalUsd` (and one with `goalUsd: 108000`) → 200, text live
  - `accept after the goal matches: 200` — set row goal to 78000 (simulating the follow), accept → 200
  - `affiliations on the ballot: 409` — admin PATCH `{ affiliations: "SEAL" }` → 409; same list (any case/order) → 200
  - `sync-content keeps chain facts on the ballot` — file with a new goal, type, affiliations and new text for an on-ballot slug → `kept` contains the slug; goal/type/affiliations unchanged; text revision applied; `recipientUrl` updated
- [ ] **Step 2: Run** — FAIL
- [ ] **Step 3: Implement**
  - accept: before `db.initiatives.review`, when `verdict === "accept"` and the slug is on the ballot, read the held revision (`db.revisions.get(initiative.id, n)`); if its `goalUsd !== undefined && goalUsd !== initiative.goalUsd`, throw 409 with the held-goal copy.
  - affiliations: compare lowercased sorted lists; `assertOffBallot(ballot, initiative.slug, differ)`.
  - sync-content: route passes `await ballotSlugs(db)`; `syncStaged` calls `upsertContent(slug, fields, { keepChainFacts: locked.has(slug) })` and records `kept`; `upsertContent` with `keepChainFacts` omits `goalUsd`, `type`, `affiliations` from the patch and passes `goalUsd: undefined` to `revise`.
- [ ] **Step 4: Run** — PASS; `deno task test` green (update any `SyncResult` equality in existing tests to include `kept: []`)
- [ ] **Step 5: Commit** `feat(vote): admin edits and content sync keep a ballot initiative's round facts (#149)`

### Task 4: Corrections never change the account

**Files:**
- Modify: `shared/vote/corrections.ts` (`case "initiative"` ~L67)
- Modify: `app/components/admin/VoteCorrections.tsx` (`InitiativeFields` ~L373)
- Test: `shared/vote/corrections.test.ts`

**Interfaces:**
- Produces: `prepareCorrection` `initiative` action takes `account` optional; when given it must equal `m.accounts[i]` (case-insensitive) else rejects `"The account can't change here: it is the initiative's Safe."`; it always encodes `m.accounts[i]`.

- [ ] **Step 1: Write the failing tests**
  - `initiative correction keeps the account` — body without `account` → `setInitiative` args[1] equals `m.accounts[i]`
  - `initiative correction refuses another account` — body `account` = another address → throws with the copy above
- [ ] **Step 2: Run** `deno test -A shared/vote/corrections.test.ts` — FAIL
- [ ] **Step 3: Implement**; in `InitiativeFields` replace the account input with a read-only line "Safe: {shortAddr(account)}" and stop sending `account`. Drop the "account …→…" part of the summary.
- [ ] **Step 4: Run** — PASS
- [ ] **Step 5: Commit** `fix(vote): round corrections leave an initiative's Safe as it is`

> **Revision 2 (Nov 26):** Tasks 1–4 are done. Tasks 5–9 below replace the earlier Tasks 5–7
> (spec: "Revision 2"). Task 2's goal refusals become goal requests in Task 6; type and
> affiliation refusals stay.

### Task 5: Goal requests (store) and the follow step

**Files:**
- Create: `api/services/goal-requests.ts`, `api/services/ballot-follow.ts`
- Modify: `api/bootstrap.ts` (production `activeVote` refresh)
- Test: `api/tests/ballot-follow.test.ts`

**Interfaces:**
- Produces (`goal-requests.ts`), key `["goal-request", rfpId]`, value tagged with the round so another round's record is ignored:
  - `type GoalRequest = { rfpId: string; contract: string; goalUsd: number; by: string; at: number }`
  - `requestGoal(db: Db, m: VoteManifest, row: Initiative, goalUsd: number, by: string): Promise<GoalRequest | null>` — `null` (and the request dropped) when `goalUsd === row.goalUsd`
  - `goalRequestOf(db: Db, m: VoteManifest | undefined, rfpId: string): Promise<GoalRequest | null>`
  - `goalRequests(db: Db, m: VoteManifest): Promise<GoalRequest[]>`, `dropGoalRequest(db: Db, rfpId: string): Promise<void>`
- Produces (`ballot-follow.ts`):
  - `sharedGroups(m: VoteManifest, i: number): string[]`
  - `type FollowChange = { slug: string; field: "goalUsd" | "type" | "affiliations"; from: unknown; to: unknown }`
  - `followRound(db: Db, m: VoteManifest): Promise<FollowChange[]>` — no-op unless `m.kind === "real"`; per slug: goal ← `Number(BigInt(goalUsd) / 10_000n) / 100`, type ← `rfp ? "rfp" : "grant"` (field only), affiliations ← `sharedGroups` when lowercased sets differ; never `safeAddress`; then drops every goal request whose `goalUsd` equals the round's goal for that initiative.

- [ ] **Step 1: Failing tests** — `sharedGroups drops a group only one initiative holds`; `follows goal, type and shared affiliations`; `ignores case and order in affiliations`; `own-team group is not copied`; `never writes the Safe`; `a test round changes nothing`; `rows not in the round are untouched`; `a request the round now matches is dropped, another stays`; `requestGoal: the current goal drops the request`; `goalRequestOf ignores another round's request`.
- [ ] **Step 2: Run** `deno test -A api/tests/ballot-follow.test.ts` — FAIL
- [ ] **Step 3: Implement**; in `bootstrap.ts` production refresh call `followRound(db, next)` when the revision/anchor changed and once per isolate on the first refresh; log changes (`console.info("ballot-follow", …)`); catch and log errors, never fail the refresh.
- [ ] **Step 4: Run** — PASS; `deno task test:api` green
- [ ] **Step 5: Commit** `feat(vote): ballot initiatives follow the round, and goal requests settle with it (#149)`

### Task 6: Goal edits on the ballot become requests

**Files:**
- Modify: `api/routes/initiatives.ts` (PATCH, revisions, GET), `api/routes/admin.ts` (accept; admin initiative GET ~L939), `api/db/initiatives.ts` (`review` gains `opts: { keepGoal?: boolean }`, `revise` callers), `app/lib/api-types.ts`
- Test: `api/tests/ballot-lock.test.ts` (rewrite the three goal-refusal tests)

**Interfaces:**
- Consumes: Task 5's `requestGoal`, `goalRequestOf`; Task 1's `productionManifest`
- Produces: PATCH answers `202 { initiative, goalRequest }` when it held a goal; GET `/api/initiatives/:slug` and the admin initiative GET carry `goalRequest?: { goalUsd: number; by: string; at: number }`

- [ ] **Step 1: Failing tests** (replace "PATCH goal… 409" and "revision with a new goal… 409" and "accepting a held goal change… 409")
  - `admin PATCH goal on the ballot: 202, the page keeps its goal` — row 25000, `goalRequest.goalUsd === 78000`; GET shows it
  - `admin PATCH back to the current goal drops the request`
  - `admin live text edit with a new goal: text live, goal requested`
  - `proposer edit with a new goal is held; accepting it puts the text live and requests the goal` — row goal 25000, title changed, request 78000
  - `off the ballot a goal edit applies as before`
  - keep: type 409, same goal 200, affiliations 409, sync keeps
- [ ] **Step 2: Run** — FAIL
- [ ] **Step 3: Implement** — PATCH: strip `goalUsd` from the patch when on the ballot and it differs, `requestGoal`, answer 202; revisions: when on the ballot and the goal differs, a held edit carries it as today, a live edit goes in without it and `requestGoal`; accept: `review(..., { keepGoal: onBallot })` then `requestGoal` with the held goal; GETs read `goalRequestOf` in the same `Promise.all` (the kv-depth test must stay green).
- [ ] **Step 4: Run** — PASS; `deno task test:api` green
- [ ] **Step 5: Commit** `feat(vote): a ballot initiative's goal change waits for a round admin (#149)`

### Task 7: The round admin's queue lists goal changes

**Files:**
- Modify: `api/services/round-admin-queue.ts`, `api/routes/admin.ts` (queue GET; new `DELETE /initiatives/:id/goal-request`), `app/lib/api-types.ts`
- Test: `api/tests/ballot-follow.test.ts` (or the queue's test file if it has one)

**Interfaces:**
- Produces: `RoundAdminQueueJson.goals: GoalToSignJson[]` where `GoalToSignJson = { rfpId: string; slug: string; title: string; fromUsd: number; toUsd: number; by: string; at: number; call: { id: string; account: string; goalUsd: string; rfp: boolean; groups: string }; batch: unknown }` (`call` values as decimal strings; `batch` = `adminBatch(m, "Change a goal", [requireConfigRevision, setInitiative])`)

- [ ] **Step 1: Failing tests** — `the queue lists a goal request with the round's account, RFP flag and groups`; `discard drops the request`; `a request whose initiative left the round is not listed`
- [ ] **Step 2: Run** — FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** — PASS
- [ ] **Step 5: Commit** `feat(vote): goal changes to sign in the round admin's queue (#149)`

### Task 8: Sign or download a goal change

**Files:**
- Modify: `app/components/admin/vote/RoundAdminQueue.tsx`, `app/components/admin/vote/round-admin-actions.ts`
- Test: `app/components/admin/vote/RoundAdminQueue.test.tsx`

**Interfaces:**
- Consumes: Task 7's `goals`
- Produces: `GoalsToSign` section ("Goal changes to sign": "{title}: $108,000 → $78,000", asked by, Sign / Download for the Safe / Discard)

- [ ] **Step 1: Failing tests** — wallet with `ADMIN_ROLE`: Sign calls `writeContract` with `functionName: "setInitiative"` and the item's `call` args as bigints; without it: Sign is replaced by "Download for the Safe" and the note "The page follows once the Safe runs it."; Discard calls the DELETE route
- [ ] **Step 2: Run** `deno run -A npm:vitest run app/components/admin/vote/RoundAdminQueue.test.tsx` — FAIL
- [ ] **Step 3: Implement** — after the receipt, refetch the queue until the item is gone (every 3 s, up to 2 min), as Put on the ballot waits.
- [ ] **Step 4: Run** — PASS
- [ ] **Step 5: Commit** `feat(vote): round admins sign goal changes from the queue (#149)`

### Task 9: Show "Awaiting signature" and lock type/affiliations in the forms

**Files:**
- Modify: `app/routes/initiative.edit.tsx`, `app/components/admin/initiative/SettingsForm.tsx`, the admin initiative page's goal display
- Test: `app/routes/initiative.edit.test.tsx`

- [ ] **Step 1: Failing tests** — `goalRequest` present: "Awaiting signature: $78,000" next to the goal; `onBallot`: type control disabled with `ON_BALLOT` copy; affiliations read-only with the same copy; PATCH 202: the form says "Sent to the round admins to sign."
- [ ] **Step 2: Run** — FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** — PASS; `deno task test` and `deno task typecheck` green; check the edit page in the browser preview
- [ ] **Step 5: Commit** `feat(vote): edit pages show a goal awaiting signature (#149)`
