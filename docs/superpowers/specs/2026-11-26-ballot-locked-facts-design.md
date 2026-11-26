# On the ballot, the round leads: locked facts (#149)

## Revision 2 (Sem, Nov 26): goal changes are requests a round admin signs

This section replaces §3 ("Changing a fact on the round") and the goal parts of §1 below.
Type and affiliations stay as §1 and §2 say.

- **Propose.** On a ballot initiative, a goal change never changes the page. It becomes a
  **goal request** (one per initiative, a new one replaces it; asking for the current goal
  drops it), like a pledge awaiting signature:
  - a site admin's direct goal edit (`PATCH /:slug`) answers 202 with the request; other
    facts in the same save apply as usual;
  - a site admin's live text edit carrying a goal: the text goes live, the goal becomes a
    request;
  - a proposer's held edit keeps carrying its goal; accepting it puts the text live and
    makes the goal a request (no longer refused).
- **Accept.** The round admin's queue lists "Goal changes to sign" (from → to, who asked).
  The round contract has no signed variant of `setInitiative`, so Sign sends
  `setInitiative(id, account, goal, rfp, groups)` from a wallet holding `ADMIN_ROLE`,
  keeping the account, RFP flag and groups the round has; without the role, "Download for
  the Safe" gives the batch (`requireConfigRevision` + `setInitiative`). Any site admin can
  Discard.
- **Settle.** No new chain reads: the round's manifest is re-read every few seconds while
  vote pages are used, and `setInitiative` bumps its revision. The follow step (§2) copies
  the round's goal into the row and drops any request whose goal the round now has, so a
  Safe batch or a hand-made fix settles the same way.
- **Show.** The initiative's page data carries `goalRequest` (`{ goalUsd, by, at }`) so
  the edit page and the admin page show "Awaiting signature: $78,000" next to the goal.
- Dropped from revision 1: the "Set on the round" panel and the Safe-mismatch warning.

## Why

ValOS (initiative 23) was put on the ballot with a $108k goal. Two days later the team
lowered it to $78k on the site (revision 11, accepted Nov 24, 12:14 UTC). Nothing carried
that to the contract, so the ballot rules, the on-chain ask and the team's tracker kept
$108k until a round admin sent `setInitiative` by hand (Nov 25). The site and the round
each kept a copy of the same facts, and only one of them was ever edited.

The goal: once an initiative is on the ballot, the facts the round contract stores can't
drift from it. Only a round admin can change them, and the change is made on the round;
the site follows.

## The facts

Per initiative, the contract stores `account`, `goalUsd`, `rfp`, `withdrawn` and
`groups`. The site copies:

| Contract | Site field | Changed today by |
|---|---|---|
| `goalUsd` | `goalUsd` | proposer revision (held, applied on accept), admin `PATCH /:slug`, admin sync-content |
| `rfp` | `type` (`rfp` / `grant`) | admin `PATCH /:slug`, sync-content |
| `account` | `safeAddress` | `safe-confirm`, only while unset |
| `groups` (names) | `affiliations` | admin `PATCH /api/admin/initiatives/:id`, sync-content |
| `withdrawn` | none (read from the replay) | round admin only, already |

"On the ballot" means the slug is in the production round's manifest (`onBallotSlugs`).
Test rounds (Sepolia) never lock or write site rows.

## Approaches

1. **The round leads, the site follows (chosen).** The site refuses edits to these facts
   for an initiative on the ballot. A round admin changes them on the round, from the
   site, and the site copies the round's values into its row when it next reads the
   round. No transaction can leave the two apart: a rejected or reverted one changes
   neither. Works for Safe admins (they get a batch). The page follows a few seconds after
   the block.
2. **The server checks the role, saves, then the wallet sends.** Rejected: a reverted or
   abandoned transaction recreates the drift, and a Safe admin can't sign in as the Safe.
3. **Lock plus a drift to-do, no edit path.** Rejected: still two manual steps.

## Design

### 1. Lock (server, every path)

For a slug in `onBallotSlugs(production manifest)`:

