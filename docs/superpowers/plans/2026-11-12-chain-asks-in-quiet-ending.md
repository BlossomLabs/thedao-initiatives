# Asks from the Chain in the Quiet Ending: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The vote's tally takes every project's ask, the pool and the pledges from the chain at each tally's block, so anyone can replay the round, and admins record pledges on-chain by signature.

**Architecture:** A pure function computes a project's remaining ask from chain values exactly as the contract does. The chain reader builds a list of chain states (asks and pool per block) for the blocks the replay tallies at; `replay()` stays pure and takes that list instead of one `needs` array. The contract gains `setPledgeBySig`; the existing admin pledge form signs and the relayer submits.

**Tech Stack:** Deno + TypeScript, vitest (`shared/`, `app/`), `deno test` (`api/`), Solidity with Foundry (`vote/`), Python `unittest` reference (`vote/reference/`), viem.

**Spec:** `docs/superpowers/specs/2026-11-12-chain-asks-in-quiet-ending-design.md`. Read it first; this plan argues from it.

## Global Constraints

- Tiers are written **Tier-S**, **Tier-A**, **Tier-B** in prose, comments, copy and test names (`AGENTS.md`). In running text from code use `tierName()` from `shared/vote/ballot.ts`.
- Dates in copy use the helpers in `app/lib/format.ts`.
- Amounts are six-decimal USD (`bigint` micro-USD), rounded down, as in `RoundAccounting._convert`.
- `stageTally` (`shared/vote/stage.ts`), the supporter locks, the window schedule and the ballot rules do not change.
- No contract change other than `setPledgeBySig`. If another seems needed, stop and ask.
- Missing chain data is an error ("derivation incomplete"), never a value of zero.
- `replay()` stays pure: no RPC, runs in the browser and in Deno.
- The branch `vote` has many uncommitted changes that are not part of this work. Each commit step adds **only the files that task names**.
- Test commands: `deno run -A npm:vitest run <file>` (shared, app); `deno test -A <file>` (api); `cd vote && forge test --match-contract <Name>`; `cd vote/reference && python3 -m unittest <module>`.

## Review Focus

1. **A block that is not final yet.** A chain state read for a block newer than the finality margin (`FINAL_AFTER_SECS`) must not be cached; a reorg would otherwise freeze wrong asks. Test in Task 6.
2. **An RPC that cannot serve past state.** The reader must fail with a 503 (`asks_unavailable`), not return asks computed from today's balances. Test in Task 7.
3. **A feed answer of zero or less, or changed decimals.** The ask is undefined and the reader throws; a stale but positive answer is used. Test in Task 2.
4. **A project added after earlier states were read.** A state whose `asks` is shorter than the project count: the missing projects are not candidates at that tally (they did not exist). Test in Task 3.
5. **An admin signs and the relay fails.** A reverted or dropped `setPledgeBySig` saves nothing on the site and tells the admin so; submitting the same signature twice fails on the nonce without a second pledge. Test in Task 8.

---

## File map

| File | Responsibility |
| --- | --- |
| `vote/reference/quiet_ending_steps.py` | Reference: $0 rule and the covered-aware comparison in `run_on_time` |
| `shared/vote/asks.ts` (new) | Pure ask arithmetic, identical to the contract |
| `shared/vote/quiet-ending.ts` | `replay()` over chain states; covered projects |
| `vote/contracts/SignedBallots.sol`, `RoundAccounting.sol` | `setPledgeBySig` |
| `shared/vote/typed-data.ts`, `shared/vote/abi.ts` | `Pledge` typed data, ABI |
| `scripts/vote-deploy.ts`, `shared/vote/manifest.ts` | Currencies, accounts, pledge role, seeded pledges |
| `api/services/vote-asks.ts` (new) | Reads chain states for the replay; caches final blocks |
| `api/services/vote-chain.ts` | Raw reads the asks reader needs; `setPledgeBySig` send |
| `api/routes/vote.ts` | Round state from chain states; the board leaves the vote |
| `api/routes/admin.ts`, `app/components/admin/initiative/Pledges.tsx` | Signed pledges in the existing form |
| `app/components/vote/VoteResults.tsx` | "Covered by donations" |
| `vote/docs/quiet-ending-rules.md`, `vote/docs/settlement-policy.md` | The rules |

