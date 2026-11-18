# On the ballot: pledges to sign and putting initiatives on the ballot

Nov 18, 2026. Design: https://claude.ai/artifact/SNj76PdaYbvRFJXwWHf1q5

## Why

During the real vote, a pledge to an initiative in the round must be signed by a wallet that holds
the contract's pledge role (`setPledgeBySig`). Site admins without that role can no longer record a
pledge at all: the form asks their wallet to sign and the contract refuses.

Initiatives also join the round only through `scripts/vote-deploy.ts --add`, run by hand.

## What changes, in one paragraph

Approving, pledging and qualifying work as today. One new state follows them: **On the ballot**.
Only a round admin can put an initiative on the ballot, and only once it is **Qualified for the
vote**. Doing so adds it to the vote contract and signs its pledges. After that, any site admin can
still add or change a pledge to it: the change is saved as **Awaiting signature** and waits in a
list until a round admin signs it.

## Words

| Thing                                                            | Word in the UI                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| The new state                                                    | **On the ballot**                                                                             |
| The action                                                       | **Put on the ballot**                                                                         |
| A wallet that holds the vote contract's admin and pledge roles   | **round admin**                                                                               |
| A pledge change to an initiative on the ballot, not yet on-chain | **Awaiting signature**                                                                        |
| Taking an awaiting change back                                   | **Discard**                                                                                   |
| The round admin's list                                           | **Waiting for a round admin**, in two parts: **Ready for the ballot** and **Pledges to sign** |

Every admin wallet on the mainnet round holds both `ADMIN_ROLE` and `PLEDGE_ROLE`
(`vote/deployments/mainnet-2026-11-18.preview.json`), so one name covers both. The UI checks both
roles anyway (below).

"On the ballot" is derived from the chain, never stored: an initiative is on the ballot when its
slug is in the production round's manifest (`ROUND.slugs`).

## States

```
pending ──(site admin: Approve)──▶ approved ──(pledges + donations reach the floor)──▶ Qualified for the vote
                                                                                          │
                                                       (round admin: Put on the ballot)   ▼
                                                                                    On the ballot
```

- `pending`, `approved`, `rejected`, `archived`: unchanged (`InitiativeStatus`).
- **Qualified for the vote**: unchanged, `voteState(raised, goal, settings).kind === "eligible"`
  (`shared/vote.ts`).
- **On the ballot**: in the round's manifest. Once on, it stays on even if it later falls under the
  floor; only Withdraw (Admin → Vote) takes it out of the count, as today.

## Funding status on the board

"On the ballot" is a new funding status, next to the ones the board already has (`STATUS_LABELS` in
`app/lib/board-view.ts`):

| Status      | Label                  | When                               |
| ----------- | ---------------------- | ---------------------------------- |
| `open`      | Open for funding       | as today                           |
| `qualified` | Qualified for the vote | as today, and not on the ballot    |
| `ballot`    | **On the ballot**      | in the production round's manifest |
| `funded`    | Fully funded           | as today (wins over On the ballot) |

Where funding statuses show today, On the ballot shows too:

- **Funding filter**: a fourth choice, **On the ballot**, after Qualified for the vote. It is
  offered while the vote display is on (`voteFilter`), like Qualified. The filter `qualified` keeps
  matching every initiative that qualified, so it includes those on the ballot; `ballot` matches
  only those on the ballot. URL: `?status=ballot`.
- **Funding sort sections**: Fully funded, On the ballot, Qualified for the vote, Open for funding.
- **Colour**: On the ballot is green (`--color-dao-green`, #5cb75a). Never the vote gold or yellow:
  those mean a settled initiative. Awaiting signature and Pledges to sign are neutral (white
  outlines), not amber.
- **Glyph** (`FundingGlyph`): the qualified check, dark, inside a filled green ring (Qualified keeps
  its outline ring).
- **Card and initiative page mark**: where an initiative shows "Qualified for the vote", one on the
  ballot shows "On the ballot" instead.
- **Agent feeds** (`api/services/feed.ts`, `vote-llms.ts`): "On the ballot" as the status.

The homepage follows the production round only (`docs/vote-environments.md`), so a test round never
makes anything show On the ballot.

## Pledges

### Before the ballot

Unchanged: any site admin adds, edits or removes a pledge and it saves at once and shows on the
initiative page and the front page. `pledgeOnChain()` returns null for an initiative not in the
round, as today.

### On the ballot

`pledgeOnChain()` is non-null. What happens on add, edit, status change or delete:

- **The admin's wallet is a round admin**: as today. The wallet signs, the relayer sends, the row
  changes once the chain has it.
- **Otherwise**: the change is saved as an **awaiting request** and the row is left as it is. The
  form says "Saved as Awaiting signature. It counts in the vote once a round admin signs it." No
  wallet prompt.

This works like a proposal waiting for admin review: the change is held, nobody outside the admin
pages sees it, and here the review is a round admin's signature.

An awaiting request:

- holds the same `PledgeChange` the signed path uses (`add` with the new row, `edit` with the patch
  and status, `remove`), the pledge id (`pid`, made when it is saved, so a new pledge keeps its id
  through signing), who asked and when;
- is kept in KV under the round's own keys, next to `pledge-pending` (so backups keep it, and a new
  round starts with none);
