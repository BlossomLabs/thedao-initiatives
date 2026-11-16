# Withdrawn Initiatives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can withdraw an initiative from the vote (and undo it) without removing its
slot; a withdrawn initiative asks $0 in the ballot size rule (the independence and
affiliation rules ignore the flag), and the off-chain tally skips it.

**Architecture:** The contract stores a `withdrawn` bit per initiative and applies it to the
size rule only. The replay reads the bits per block beside the asks (`withdrawnMask()`) and
treats a withdrawn project like a covered one for candidacy and the quiet comparison, but
records it separately and not finally. The supporter lock is unchanged. Admin → Vote hands the admin a
Safe Transaction Builder batch for the call, refusing settled projects.

**Tech Stack:** Solidity 0.8 + Foundry (`vote/`), TypeScript (Deno + Vitest), Python 3
reference (`vote/reference/`), React Router app.

**Spec:** `docs/superpowers/specs/2026-11-15-withdrawn-initiatives-design.md`

## Global Constraints

- Tiers are written S-Tier, A-Tier, B-Tier in prose, comments, UI copy and test names (AGENTS.md);
  bare letters only in data. Render tiers in running text with `tierName()`.
- Dates via `app/lib/format.ts` helpers ("Nov 1, 14:00"); agent feeds keep ISO UTC.
- Only `ADMIN_ROLE` withdraws or undoes; allowed until the hard deadline, inside quiet-ending
  windows too; revert when already in the requested state.
- `initiativeUsd(i).askUsd` keeps reporting the real ask; withdrawn is a separate fact.
- Ballot encoding, slot order and `MAX_PROJECTS` (254) don't change.
- A withdrawal or undo of a project already settled (funded in a settled tier, or covered at a
  settlement) is ignored by the replay. A withdrawal counts for a tier's settlement when its
  block timestamp is before the tier's cutoff (the state `before()` picks).
- Withdrawn wins over covered: a withdrawn project asking $0 is withdrawn.
- The independence rule (`_checkProof`) and the affiliation rule (`_checkGroups`, real asks)
  ignore the flag, so a voter with a withdrawn project in a settled tier is never stranded.
- The deployed Sepolia test round is not migrated; the next deploy has the flag.
- Copy: the action is "Withdraw from the vote" / "Undo withdrawal"; the state is "Withdrawn".

## Review Focus

1. A withdrawal in the very block the tier settles with (last block strictly before the
   cutoff) — it counts: the project is in `withdrawn`, not `funded`.
2. A withdrawn project that also asks $0 (fully donated) — it is withdrawn, not covered.
3. A voter's settled S-Tier is {P, X, Y} and P is withdrawn afterwards; the voter changes their
   B-Tier — the editor keeps P in S-Tier, the contract accepts it (P still counts as
   independent) and the replay accepts it (lock unchanged).
4. A withdrawn project in an open tier, followed by lower tiers: the editor drops it and
   moves the ranks below up, and the sent ballot passes `_tierRanks`.
5. Old chain-state cache entries and stored settlements (no `withdrawn`) are never read as
   "nothing withdrawn".

---

### Task 1: Contract flag, calls and ballot rules

**Files:**
- Modify: `vote/contracts/RoundAccounting.sol` (struct `Initiative`, `addInitiative`,
  `setInitiative`, `_unplacedAskNothing`, new functions/event/view)
- Modify: `vote/contracts/SignedBallots.sol` (`_rankCounts`)
- Test: `vote/test/Withdrawn.t.sol` (new; reuse the setup helpers in `vote/test/helpers/`
  the way `BallotRules.t.sol` does)
- Modify: `shared/vote/abi.ts` (regenerated)

**Interfaces:**
- Produces:
  - `struct Initiative { address account; bool rfp; bool withdrawn; uint256 goalUsd; uint256 groups; }`
    (`withdrawn` right after `rfp`, so it packs into slot 0 with `account`)
  - `event InitiativeWithdrawn(uint256 indexed initiativeId, bool withdrawn);`
  - `function withdrawInitiative(uint256 id) external` / `function undoWithdrawInitiative(uint256 id) external`
  - `function withdrawnMask() external view returns (uint256)` (bit `i` = initiative `i` withdrawn)
  - errors `AlreadyWithdrawn()`, `NotWithdrawn()`
  - gate: the existing `_requireAccountingOpen()` (no new hook)