---

### Task 1: Reference model: covered projects

**Files:**
- Modify: `vote/reference/quiet_ending_steps.py` (`run_on_time`, its `tally_open` and the stage comparison)
- Test: `vote/reference/test_quiet_ending_on_time.py`

**Interfaces:**
- Produces: `run_on_time(...)` result gains `"covered"`: a list, one entry per confirmed stage, of the proposals whose cost was 0 at that stage's settling tally. Behaviour the TypeScript port in Task 3 must match.

Rules (spec, "Fully covered projects"):
- At every tally, proposals with cost 0 are removed from `candidates` before `_ear` is called.
- A proposal with cost 0 at the tally that confirms a stage goes into that stage's `covered` and is never a candidate in later stages, whatever its later cost.
- Comparing two tallies of a stage: drop from both funded sets every proposal with cost 0 at either tally, then compare.

- [ ] **Step 1: Write the failing tests** in `test_quiet_ending_on_time.py`

```python
def test_a_donation_before_tier_s_settles_extends_the_window(self):
    # costs [62,12,42,32] fund [3,2] in Tier-S; a donation taking project 0 to 40 funds [3,0]
    costs = [62, 12, 42, 32]
    voters = [(76, [2, 2, 3, 1]), (76, [1, 2, 1, 2])]
    quiet = run_on_time(costs, voters, 0, lambda day, state: {}, tiers=3)
    moved = run_on_time(costs, voters, 0, lambda day, state: {}, tiers=3,
                        asks_for_day=lambda day, state: [40, 12, 42, 32] if day >= 1 else None)
    self.assertEqual(quiet["days"][1]["confirmed"][:1], [0])   # Tier-S confirmed at the deadline
    self.assertNotIn(0, moved["days"][1]["confirmed"])          # not quiet: the window extends

def test_a_covered_project_is_not_funded_and_is_recorded_as_covered(self):
    costs = [100, 100, 0]
    voters = [(150, [1, 2, 255]), (150, [1, 2, 255])]           # nobody ranks project 2
    result = run_on_time(costs, voters, 0, lambda day, state: {}, tiers=3)
    self.assertNotIn(2, result["funded"])
    self.assertEqual(result["covered"][0], [2])

def test_crossing_zero_alone_does_not_extend(self):
    # project 1 is funded in Tier-S at cost 5 and covered at cost 0; nothing else moves
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

Read the existing tests in the file first and match their way of calling `run_on_time` and reading `days`; adjust the day indexes and the withheld mark to what the module really uses, keeping the four behaviours.

- [ ] **Step 2: Run** `cd vote/reference && python3 -m unittest test_quiet_ending_on_time` — expected: the four new tests fail.
- [ ] **Step 3: Implement** the three rules in `run_on_time`.
- [ ] **Step 4: Run** `cd vote/reference && python3 -m unittest discover -p 'test_quiet_ending*.py'` — expected: all pass, including `test_without_revisions_it_is_plain_pbear…`.
- [ ] **Step 5: Commit** `git add vote/reference/quiet_ending_steps.py vote/reference/test_quiet_ending_on_time.py && git commit -m "Vote reference: a covered project is not a candidate, and crossing \$0 alone does not extend"`

---

### Task 2: Ask arithmetic

**Files:**
- Create: `shared/vote/asks.ts`
- Test: `shared/vote/asks.test.ts`

**Interfaces:**
- Produces:

```ts
/** A registered currency, as CurrencyRegistered recorded it. Currency 0 is the
 * virtual USD unit: asset null, no feed, pledges only. */
