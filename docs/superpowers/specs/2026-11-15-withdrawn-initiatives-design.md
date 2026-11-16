# Withdrawn initiatives

Design, Nov 15, 2026. Status: approved and built Nov 16, 2026. Revised Nov 16 after a review against the
code, and again to match what was built.

## Why

The contract cannot remove an initiative. Initiatives live in an append-only list and a
ballot's bytes are positional (byte `i` is initiative `i`), so taking one out would shift
every later initiative and make recorded ballots point at the wrong projects. Today an
initiative that drops out after voting opens can only be hidden off-chain, which breaks
"anyone can replay the round from the chain".

A **withdrawn** flag keeps the slot. The off-chain tally skips a withdrawn project, and the
ballot size rule doesn't count its ask.

## Decisions (the owner's)

1. **Only admins** withdraw an initiative or undo a withdrawal (`ADMIN_ROLE`).
2. **Any time** until the hard deadline, including inside a tier's quiet-ending window
   (unlike adding projects, which is closed there).
3. **Never once the project is settled**: funded in a settled tier (receiving money from
   TheDAO) or covered by donations at a tier's settlement. The contract cannot know this,
   because settlement is computed off-chain by the replay, so this is enforced off-chain
   (option A below).
4. **A withdrawal can be undone.**
5. **A withdrawal mid-window works like a project becoming fully funded** (rule 10 of
   `2026-11-12-chain-asks-in-quiet-ending-design.md`): it does not extend the window by
   itself. It extends it only when the freed money brings another project into the
   settling tier (or, for an undo, when the returning project pushes one out).
6. **A ballot is as valid after a withdrawal as before.** Ballots are judged once, when
   recorded; the tally just skips the withdrawn project.
7. **The independence and affiliation rules stay as they are and ignore the flag.** A
   withdrawn project counts in them like any other project, with its real ask. Only the size
   rule treats it as asking $0 (see "Why the tier rules ignore the flag").

## Approaches for decision 3

- **A. Off-chain** (chosen). Admin → Vote refuses the action for a settled project, and the
  replay ignores a withdrawal (or undo) of a project that is already settled: its award
  stands. Small, and it matches how settlement already works.
- **B. On-chain.** Post each settlement to the contract so `withdraw` can revert. Someone must
  post settlements and the contract must trust them. Rejected: large, and it adds a trusted
  role.

## Contract

- `Initiative` gains `bool withdrawn`, right after `rfp`. `initiative(id)` returns it (ABI change; `shared/vote/abi.ts` is
  regenerated). `addInitiative` and `setInitiative` build the struct positionally and must
  carry the field: `addInitiative` writes `false`, `setInitiative` (before voting opens only)
  keeps the current value.
- `withdrawInitiative(uint256 id)` and `undoWithdrawInitiative(uint256 id)`:
  `onlyRole(ADMIN_ROLE)`, `_requireInitiative(id)`, the existing `_requireAccountingOpen()`
  (closed at the hard deadline once the pool is set, like every other accounting gate), and
  revert `AlreadyWithdrawn` / `NotWithdrawn` when the flag is already in the requested state
  (no silent no-op, so a double click shows up). Both emit
  `InitiativeWithdrawn(uint256 indexed initiativeId, bool withdrawn)`. `InitiativeConfigured`
  does not carry the flag.
- `withdrawnMask` is a stored public `uint256`: bit `i` set when initiative `i` is withdrawn
  (at most 254 initiatives, so it fits). It is kept beside the struct's `withdrawn` bool, and
  both are written only by one private setter, so they cannot disagree. Each ballot reads the
  mask once (+0.28% gas on a 40-project ballot), and the replay reads it once per block.
- `initiativeUsd` is unchanged: it still reports the real ask. Withdrawn is a separate fact,
  so the replay can tell "withdrawn" from "covered" (both would otherwise look like $0).
- **Ballot rules** (`_validateBallot`), for a withdrawn project:
  - placed: its ask adds nothing to the 1.5× total (`_rankCounts` skips it when summing
    `requested`; the `asks` array keeps its real ask for the affiliation rule);
  - unplaced: `_unplacedAskNothing` skips it, so leaving a withdrawn project out never blocks
    the "every project that still asks is placed" escape;
  - everything else is unchanged: rank structure (`_rankCounts` / `_tierRanks`), the three
    independent projects (`_checkProof`), and the affiliation rule (`_checkGroups`, real ask).
- Size: `SignedBallots` runtime is 22,104 bytes; two functions, a
  view, an event and two errors fit.

### Why the tier rules ignore the flag

