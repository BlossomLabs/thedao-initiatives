# Admin Proposer Edit Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin's text edit to an approved initiative they proposed is held for review like any proposer's, with the goal waiting alongside the milestones; self-review is flagged, not blocked.

**Architecture:** One server rule change in `holdWhen` (`api/routes/initiatives.ts`); the edit page's `hold` mirrors it and keeps the goal out of the facts PATCH when holding; `PendingEdit` reads the session and the admin list to show an own-edit note and an admin-proposer marker. No storage, route or type changes.

**Tech Stack:** Deno + Hono API on Deno KV (`deno task test:api`), React + TanStack Query app tested with Vitest (`deno task test`).

**Spec:** `docs/superpowers/specs/2026-11-10-admin-proposer-edit-review-design.md`

## Global Constraints

- Work on a branch `admin-proposer-edit-review` off `main`; commit the spec in Task 1.
- Non-admin proposer behaviour must not change (existing `api/tests/pending-revisions.test.ts` and `app/routes/initiative.edit.test.tsx` stay green untouched).
- Admin edits to initiatives they did not propose stay live at once; edits to `pending` initiatives stay live for everyone.
- Self-acceptance is allowed: no server check on reviewer ≠ author.
- Page facts other than the goal stay editable and live for an admin proposer.
- The hold is decided inside the write, on the committed row (keep it in `holdWhen`).
- Own-edit note copy: "This is your own edit. Team policy is that another admin accepts it."

## Review Focus

1. Admin proposer changes only categories while their own edit waits → the change joins the held edit; accepting it keeps the new categories (Task 1 test).
2. Admin proposer whose initiative is still `pending` → edit goes live, button reads "Save as a new revision" (Task 1 and Task 2 tests).
3. Admin proposer lowers the goal and changes a fact (e.g. duration) in one save → duration goes in the PATCH, goal only in the held revision (Task 2 test).
4. Admin proposer address differs only in letter case from the session/proposer → still treated as proposer (server uses existing case-insensitive `isProposer`; Task 3 compares lowercased).
5. Admin list query fails or is loading in `PendingEdit` → the panel still renders and Accept/Reject still work; only the marker is missing (Task 3 test).

---

### Task 1: Hold an admin proposer's edits on the server

**Files:**
- Modify: `api/routes/initiatives.ts:267-271` (`holdWhen`)
- Modify: `api/routes/initiatives.ts:226-236` (route doc comment)
- Test: `api/tests/pending-revisions.test.ts`
- Add: `docs/superpowers/specs/2026-11-10-admin-proposer-edit-review-design.md`, this plan

**Interfaces:**
- Consumes: `isProposer(initiative, user)` (same file, line 97), `tagsOnly` (in scope in the route), `Initiative.pendingRevision`.
- Produces: `POST /api/initiatives/:slug/revisions` responds `pending: true` for an admin proposer's held edit; revision `source` stays `"proposer"`.

- [ ] **Step 1: Write the failing tests**

Add a helper next to `approved()` that makes PLAIN an admin and the proposer: `harness({ env: { RATE_LIMIT_MODE: "off", ADMIN_ADDRESSES: `${ADMIN},${PLAIN}` } })`, submit with `proposerToken(h)`, approve as ADMIN, then return `selfToken = await h.mint(PLAIN, true)` alongside the `approved()` fields (reuse `approved(h)` by passing the harness in).

Tests (`Deno.test` names and assertions):
- `"an admin's text edit to an initiative they proposed is held like any proposer's"`: `edit(selfToken, retitled("An admin's own retitle"))` → 201, `out.pending === true`, `[out.revision.state, out.revision.source]` equals `["pending", "proposer"]`, live row title still `GOOD.title`, `pendingRevision === 2`.
- `"another admin accepts it, and the proposing admin may too"`: after the held edit, `review(2, "accept")` (ADMIN) → 200 and row title is the new one; in a fresh harness, accept with `selfToken` instead → 200, `reviewedBy` equals PLAIN (case-insensitive).
- `"an admin proposer retags directly, unless their own edit is waiting"`: `edit(selfToken, { categories: ["defi"], initiativeId: id })` with nothing waiting → `pending` falsy, row categories `["defi"]`; then a held text edit, then `{ categories: ["opsec"] }` → `pending === true`, row categories unchanged, held revision categories `["opsec"]`; accept → row categories `["opsec"]`.
- `"an admin proposer's edits to a pending initiative go live"`: with `approved(h, false)` setup → text edit `pending` falsy, row title updated.
- `"an admin's edit to someone else's approved initiative still goes live"`: existing behaviour pinned with ADMIN (not proposer) → `pending` falsy.
- `"an admin proposer's held edit may carry the goal; accepting moves it"`: `edit(selfToken, { ...regoaled(11500), initiativeId: id })` → `pending === true`, row `goalUsd` unchanged; accept → row `goalUsd === 11500`.

- [ ] **Step 2: Run to verify they fail**

Run: `deno test -A api/tests/pending-revisions.test.ts`
Expected: the new held/goal/retag-while-waiting tests FAIL (`pending` undefined); the "live" tests pass.

- [ ] **Step 3: Change `holdWhen`'s return to**

```ts
return row.status === "approved" &&
  (!user.isAdmin || (isProposer(row, user) && (!tagsOnly || Boolean(row.pendingRevision))));
```

Update the route doc comment: an admin's edit to an initiative they proposed is held the same way; their category-only edit is direct unless an edit is waiting.

- [ ] **Step 4: Run to verify they pass, then the whole API suite**