export type Currency = {
  asset: `0x${string}` | "native" | null;
  usdFeed: `0x${string}` | null;      // null: fixed $1 (or currency 0)
  amountDecimals: number;
  feedDecimals: number;
};
/** One currency's amounts for one project at a block. `price` is the feed's answer
 * at that block (1n for fixed $1; unused for currency 0). */
export type Holding = { donated: bigint; pledged: bigint; price: bigint };
export function toUsd(amount: bigint, price: bigint, c: Currency): bigint;
/** max(askUsd − Σ support, 0). `holdings[i]` belongs to `currencies[i]`. Throws
 * "invalid price" when a currency with a nonzero amount has price <= 0. */
export function remainingAsk(askUsd: bigint, currencies: Currency[], holdings: Holding[]): bigint;
```

- `toUsd` is `amount * price * 1_000_000n / 10n ** BigInt(amountDecimals + feedDecimals)`, floored. Currency 0 returns `amount`.
- Donated and pledged are converted separately, then added (as `initiativeUsd`).
- The spec requires the result to equal the contract's `initiativeUsd(i).remainingAskUsd` whenever that view does not revert. Pin it: add a Forge test in `vote/test/RoundAccounting.t.sol` (`test_RemainingAsk_CrossCheck`) that sets up one project with a USD pledge, 1.5 ETH at a mock feed price of 300_012_345_678 and 500 DAI, and asserts a hard-coded `remainingAskUsd`; assert the same number from `remainingAsk` in the vitest file.

- [ ] **Step 1: Write the failing tests**

```ts
const USD: Currency = { asset: null, usdFeed: null, amountDecimals: 6, feedDecimals: 0 };
const ETH: Currency = { asset: "native", usdFeed: "0x…feed", amountDecimals: 18, feedDecimals: 8 };
const DAI: Currency = { asset: "0x…dai", usdFeed: null, amountDecimals: 18, feedDecimals: 0 };

it("values ETH at the feed price, rounded down", () => {
  // 1.5 ETH at $3,000.12345678 = $4,500.185185 (…17 dropped)
  expect(toUsd(1_500_000_000_000_000_000n, 300_012_345_678n, ETH)).toBe(4_500_185_185n);
});
it("values a fixed-dollar token one to one", () => {
  expect(toUsd(2_500_000_000_000_000_000n, 1n, DAI)).toBe(2_500_000n);
});
it("subtracts donations and pledges from the ask", () => {
  const h = [{ donated: 0n, pledged: 1_000_000_000n, price: 0n },          // $1,000 pledged
             { donated: 10n ** 18n, pledged: 0n, price: 200_000_000_000n }, // 1 ETH at $2,000
             { donated: 500n * 10n ** 18n, pledged: 0n, price: 1n }];       // 500 DAI
  expect(remainingAsk(10_000_000_000n, [USD, ETH, DAI], h)).toBe(6_500_000_000n);
});
it("never goes below zero", () => {
  expect(remainingAsk(100n, [USD], [{ donated: 0n, pledged: 500n, price: 0n }])).toBe(0n);
});
it("an ETH swap to DAI at the same price leaves the ask where it was", () => { /* 1 ETH @2000 vs 2000 DAI */ });
it("refuses a non-positive price on a nonzero amount", () => {
  expect(() => remainingAsk(1n, [USD, ETH], [{ donated: 0n, pledged: 0n, price: 0n },
    { donated: 1n, pledged: 0n, price: 0n }])).toThrow("invalid price");
});
it("needs no price for a currency the project does not hold", () => { /* price 0n, amounts 0n: no throw */ });
```

- [ ] **Step 2: Run** `deno run -A npm:vitest run shared/vote/asks.test.ts` — expected: fails, module missing.
- [ ] **Step 3: Implement** `shared/vote/asks.ts`.
- [ ] **Step 4: Run** the same command — expected: pass.
- [ ] **Step 5: Commit** `git add shared/vote/asks.ts shared/vote/asks.test.ts && git commit -m "Vote: a project's remaining ask from chain values, as the contract counts it"`

---

### Task 3: Replay over chain states

**Files:**
- Modify: `shared/vote/quiet-ending.ts`
- Test: `shared/vote/quiet-ending.test.ts`

**Interfaces:**
- Produces:

```ts
/** The asks and pool at one block. `event`: the block holds an ask-side tally event
 * (a pledge, a pool change, a balance change). `asks` may be shorter than the
 * project count for a block before later projects joined. */