- is at most one per pledge: a second change to the same pledge replaces it;
- can be discarded by any site admin;
- does not move the tally, the board or the public page until it is signed and lands. The admin
  pledges table shows it on its row (or as a new row for an `add`) with the Awaiting signature chip
  and Discard.

A logo uploaded with an awaiting `add` or `edit` is stored with the request and applied with it.

### Signing

A round admin signs an awaiting request from **Pledges to sign**. It runs the existing flow
(`api/services/admin-pledges.ts`, `app/lib/pledge-flow.ts`): prepare → sign → relay → wait for the
receipt → settle. When it settles as landed, the request goes away and the row matches the chain. If
it fails, the request stays, with the reason.

**Sign all** signs them one after another: one wallet prompt each, consecutive nonces.

## Put on the ballot

### When the button shows

On the admin initiative page, a **Put on the ballot** card shows when the initiative is:

1. `approved`,
2. Qualified for the vote,
3. not on the ballot yet,
4. and a real round is active and not over.

A site admin who isn't a round admin sees the card without the button: "Qualified. A round admin
puts it on the ballot."

The button is greyed out, with the reason, when:

- the initiative has no Safe (`safeAddress`), or another initiative in the round uses it: "Add a
  Safe first." The round finds the initiative by this address;
- adding is closed (a tier's quiet ending): "Opens again Dec 5, 21:54", from `nextAddingOpen`;
- it is an RFP with affiliations (the contract refuses it).

### What the card shows

The initiative's Safe, goal, the pledges it will sign (count and total), what it will ask the pool
(goal less those pledges), its affiliations and whether it is an RFP. Then the button and "Your
wallet asks N times: the transaction that adds it, then one signature per pledge."

### What the button does

All in the round admin's browser, with their connected wallet:

1. **Add**: the wallet sends `addGroup` for each new affiliation the round doesn't have yet, then
   `addInitiative(safe, goal, rfp, groups)`. Same arguments as `addPlan()` in
   `scripts/vote-deploy.ts`, moved to `shared/` so the script and the site share them. These are
   transactions: the round admin pays the gas.
2. **Wait** for the receipt and for the site's manifest to include the slug. The manifest already
   refreshes on its own when `configRevision` changes, matching the slug by Safe (`slugsByAccount`).
   The page polls the round until the slug shows.
3. **Sign** each open pledge (`status === "pledged"`) as it stands, through the same flow as Pledges
   to sign. A pledge saved before the ballot is a row with no chain record, so the change is "record
   it as it is".

If the page closes after step 1, nothing is lost: the initiative is on the ballot, and its unsigned
pledges show in **Pledges to sign** (see below), where any round admin can finish.

### Pledges that still need a signature

For an initiative on the ballot, **Pledges to sign** lists:

- every awaiting request, and
- every open pledge row whose on-chain record is missing or has another amount (read with
  `pledges(id)`, as `pledgeOf` does), with no awaiting request or relayed change in flight.

The second kind covers pledges left unsigned by Put on the ballot. In the meantime the initiative
asks the pool for more than its pledges say; the list makes that visible.

## Who is a round admin

The connected wallet holds both `ADMIN_ROLE` and `PLEDGE_ROLE` on the active round's contract
(`hasRole`, read in the browser). Not a site role: any site admin can connect a round admin wallet.
Sending still needs a site admin session, as today.

## Where it shows

- **Admin initiative page**:
  - the Put on the ballot card when qualified;
  - "On the ballot" chip in the header once on;
  - awaiting rows in the pledges table;
  - a short **Pledges to sign** list beside the pledge form, read-only for others.
- **Admin dashboard**:
  - the **Waiting for a round admin** card: Ready for the ballot, then Pledges to sign;
  - one to-do line: "1 initiative ready for the ballot, 3 pledges to sign".
- **Record a pledge** (dashboard): the same awaiting behaviour as the initiative page.

- **Public board and initiative pages**: the On the ballot funding status (above). Awaiting pledges
  never show there.

## Rehearsal on Sepolia

Put on the ballot also works on the test round, from **Admin → Test vote** (`/admin/vote-test`), so
it can be tried before mainnet:

- The same card, in a **Ready for the test ballot** list on that page: approved, Qualified for the
  vote, not in the test round yet. The checks and the quiet-ending rule are the same.
- An initiative without a Safe goes in under its test placeholder account (`testPlaceholder(slug)`),
  as `planInitiatives()` already does for test rounds.
- Its open pledges are signed as **test pledges** (the existing
  `/api/admin/vote-test-round/test-pledges/…` flow): they reach the test contract only and never
  change the site's pledge rows.
- Pledges to sign on that page lists the open pledges of test-round initiatives whose test record is
  missing or differs, signed the same way.
- Awaiting requests stay production-only: in the test round a site pledge never needs a signature,
  so there is nothing to hold.
- Nothing on the public board changes for the test round.

## Out of scope

- A Safe as the round admin (multisig signatures or transactions).
- Taking an initiative off the ballot (Withdraw on Admin → Vote stays as it is).
- Email or chat notifications for round admins.