- [ ] **Step 1: Write the failing tests** in `Withdrawn.t.sol`:
  - `test_adminWithdrawsAndUndoes`: emits `InitiativeWithdrawn(1, true)` then `(1, false)`;
    `initiative(1).withdrawn` follows; `withdrawnMask()` is `2` between, `0` after.
  - `test_onlyAdmin`: a non-admin reverts with AccessControl's unauthorized error for both calls.
  - `test_revertsWhenAlreadyInState`: withdraw twice → `AlreadyWithdrawn`; undo a live one → `NotWithdrawn`.
  - `test_openInsideQuietEnding`: `vm.warp(firstTallyAt[0] + 1)` → withdraw succeeds (while
    `addInitiative` reverts `AddingClosed` at the same time).
  - `test_closedAtHardDeadline`: pool set, `vm.warp(hardDeadline)` → `VotingClosed`.
  - `test_addInitiativeStartsLive`, `test_setInitiativeKeepsFlag`, `test_setGroupsKeepsFlag`.
  - `test_initiativeUsdUnchanged`: withdrawn project's `initiativeUsd(i).askUsd` equals its real ask.
  - `test_withdrawnAsksNothingForSize`: pool $100k; a ballot placing projects asking $120k +
    withdrawn X asking $40k reverts `BallotTooSmall` (would pass with X live).
  - `test_withdrawnStillIndependent`: S-Tier = {X, Y, Z} pairwise unrelated, X withdrawn,
    proof `[x, y, z]` → accepted (Review Focus 3).
  - `test_withdrawnKeepsRealAskInGroups`: S-Tier = {X g $100k, Y h $50k, P k $60k}, P withdrawn →
    accepted (with P at $0, group g would be over half).
  - `test_withdrawnLeftOutIsFine`: every live project placed, only withdrawn X unplaced and asking
    > 0, total below 1.5× pool → accepted (`_unplacedAskNothing` skips X).
  - `test_withdrawnKeepsShape`: ranks `[1,1,1,1,4]` with X (rank 1) withdrawn → no `InvalidBallot`.
  - `test_earlierBallotStaysRecorded`: ballot recorded, then withdraw → nothing reverts, receipt kept.

- [ ] **Step 2: Run** `cd vote && forge test --match-contract Withdrawn` — Expected: compile errors / FAIL.

- [ ] **Step 3: Implement.** `_rankCounts` doesn't add a withdrawn project's ask to
  `requested` (the `asks` array keeps real asks for `_checkGroups`); `_unplacedAskNothing`
  `continue`s past withdrawn projects; `addInitiative` writes `false`, `setInitiative` writes
  the existing bit back; withdraw/undo call `_requireAccountingOpen()`, `_requireInitiative(id)`.

- [ ] **Step 4: Run** `cd vote && forge test` — Expected: all pass, including `Gas.t.sol` and
  `Size.t.sol` (contract stays under 24 576 bytes; `via_ir` is already on). Note the gas of
  the 40-project ballot in `Gas.t.sol` before and after; it must not rise more than ~1%
  (the bit shares slot 0 with `account`, already read).

- [ ] **Step 5: Regenerate** `shared/vote/abi.ts` from `vote/out/SignedBallots.sol/SignedBallots.json`
  with the same header line and `export const SIGNED_BALLOTS_ABI = [...] as const;` shape,
  then `deno fmt shared/vote/abi.ts`; `deno task check:api` passes (`initiative()`'s tuple
  gained a field; fix any reader).

- [ ] **Step 6: Commit** `Vote contract: admins withdraw an initiative (and undo it); a withdrawn one asks $0 for the size rule`

### Task 2: Ballot rules mirrors

**Files:**
- Modify: `shared/vote/rules.ts`, `vote/reference/ballot_rules.py`,
  `vote/reference/export_rules_fixtures.py`, `shared/vote/fixtures/ballot-rules.json` (regenerated)
- Test: `vote/reference/test_ballot_rules.py`, `shared/vote/rules.test.ts`

**Interfaces:**
- Produces: `RulesRound.withdrawn?: boolean[]` (absent = none); Python
  `check_ballot(..., withdrawn=None)` and `check_proof(..., withdrawn=None)`.
  Every caller that builds a `RulesRound` (grep `independentTiers:`) passes the round's flags
  once Task 3 provides them.

- [ ] **Step 1: Failing tests** in both languages, the same four cases as Task 1's size /
  left-out / independent / groups tests, named `test_withdrawn_asks_nothing`,
  `test_withdrawn_left_out_is_fine`, `test_withdrawn_still_independent`,
  `test_withdrawn_keeps_real_ask_in_groups`; plus fixture cases carrying `withdrawn` in the
  exported JSON.