The contract checks S-Tier (and A-Tier when `independentTiers` says so) on every ballot,
including tiers that have already settled, and the replay rejects any ballot that changes a
settled tier (`tier_settled`). If a withdrawn project couldn't be one of the three
independent projects, a voter whose settled S-Tier was {P, X, Y} with P withdrawn later
would have to keep P, fail the proof, and never send a ballot again. Counting P's ask as $0
in the affiliation rule strands them the same way (a group can go over half once P's ask
leaves the tier's total). The size rule can't strand anyone: B-Tier stays open until the end,
and the escape skips withdrawn projects.

The cost: a ballot sent straight to the contract can lean on a withdrawn project for the
independence and affiliation rules. The site's editor relies on withdrawn projects only
where it must keep them: in a settled tier, or as a placeholder holding an open tier's place
so the picks below keep their tier.

## Replay (`shared/vote/quiet-ending.ts`)

- **Chain state per block** gains `withdrawn: boolean[]` beside `asks` and `poolUsd`, read
  with `withdrawnMask()` in the same multicall as the asks (`api/services/vote-chain.ts`
  `stateAt`). A contract without the view (the deployed Sepolia test round) reads as nothing
  withdrawn.
- **Tally event**: `accountingEventBlocks` adds `InitiativeWithdrawn` to `PledgeSet` and
  `PoolUsdSet`, so a block with a withdrawal or an undo gets a tally inside a window.
- **Candidates**: a project withdrawn at a tally's state is not a candidate in that tally: no
  money, not in any funded set. A ballot that places it is skipped for it: the voter is not
  charged, and their money goes to their other choices in this tier or later ones.
  `ChainInputs` carries the withdrawn set explicitly (not as a $0 cost), so the browser's
  what-if tally and next-tier gaps don't read it as covered.
- **Withdrawn wins over covered**: a project that is withdrawn and asks $0 is withdrawn.
  `coveredIn` and `live.covered` exclude withdrawn projects.
- **Quiet comparison**: `sameFunded` leaves out, from both funded sets, every project that is
  covered **or withdrawn** at either tally. So withdrawing and undoing alone never extend a
  window; they extend it only when another project enters or leaves because of them.
- **Settlement**: a project withdrawn in the state a tier settles with (the last block with
  timestamp before the tier's cutoff, as `before()` picks it) is recorded in the settlement's
  new `withdrawn` list with a $0 award. Unlike covered, this is **not final**: if the
  withdrawal is undone later, the project is an ordinary candidate in the tiers still open.
- **Already settled**: a project funded in a settled tier, or covered at a settlement, is not
  withdrawn for the replay, whatever its flag says. Its award stands; any refund is
  off-chain. The rule by time: a withdrawal whose block timestamp is before a tier's cutoff
  counts for that tier's settlement; one at or after the cutoff can't touch what settled.
- **Supporter lock**: unchanged. A withdrawn project in a settled tier stays where the voter
  had it (the editor keeps it there); it costs them nothing.
- The last window still settles regardless (`maxWindows`), so withdrawals cannot keep a tier
  open forever.
- **Caches**: the chain-state cache key and the stored settlement snapshots (`settled` in
  KV; `Settled` gains `withdrawn`) change version, so an old entry is never read as "nothing
  withdrawn".

Reference: `vote/reference/quiet_ending_steps.py` (`run_on_time`, where covered projects and
the quiet comparison live) gets the same rules and tests:

- a funded project withdrawn mid-window, freed money funds nobody new → quiet, settles on time;
- same, freed money brings another project in → the window extends;
- withdraw then undo inside one window, nothing else changes → quiet;
- withdrawn at S-Tier's settlement, undone during A-Tier → competes in A-Tier;
- withdrawal after the project was funded in S-Tier → ignored, award unchanged.

## App

- **Admin → Vote**: "Withdraw from the vote" and "Undo withdrawal" for each project in the
  round. The admin role is held by the admin's Safe, so the site hands over a Safe
  Transaction Builder batch for the call, the same way adding projects works (recent sign-in,
  audited). It reads the replay from the single vote-routes instance. The contract refuses the
  deadline and already-in-state cases; the replay ignoring a settled project's withdrawal is
  the backstop, and Admin → Vote also refuses, with the reason, when the replay says the
  project is settled.
- **Ballot editor** (desktop and phone): a withdrawn project can't be placed. One already on
  the voter's ballot:
  - in a settled tier: kept where it is, marked "Withdrawn" (the lock needs it unchanged);
  - in an open tier: marked "Withdrawn" and dropped when the voter sends; the ranks below it
    move up to close the gap (blanking its byte alone would break the rank structure).
    Exception: when dropping it would leave that open tier empty while a lower tier still has
    picks, it stays as a "Withdrawn" placeholder. It costs nothing (the tally skips it), and
    the voter's lower picks keep their tier.
- **Which withdrawn flags the rules use**: the ballot rules on the site (editor, relay check,
  `vote-sim`) use the raw on-chain flags at the head (`withdrawnFlags` in the served round),
  matching the contract. Displays use the replay's withdrawn list, which leaves out projects
  already funded or covered in a settled tier.
- **Vote results and live preview**: a withdrawn project is listed as "Withdrawn", apart from
  the tiers and the covered projects, with no donation gap. A project funded before a
  withdrawal was attempted shows as funded (the replay ignored the withdrawal).
- **Board**: initiative cards show a "Withdrawn" mark during a vote. Vote results list
  withdrawn initiatives apart under "Withdrawn".
- **Agent feed** (`/vote/llms.txt`, `api/services/vote-llms.ts`): marks withdrawn
  initiatives, and says so when the state couldn't be read.

## Not in scope

- No removal of slots and no change to ballot encoding.
- No on-chain settlement (option B).
- No refunds: money a settled project already received is handled off-chain.
- A round already deployed (the Sepolia test round) does not gain the flag; the next deploy
  does.

## Risks

- An admin can shape a window by withdrawing and undoing, like a donor can by donating.
  More than that: withdrawing a project just before S-Tier's cutoff and undoing it after
  moves it from S-Tier into A-Tier's competition. Both are bounded by `maxWindows`, and every
  withdrawal is an on-chain, audited event.
- A ballot sent straight to the contract can use a withdrawn project to meet the
  independence and affiliation rules (decision 7).
- The off-chain "already settled" rule means a contract call can succeed but be ignored.
  Admin → Vote prevents it in practice, and the results say why if it happens.
