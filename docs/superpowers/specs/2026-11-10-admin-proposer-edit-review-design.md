# Admin proposers: their edits wait for review like everyone's

2026-11-10

## Why

When a proposer edits an initiative that is already approved, the edit is held:
the approved text stays public until an admin accepts it. Approval is a review
of the text, so a change to that text needs a review too.

An admin who is also the proposer of an initiative skips this today. Their edit
goes live at once, because the hold only applies to non-admins
(`api/routes/initiatives.ts`, `holdWhen`: `!user.isAdmin && row.status === "approved"`).
The admin wants their own proposals to follow the same mechanism as everyone
else's, so nobody's text reaches the board unreviewed.

## Goals

- An admin's text edit to an **approved** initiative **they proposed** is held,
  exactly like any proposer's: the live text stays, the edit appears in the
  admin review queue (`/admin?edit=review`) and in the `PendingEdit` panel, and
  it is accepted or rejected through the existing routes.
- The edit page treats an admin proposer on their own approved initiative as a
  proposer: it starts from the held edit if there is one, says the edit will
  wait for review, and the submit button reads "Send edit for review".
- Team policy is that **another admin** accepts it. The app makes that visible
  but does not enforce it (see below).

## Not changing

- Admin edits to initiatives they did **not** propose: live at once, as today.
- Edits while the initiative is **pending**: live at once for everyone, since
  approval itself is the review.
- Category-only edits (retagging): direct for admins, including on their own
  initiative (team housekeeping), unless their own edit is already waiting
  (see the rule below).
- **Page facts** (`PATCH /:slug`: type, top-up, duration, recipient, etc.)
  stay editable by an admin proposer after approval, without review. Decided
  by the user: admins are who other proposers "email the team" to. The goal
  is the exception when sent from the edit form with a held edit (see Edge
  cases).
- The admins' exemption from the hourly edit cap.

## Anti-goals

- Blocking an admin from accepting their own edit. The user wants to be able to
  do it; the second-admin rule is policy, not code.
- Locking an admin out of their own initiative's admin page or facts.
- Changing how non-admin proposers' edits behave.

## Self-review: visible, not blocked

- In `PendingEdit`, when the held edit's author is the signed-in admin, show a
  plain note next to Accept/Reject: "This is your own edit. Team policy is that
  another admin accepts it." Both buttons still work.
- The panel's intro says "The proposer edited…", which is still true, but when
  the author is an admin it should say that this admin is the proposer, so other
  admins know it is theirs to pick up.
- Who accepted is already recorded (`reviewedBy` on the revision, plus the audit
  log), so self-acceptance is traceable after the fact. No new storage needed.

## The rule, precisely

An edit is held when, at write time (inside the write, on the row it commits
against, as `holdWhen` already does):

```
row.status === "approved" &&
  (!user.isAdmin || (isProposer(row, user) && (!tagsOnly || row.pendingRevision)))
```

- Non-admins: unchanged (held on approved rows, retags included, as today).
- Admin proposer, text edit: held.
- Admin proposer, categories-only edit: direct, **except** when an edit is
  already waiting on the row; then it joins that held edit, as a non-admin's
  does. Otherwise accepting the held edit later would put the old categories
  back. *(Builder's call, settled in review.)*
The client's `hold` in `app/routes/initiative.edit.tsx` must use the same rule
so the form and the server agree.

The revision `source` stays `"proposer"` for these edits (it already is today).

## Edge cases

- **Proposer changes mid-request**: `holdWhen` re-reads the row, so the
  proposer check uses the committed row. Keep it inside the write.
- **Goal** (decided by the user): when an admin proposer's edit is held, a
  goal change in the edit form **waits for review with the milestones**, as it
  does for other proposers. Today `PrivateEditor`
  (`app/routes/initiative.edit.tsx`) sends a changed goal through the facts
  `PATCH` whenever `team` is true, and also attaches it to the revision when
  `hold` is true; for an admin proposer both would fire, publishing the goal
  live while the milestones wait. Fix: when `hold` is true, leave `goal` out of
  the facts `PATCH` and send it only with the held revision. The other facts
  stay editable and live. The "What you can change" copy, which tells admins
  their edits are tagged as the team's, must describe the held-edit case for
  an admin proposer.
- **An admin who already has a live edit** on their approved initiative from
  before this change: nothing to migrate; the rule applies from the next edit.

## Tests

- API (`api/tests/pending-revisions.test.ts`): admin proposer's text edit on
  an approved initiative is held; their category-only edit is not; their edit
  on a pending initiative is not; an admin editing someone else's approved
  initiative is not held; a different admin can accept it; the same admin can
  also accept it (allowed by design).
- UI (`app/routes/initiative.edit.test.tsx`): admin proposer on their own
  approved initiative sees "Send edit for review" and starts from the held edit;
  a goal change is sent with the held revision and not through the facts PATCH.
- UI (`app/routes/admin.initiative.test.tsx`): the own-edit note shows when the
  author is the signed-in admin, and not otherwise.

## Left to the builder

Exact wording of the notes, where the own-edit note sits in `PendingEdit`, and
how the edit page's "back" link behaves for an admin proposer (today it goes to
the public page when `mine`, which is fine).