- [ ] **Step 2: Run** `python3 -I -m pytest vote/reference/test_ballot_rules.py` and
  `deno task test shared/vote/rules.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**: the ask of a withdrawn project is 0 in `requested` and `total`
  only; `independent()`, `findProof`, `checkProof`, the group sums and the shape rules are
  unchanged. Regenerate the fixtures with
  `python3 -I vote/reference/export_rules_fixtures.py > shared/vote/fixtures/ballot-rules.json`.
- [ ] **Step 4: Run** both suites and `cd vote && forge test --match-contract BallotRules`
  (it reads the same fixtures) — Expected: PASS.
- [ ] **Step 5: Commit** `Ballot rules: withdrawn projects ask $0 for the size rule (TS, Python, fixtures)`

### Task 3: Chain states carry the withdrawn flags

**Files:**
- Modify: `shared/vote/quiet-ending.ts` (type `ChainState` only), `shared/vote/chain-states.ts`,
  `api/services/vote-chain.ts`
- Test: `shared/vote/chain-states.test.ts`

**Interfaces:**
- Produces: `ChainState.withdrawn: boolean[]` (may be shorter than `m`, like `asks`; missing = false);
  `StateSource.stateAt` returns `{ timestamp, asks, poolUsd, withdrawn }`.

- [ ] **Step 1: Failing tests**: a fake `StateSource` whose block 7 holds
  `withdrawn: [false, true]` → `chainStates` gives that state with the flags and `event: true`
  (an `InitiativeWithdrawn` block is an accounting event); a cache holding a state stored
  under the old key shape is not used (re-read from the source).
- [ ] **Step 2: Run** `deno task test shared/vote/chain-states.test.ts` — FAIL.
- [ ] **Step 3: Implement**: `StoredState` gains `withdrawn: boolean[]`; change the state cache
  key prefix (e.g. append `:w1`) so old entries are skipped; `vote-chain.ts` `stateAt` adds
  `withdrawnMask` to its multicall and expands the bits to `count` booleans (a contract
  without it, the deployed test round, fails that one call: treat as all false), and `accountingEventBlocks` adds the
  `InitiativeWithdrawn` event to `PLEDGE_SET, POOL_USD_SET`.
- [ ] **Step 4: Run** the test and `deno task check:api` — PASS.
- [ ] **Step 5: Commit** `Vote chain states: each block's withdrawn flags, read with the asks`

### Task 4: Replay skips withdrawn projects

**Files:**
- Modify: `shared/vote/quiet-ending.ts`, `shared/vote/chain.ts` (`ChainInputs.withdrawn`),
  `shared/vote/next-tier.ts` (honour it), `shared/vote/replay-round.ts` (named lists),
  `api/routes/vote.ts` (`StoredSettled` gains `withdrawn`; bump the snapshot key version so
  old snapshots are recomputed, not read as none withdrawn)
- Modify: `vote/reference/quiet_ending_steps.py` (`run_on_time`) with a `withdrawn_for_day`
  input beside `asks_for_day`, mirroring the TS rules
- Test: `shared/vote/quiet-ending.test.ts`, `shared/vote/next-tier.test.ts`,
  `vote/reference/test_quiet_ending_steps.py`

**Interfaces:**
- Consumes: `ChainState.withdrawn` (Task 3).
- Produces: `Settled.withdrawn: number[]`; `TierState` settling + `live` gain `withdrawn: number[]`;
  `ChainInputs.withdrawn: ReadonlySet<number>` (no candidate; not covered); replay-round's
  named output gains `withdrawn` (slugs) beside `covered`.

- [ ] **Step 1: Failing tests** (TS; mirror the first four in Python):
  - `funded project withdrawn mid-window, freed money funds nobody new: S-Tier settles on time, quiet`
  - `funded project withdrawn mid-window, freed money brings another in: S-Tier window extends`
  - `withdraw then undo inside one window, nothing else changes: quiet`
  - `withdrawn at S-Tier's settlement, undone during A-Tier: competes in A-Tier`
  - `withdrawn in the block S-Tier settles with: in withdrawn, not funded` (Review Focus 1)
  - `withdrawn and asking $0: listed withdrawn, not covered` (Review Focus 2)
  - `withdrawal after the project was funded in S-Tier: ignored, award unchanged`
  - `withdrawal one second after S-Tier's cutoff: S-Tier settled without it in withdrawn`
  - `ballot keeps a withdrawn project: voter not charged for it, money goes to their other choices`
  - `voter keeps a withdrawn project in their settled S-Tier and changes B-Tier: accepted`
    (Review Focus 3)
  - next-tier: `a withdrawn project has no gap and is not listed covered`.
- [ ] **Step 2: Run** `deno task test shared/vote/quiet-ending.test.ts shared/vote/next-tier.test.ts`
  and `python3 -I -m pytest vote/reference/test_quiet_ending_steps.py` — FAIL.
