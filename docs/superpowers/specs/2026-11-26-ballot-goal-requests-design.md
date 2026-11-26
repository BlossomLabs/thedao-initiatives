# Ballot goal requests: the site leads, the round signs (#149)

Replaces the approach of PR #152 ("the round leads"), which Sem judged too broad to merge.

## Why

ValOS (initiative 23) went on the ballot at $108k. On Nov 24 an admin accepted the team's
edit to $78k on the site only, and nothing sent it to the round contract until a round
admin did by hand on Nov 25. The site stays the source of truth; what was missing is
that a change to a fact the round stores waits for a round admin to put it on the round,
and that a difference between the two shows up instead of going unnoticed.

## Approaches

1. **The site leads, the round signs (chosen).** A goal change on a ballot initiative is
   pending until a round admin signs `setInitiative`; the page takes it once the chain
   has it. The queue also lists any ballot initiative whose site goal differs from the
   round's. Modelled on pledges awaiting signature and the queue's "record" items.
2. **The round leads, the site follows (PR #152).** Rejected: copying the round onto the
   site added a background step with races (admin rereads, overlapping runs) and a
   first-deploy overwrite.
3. **Lock only.** Rejected: leaves no way to change a goal during the vote.

## Design

"On the ballot": the production round (`kind === "real"`) holds the initiative's Safe in
`accounts`. Matched by Safe, never by slug (slugs can be reclaimed; the Safe is unique and
never changes). The slot index is the position of that account.

- **Pending goal.** On a ballot initiative, an admin's goal edit (`PATCH /:slug`, 202), an
  admin's live text edit carrying a goal, and accepting a proposer's held edit that
  changes the goal each leave the page's goal as it is and store a goal request
  (`["goal-request", rfpId]`, tagged with the round contract; one per initiative, a new
  one replaces it, asking for the current goal drops it). The accepted revision is stored
  without the goal. Refused once the vote has closed.
- **Settle.** When the round's goal for the slot equals the request's, the server writes
  the goal to the row and removes the request (only if it is still the one waiting). It
  checks when the queue is read and when the initiative page or admin page is read,
  using the stored round (refreshed every few seconds while vote pages are used).
- **Queue: "Goal changes to sign".** One item per ballot initiative with a request
  (from the round's goal → the requested goal, who asked), and one per ballot initiative
  without a request whose site goal differs from the round's ("the round has $108,000, the
  page $78,000"). Sign sends `setInitiative(slot, account, goal, rfp, groups)` with the
  round's account, RFP flag and groups, from a wallet holding `ADMIN_ROLE`, after checking
  the round's config revision; otherwise Download for the Safe. Sign is off, with the
  reason as its title, for a settled or withdrawn initiative, while a tier settles, and
  when the round's state can't be read. After signing it stays off and the list is read
  every 3 s (up to 2 min) until the change settles. Discard removes a request.
- **Type and affiliations** of a ballot initiative are refused on every write path,
  content sync included (matched by the row, not the file's slug).
- **Pages.** Page data carries `onBallot` and `goalRequest` (`by` only for admins and the
  proposer). The edit page shows "Awaiting signature: $X" and no type picker; admin
  settings show affiliations read-only; the admin page shows the pending goal with Discard.

## Non-goals

No copying from the round onto the site. No change to the round contract. The Safe
correction from PR #152 goes in its own PR.

## Assumed

A round admin doesn't change a ballot initiative's goal on the round without the site. If
one does, the queue shows the difference and Sign puts the site's goal back.