export type ChainState = {
  block: number; timestamp: number; asks: bigint[]; poolUsd: bigint; event: boolean;
};
export type Settled = { /* as today, plus */ covered: number[] };
// replay input: `needs`, `poolUsd` and `settleNeeds` are removed; add
//   states: ChainState[]   // ascending by block; at least one at or before the first Tier-S tally
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

- [ ] **Step 1: Write the failing tests.** Rewrite the file's helpers so a round is built from `states`; a helper `flat(needs, poolUsd)` returning one state at block 0 keeps the existing cases short. Add:

```ts
it("a donation inside the Tier-S window is a tally event and extends it", …);
//   states: block 0 asks [62,12,42,32]; block 50 (inside window 1) asks [40,12,42,32], event true
//   ballots [[2,2,3,1],[1,2,1,2]], pool 152 → after window 1: Tier-S status "settling", window 2
it("the same donation after Tier-S settled changes nothing", …);
//   block after the cutoff → Tier-S funded [3,2], identical awards with and without the state
it("a tally uses the pool at its own block", …);                 // pool raise mid-window
it("a covered project is not funded and is recorded as covered", …);  // asks [100,100,0] → covered [2]
it("crossing $0 alone does not extend the window", …);           // ask 5 → 0 mid-window, still settles at window 1
it("a project covered at settlement never returns", …);          // ask back to 10 in Tier-A: not funded
it("a project covered mid-window but not at the cutoff is an ordinary candidate", …);
it("a project missing from an early state is not a candidate there", …);   // asks shorter than m
it("is the same with and without snapshots", …);
it("throws without a chain state before the first tally", …);
```

Keep every existing behaviour test (receipts, rejections, registration, forced close), ported to `states`.

- [ ] **Step 2: Run** `deno run -A npm:vitest run shared/vote/quiet-ending.test.ts` — expected: new tests fail.
- [ ] **Step 3: Implement.** `tally(first, state, upTo)` takes a `ChainState`; `applyBefore` walks receipts and event states together by block.
- [ ] **Step 4: Run** `deno run -A npm:vitest run shared/vote` — expected: pass. `deno task typecheck` will fail in callers until Task 7; that is expected, note it in the commit body.
- [ ] **Step 5: Commit** `git add shared/vote/quiet-ending.ts shared/vote/quiet-ending.test.ts && git commit -m "Quiet ending: tally with the asks and pool at each block; donations are tally events"`

---

### Task 4: Contract: `setPledgeBySig`

**Files:**
- Modify: `vote/contracts/RoundAccounting.sol` (extract `_setPledge` internal from `setPledge`)
- Modify: `vote/contracts/SignedBallots.sol`
- Test: `vote/test/SignedBallots.t.sol` (or a new `vote/test/SignedPledges.t.sol` if that file is long)
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
- Produces (TypeScript): `pledgeTypedData(m: VoteManifest, p: { pledgeId: Hex; initiativeId: bigint; currencyId: bigint; amount: bigint; nonce: bigint; deadline: bigint })` in `shared/vote/typed-data.ts`, same domain as `voteTypedData`, `primaryType: "Pledge"`.