Run: `deno test -A api/tests/pending-revisions.test.ts && deno task test:api`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/routes/initiatives.ts api/tests/pending-revisions.test.ts docs/superpowers/specs/2026-11-10-admin-proposer-edit-review-design.md docs/superpowers/plans/2026-11-10-admin-proposer-edit-review.md
git commit -m "Revisions: an admin's edit to their own approved initiative waits for review"
```

### Task 2: Edit page holds for an admin proposer; the goal waits with the milestones

**Files:**
- Modify: `app/routes/initiative.edit.tsx:58` (`hold`), `:200-225` (`WhatYouCanChange`), `:290-315` (`onSubmit`)
- Test: `app/routes/initiative.edit.test.tsx`

**Interfaces:**
- Consumes: Task 1's server rule (the client must agree with it).
- Produces: `hold = (!team || mine) && r?.status === "approved"`; `WhatYouCanChange` gains a `hold: boolean` prop.

- [ ] **Step 1: Write the failing tests** (session `who.isAdmin = true`, row `proposer: ME`, `status: "approved"`)

- `"an admin proposer of an approved initiative sends the edit for review"`: button "Send edit for review" is present; the waiting-for-review notice (`/keeps the approved version until the team accepts/`) shows.
- `"an admin proposer's goal change goes in the held edit, not in the PATCH"`: click "Lower the goal" → `api` called with `"/api/initiatives/same-url/revisions"` and `json` containing `goal: "100000"`; no call to `"/api/initiatives/same-url"` whose `json` has a `goal` key.
- `"an admin proposer's other facts still go in the PATCH"`: change duration and goal in one save → PATCH `json` contains the duration and has no `goal`; revisions call carries `goal`. (Use the existing fact-changing helpers in this file; add one for duration if none exists.)
- `"an admin proposer of a pending initiative saves as a new revision"`: `status: "pending"` → button "Save as a new revision".
- `"an admin proposer is told their text edits wait for another admin"`: the "What you can change" panel matches `/wait for another admin/`.

- [ ] **Step 2: Run to verify they fail**

Run: `deno run -A npm:vitest run app/routes/initiative.edit.test.tsx`
Expected: the new tests FAIL; existing ones pass.

- [ ] **Step 3: Implement**

- `hold`: `(!team || mine) && r?.status === "approved"`; update its comment.
- `onSubmit`: when `hold`, drop `goal` from `facts` (`const { goal: _, ...rest } = facts`; treat an empty remainder as `null`).
- `WhatYouCanChange({ status, manage, hold })`: when `manage && hold`, copy: "As an admin you can change the facts here directly. This is your own initiative, so text edits and the goal wait for another admin to accept them, like any proposer's." Pass `hold={hold}` from the page.

- [ ] **Step 4: Run to verify they pass, then the app suite**

Run: `deno run -A npm:vitest run app/routes/initiative.edit.test.tsx && deno task test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/routes/initiative.edit.tsx app/routes/initiative.edit.test.tsx
git commit -m "Edit page: an admin proposer's edit waits for review, goal with the milestones"
```

### Task 3: Review panel flags own edits and admin proposers

**Files:**
- Modify: `app/components/admin/initiative/PendingEdit.tsx`
- Test: `app/routes/admin.initiative.test.tsx`

**Interfaces:**
- Consumes: `useSession()` (`session.address`), `adminsKey` and `AdminList` (`app/components/admin/Admins.tsx`, `app/lib/api-types.ts:431`), `edit.author` from `useRevision`.
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing tests** (session address is `0x1111…1111` in this file's mock)

- `"an admin's own edit says another admin should accept it, and Accept still works"`: `withPendingEdit({ author: "0x1111111111111111111111111111111111111111" })` → panel contains "This is your own edit. Team policy is that another admin accepts it."; clicking "Accept edit" still calls `/api/admin/initiatives/1/revisions/3/accept`.
- `"someone else's edit has no own-edit note"`: `withPendingEdit()` → that text is absent.
- `"an edit by an admin proposer is marked as such"`: mock `/api/admin/admins` to return `{ admins: [{ address: "0x2222…2222", fixed: false }, …], you: "0x1111…1111" }` → panel matches `/proposer is an admin/`.
- `"the panel works without the admin list"`: `/api/admin/admins` rejects → panel and "Accept edit" render; no marker.

- [ ] **Step 2: Run to verify they fail**

Run: `deno run -A npm:vitest run app/routes/admin.initiative.test.tsx`
Expected: the note and marker tests FAIL.

- [ ] **Step 3: Implement in `PendingEdit`**

- `own = Boolean(edit && session && edit.author.toLowerCase() === session.address.toLowerCase())`; when `own`, render the note (`small dim`, near the buttons).
- Admin list via `useQuery({ queryKey: [...adminsKey, sessionKey(session)], queryFn: ({ signal }) => api<AdminList>("/api/admin/admins", { signal }), enabled: Boolean(session?.isAdmin) })` (same key as `Admins.tsx`, so they share cache); `byAdmin` = author is in `admins` (lowercased) and not `own`.
- Intro copy when `byAdmin`: "The proposer is an admin, so another admin should review this edit. The public page keeps the approved version until it is accepted." Otherwise keep the existing copy.

- [ ] **Step 4: Run to verify they pass, then the app suite**

Run: `deno run -A npm:vitest run app/routes/admin.initiative.test.tsx && deno task test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/initiative/PendingEdit.tsx app/routes/admin.initiative.test.tsx
git commit -m "Admin: flag an admin's own edit and edits by admin proposers"
```
