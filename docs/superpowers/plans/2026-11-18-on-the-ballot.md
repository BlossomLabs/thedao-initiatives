# On the ballot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Round admins put qualified initiatives on the vote contract with their pledges ("On the
ballot", a new funding status), and site admins without the pledge role can still record pledges to
initiatives on the ballot as "Awaiting signature".

**Architecture:** "On the ballot" is derived from the production round's manifest (`slugs`), never
stored. Awaiting pledge changes are KV records under the round's keys, beside `pledge-pending`;
signing one reuses `adminPledges().write()` and the browser's `sendPledge` flow. Put on the ballot
runs in the round admin's browser: wagmi `writeContract` for `addGroup`/`addInitiative` (calls
planned by `addPlan`, moved from `scripts/vote-deploy.ts` to `shared/`), then one pledge signature
per open pledge.

**Tech Stack:** Deno + Hono API (Deno KV), React Router + React Query, wagmi/viem, Vitest (app) and
`deno test` (api).

**Spec:** `docs/on-the-ballot-spec-2026-11-18.md` (design:
https://claude.ai/artifact/SNj76PdaYbvRFJXwWHf1q5)

## Global Constraints

- UI words, exactly: **On the ballot**, **Put on the ballot**, **round admin**, **Awaiting
  signature**, **Discard**, **Waiting for a round admin**, **Ready for the ballot**, **Pledges to
  sign**, **Ready for the test ballot**.
- Funding status key `ballot`, label "On the ballot"; order in sections: Fully funded, On the
  ballot, Qualified for the vote, Open for funding. `?status=ballot` in URLs.
- A round admin = connected wallet holds both `ADMIN_ROLE` and `PLEDGE_ROLE` on the active round's
  contract.
- On the ballot is green (`--color-dao-green`, #5cb75a) everywhere: chip, glyph, callout border, Put
  on the ballot button. Never the vote gold (`--color-vote`) or another yellow: those mean settled.
- Awaiting signature and Pledges to sign are neutral (white outlines and text), not amber.
- Dates per AGENTS.md: `dayTime()` ("Nov 18, 11:20") from `app/lib/format.ts`; never weekday,
  seconds or zone.
- Tiers per AGENTS.md (S-Tier, A-Tier, B-Tier) if any copy mentions them.
- The public board follows the production round only; a test round never makes anything show On the
  ballot.
- Awaiting requests exist only for the real round (production). Test rounds never hold a site
  pledge.
- Pledges before the ballot behave exactly as today (save at once, show publicly).
- New `shared/` files are imported by Deno (api, scripts) and Vite (app): copy the import style of
  their neighbours in `shared/vote/`.
- Commit after each task; do not push.

## Review Focus

1. A non-round-admin edits an awaiting pledge again → the request is replaced (one per pledge), not
   duplicated. Test in Task 3.
2. A pledge with a relayed change in flight and also listed as "missing on chain" → listed once, as
   in flight, never offered for a second signature. Test in Task 4.
3. Put on the ballot stopped after the add lands (tab closed) → its open pledges show in Pledges to
   sign with the "record as it stands" change. Test in Task 4.
4. A qualified initiative with no Safe, a Safe already used in the round, or an RFP with
   affiliations → no add is sent; the card names the reason. Test in Task 1 (`addBlocker`).
5. A withdrawn or received pledge on an initiative being put on the ballot → not signed (only
   `status === "pledged"` goes on-chain, amount 0 otherwise). Test in Task 4.

---

### Task 1: Shared add plan and adding windows

Move the add planning out of the script so the site and the script share it.

**Files:**

- Create: `shared/vote/add-plan.ts`
- Create: `shared/vote/add-plan.test.ts`
- Modify: `scripts/vote-deploy.ts` (delete the moved functions, import them from
  `shared/vote/add-plan.ts`; `addMain` unchanged in behaviour)

**Interfaces:**

- Produces, moved verbatim from `scripts/vote-deploy.ts`: `addPlan`, `planGroups`,
  `planInitiatives`, `groupMask`, `addingOpen(s: Schedule, now: number): boolean`,
  `nextAddingOpen(s: Schedule, now: number): number | null`, types `BoardCard` (the fields `addPlan`
  reads: `slug`, `goalUsd`, `type`, `safeAddress`, `affiliations`, `pledges`, `raisedUsd`) and
  `PlannedInitiative`.
- Produces, new: `addBlocker(m: VoteManifest, card: BoardCard, now: number): AddBlocker | null` with
  `type AddBlocker = { kind: "no-safe" } | { kind: "safe-used" } | { kind: "rfp-affiliations" } | { kind: "closed"; opensAt: number | null } | { kind: "already" }`.
  For `m.kind === "test"` a missing Safe is not a blocker (placeholder account).

- [ ] **Step 1: Write the failing tests** in `shared/vote/add-plan.test.ts` (Vitest):
  - `addBlocker: no Safe on the real round` → `{ kind: "no-safe" }`; same card on a test manifest →
    `null`.
  - `addBlocker: a Safe another initiative in the round uses` (manifest `accounts` holds it, any
    case) → `{ kind: "safe-used" }`.
  - `addBlocker: an RFP with affiliations` → `{ kind: "rfp-affiliations" }`.
  - `addBlocker: inside S-Tier's quiet ending` (`now = firstTallyAt[0] + 1`) →
    `{ kind: "closed", opensAt: firstTallyAt[0] + tierMax }`; after the last span →
    `{ kind: "closed", opensAt: null }`.
  - `addBlocker: already in the round` → `{ kind: "already" }`.
  - `addPlan: a new affiliation adds its group before the initiative` → `calls.map(c => c.fn)`
    equals `["addGroup", "addInitiative"]`.
- [ ] **Step 2:** `deno task test shared/vote/add-plan.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Create `shared/vote/add-plan.ts`: move the functions and types, add `addBlocker`
      (check order: already, rfp-affiliations, no-safe, safe-used, closed). Point
      `scripts/vote-deploy.ts` at it.
- [ ] **Step 4:** `deno task test shared/vote/add-plan.test.ts` and
      `deno test -A scripts/vote-deploy.test.ts` → PASS. `deno task check:api` → no errors.
- [ ] **Step 5:** Commit `refactor(vote): add planning in shared/ for the site and the script`.

### Task 2: "On the ballot" funding status

**Files:**

- Modify: `api/routes/board.ts:39-40,213-216` (card `vote` gains `"ballot"`)
- Modify: `app/lib/api-types.ts:175` (`vote?: "below" | "eligible" | "ballot"`)
- Modify: `app/lib/board-view.ts:15,138,278-296,352-356`
- Modify: `app/components/board/filters/FundingGlyph.tsx`,
  `app/components/board/filters/FilterSheet.tsx:30`, `app/components/board/FilterBar.tsx`
- Modify: `app/components/board/VoteMark.tsx` (`CalloutState` gains `{ kind: "ballot" }`),
  `InitiativeCard.tsx`, `BoardList.tsx`, `app/components/initiative/FundingHead.tsx`,
  `app/routes/initiative.tsx:232`, `app/routes/admin.initiative.tsx:154`
- Modify: `api/services/feed.ts:176,237`, `api/services/vote-llms.ts`
- Test: `app/lib/board-view.test.ts`, `app/components/board/VoteMark.test.tsx`,
  `api/tests/board.test.ts`

**Interfaces:**

- Produces: `Card.vote: "below" | "eligible" | "ballot" | undefined`;
  `STATUSES = ["all", "open", "qualified", "ballot", "funded"]`;
  `STATUS_LABELS.ballot = "On the ballot"`;
  `FundingSection = "funded" | "ballot" | "qualified" | "open"`;
  `onBallotSlugs(m: VoteManifest | undefined): Set<string>` in `shared/vote/manifest.ts` (empty
  unless `m.kind === "real"`); `FundingHead` prop `onBallot?: boolean`;
  `voteCallout(raised, goal, vote, onBallot?)` and `voteStanding(raised, goal, vote, onBallot?)`
  return `{ kind: "ballot" }` when `onBallot`.
- `calloutLabel({kind:"ballot"})` = "On the ballot"; `calloutText` = "On the ballot for TheDAO's
  vote".

- [ ] **Step 1: Failing tests:**
  - board route: with `vote.show` and a real round whose `slugs` include `a`, card `a` has
    `vote: "ballot"`; with a test round it has `"eligible"`/`"below"` as today.
  - `matches`: `status: "ballot"` keeps only `vote === "ballot"`; `status: "qualified"` keeps
    `"eligible"` and `"ballot"`, drops `"below"`.
  - `groupByFunding`: keys in order `["funded", "ballot", "qualified", "open"]`; a fully funded card
    on the ballot is in `funded`.
  - `parseBoardView("?status=ballot").status === "ballot"`.
  - `voteCallout(10, 100, show, true)` → `{ kind: "ballot" }` even below the floor; `calloutLabel` →
    "On the ballot".
- [ ] **Step 2:** `deno task test app/lib/board-view.test.ts app/components/board/VoteMark.test.tsx`
      and `deno task test:api` → FAIL.
- [ ] **Step 3:** Implement. In `buildBoard`, `const ballot = onBallotSlugs(round?.manifest)`; card
      vote = `ballot.has(slug) ? "ballot" : voteState(...).kind` (only while `vote.show`). Pages
      pass `onBallot` from `onBallotSlugs(useRound()).has(slug)`. Glyph `ballot`: the qualified
      check inside a filled ring in `--color-dao-green` (#5cb75a), check stroke #08321c (Qualified
      keeps its outline ring with a green check). FilterBar/FilterSheet offer On the ballot only
      while `voteFilter`. Feed status line: "On the ballot" when it is; `funding_status: ballot`.
- [ ] **Step 4:** Same commands → PASS; `deno task typecheck` → clean.
- [ ] **Step 5:** Commit `feat(board): On the ballot funding status`.

### Task 3: Awaiting pledge requests (server)

A site admin whose wallet lacks `PLEDGE_ROLE` saves pledge changes to an initiative on the ballot as
requests.

**Files:**

- Create: `api/services/pledge-requests.ts`
- Modify: `api/services/vote-chain.ts`
  (`VoteChain.hasRole(role: Hex, account: Hex): Promise<boolean>`, reading `hasRole`)
- Modify: `api/services/admin-pledges.ts` (on a landed settle, delete the request for that pid)
- Modify: `api/routes/admin.ts:1249-1320` (add, edit, delete paths), admin initiative JSON at
  `:846-854`, new `DELETE /initiatives/:id/pledge-requests/:pid`
- Modify: `app/lib/api-types.ts` (`AdminInitiativePage.awaitingPledges: AwaitingPledgeJson[]`)
- Test: `api/tests/admin-pledges-vote.test.ts` (fake chain gains `hasRole`, default `true` for ADMIN
  so existing tests keep passing)

**Interfaces:**

- `PLEDGE_ROLE_ID = keccak256(toHex("PLEDGE_ROLE"))`,
  `ADMIN_ROLE_ID = keccak256(toHex("ADMIN_ROLE"))` in `shared/vote/roles.ts`.
- `type PledgeRequest = { rfpId: string; pid: string; change: PledgeChange; by: Hex; at: number }`;
  KV key `[...roundKey(m), "pledge-request", rfpId, pid]`.
- `pledgeRequests(deps)` returns
  `{ put(d, req): Promise<void>; get(d, rfpId, pid); list(d, rfpId?): Promise<PledgeRequest[]>; discard(d, rfpId, pid): Promise<boolean> }`.
- `type AwaitingPledgeJson = { pid: string; kind: "add" | "edit" | "remove"; company: string; amountUsd: number | null; fromUsd: number | null; by: string; at: number }`
  (`fromUsd`: the row's amount now, null for add).
- Route behaviour when `chainAt` and no signature: if
  `await chainAt.d.chain.hasRole(PLEDGE_ROLE_ID, user)` → 428 as today; else save the request (an
  `edit` merges into an existing request's patch; a `remove` replaces it; a new pledge gets
  `newId()`), answer `202 { awaiting: true, pid }`.

- [ ] **Step 1: Failing tests** in `admin-pledges-vote.test.ts`:
  - `admin pledges: a site admin without the pledge role saves a pledge as awaiting` → 202
    `{ awaiting: true }`, `db.pledges.list` unchanged, public `/api/initiatives/:slug` shows no new
    pledge, admin page `awaitingPledges` has one `add`.
  - `admin pledges: a second change to an awaiting pledge replaces it` → still one request, amount
    the latest.
  - `admin pledges: an awaiting change to an existing pledge leaves the row as it is` → row amount
    unchanged; request `kind: "edit"`, `fromUsd` the old amount.
  - `admin pledges: discarding an awaiting pledge removes the request` → 200, list empty; unknown
    pid → 404.
  - `admin pledges: a landed signature clears the awaiting request` (sign via the Task 4 endpoints
    may not exist yet: write the request, then send the signed PATCH as today) → after settle, no
    request.
  - `admin pledges: an initiative outside the round never holds a pledge` (wallet without role) →
    saved at once, 201.
- [ ] **Step 2:** `deno test -A api/tests/admin-pledges-vote.test.ts` → FAIL.
- [ ] **Step 3:** Implement as in Interfaces. The request keeps the uploaded `logoCid` in its
      change.
- [ ] **Step 4:** Same command → PASS; `deno task test:api` → all pass.
- [ ] **Step 5:** Commit
      `feat(admin): pledges to an initiative on the ballot wait for a round admin's signature`.

### Task 4: Waiting for a round admin (server list and signing)

**Files:**

- Create: `api/services/round-admin-queue.ts`
- Modify: `api/routes/admin.ts` (routes under `/vote-round/…`, so `/vote-test-round/…` serves the
  test round automatically)
- Test: create `api/tests/round-admin-queue.test.ts`

**Interfaces:**

- `GET /vote-round/queue` → `RoundAdminQueueJson`:
  ```ts
  type ReadyJson = {
    id: string;
    slug: string;
    title: string;
    goalUsd: number;
    raisedUsd: number;
    safeAddress: string;
    type: "rfp" | "grant";
    affiliations: string[];
    pledges: { pid: string; company: string; amountUsd: number }[];
    blocker: AddBlocker | null;
  };
  type ToSignJson = {
    rfpId: string;
    slug: string;
    title: string;
    pid: string;
    company: string;
    kind: "add" | "edit" | "remove" | "record";
    amountUsd: number;
    fromUsd: number | null;
    by: string | null;
    at: number | null;
    inFlight: { hash: Hex | null } | null;
  };
  type RoundAdminQueueJson = { kind: "real" | "test"; ready: ReadyJson[]; toSign: ToSignJson[] };
  ```
  `ready`: approved, `voteState` eligible with the saved settings, not in `m.slugs`, round not
  closed. `toSign`, for initiatives in `m.slugs`: every request (Task 3, real round only), plus
  every `status === "pledged"` row with no request whose on-chain record (`chain.pledgeOf`) is
  missing or has another amount, as `kind: "record"`. A pid with a `pledge-pending` record shows
  once with `inFlight`.
- `POST /vote-round/queue/:rfpId/:pid/prepare` → `{ pid, typedData }` (as `/pledges/prepare`) for
  the request's change, or `{ kind: "edit", patch: {} }` ("record as it stands") when there is none.
  404 when neither applies.
- `POST /vote-round/queue/:rfpId/:pid` body `SIGNED_FIELDS` → real round: `pledges.write` with that
  change (202 `{ hash, pid }` or 200 saved). Test round: relay `setPledgeBySig` only, like
  `/vote-round/test-pledges/:slug/pledges`, never touching site rows. Settling: real uses
  `/initiatives/:id/pledges/:pid/settle`; test uses
  `/vote-round/test-pledges/:slug/pledges/:pid/settle`.

- [ ] **Step 1: Failing tests** in `round-admin-queue.test.ts` (reuse `harness`, `fakeChain` pattern
      from `admin-pledges-vote.test.ts`):
  - `queue: a qualified approved initiative outside the round is ready` with its open pledges only
    (a `received` and a `withdrawn` one left out); a pending one is not listed.
  - `queue: an initiative under the floor is not ready`.
  - `queue: an open pledge missing on-chain is listed as record` (initiative in `m.slugs`, chain
    empty).
  - `queue: a pledge with a change in flight shows once, in flight`.
  - `queue: an awaiting request is listed with who asked`; on a test round requests never appear.
  - `queue: signing a record writes the row's amount and leaves the row as it is` → relayed amount =
    row amount × 1e6; after settle the pledge is gone from `toSign`.
  - `queue: on a test round signing relays without touching the site's rows`.
- [ ] **Step 2:** `deno test -A api/tests/round-admin-queue.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Read on-chain records with `Promise.all` over `chain.pledgeOf` at one
      block.
- [ ] **Step 4:** Same command → PASS; `deno task test:api` → all pass.
- [ ] **Step 5:** Commit
      `feat(admin): Waiting for a round admin: initiatives ready for the ballot and pledges to sign`.

### Task 5: Pledge form and table: awaiting rows

**Files:**

- Modify: `app/components/admin/initiative/Pledges.tsx`,
  `app/components/admin/dashboard/QuickPledge.tsx`, `app/lib/pledge-flow.ts` (a `plain()` answer of
  202 `{ awaiting: true }` ends as `{ kind: "awaiting" }`)
- Test: `app/lib/pledge-flow.test.ts`, create `app/components/admin/initiative/Pledges.test.tsx`

**Interfaces:**

- Consumes Task 3's `AwaitingPledgeJson`, `DELETE /api/admin/initiatives/:id/pledge-requests/:pid`.
- `PledgePhase` gains `{ kind: "awaiting" }`; `outcomeOf` text for it: "Saved as Awaiting signature.
  It counts in the vote once a round admin signs it."

- [ ] **Step 1: Failing tests:**
  - `sendPledge: an awaiting answer ends without asking the wallet` → `sign` never called, end
    `{ kind: "awaiting" }`.
  - `Pledges: an awaiting add shows as a row with the Awaiting signature chip and Discard`.
  - `Pledges: an awaiting edit shows "$20,000 → $30,000" on its row`; Edit and Delete hidden on that
    row.
  - `Pledges: Discard calls the discard endpoint`.
- [ ] **Step 2:**
      `deno task test app/lib/pledge-flow.test.ts app/components/admin/initiative/Pledges.test.tsx`
      → FAIL.
- [ ] **Step 3:** Implement. Chip style: neutral, white outline (`border-white/35`,
      `text-white/90`); no amber, gold or yellow. The form's note under the buttons, only while the
      initiative is on the ballot and the wallet isn't a round admin (Task 6's hook): "It's on the
      ballot: a pledge counts in the vote once a round admin signs it."
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(admin): awaiting pledges in the pledge table and form`.

### Task 6: Round admin wallet, Pledges to sign and Put on the ballot (browser)

**Files:**

- Create: `app/hooks/use-round-admin.ts`
- Create: `app/lib/ballot-add.ts` (+ `app/lib/ballot-add.test.ts`): the Put on the ballot sequence,
  dependency-injected like `pledge-flow.ts`
- Create: `app/components/admin/vote/RoundAdminQueue.tsx` (Ready for the ballot + Pledges to sign),
  `app/components/admin/vote/PutOnBallot.tsx` (the card)
- Modify: `app/routes/admin.initiative.tsx` (card when qualified, "On the ballot" chip, short
  Pledges to sign list beside the form)
- Test: `app/components/admin/vote/RoundAdminQueue.test.tsx`

**Interfaces:**

- `useRoundAdmin(): { isRoundAdmin: boolean; loading: boolean }`: `hasRole(ADMIN_ROLE_ID)` and
  `hasRole(PLEDGE_ROLE_ID)` for the connected wallet via `voteClient(ROUND)`.
- `putOnBallot(deps: BallotAddDeps, ready: ReadyJson, onPhase: (p: BallotPhase) => void): Promise<BallotPhase>`
  with
  `BallotAddDeps = { plan(): { fn: "addGroup" | "addInitiative"; args: readonly unknown[] }[]; send(call): Promise<Hex>; waitReceipt(hash): Promise<"success" | "reverted">; inRound(): Promise<boolean>; signPledge(pid: string): Promise<"saved" | "failed">; sleep(ms): Promise<void> }`
  and
  `BallotPhase = { kind: "adding"; step: number; of: number } | { kind: "waiting-round" } | { kind: "signing"; done: number; of: number } | { kind: "done" } | { kind: "failed"; reason: string; added: boolean }`.
  `inRound` polls `GET /api/vote/round` (or the manifest the page already loads) every 3 s, up to 2
  min.
- `signPledge` runs `sendPledge` against Task 4's queue endpoints.
- Card copy: "Sends it to the vote contract with its pledges, so voters can place it in a tier." /
  "Your wallet asks N times: the transaction that adds it, then one signature per pledge." / blocker
  texts: "Add a Safe first.", "Another initiative in the round uses this Safe.", "An RFP can't have
  affiliations.", "Opens again {dayTime(opensAt)}." / site admin: "Qualified. A round admin puts it
  on the ballot."

- [ ] **Step 1: Failing tests:**
  - `putOnBallot: adds, waits for the round, then signs each pledge` → phases in order; `send`
    called once per planned call; `signPledge` per pledge.
  - `putOnBallot: a reverted add stops before any signature` → `{ kind: "failed", added: false }`.
  - `putOnBallot: a failed signature after the add ends failed with added: true` (the queue lists
    the rest).
  - `RoundAdminQueue: Sign all signs the unsigned ones in order` and skips `inFlight` rows.
  - `RoundAdminQueue: a blocked ready initiative shows its reason and a disabled button`.
- [ ] **Step 2:**
      `deno task test app/lib/ballot-add.test.ts app/components/admin/vote/RoundAdminQueue.test.tsx`
      → FAIL.
- [ ] **Step 3:** Implement. `plan()` = `addPlan(ROUND, [card]).calls`; `send` = `writeContract`
      with the vote ABI (as `use-vote-send.ts`), after `useEnsureVoteChain()`. Button green
      (`bg-dao-green`, text #08321c), as on the canvas.
- [ ] **Step 4:** Same command → PASS; `deno task typecheck` → clean.
- [ ] **Step 5:** Commit `feat(admin): Put on the ballot and Pledges to sign for round admins`.

### Task 7: Dashboard and Admin → Test vote

**Files:**

- Modify: `app/routes/admin.dashboard.tsx` (Waiting for a round admin card under Record a pledge;
  to-do line), `api/routes/admin.ts` `/todo` (counts `ready` and `toSign` from the production queue:
  `{ roundAdmin: { ready: number; toSign: number } }`)
- Modify: `app/routes/admin.vote.tsx` (test environment: `RoundAdminQueue` titled "Ready for the
  test ballot")
- Test: `api/tests/admin-todo.test.ts`; the dashboard line's text in a small pure helper
  `roundAdminTodoLine(ready, toSign): string | null` in `app/lib/admin-rows.ts`, tested in
  `app/lib/admin-rows.test.ts`

**Interfaces:**

- Consumes `RoundAdminQueue` (Task 6) and `GET /vote-round/queue` / `/vote-test-round/queue` (Task
  4).
- To-do line: "{n} initiative(s) ready for the ballot, {m} pledge(s) to sign", omitting a zero half;
  hidden when both are 0.

- [ ] **Step 1: Failing tests:** `/todo` returns `roundAdmin: { ready: 1, toSign: 2 }` for a seeded
      round; the dashboard line reads "1 initiative ready for the ballot, 2 pledges to sign"; with
      `toSign: 0` it reads "1 initiative ready for the ballot".
- [ ] **Step 2:** run the two tests → FAIL.
- [ ] **Step 3:** Implement. The `/todo` counts must not slow its one-KV-wave first paint: compute
      `ready` from the status index and settings, and `toSign` from requests + pending records only
      (the on-chain "record" check stays in `/vote-round/queue`).
- [ ] **Step 4:** run → PASS;
      `deno task test && deno task test:api && deno task typecheck && deno task lint` → all clean.
- [ ] **Step 5:** Commit `feat(admin): round admin queue on the dashboard and Admin → Test vote`.

### Task 8: Rehearse on Sepolia

- [ ] **Step 1:** Run the app locally against a Sepolia test round (`deno task dev`; Admin → Test
      vote set to a test round with a qualified initiative not in it).
- [ ] **Step 2:** With sem-the-bee.eth: Put on the ballot → check the initiative appears in the test
      round (Admin → Test vote's list) and its pledges are recorded on Sepolia (Blockscout).
- [ ] **Step 3:** Report what was verified on Sepolia, and that the awaiting path (production only)
      is covered by tests alone.