- [ ] **Step 1: Write the failing Forge tests**: `test_SignedPledge_RecordsLikeSetPledge` (same `PledgeSet` event, `initiativeUsd` drops by the amount), `test_SignedPledge_AnyoneMaySubmit`, `test_SignedPledge_RevertsWithoutRole`, `test_SignedPledge_RevertsOnReplay` (second submit → `InvalidPledgeNonce`), `test_SignedPledge_RevertsWhenExpired`, `test_SignedPledge_RevertsOnWrongSigner`, `test_SignedPledge_ContractWalletSigner` (ERC-1271 mock from `vote/test/helpers` if one exists, else add a minimal one), `test_SignedPledge_ClosedAtHardDeadline`.
- [ ] **Step 2: Run** `cd vote && forge test --match-test SignedPledge` — expected: compile error, function missing.
- [ ] **Step 3: Implement** the contract change.
- [ ] **Step 4: Run** `cd vote && forge test` — expected: all pass.
- [ ] **Step 5: Add the ABI entries and `pledgeTypedData`,** with a vitest test asserting `hashTypedData(pledgeTypedData(...))` equals a digest printed by a Forge test for the same values (hard-code the digest in both tests).
- [ ] **Step 6: Run** `deno run -A npm:vitest run shared/vote/typed-data.test.ts` — expected: pass.
- [ ] **Step 7: Commit** the five files: `git commit -m "Vote contract: an admin's signed pledge, submitted by anyone"`

---

### Task 5: Deploy: currencies, accounts, pledge role, seeded pledges

**Files:**
- Modify: `shared/vote/manifest.ts`, `scripts/vote-deploy.ts`
- Test: `shared/vote/manifest.test.ts`, `scripts/vote-deploy.test.ts`

**Interfaces:**
- Consumes: `Currency` from Task 2.
- Produces, on `VoteManifest`:

```ts
/** The contract's registered currencies, in id order; [0] is the virtual USD unit. */
currencies?: Currency[];
/** Per slug: the project's account on the round's chain (its Safe). */
accounts?: `0x${string}`[];
```

`checkManifest`: a real round must have `currencies` with at least one beyond currency 0, and `accounts` matching `slugs` one to one. A manifest without `currencies` (older or test rounds) means "currency 0 only".

- Real round, in the atomic setup transaction and before opening: `registerCurrency(address(0), ETH_USD_FEED, maxPriceAge)` and one fixed-$1 `registerCurrency(token, address(0), 0)` per stablecoin. Mainnet values: Chainlink ETH/USD `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`, `maxPriceAge` 3 hours (10800); USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`; DAI `0x6B175474E89094C44Da98b954EedeAC495271d0F`. Keep them in one exported constant so the list is easy to change.
- Real round: `grantRole(PLEDGE_ROLE, admin)` for every admin wallet address (use the site's existing admin list in `api/config.ts`; if admins are not identified by wallet address, stop and ask).
- Real round: one `setPledge(pledgeChainId(p.id), initiativeId, 0, usdMicro)` per board pledge with status `pledged` on a project in the round. `pledgeChainId(id: string): Hex` = `keccak256(toHex("pledge:" + id))`, exported from `shared/vote/typed-data.ts`.
- Test rounds register no currency and seed no pledge.

- [ ] **Step 1: Write the failing tests**: manifest (`a real round needs its currencies and accounts`, `a round without currencies counts pledges only`); deploy plan (`registers ETH and the stablecoins before opening`, `grants the pledge role to each admin`, `seeds the board's open pledges and skips received and withdrawn ones`, `a test round registers nothing`).
- [ ] **Step 2: Run** `deno run -A npm:vitest run shared/vote/manifest.test.ts scripts/vote-deploy.test.ts` — expected: fail.
- [ ] **Step 3: Implement.** Follow the existing `plan`/`step(...)` structure in `vote-deploy.ts`; mind the per-transaction gas cap it already batches for.
- [ ] **Step 4: Run** the same command — expected: pass.
- [ ] **Step 5: Commit** the four files: `git commit -m "Vote deploy: register ETH and stablecoins, grant the pledge role, put the board's pledges on-chain"`