- [ ] **Step 3: Implement** in `replay()`:
  - `withdrawnIn(state)` = projects with `state.withdrawn[c]` and not in `finished()`;
  - `coveredIn` excludes `withdrawnIn`;
  - `inputs()` passes `withdrawn: new Set(withdrawnIn(state))`, costs stay the real asks;
    `chainTally` leaves withdrawn projects out of `candidates`;
  - `look()` returns `{ funded, covered, withdrawn }`; `sameFunded` leaves out covered **or**
    withdrawn at either tally;
  - `settle()` records `withdrawn: withdrawnIn(state)`; `finished()` stays funded + covered
    (withdrawn is not final);
  - the `tier_settled` lock is unchanged.
- [ ] **Step 4: Run** both suites plus `deno task test shared/vote/` — PASS.
- [ ] **Step 5: Commit** `Vote replay: withdrawn projects are no candidate, extend nothing alone and are recorded apart`

### Task 5: Admin → Vote action

**Files:**
- Modify: `api/routes/admin.ts` (new route beside `/vote-round/pool`), `scripts/vote-deploy.ts`
  (export the existing `adminBatch(m, title, calls)` from a shared module, e.g. move it to
  `shared/vote/admin-batch.ts`, so the API can use it)
- Modify: `app/components/admin/VoteRound.tsx` (the per-project list, or add one)
- Test: `api/routes/admin.test.ts` (or the file testing `/vote-round/*`), `app/components/admin/VoteRound.test.tsx`

**Interfaces:**
- Consumes: replay state (Task 4) via `currentVote(deps)`; `adminBatch`.
- Produces: `POST /api/admin/vote-round/withdraw` with body `{ slug: string, withdrawn: boolean }`,
  `requireRecentAuth`, audited like the pool route; returns the Safe Transaction Builder batch
  JSON for `withdrawInitiative(i)` / `undoWithdrawInitiative(i)`.

- [ ] **Step 1: Failing tests**: settled project → 409 "This initiative is settled in S-Tier; it can't be
  withdrawn." (tier via `tierName()`); covered at a settlement → 409 likewise; unknown slug → 404;
  already in the requested state on-chain → 409; past the hard deadline → 409; good case →
  200 with one transaction to the round's contract whose data decodes to the right call; an
  audit entry is written. UI: the button reads "Withdraw from the vote" / "Undo withdrawal",
  is disabled with the reason for a settled project, and downloads the batch.
- [ ] **Step 2: Run** `deno task test:api` and `deno task test app/components/admin/VoteRound.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both — PASS.
- [ ] **Step 5: Commit** `Admin → Vote: withdraw an initiative from the vote, or undo it (Safe batch; never once settled)`

### Task 6: Voter-facing screens and feeds

**Files:**
- Modify: ballot editor (desktop and phone: find where `covered` / unplaced projects are listed
  in `app/components/vote/`), `app/lib/vote-results.ts`, `app/components/vote/VoteResults.tsx`,
  `app/hooks/use-vote.ts`, `api/services/vote-llms.ts`
- Test: the matching `*.test.ts(x)` files

**Interfaces:**
- Consumes: `withdrawn` on settled tiers and `live` (Task 4).

- [ ] **Step 1: Failing tests**:
  - editor: a withdrawn project is shown "Withdrawn" and can't be placed;
  - one already on the voter's ballot in a settled tier stays where it is, marked "Withdrawn";
  - one in an open tier is dropped on send and the ranks below move up: S-Tier settled =
    projects 0–2 (rank 1), A-Tier open = projects 3 (withdrawn) and 4 (rank 4), B-Tier =
    project 5 (rank 6): `[1,1,1,4,4,6]` sends `[1,1,1,255,4,5]`, which passes `checkBallot`'s
    shape (Review Focus 4);
  - `withdrawnProjects(tiers, liveWithdrawn)` in `vote-results.ts` lists them; results show a
    "Withdrawn" group apart from tiers and covered, never with a donation gap; a project
    funded in a settled tier whose flag says withdrawn shows as funded;
  - `vote-llms`: the feed marks a withdrawn initiative `withdrawn: true` (ISO UTC times unchanged).
- [ ] **Step 2: Run** `deno task test app` and `deno task test:api` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `deno task test`, `deno task test:api`, `deno task typecheck`, `deno lint` — PASS.
- [ ] **Step 5: Commit** `Vote screens: withdrawn initiatives shown apart, unplaceable, in the agent feed`

### Task 7: Docs

**Files:**
- Modify: `vote/docs/quiet-ending-rules.md`, `docs/superpowers/specs/2026-11-11-ballot-rules-design.md`
  (one paragraph each), spec status line → "approved and built Nov <day>, 2026"

- [ ] **Step 1:** Add the withdrawn rules (candidacy, quiet comparison, not final, lock, ignored
  once settled) and the two ballot-rule changes, in the docs' own wording.
- [ ] **Step 2: Commit** `Vote docs: withdrawn initiatives`
