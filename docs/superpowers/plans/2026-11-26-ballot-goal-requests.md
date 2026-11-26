# Ballot goal requests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Sem chose native execution). Steps use checkbox (`- [ ]`) syntax.

**Goal:** A ballot initiative's goal change waits until a round admin signs it; the site leads and the queue shows any site/round goal difference.

**Architecture:** Ballot membership is the production manifest holding the row's Safe in `accounts` (no slugs). Goal requests live in KV and settle on read when the stored round has the requested goal. The round admin queue lists requests and differences with the exact `setInitiative` call. Pieces are ported from PR #152 (branch `ballot-locked-facts`, head 450bdfe) minus its follow step.

**Tech Stack:** Deno, Hono, Deno KV, React, TanStack Query, viem/wagmi, `deno test`, vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-ballot-goal-requests-design.md`

## Global Constraints

- On the ballot = `m.kind === "real"` and `m.accounts` holds `row.safeAddress` (case-insensitive); slot = that index. Never match by slug.
- Copy: `ON_BALLOT = "On the ballot: a round admin changes this on the round."`; closed: `"The vote has closed: the round's goal is final."`; stale list: `"The round's settings changed since this list was read. Try again."`.
- Nothing writes site rows from the round except settling a request whose goal the round has.
- Port from 450bdfe where the code is the same; AGENTS.md copy rules; `deno task test:api`, `deno task test`, `deno task typecheck`, `deno lint` green; `deno fmt` only on the files touched (never on `shared/` wholesale: it reformats fixtures).

## Review Focus

1. An initiative whose slug was reclaimed (archived, renamed) is matched by Safe, and the new holder of the slug is not treated as on the ballot. Task 1.
2. A goal sent equal to the current one creates no request and no refusal. Task 2.
3. Settling never removes a request asked for after the read. Task 2.
4. When the replay can't be read, Sign is off, never on. Task 3.
5. A ballot initiative whose site goal equals the round's and has no request is not listed. Task 3.

---

### Task 1: Ballot by Safe, and the type/affiliations lock

**Files:** Create `api/services/ballot-lock.ts`, `shared/vote/ballot-facts.ts`; modify `api/routes/initiatives.ts` (PATCH type), `api/routes/admin.ts` (affiliations), `api/services/content.ts`, `api/db/initiatives.ts` (`upsertContent` opts), `api/tests/routes.test.ts` (`kept: []`); test `api/tests/ballot-lock.test.ts`.

**Interfaces (produces):** `productionManifest(db): Promise<VoteManifest | undefined>`; `ballotSlot(m: VoteManifest | undefined, row: { safeAddress: string }): number` (-1 off the ballot); `assertOffBallot(onBallot: boolean, changed: boolean): void` (409 `ON_BALLOT`); `syncContent(db, files, audit?, m?: VoteManifest)`; `SyncResult.kept: string[]`; `upsertContent(slug, f, opts?: { keep?: (row: Initiative) => boolean })`.

- [ ] Failing tests: `ballotSlot matches by Safe, case-insensitive; -1 for a test round or no round`; `PATCH type on the ballot: 409`; `PATCH the same type and other facts: 200`; `affiliations on the ballot: a change is 409, the same list in any case/order is 200`; `off the ballot an affiliation's case fix saves`; `sync-content keeps a ballot initiative's type, goal and affiliations and applies the rest`; `sync-content of a file whose row moved to an archived slug is still locked`; `a row that took a reclaimed slug is not on the ballot`.
- [ ] Run `deno test -A api/tests/ballot-lock.test.ts` — FAIL
- [ ] Implement; Run — PASS; `deno task test:api` green
- [ ] Commit `feat(vote): ballot initiatives' type and affiliations change only with the round (#149)`

### Task 2: Goal requests and settling

**Files:** Create `api/services/goal-requests.ts` (port); modify `api/routes/initiatives.ts` (PATCH goal, revisions, GET), `api/routes/admin.ts` (accept, admin initiative GET, `DELETE /initiatives/:id/goal-request`), `api/db/initiatives.ts` (`review` opts `keepGoal`, revision stored without goal), `app/lib/api-types.ts`; test `api/tests/ballot-lock.test.ts`.

**Interfaces (produces):** `requestGoal(db, m, row, goalUsd, by)`, `goalRequestOf(db, m, rfpId)`, `goalRequests(db, m)`, `dropGoalRequest(db, rfpId)`, `settleGoalRequest(db, r): Promise<boolean>`, `assertGoalOpen(m, now)`, `goalRequestJson(r, withBy)`, `ballotFor(db, row): Promise<{ manifest; slot: number; goalRequest }>` (one round trip), `settleIfOnChain(db, m, row, r): Promise<Initiative>` (writes the goal and settles when `m.projects[slot].goalUsd` equals the request, else returns the row).

- [ ] Failing tests (port from 450bdfe, rounds with `accounts` holding the row's Safe): admin PATCH goal 202 page keeps its goal; PATCH back drops it; off the ballot applies as before; admin live text edit with a goal requests it; proposer's held goal edit accepted → text live, goal requested, revision has no goal; held edit without a goal change accepts; goal-only admin edit answers 202; closed vote refuses; public GET hides `by`; **new:** `GET settles a request the round has: the page takes the goal, the request goes`; `settling never removes a newer request`.
- [ ] Run — FAIL; implement; Run — PASS; `deno task test:api` green (kv-depth stays within its trips)
- [ ] Commit `feat(vote): a ballot initiative's goal change waits for a round admin (#149)`

### Task 3: Goal changes to sign in the queue

**Files:** Modify `api/services/round-admin-queue.ts`, `api/routes/admin.ts` (queue GET adds `blocked`), `app/lib/api-types.ts`; test `api/tests/goal-queue.test.ts`, `api/tests/round-admin-queue.test.ts`.

**Interfaces (produces):** `GoalToSignJson = { kind: "request" | "record"; rfpId; slug; title; fromUsd; toUsd; by: string | null; at: number | null; call; batch; configRevision: string | null; blocked: GoalBlock | null }`; `GoalBlock = settled | withdrawn | settling{until} | unknown`; `goalBlock(slug, initiatives | null, schedule, now)`.

- [ ] Failing tests: request listed with the round's account/RFP/groups and a Safe batch; a request the round has is settled (row takes the goal) and not listed; a ballot initiative whose site goal differs with no request is listed as `record` (from round → to site); one that matches is not listed; `goalBlock` settled/withdrawn/settling/unknown (`null` initiatives → unknown); discard.
- [ ] Run — FAIL; implement; Run — PASS; suite green
- [ ] Commit `feat(vote): goal changes to sign in the round admin's queue (#149)`

### Task 4: The UI

**Files:** Port `app/components/admin/vote/GoalsToSign.tsx` (+test), `RoundAdminQueue.tsx`, `app/hooks/use-round-admin.ts` (+test), `app/routes/initiative.edit.tsx` (+test), `app/routes/admin.initiative.tsx` (+test), `app/components/admin/initiative/SettingsForm.tsx` (+test).

- [ ] Failing tests (port) plus: a `record` item reads "Round $108,000, page $78,000", has Sign and no Discard; `unknown` block title "The round's state couldn't be read. Try again shortly."
- [ ] Run — FAIL; implement; `deno task test`, `deno task typecheck`, `deno lint` green
- [ ] Commit `feat(vote): round admins sign goal changes; pages show a goal awaiting signature (#149)`