---

### Task 6: Chain reader: states for the replay

**Files:**
- Modify: `api/services/vote-chain.ts` (raw reads)
- Create: `api/services/vote-asks.ts`
- Test: `api/tests/vote-asks.test.ts`

**Interfaces:**
- Consumes: `remainingAsk`, `Currency`, `Holding` (Task 2); `ChainState` (Task 3); `windowEnds`, `Schedule`.
- Produces on `VoteChain`:

```ts
/** PledgeSet logs since the deploy block, in chain order. */
pledgeEvents(): Promise<{ block: number; logIndex: number; timestamp: number;
  pledgeId: Hex; initiativeId: number; currencyId: number; amount: bigint }[]>;
/** Balances of every account in every registered currency, and each feed's answer,
 * at `block` (one multicall with a block tag). balances[project][currency]. */
holdingsAt(block: number): Promise<{ balances: bigint[][]; prices: bigint[] }>;
/** Blocks in [from, to] where any account's balance in any registered currency
 * differs from the block before. */
balanceChangeBlocks(from: number, to: number): Promise<number[]>;
/** The last block with timestamp < time, and its timestamp. */
blockBefore(time: number): Promise<{ block: number; timestamp: number }>;
```

- Produces in `vote-asks.ts`:

```ts
export async function chainStates(d: VoteRound, kv: Deno.Kv, now: number): Promise<ChainState[]>;
```

`chainStates` returns, ascending and without duplicates, a state for:
1. the last block before each tier's first tally that has started, and before each window cutoff that has passed (`windowEnds`);
2. inside each started tier's span `[firstTallyAt[t], min(now, last window end))`: every block with a receipt, a `PledgeSet`, a `PoolUsdSet` or a balance change; `event` is true for the last three;
3. the head block.

Each state's `asks[i]` is `remainingAsk` for every project registered at that block (`rulesHistory().addedAt`), with pledges folded from `pledgeEvents()` up to and including that block and the pool from `rulesHistory().pool`. A round with no `currencies` skips `holdingsAt` and `balanceChangeBlocks` entirely.

The feed answer is used whatever its age (the reader calls the feed's `latestRoundData()` at the block and never the contract's `initiativeUsd()`, which reverts on a stale price).

Left to the implementer (spec): how `balanceChangeBlocks` finds native ETH changes (Transfer logs cover ERC-20s; ETH needs traces or per-block balance reads), batching, and the KV key shape. Required: states for blocks older than `FINAL_AFTER_SECS` are cached in KV by round and block and not read again; newer ones are never cached.

- [ ] **Step 1: Write the failing tests** against a fake `VoteChain`: `a state for each boundary, each event block and the head`; `a pledge lowers the ask from its block on`; `a balance change marks its block as an event; a receipt block is not an ask event`; `the pool in each state is the one in force at that block`; `a round without currencies never reads balances` (the fake throws if asked); `a final block is read once; a recent block is read again` (Review Focus 1); `a project added later is missing from earlier states`; `a non-positive feed answer on a held currency throws` (Review Focus 3).
- [ ] **Step 2: Run** `deno test -A api/tests/vote-asks.test.ts` — expected: fail.
- [ ] **Step 3: Implement** the four chain reads (viem `getLogs`, `multicall` with `blockNumber`) and `chainStates`.
- [ ] **Step 4: Run** the same command — expected: pass.
- [ ] **Step 5: Commit** `git add api/services/vote-chain.ts api/services/vote-asks.ts api/tests/vote-asks.test.ts && git commit -m "Vote: read the asks and pool at each tally block from the chain"`

---

### Task 7: API: the round from chain states

**Files:**
- Modify: `api/routes/vote.ts` (`needsOf`, `roundState`, `/round` JSON), `api/services/vote-chain.ts` (`VoteRound`), `api/services/vote-llms.ts` if it reads needs
- Test: the existing vote route tests under `api/tests/` (find them with `grep -l "needs" api/tests`)

