# Asks from the Chain, Replayable by Anyone: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The vote's tally takes every project's ask and the pool from the chain at each tally's block, donations and pledges are tally events, admins record pledges on-chain by signature, and anyone can replay the round from an archive RPC with one script.

**Architecture:** A shared, pure-at-the-core replayer: `shared/vote/chain-states.ts` reads chain states (asks via the contract's own `initiativeUsd(i).askUsd` and `poolUsd()` with `eth_call` at a block) through a small `StateSource` interface; `replay()` in `shared/vote/quiet-ending.ts` stays pure and tallies each block with that block's state. The server wires the source to viem + KV; `scripts/vote-replay.ts` wires it to viem alone. The contract gains `setPledgeBySig` and the owner's size-minimum fix.

**Tech Stack:** Deno + TypeScript, vitest (`shared/`, `app/`, `scripts/`), `deno test` (`api/`), Solidity with Foundry (`vote/`), Python `unittest` reference (`vote/reference/`), viem.

**Spec:** `docs/superpowers/specs/2026-11-12-chain-asks-in-quiet-ending-design.md`, including its section "Adapted Nov 15", which overrides the text above it. Also binding: `docs/superpowers/specs/2026-11-15-ballot-rules-on-asks-design.md` (the price rule, the transcript check).

## Global Constraints

- Tiers are written **S-Tier**, **A-Tier**, **B-Tier** in prose, comments, copy and test names (`AGENTS.md`). In running text from code use `tierName()` from `shared/vote/ballot.ts`.
- Dates in copy use the helpers in `app/lib/format.ts` (`dayTime`, `shortDay`, `clock`, `dt`); the agent feed keeps ISO-style UTC.
- Amounts are six-decimal USD (`bigint` micro-USD). The per-initiative amount is `goalUsd`; the remaining one is `askUsd` (goal − donations − open pledges, never below 0).
- The ask of project `i` at block `b` is `initiativeUsd(i)` (its last return value, `askUsd`) read with `eth_call` at `b`. Nobody re-implements the contract's conversion in TypeScript.
- `stageTally` (`shared/vote/stage.ts`), the supporter locks and the window schedule do not change.
- Contract changes allowed: `setPledgeBySig` (Task 4) and the size minimum (Task 1). Anything else: stop and ask.
- Missing chain data is an error (503 `asks_unavailable` on the server, a non-zero exit in the script), never a value of zero and never today's state standing in for a past block.
- `replay()` stays pure: no RPC, runs in the browser and in Deno.
- Never commit `vote/node_modules` (a symlink) or `.superpowers/`. Each commit adds only the files its task names.
- Test commands: `deno run -A npm:vitest run <file>` (shared, app, scripts); `deno test -A <file>` (api) or `deno task test:api`; `cd vote && forge test --match-contract <Name>`; `cd vote/reference && python3 -m pytest -q` (or `-m unittest`); `deno task typecheck`, `deno task check:api`.

## Review Focus

1. **A block that is not final yet.** A chain state for a block newer than `FINAL_AFTER_SECS` must not be cached; a reorg would freeze wrong asks. Test in Task 6.
2. **An RPC that cannot serve past state.** Reading at an old block fails (pruned node): the server answers 503 `asks_unavailable` and the script exits non-zero; neither substitutes head-block values. Tests in Tasks 6 and 7.
3. **The script and the server disagree.** Same chain, same moment: `scripts/vote-replay.ts` and `/api/vote/round` must produce the same tiers, funded sets, awards and covered sets. Test in Task 8.
4. **A project added after earlier states were read.** A state whose `asks` is shorter than the project count: the missing projects are not candidates there. Test in Task 3.
5. **An admin signs and the relay fails.** A reverted or dropped `setPledgeBySig` saves nothing on the site and says so; the same signature twice fails on the nonce without a second pledge. Test in Task 9.

---

## File map

| File | Responsibility |
| --- | --- |
| `vote/test/HostileReads.t.sol` | Task 0: the test must catch an unbounded copy |
| `vote/contracts/SignedBallots.sol`, `shared/vote/rules.ts`, `vote/reference/ballot_rules.py`, fixtures | Task 1: size minimum min(1.5× pool, Σ asks) |
| `vote/reference/quiet_ending_steps.py` | Task 2: $0 rule in the reference |
| `shared/vote/quiet-ending.ts` | Task 3: `replay()` over chain states; covered projects |
| `vote/contracts/SignedBallots.sol`, `RoundAccounting.sol`, `shared/vote/abi.ts`, `shared/vote/typed-data.ts` | Task 4: `setPledgeBySig` |
| `scripts/vote-deploy.ts`, `shared/vote/manifest.ts` | Task 5: currencies, accounts, pledge role, seeded pledges |
| `shared/vote/chain-states.ts` (new) | Task 6: chain states through a `StateSource` |
| `api/services/vote-chain.ts`, `api/routes/vote.ts` | Tasks 6–7: viem/KV source; the round from chain states |
| `shared/vote/replay-round.ts` (new), `scripts/vote-replay.ts` (new) | Task 8: one replayer for the server and anyone |
| `api/routes/admin.ts`, `app/components/admin/initiative/Pledges.tsx` | Task 9: signed pledges |
| `app/components/vote/VoteResults.tsx` | Task 10: "Covered by donations" |
| `vote/docs/*.md`, `vote/README.md` | Task 11: the rules and how to replay |

---

### Task 0: HostileReads catches an unbounded copy

**Files:**
- Modify: `vote/test/HostileReads.t.sol` (the `BLOB` size at lines ~24, 37, 47)

The Nov 15 review parked this: the hostile token's 160 KB reply costs more than the 50k `EXTERNAL_READ_GAS` to return, so the call fails anyway and the test would pass even if `_boundedRead` copied the whole reply. Make the blob small enough to be returned under the read cap but large enough that copying it into memory costs far more than the bound the test asserts.

- [ ] **Step 1:** Set the blob to about 100_000 bytes, or whatever size you measure is returned within 50k gas yet blows the test's gas bound when copied whole. Keep the assertions.
- [ ] **Step 2: Prove it discriminates.** Temporarily replace `_boundedRead`'s assembly with a plain high-level call that copies the full return data; `cd vote && forge test --match-contract HostileReads` must FAIL. Restore the code; it must PASS. Put both outputs in the report. Do not commit the temporary change.
- [ ] **Step 3: Run** `cd vote && forge test` — all pass.
- [ ] **Step 4: Commit** `git add vote/test/HostileReads.t.sol && git commit -m "Vote contract tests: the hostile-read test fails if a reply is copied whole"`

---

### Task 1: The size minimum is min(1.5× pool, Σ every ask)

**Files:**
- Modify: `vote/contracts/SignedBallots.sol` (`_checkTiers` / `_validateBallot`, wherever the 1.5× check lives)
- Modify: `shared/vote/rules.ts`, `shared/vote/rules.test.ts`
- Modify: `vote/reference/ballot_rules.py`, `vote/reference/test_ballot_rules.py`, `vote/reference/export_rules_fixtures.py`, `shared/vote/fixtures/ballot-rules.json` (regenerated)
- Modify: the contract fixture test that reads the shared fixtures (find it with `grep -rl ballot-rules.json vote/test`), `vote/test/Gas.t.sol` if a bound moves
- Modify: the page's rule message if its wording states 1.5× unconditionally (`grep -rn "1.5" app/components/vote app/lib`)

Rule (owner, option B): a ballot passes the size rule when `placed ≥ min(1.5 × pool, total)`, where `placed` = Σ asks of the projects it places and `total` = Σ asks of every project in the round. Equivalently: `placed ≥ 1.5 × pool`, or every project it leaves out has an ask of 0. All sums saturate as today. The error's `needed` value becomes the minimum actually applied.

Contract: compute the placed asks as today; only when `placed < 1.5 × pool`, compute the asks of the unplaced projects (same `_asksOf`/`_supportOf` path, prices read once per ballot) and pass if their sum is 0. A normal ballot must cost no extra gas: the Gas test's 40-placed figure must not rise.

- [ ] **Step 1: Write the failing tests.**
  - Forge: `test_SizeRule_AllAsksBelowMinimum_PlacingEveryAskedProjectPasses` (donations take Σ all asks below 1.5× pool; a ballot placing every project with a nonzero ask records); `test_SizeRule_AllAsksBelowMinimum_LeavingOneOutReverts` (same round, one nonzero-ask project left out → the existing too-small error with `needed` = Σ all asks); `test_SizeRule_CoveredProjectsMayBeLeftOut` (unplaced projects all at $0 ask → passes).
  - vitest (`rules.test.ts`): the same three cases against `checkBallot`/`rulesRound`.
  - Python: the same three in `test_ballot_rules.py`; add one fixture case "every asked project placed below 1.5×" to the exporter.
- [ ] **Step 2: Run** each suite's new tests — expected: fail.
- [ ] **Step 3: Implement** in the contract, `rules.ts` and `ballot_rules.py`; regenerate fixtures with the exporter (`cd vote/reference && python3 export_rules_fixtures.py` or as its header says) and confirm byte-identical on a second run.
- [ ] **Step 4: Run** `cd vote && forge test`, `deno run -A npm:vitest run shared/vote`, `cd vote/reference && python3 -m pytest -q`, `deno task typecheck` — expected: pass; report the Gas test's 40-placed number before and after.
- [ ] **Step 5: Regenerate the ABI** in `shared/vote/abi.ts` only if an error or function signature changed (compare with the forge build output).
- [ ] **Step 6: Commit** the touched files: `git commit -m "Vote: the size minimum is the smaller of 1.5x the pool and every project's ask"`

---

### Task 2: Reference model: covered projects

**Files:**
- Modify: `vote/reference/quiet_ending_steps.py` (`run_on_time`, its `tally_open` and the stage comparison)
- Test: `vote/reference/test_quiet_ending_on_time.py`

**Interfaces:**
- Produces: `run_on_time(...)` result gains `"covered"`: a list, one entry per confirmed stage, of the proposals whose cost was 0 at that stage's settling tally. Behaviour the TypeScript port in Task 3 must match.

Rules (spec, "Fully covered projects"):
- At every tally, proposals with cost 0 are removed from `candidates` before `_ear` is called.
- A proposal with cost 0 at the tally that confirms a stage goes into that stage's `covered` and is never a candidate in later stages, whatever its later cost.
- Comparing two tallies of a stage: drop from both funded sets every proposal with cost 0 at either tally, then compare.

- [ ] **Step 1: Write the failing tests** in `test_quiet_ending_on_time.py`:

```python
def test_a_donation_before_tier_s_settles_extends_the_window(self):
    # costs [62,12,42,32] fund [3,2] in S-Tier; a donation taking project 0 to 40 funds [3,0]
    costs = [62, 12, 42, 32]
    voters = [(76, [2, 2, 3, 1]), (76, [1, 2, 1, 2])]
    quiet = run_on_time(costs, voters, 0, lambda day, state: {}, tiers=3)
    moved = run_on_time(costs, voters, 0, lambda day, state: {}, tiers=3,
                        asks_for_day=lambda day, state: [40, 12, 42, 32] if day >= 1 else None)
    self.assertEqual(quiet["days"][1]["confirmed"][:1], [0])   # S-Tier confirmed at the deadline
    self.assertNotIn(0, moved["days"][1]["confirmed"])          # not quiet: the window extends

def test_a_covered_project_is_not_funded_and_is_recorded_as_covered(self):
    costs = [100, 100, 0]
    voters = [(150, [1, 2, 255]), (150, [1, 2, 255])]           # nobody ranks project 2
    result = run_on_time(costs, voters, 0, lambda day, state: {}, tiers=3)
    self.assertNotIn(2, result["funded"])
    self.assertEqual(result["covered"][0], [2])

def test_crossing_zero_alone_does_not_extend(self):
    # project 1 is funded in S-Tier at cost 5 and covered at cost 0; nothing else moves
    costs = [100, 5]
    voters = [(100, [1, 1]), (100, [1, 1])]
    result = run_on_time(costs, voters, 0, lambda day, state: {}, tiers=3,
                         asks_for_day=lambda day, state: [100, 0] if day >= 1 else None)
    self.assertIn(0, result["days"][1]["confirmed"])

def test_covered_at_settlement_never_returns(self):
    costs = [100, 0]
    voters = [(60, [1, 2]), (60, [1, 2])]
    result = run_on_time(costs, voters, 0, lambda day, state: {}, tiers=3,
                         asks_for_day=lambda day, state: [100, 10] if day >= 2 else None)
    self.assertNotIn(1, result["funded"])
```

Read the existing tests first and match their way of calling `run_on_time` and reading `days`; adjust day indexes and the withheld mark to what the module really uses, keeping the four behaviours.

- [ ] **Step 2: Run** `cd vote/reference && python3 -m unittest test_quiet_ending_on_time` — expected: the four new tests fail.
- [ ] **Step 3: Implement** the three rules in `run_on_time`.
- [ ] **Step 4: Run** `cd vote/reference && python3 -m unittest discover -p 'test_quiet_ending*.py'` — expected: all pass, including the "without revisions it is plain PB-EAR" test (state the $0 difference in that test's docstring if it needs one).
- [ ] **Step 5: Commit** `git add vote/reference/quiet_ending_steps.py vote/reference/test_quiet_ending_on_time.py && git commit -m "Vote reference: a covered project is not a candidate, and crossing \$0 alone does not extend"`

---

### Task 3: Replay over chain states

**Files:**
- Modify: `shared/vote/quiet-ending.ts`
- Test: `shared/vote/quiet-ending.test.ts`

**Interfaces:**
- Produces:

```ts
/** The asks and pool at one block. `event`: the block holds an ask-side tally event
 * (a pledge, a pool change, a balance change). `asks` may be shorter than the project
 * count for a block before later projects joined. */
export type ChainState = {
  block: number; timestamp: number; asks: bigint[]; poolUsd: bigint; event: boolean;
};
// Settled gains `covered: number[]`.
// replay input: `needs`, `poolUsd` and `settleNeeds` are removed; add
//   states: ChainState[]   // ascending by block; at least one at or before the first S-Tier tally
// `snapshots` stays as an optional cache.
// RoundState tiers in "settling" gain `covered: number[]` (the latest tally's).
// RoundState.live gains `covered: number[]`.
```

Rules:
- **State for a tally at block `b`:** the last state with `block <= b`. For a boundary at time `t`: the last state with `timestamp < t`. No state at or before the point is an error (`throw new Error("no chain state")`).
- **Tally events:** blocks holding a receipt, and blocks whose state has `event: true`, inside the window. Merge both streams by block; one tally per block after everything in it.
- **Candidates:** not settled, not in any settled tier's `covered`, `asks[c]` defined and `> 0n`.
- **Comparison:** `sameFunded(a, coveredA, b, coveredB)`: remove from both funded sets every project in `coveredA ∪ coveredB`, then compare as sets. Used for every in-window check and the closing check.
- **Settlement:** tally with the state at the cutoff; `covered` = projects not settled or covered earlier whose ask there is `0n`. `awards`, `shares` as today.
- **Weights:** `each = state.poolUsd / n` with the pool of the tally's own state.
- A given `snapshot` for a tier is used as is; without snapshots the result must be the same.
- The `readable` shape check and the transcript-verified receipts stay as they are.

- [ ] **Step 1: Write the failing tests.** Rewrite the file's helpers so a round is built from `states`; a helper `flat(needs, poolUsd)` returning one state at block 0 keeps the existing cases short. Add:

```ts
it("a donation inside the S-Tier window is a tally event and extends it", …);
//   states: block 0 asks [62,12,42,32]; block 50 (inside window 1) asks [40,12,42,32], event true
//   ballots [[2,2,3,1],[1,2,1,2]], pool 152 → after window 1: S-Tier status "settling", window 2
it("the same donation after S-Tier settled changes nothing", …);
it("a tally uses the pool at its own block", …);
it("a covered project is not funded and is recorded as covered", …);  // asks [100,100,0] → covered [2]
it("crossing $0 alone does not extend the window", …);
it("a project covered at settlement never returns", …);
it("a project covered mid-window but not at the cutoff is an ordinary candidate", …);
it("a project missing from an early state is not a candidate there", …);   // Review Focus 4
it("is the same with and without snapshots", …);
it("throws without a chain state before the first tally", …);
```

Keep every existing behaviour test (receipts, rejections, registration, forced close), ported to `states`. Cases that the Python reference covers (Task 2) must give the same funded and covered sets.

- [ ] **Step 2: Run** `deno run -A npm:vitest run shared/vote/quiet-ending.test.ts` — expected: new tests fail.
- [ ] **Step 3: Implement.** `tally(first, state, upTo)` takes a `ChainState`; `applyBefore` walks receipts and event states together by block.
- [ ] **Step 4: Run** `deno run -A npm:vitest run shared/vote` — expected: pass. Callers in `api/` and `app/` will fail typecheck until Task 7; to keep the branch green, adapt them minimally in this task by wrapping today's single needs list in one state (`[{ block: 0, timestamp: 0, asks: needs, poolUsd, event: false }]`), and run `deno task typecheck && deno task check:api && deno task test:api`.
- [ ] **Step 5: Commit** the touched files: `git commit -m "Quiet ending: tally with the asks and pool at each block; donations are tally events"`

---

### Task 4: Contract: `setPledgeBySig`

**Files:**
- Modify: `vote/contracts/RoundAccounting.sol` (extract `_setPledge` internal from `setPledge`)
- Modify: `vote/contracts/SignedBallots.sol`
- Test: `vote/test/SignedPledges.t.sol` (new)
- Modify: `shared/vote/abi.ts`, `shared/vote/typed-data.ts`; Test: `shared/vote/typed-data.test.ts` (new)

**Interfaces:**
- Produces (Solidity):

```solidity
bytes32 public constant PLEDGE_TYPEHASH = keccak256(
  "Pledge(bytes32 pledgeId,uint256 initiativeId,uint256 currencyId,uint256 amount,uint256 nonce,uint256 deadline)");
mapping(address signer => uint256) public pledgeNonceOf;   // the next nonce this signer must use
error PledgeExpired();
error InvalidPledgeNonce(address signer, uint256 nonce);
function setPledgeBySig(bytes32 pledgeId, uint256 initiativeId, uint256 currencyId, uint256 amount,
                        address signer, uint256 nonce, uint256 deadline, bytes calldata signature) external;
```

- Checks, in order: `block.timestamp > deadline` → `PledgeExpired`; `nonce != pledgeNonceOf[signer]` → `InvalidPledgeNonce`; signature over the existing EIP-712 domain via `SignatureChecker.isValidSignatureNow(signer, digest, signature)` else `InvalidSignature`; `hasRole(PLEDGE_ROLE, signer)` else `AccessControlUnauthorizedAccount(signer, PLEDGE_ROLE)`. Then `pledgeNonceOf[signer]++` and `_setPledge(...)`, which keeps `_requireAccountingOpen` and emits `PledgeSet` unchanged.
- Produces (TypeScript): `pledgeTypedData(m: VoteManifest, p: { pledgeId: Hex; initiativeId: bigint; currencyId: bigint; amount: bigint; nonce: bigint; deadline: bigint })` in `shared/vote/typed-data.ts`, same domain as `voteTypedData`, `primaryType: "Pledge"`; and `pledgeChainId(id: string): Hex` = `keccak256(toHex("pledge:" + id))`.

- [ ] **Step 1: Write the failing Forge tests**: `test_SignedPledge_RecordsLikeSetPledge` (same `PledgeSet` event, `initiativeUsd(i)`'s `askUsd` drops by the amount), `test_SignedPledge_AnyoneMaySubmit`, `test_SignedPledge_RevertsWithoutRole`, `test_SignedPledge_RevertsOnReplay` (second submit → `InvalidPledgeNonce`), `test_SignedPledge_RevertsWhenExpired`, `test_SignedPledge_RevertsOnWrongSigner`, `test_SignedPledge_ContractWalletSigner` (ERC-1271 mock; reuse one in `vote/test` if present), `test_SignedPledge_ClosedAtHardDeadline`, and `test_SignedPledge_Digest` printing/asserting a hard-coded digest for fixed values.
- [ ] **Step 2: Run** `cd vote && forge test --match-contract SignedPledges` — expected: compile error.
- [ ] **Step 3: Implement.** Check the contract still fits the size limit (`forge build --sizes`); report the size.
- [ ] **Step 4: Run** `cd vote && forge test` — expected: all pass.
- [ ] **Step 5: Regenerate the ABI** in `shared/vote/abi.ts` from the build (the way the file's header says) and add `pledgeTypedData` / `pledgeChainId`, with a vitest test asserting `hashTypedData(pledgeTypedData(...))` equals the Forge test's digest.
- [ ] **Step 6: Run** `deno run -A npm:vitest run shared/vote && deno task typecheck` — expected: pass.
- [ ] **Step 7: Commit** the touched files: `git commit -m "Vote contract: an admin's signed pledge, submitted by anyone"`

---

### Task 5: Deploy: currencies, accounts, pledge role, seeded pledges

**Files:**
- Modify: `shared/vote/manifest.ts`, `scripts/vote-deploy.ts`
- Test: `shared/vote/manifest.test.ts`, `scripts/vote-deploy.test.ts`

**Interfaces:**
- Produces, on `VoteManifest`:

```ts
/** The contract's registered currencies, in id order; [0] is the virtual USD unit. */
currencies?: { symbol: string; asset: `0x${string}`; usdFeed: `0x${string}` }[];
/** Per slug, in the same order: the project's account on the round's chain (its Safe). */
accounts?: `0x${string}`[];
```

`checkManifest`: a real round must have `currencies` with at least one beyond currency 0, and `accounts` matching `slugs` one to one. A manifest without `currencies` (older or test rounds) means "currency 0 only".

- Real round, in the setup transaction(s) and before opening: one `registerCurrency(asset, usdFeed)` per entry of `vote/config/mainnet.json`'s `currencies`, in file order (the Nov 15 two-argument form; a zero feed is fixed $1).
- Real round: `grantRole(PLEDGE_ROLE, a)` for every address in the site's admin list (`adminAddresses` from `api/config.ts`, passed in the way the script already receives its inputs).
- Real round: one `setPledge(pledgeChainId(p.id), initiativeId, 0, usdMicro)` per board pledge with status `pledged` on a project in the round.
- Test rounds register no currency and seed no pledge.
- Follow the existing `plan`/`step(...)` structure and the per-transaction gas cap it batches for.

- [ ] **Step 1: Write the failing tests**: manifest (`a real round needs its currencies and accounts`, `a round without currencies counts pledges only`); deploy plan (`registers the configured currencies before opening`, `grants the pledge role to each admin`, `seeds the board's open pledges and skips received and withdrawn ones`, `a test round registers nothing`).
- [ ] **Step 2: Run** `deno run -A npm:vitest run shared/vote/manifest.test.ts scripts/vote-deploy.test.ts` — expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `deno task typecheck` — expected: pass.
- [ ] **Step 5: Commit** the touched files: `git commit -m "Vote deploy: register the round's currencies, grant the pledge role, put the board's pledges on-chain"`

---

### Task 6: Chain states, through one read interface

**Files:**
- Create: `shared/vote/chain-states.ts`, `shared/vote/chain-states.test.ts`
- Modify: `api/services/vote-chain.ts` (a viem-backed `StateSource`; a KV-backed `StateCache`)
- Test: `api/tests/vote-chain-states.test.ts` (the viem/KV wiring: caching rules)

**Interfaces:**
- Consumes: `ChainState` (Task 3); `windowEnds`, `Schedule`; manifest `currencies`/`accounts` (Task 5).
- Produces in `shared/vote/chain-states.ts` (no Deno, no KV, no env; runs in Deno and the browser):

```ts
export interface StateSource {
  head(): Promise<{ block: number; timestamp: number }>;
  /** The last block with timestamp < time. */
  blockBefore(time: number): Promise<{ block: number; timestamp: number }>;
  /** At `block` (eth_call with that block): initiativeCount, each initiativeUsd(i).askUsd, poolUsd(). */
  stateAt(block: number): Promise<{ timestamp: number; asks: bigint[]; poolUsd: bigint }>;
  /** Blocks in [from, to] holding a PledgeSet or PoolUsdSet log from the round's contract. */
  accountingEventBlocks(from: number, to: number): Promise<number[]>;
  /** Blocks in [from, to] where any account's balance in any registered currency changed:
   * ERC-20 Transfer logs to or from an account, and native balances read block by block. */
  balanceChangeBlocks(from: number, to: number): Promise<number[]>;
}
export interface StateCache {  // optional; only blocks older than the finality margin go in
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}
export async function chainStates(
  m: VoteManifest, src: StateSource, opts: { now: number; receiptBlocks: number[]; cache?: StateCache; finalAfterSecs: number },
): Promise<ChainState[]>;
```

`chainStates` returns, ascending and without duplicates, a state for:
1. the last block before each tier's first tally that has started, and before each window cutoff that has passed (`windowEnds`);
2. inside each started tier's span `[firstTallyAt[t], min(now, last window end))`: every receipt block (`event: false` unless another event shares it) and every accounting-event or balance-change block (`event: true`);
3. the head block.

A round whose manifest has no `currencies` beyond currency 0 never calls `balanceChangeBlocks`. Cache: states and scanned balance-change ranges for blocks whose timestamp is older than `now − finalAfterSecs` are cached (key includes the contract address and block) and not read again; newer ones are never cached. Any read error propagates (no zeros, no head values for past blocks).

viem source (`api/services/vote-chain.ts`): `stateAt` is one multicall with `blockNumber`; native balances use Multicall3 `getEthBalance` per block, one multicall per block, bounded concurrency; ERC-20 changes from `getLogs` on `Transfer` with the accounts as `from` or `to` topics. The RPC for these reads: an archive endpoint from a new env var `VOTE_ARCHIVE_RPC_URL` if set, else the round's existing RPC (`api/config.ts` naming style). KV cache under the round's existing KV prefix.

- [ ] **Step 1: Write the failing tests** against a fake `StateSource` in `chain-states.test.ts`: `a state for each boundary, each event block and the head`; `a pledge or pool change marks its block as an event; a receipt block alone is not one`; `a balance change marks its block as an event`; `a round without currencies never scans balances` (the fake throws if asked); `a project added later is missing from earlier states` (shorter `asks`); `a read error fails the whole call`; `a final block is read once; a recent block is read again` (Review Focus 1, with an in-memory cache). In `api/tests/vote-chain-states.test.ts`: `a pruned RPC error on a past block propagates` (Review Focus 2, a viem transport mock that errors for historical block tags).
- [ ] **Step 2: Run** `deno run -A npm:vitest run shared/vote/chain-states.test.ts` and `deno test -A api/tests/vote-chain-states.test.ts` — expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, plus `deno task typecheck && deno task check:api` — expected: pass.
- [ ] **Step 5: Commit** the touched files: `git commit -m "Vote: read the asks and pool at each tally block from the chain, through one read interface"`

---

### Task 7: API: the round from chain states

**Files:**
- Modify: `api/routes/vote.ts` (`needsOf`, `roundState`, `/round` JSON), `api/services/vote-chain.ts` (`VoteRound`), `api/services/vote-llms.ts` if it reads needs, `shared/vote/live-inputs.ts` if the browser tally reads needs
- Test: the existing vote route tests under `api/tests/` (`grep -l "needs" api/tests`)

**Interfaces:**
- Consumes: `chainStates` (Task 6), `replay` with `states` (Task 3).
- Produces: `VoteRound.needs` is replaced by `states?: (now: number) => Promise<ChainState[]>` (the test hook); when absent the route calls `chainStates` with the viem source and KV cache. `/round` adds, per tier, `covered: string[]` (slugs) and in the live view `covered: string[]`. The round JSON's `asks` (Nov 15) is the head state's asks, so the page, the relayer and the tally use one figure.

Changes:
- Delete `needsOf` and every read of the board for the vote's tally. Delete the `settle-needs` KV reads and writes.
- Keep the `settled` KV record as a cache, written only after `FINAL_AFTER_SECS` as today. Add `covered` to `storeSettled`/`loadSettled`; a stored record without it loads as `[]`.
- The transcript check (Nov 15) still runs first; its 503 stays.
- A failure in `chainStates` is `fail(503, "asks_unavailable", "The vote results can't be read from the chain right now.")`.

- [ ] **Step 1: Write the failing tests**: `the round's asks come from the chain states, not the board`; `a donation inside the S-Tier window shows the tier still settling`; `a settled tier is the same before and after its record is stored`; `an RPC without past state is a 503, not a result` (Review Focus 2: the hook throws); `a covered project is listed as covered`. Port every existing test from `needs:` to `states:` with a one-state helper.
- [ ] **Step 2: Run** `deno task test:api` — expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `deno task test:api && deno task check:api && deno task typecheck && deno run -A npm:vitest run` — expected: pass (type `covered` where the app reads `/round`; the screen is Task 10).
- [ ] **Step 5: Commit** the touched files: `git commit -m "Vote API: the round is replayed from chain states; the board no longer feeds the tally"`

---

### Task 8: One replayer for the site and for anyone

**Files:**
- Create: `shared/vote/replay-round.ts`, `shared/vote/replay-round.test.ts`
- Create: `scripts/vote-replay.ts`, `scripts/vote-replay.test.ts`
- Modify: `api/routes/vote.ts` (`roundState` calls `replayRound`), `api/services/vote-chain.ts` (export the viem `StateSource`/ballot reader so the script can build them from an RPC URL alone), `deno.json` (a `vote:replay` task)

**Interfaces:**
- Produces:

```ts
/** Everything a replay needs, read from the chain: ballots (transcript-checked), chain states. */
export interface RoundSource extends StateSource {
  ballots(): Promise<{ events: BallotEvent[]; block: bigint }>;
  committed(block: bigint, tokenIds: bigint[]): Promise<{ transcript: Hex; recordCount: bigint; ballotHashes: Hex[] }>;
}
export async function replayRound(
  m: VoteManifest, src: RoundSource, opts: { now: number; cache?: StateCache; snapshots?: Settled[]; finalAfterSecs: number },
): Promise<RoundState>;  // throws "transcript_mismatch" or the read error; never a partial result
```

Match the names `ballots`/`committed` to what `VoteChain` already has (Nov 15); adjust the interface to their real signatures.

- `scripts/vote-replay.ts`: `deno task vote:replay --rpc <archive url> [--manifest <path to a manifest JSON or manifest-data.ts>] [--at <unix seconds>] [--json]`. Defaults: the repo's `shared/vote/manifest-data.ts`, now. Reads no env, no KV, no site database. Prints, per tier: status, window, funded slugs with awards in dollars, covered slugs; then the transcript check result and the head block. Exit code 1 with the error on any read failure or mismatch.
- The server's `roundState` and the script call the same `replayRound`.

- [ ] **Step 1: Write the failing tests**: `replayRound gives the same result with and without a cache`; `replayRound throws on a transcript mismatch and returns nothing`; `the script and the API agree on the same fake chain` (Review Focus 3: run the script's main with an injected `RoundSource` and compare its JSON with `/api/vote/round` built on the same source and `now`); `the script exits non-zero when a past block cannot be read`.
- [ ] **Step 2: Run** `deno run -A npm:vitest run shared/vote/replay-round.test.ts scripts/vote-replay.test.ts` and `deno task test:api` — expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, plus `deno task typecheck && deno task check:api` — expected: pass. Then run the script for real against the deployed Sepolia round with a public RPC (`https://sepolia.gateway.tenderly.co`, no secrets): it must print the round (24 ballots, legacy transcript accepted) or fail with a clear archive-state error; paste the output in the report.
- [ ] **Step 5: Commit** the touched files: `git commit -m "Vote: one replayer for the site and a script anyone can run against an archive node"`

---

### Task 9: Signed pledges in the admin form

**Files:**
- Modify: `api/routes/admin.ts`, `api/services/vote-chain.ts` (`send` gains `{ fn: "setPledgeBySig"; args }`, plus `pledgeNonceOf(signer: Hex): Promise<bigint>`), the pledges store in `api/db` (accept a caller-chosen id on add, if it does not already)
- Modify: `app/components/admin/initiative/Pledges.tsx`
- Test: the admin route tests under `api/tests/`, `app/components/admin/initiative/Pledges.test.tsx` (create if missing)

**Interfaces:**
- Consumes: `pledgeTypedData`, `pledgeChainId` (Task 4); the relayer send path the `/ballot` route uses (same nonce queue).
- Produces:
  - `pledgeOnChain(m: VoteManifest | null, slug: string, now: number): { initiativeId: number } | null`: non-null when `m.kind === "real"`, `now < m.closesAt` and the slug is in `m.slugs`.
  - `POST /admin/initiatives/:id/pledges/prepare` with the same body as add/edit plus optional `pid` and `remove: true` → `{ pid, typedData }`. Amount on-chain: `Math.round(amountUsd * 1e6)` in currency 0; `0` when the resulting status is `received` or `withdrawn`, or on removal. `nonce` from `pledgeNonceOf(admin)`, `deadline` = now + 600 s. 409 when `pledgeOnChain` is null.
  - `POST`, `PATCH`, `DELETE …/pledges[/:pid]`: when `pledgeOnChain` is non-null they require `pid`, `nonce`, `deadline`, `signature`; the API rebuilds the typed data from the request itself (never signs over a client-sent amount), checks the signature recovers to the signed-in admin's wallet, relays `setPledgeBySig`, waits for the receipt, and only on success writes the database. Missing fields → 428 `{ code: "signature_required" }`. Revert or timeout → 502 `{ code: "pledge_not_recorded" }`, nothing saved.
  - Outside the real vote the three routes behave exactly as today.

Form: when the API answers 428, call `prepare`, ask the wallet to sign the typed data, resubmit with the signature. Show "Recording the pledge on-chain…" while waiting and the API's message on failure. No other layout change.

- [ ] **Step 1: Write the failing API tests**: `outside the real vote a pledge saves as today`; `during the real vote a pledge without a signature is refused and nothing is saved`; `a signed pledge is relayed and then saved`; `a pledge whose transaction reverts is not saved` and `the same signature sent twice saves one pledge` (Review Focus 5); `a signature from another wallet is refused`; `marking a pledge received sends amount 0`; `removing a pledge sends amount 0 and removes it`; `an initiative outside the round saves as today`.
- [ ] **Step 2: Run** `deno task test:api` — expected: new tests fail.
- [ ] **Step 3: Implement the API.**
- [ ] **Step 4: Write the failing form tests**: `asks for a signature when the API requires one and resubmits with it`; `shows the failure and keeps the form filled when the chain refuses`.
- [ ] **Step 5: Implement the form** with the wallet-signing hook the app already uses for ballots (find it from `voteTypedData`'s callers).
- [ ] **Step 6: Run** `deno task test:api && deno run -A npm:vitest run app/components/admin && deno task typecheck` — expected: pass.
- [ ] **Step 7: Commit** the touched files: `git commit -m "Admin pledges: during the real vote a pledge is signed and recorded on-chain before it is saved"`

---

### Task 10: Vote results: covered projects

**Files:**
- Modify: `app/components/vote/VoteResults.tsx`, `app/components/vote/mock-round.ts`
- Test: `app/components/vote/VoteResults.test.tsx`

**Interfaces:**
- Consumes: `covered` per tier and in the live view from `/round` (Task 7).

A covered project is shown with the label **Covered by donations**, outside the tier lists, not counted in "funded" totals or in the pool's spend. In a settled tier it is final; in the live view it is "Covered by donations for now". Read the component first and use the smallest change that fits its existing sections.

- [ ] **Step 1: Write the failing tests**: `a covered project is listed as covered by donations, not under a tier`; `covered projects are not counted as funded by the pool`.
- [ ] **Step 2: Run** `deno run -A npm:vitest run app/components/vote/VoteResults.test.tsx` — expected: fail.
- [ ] **Step 3: Implement**, with one covered project in `mock-round.ts`.
- [ ] **Step 4: Run** `deno run -A npm:vitest run app/components/vote && deno task typecheck` — expected: pass.
- [ ] **Step 5: Commit** the touched files: `git commit -m "Vote results: a project covered by donations is shown apart from the tiers"`

---

### Task 11: Rules, policy and how to replay

**Files:**
- Modify: `vote/docs/quiet-ending-rules.md`, `vote/docs/settlement-policy.md`, `vote/README.md`

Write in, in the documents' own voice, every rule under "Rules to add" and "Adapted Nov 15" in the spec: the ask at a block is `initiativeUsd(i).askUsd` at that block, with the Nov 15 price rule; tally events and the pool at each tally; settlement from the cutoff block with the stored record as a cache; covered projects (not a candidate, final at settlement, left out of the comparison when covered at either tally); the staged tally differs from plain PB-EAR only for $0 projects; the size minimum min(1.5× pool, Σ asks); signed pledges and who may sign; the swap rule for people; only the round's chain, the project's account and the registered currencies count. Remove statements that replay's settlement and quiet-comparison checks are unimplemented, and the "Remaining decisions" entries this work closes; fix the deferred Nov 15 wording "original ask" in `quiet-ending-rules.md`.

`vote/README.md` gains a section **Replay the round yourself**: what you need (an archive RPC for the round's chain; nothing from the site), the one command, what it prints, what the transcript check proves, and that its output must match `/api/vote/round`.

- [ ] **Step 1: Edit the documents.**
- [ ] **Step 2: Check** `grep -rn "S tier\|S-tier\|tier S\|S/A/B" vote/docs vote/README.md` — expected: no new matches.
- [ ] **Step 3: Run the whole suite**: `deno run -A npm:vitest run && deno task test:api && deno task typecheck && deno task check:api && (cd vote && forge test) && (cd vote/reference && python3 -m pytest -q)` — expected: all pass.
- [ ] **Step 4: Commit** `git add vote/docs vote/README.md && git commit -m "Vote docs: asks from the chain, covered projects, signed pledges, replaying the round"`