- `PATCH /api/initiatives/:slug`: refuse a change to `goal` or `type` (409, "On the
  ballot: a round admin changes this on the round."). Other page facts stay editable.
- `POST /:slug/revisions`: refuse a `goal` that differs from the row's. Text edits stay.
- Accepting a held revision whose goal differs from the row's: refuse with the same
  message, naming the held goal, so the admin can ask a round admin. (A held edit from
  before the initiative went on the ballot is the ValOS case.)
- `PATCH /api/admin/initiatives/:id`: refuse an `affiliations` change.
- `sync-content`: leave `goalUsd`, `type` and `affiliations` of on-ballot rows untouched,
  and list them as skipped in its answer.
- `safe-confirm`: unchanged (it already refuses a set Safe).

The check reads the production round's stored manifest; with no production round,
nothing locks.

### 2. The site follows the round

When the production round is read and its `configRevision` (or anchor) differs from the
stored manifest's, the server writes, for every on-ballot slug whose row differs:

- `goalUsd` ← `goalUsd / 1e6`
- `type` ← `rfp ? "rfp" : "grant"`, only the field (the grant-only facts are kept, so
  a change back loses nothing)
- `affiliations` ← the names of its groups that two or more initiatives in the round hold;
  a group only this initiative holds (a team's own, from #147 and Put on the ballot) stays
  on the round only. Comparison ignores those, so they don't rewrite the row every refresh.

The Safe is never copied. It is predicted from the initiative's id (`rfp:<id>`) and its
signers, and set once through `safe-confirm`. If the round's `account` ever differs from
the site's Safe, the follow step logs it and Admin → Vote shows it as a warning; nothing is
written.

It also runs once per isolate on the first read, so today's rows are brought in line
without waiting for a new revision. Each write is logged (slug, field, from → to) and goes
through `db.initiatives.update` so the board's status index and card summaries refresh.
Slugs already follow the round by index once seen (`manifestFromChain` with `previous`),
so an account changed by hand on the round keeps its page.

### 3. Changing a fact on the round

On the initiative's edit page and in admin settings, an on-ballot initiative shows its
goal, type and affiliations read-only, with "Set on the round" for a site admin
(see Calls made). It opens a form for goal, RFP and affiliations. The account is sent as
the round has it: the form never changes it. Saving calls the existing `POST /api/admin/vote-round/corrections` with
`action: "initiative"`, which validates and returns the `setInitiative` batch, then:

- the connected wallet holds `ADMIN_ROLE`: send it with `writeContract`, wait for the
  receipt, then poll the initiative until the site shows the new values (as
  `ballot-add.ts` does after Put on the ballot);
- otherwise: offer the Safe Transaction Builder JSON, as withdraw and corrections do
  today, and say the page will follow once the Safe executes it.

When the contract won't take it (a quiet ending, the initiative settled, the round over),
the form says so and when it opens again (`addingOpen` / `nextAddingOpen`).

Proposers see the goal field disabled with "On the ballot: ask a round admin to change
the goal."

## Goals, non-goals, anti-goals

- Goal: no path changes an on-ballot initiative's goal, type, Safe or affiliations on the
  site alone; the round's values show on the site within one refresh.
- Non-goal: changing recorded ballots or the replay; renaming groups (`setGroupName`
  stays in Admin → Vote corrections); test rounds.
- Anti-goal: the site writing to the chain on its own, or trusting the browser that a
  transaction happened. The site only copies what it reads from the chain.

## Calls made (builder check)

- **The lock never lifts.** It lasts as long as the slug is in the production round, through
  settling and after the round closes. The round is the record of what was voted on; a
  site goal changed afterwards would make the funded % disagree with the award. Once the
  contract stops taking `setInitiative` (settled, round over), the form says the facts are
  final.
- **Who gets the form.** Any site admin sees "Set on the round" on an on-ballot initiative
  (the corrections route stays `requireAdmin` + recent auth). It sends the call directly
  when the connected wallet holds `ADMIN_ROLE` on the round (a new `isAdmin`-only check,
  not `useRoundAdmin`, which also requires the pledge role); otherwise it gives the Safe
  Transaction Builder JSON for the admin Safes.
- **Milestones.** A goal change on the round leaves the milestones as they are. The form
  warns when the live milestones (or a held edit's) won't add up to the new goal. The
  intended order for a team's goal change is: a round admin sets the goal on the round, the
  site follows, then an admin accepts the team's held edit with the matching milestones.
  The refusal on accepting a held goal says exactly that.

## Decided by Sem

- **Affiliations:** copy only groups shared by two or more initiatives (a team's own group
  stays on the round only).
- **Safe:** not changeable from the website. It is computed from the initiative's id; the
  form leaves the account as the round has it, and the follow step never copies it.

## Left to the builder

Where the lock check lives (one helper used by every route), the exact copy, the log
format, and test layout (route tests for each refusal, a unit test for the follow step
against a fixed manifest, a component test for the read-only fields).