**Interfaces:**
- Consumes: `chainStates` (Task 6), `replay` with `states` (Task 3).
- Produces: `VoteRound.needs` is replaced by `states?: (now: number) => Promise<ChainState[]>` (the test hook); when absent the route calls `chainStates`. `/round` adds, per tier, `covered: string[]` (slugs) and in the live view `covered: string[]`; each project's current ask comes from the head state.

Changes:
- Delete `needsOf` and every read of the board for the vote. Delete the `settle-needs` KV reads and writes.
- Keep the `settled` KV record as a cache, written only after `FINAL_AFTER_SECS` as today. Add `covered` to `storeSettled`/`loadSettled`; a stored record without it loads as `[]`.
- A failure in `chainStates` is `fail(503, "asks_unavailable", "The vote results can't be read from the chain right now.")`.

- [ ] **Step 1: Write the failing tests**: `the round's asks come from the chain states, not the board` (board says raised, states say not: the result follows the states); `a donation inside the Tier-S window shows the tier still settling`; `a settled tier is the same before and after its record is stored`; `an RPC without past state is a 503, not a result` (Review Focus 2: the hook throws); `a covered project is listed as covered`. Port every existing test from `needs:` to `states:` with a one-state helper.
- [ ] **Step 2: Run** `deno test -A api/` — expected: the new tests fail, ported ones fail to compile until Step 3.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `deno test -A api/ && deno task check:api && deno task typecheck` — expected: pass (the app may need the `covered` field typed where it reads `/round`; add the type only, the screen is Task 9).
- [ ] **Step 5: Commit** the touched files: `git commit -m "Vote API: the round is replayed from chain states; the board no longer feeds the tally"`

---

### Task 8: Signed pledges in the admin form

**Files:**
- Modify: `api/routes/admin.ts`, `api/services/vote-chain.ts` (`send` gains `{ fn: "setPledgeBySig"; args }`, plus `pledgeNonceOf(signer: Hex): Promise<bigint>`), `api/db` pledges store (accept a caller-chosen id on add, if it does not already)
- Modify: `app/components/admin/initiative/Pledges.tsx`
- Test: the admin route tests under `api/tests/`, `app/components/admin/initiative/Pledges.test.tsx` (create if missing)

**Interfaces:**
- Consumes: `pledgeTypedData`, `pledgeChainId` (Tasks 4, 5); the relayer send path the `/ballot` route uses (same nonce queue).
- Produces:
  - `pledgeOnChain(m: VoteManifest | null, slug: string, now: number): { initiativeId: number } | null` in `api/routes/admin.ts` (or a small helper file): non-null when `m.kind === "real"`, `now < m.closesAt` and the slug is in `m.slugs`.
  - `POST /admin/initiatives/:id/pledges/prepare` with the same body as add/edit plus optional `pid` and `remove: true` → `{ pid, typedData }`. Amount on-chain: `Math.round(amountUsd * 1e6)` in currency 0; `0` when the resulting status is `received` or `withdrawn`, or on removal. `nonce` from `pledgeNonceOf(admin)`, `deadline` = now + 600 s. 409 when `pledgeOnChain` is null.
  - `POST`, `PATCH`, `DELETE …/pledges[/:pid]`: when `pledgeOnChain` is non-null they require `pid`, `nonce`, `deadline`, `signature`; the API rebuilds the typed data from the request itself (never trusts a client-sent amount for signing), checks the signature recovers to the signed-in admin's wallet, relays `setPledgeBySig`, waits for the receipt, and only on success writes the database. Missing fields → 428 `{ code: "signature_required" }`. Revert or timeout → 502 `{ code: "pledge_not_recorded" }`, nothing saved.
  - Outside the real vote the three routes behave exactly as today.

Form: when the API answers 428, call `prepare`, ask the wallet to sign the typed data, resubmit with the signature. Show "Recording the pledge on-chain…" while waiting and the API's message on failure. No other layout change.

- [ ] **Step 1: Write the failing API tests**: `outside the real vote a pledge saves as today`; `during the real vote a pledge without a signature is refused and nothing is saved`; `a signed pledge is relayed and then saved`; `a pledge whose transaction reverts is not saved` and `the same signature sent twice saves one pledge` (Review Focus 5); `a signature from another wallet is refused`; `marking a pledge received sends amount 0`; `removing a pledge sends amount 0 and removes it`; `an initiative outside the round saves as today`.
- [ ] **Step 2: Run** `deno test -A api/` — expected: new tests fail.
- [ ] **Step 3: Implement the API.**
- [ ] **Step 4: Write the failing form test**: `asks for a signature when the API requires one and resubmits with it`; `shows the failure and keeps the form filled when the chain refuses`.
- [ ] **Step 5: Implement the form** with the wallet-signing hook the app already uses for ballots (find it from `voteTypedData`'s callers).
- [ ] **Step 6: Run** `deno test -A api/ && deno run -A npm:vitest run app/components/admin` — expected: pass.
- [ ] **Step 7: Commit** the touched files: `git commit -m "Admin pledges: during the real vote a pledge is signed and recorded on-chain before it is saved"`

---

### Task 9: Vote results: covered projects

**Files:**
- Modify: `app/components/vote/VoteResults.tsx`, `app/components/vote/mock-round.ts`
- Test: `app/components/vote/VoteResults.test.tsx`

**Interfaces:**
- Consumes: `covered` per tier and in the live view from `/round` (Task 7).

A covered project is shown with the label **Covered by donations**, outside the tier lists, not counted in "funded" totals or in the pool's spend. In a settled tier's list it is final; in the live view it is "Covered by donations for now". Read the component first and use the smallest change that fits its existing sections.

- [ ] **Step 1: Write the failing tests**: `a covered project is listed as covered by donations, not under a tier`; `covered projects are not counted as funded by the pool`.
- [ ] **Step 2: Run** `deno run -A npm:vitest run app/components/vote/VoteResults.test.tsx` — expected: fail.
- [ ] **Step 3: Implement**, with one covered project in `mock-round.ts`.
- [ ] **Step 4: Run** `deno run -A npm:vitest run app/components/vote && deno task typecheck` — expected: pass.
- [ ] **Step 5: Commit** the three files: `git commit -m "Vote results: a project covered by donations is shown apart from the tiers"`

---

### Task 10: Rules and policy docs

**Files:**
- Modify: `vote/docs/quiet-ending-rules.md`, `vote/docs/settlement-policy.md`, `vote/README.md` if it lists contract functions

Write in, in the documents' own voice, every rule under "Rules to add" in the spec: the ask at a block and where each value comes from; replay ignores the price age limit while the view keeps it; tally events (unchanged list, now implemented) and the pool at each tally; settlement from the cutoff block with the stored record as a cache; covered projects (not a candidate, final at settlement, left out of the comparison when covered at either tally); the staged tally differs from plain PB-EAR only for $0 projects; signed pledges and who may sign; the swap rule for people; only the round's chain, the project's account and the registered currencies count. Remove the statements that replay's settlement and quiet-comparison checks are unimplemented, and the "Remaining decisions" entries this work closes. Record the date as Nov 12, 2026.

- [ ] **Step 1: Edit the documents.**
- [ ] **Step 2: Check** `grep -rn "S tier\|S-tier\|tier S\|S/A/B" vote/docs` — expected: no new matches.
- [ ] **Step 3: Run the whole suite**: `deno task test && deno task test:api && deno task typecheck && deno task lint && (cd vote && forge test) && (cd vote/reference && python3 -m unittest discover -p 'test_*.py')` — expected: all pass.
- [ ] **Step 4: Commit** `git add vote/docs vote/README.md && git commit -m "Vote docs: asks from the chain, covered projects, signed pledges"`
