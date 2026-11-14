# Ballot Rules on Asks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 1.5× ballot rule and the affiliation rule count each project's ask (goal less donations and open pledges) at the block that records the ballot, with Chainlink prices that never block voting; every ask on the vote's screens comes from the chain; the replay proves the ballots it counts are the ones the contract accepted.

**Architecture:** The contract computes asks inside ballot validation (prices once per ballot, `try` on feeds and `balanceOf`, a stored last good price per currency). The shared TS rules and the Python reference take the asks as input; fixtures carry them. The server reads all asks at the head block (`initiativeUsd` multicall), serves them with the round, uses them for the relayer's pre-check, and verifies the transcript before replaying. The page judges and displays with those asks.

**Tech Stack:** Solidity 0.8.28 / Foundry (`vote/`), Deno + TypeScript (viem, Hono, vitest), Python 3 reference (`vote/reference`, pytest).

**Spec:** `docs/superpowers/specs/2026-11-15-ballot-rules-on-asks-design.md` (also read the price rule in `docs/superpowers/specs/2026-11-12-chain-asks-in-quiet-ending-design.md`, "The ask at a block").

## Global Constraints

- Amounts are six-decimal micro-USD (`bigint` in TS, `uint256` in Solidity); `usd()` is `RoundAccounting._convert` exactly (rounded down, donations and pledges converted separately).
- `ask_i = max(goalUsd_i − support_i, 0)`; `support_i` = Σ over registered currencies of balance (non-USD) + open pledges, each converted.
- A price is **good** when the feed call succeeds, `roundId != 0`, `answer > 0`, `updatedAt != 0`, `updatedAt <= block.timestamp`, and `decimals()` equals the registered `feedDecimals`. Age never matters. Not good → `lastPrice[c]`.
- A token whose `balanceOf` reverts counts as a $0 balance. Token decimals are the registered `amountDecimals`; a changed `decimals()` is ignored.
- A $0-ask project still counts as one of S-Tier's three independent projects; it adds $0 to every total.
- One ballot per relayed `record()` call (unchanged).
- Copy: tiers are written S-Tier, A-Tier, B-Tier (`tierName()`); dates via `app/lib/format.ts` (AGENTS.md).
- Commands: `forge test` (in `vote/`), `deno task test`, `deno task test:api`, `deno task typecheck`, `deno task check:api`, `python3 -I -m pytest -q` (in `vote/reference`).

## Review Focus

1. A feed whose good answer has an older `updatedAt` than `lastPrice` (proxy repointed): the answer is used, `lastPrice` is not overwritten. → Task 1 test `test_olderGoodAnswerUsedNotStored`.
2. A badge that revoked and then voted again: the transcript entry for the revocation uses the last recorded nonce, and the check still passes. → Task 5 test `revocation then a new ballot keeps the transcript`.
3. The asks read fails (RPC error): the round is still served without `asks`, the page says the figures are being worked out, and the relayer refuses with 503 rather than judging on goals. → Task 6 test `asks unavailable: round served without asks, relay 503`.
4. A ballot shorter than the project list (a project added after the voter's page loaded): only `ballot.length` projects are read; unplaced tail costs nothing. → Task 2 test `test_shortBallotReadsOnlyItsProjects`.
5. All placed projects covered ($0 asks) with a non-zero pool: the ballot fails the size rule but S-Tier independence is satisfied by covered projects. → Task 3 fixture `covered_projects_independent_but_too_small`.

---

### Task 1: Contract prices: last good price, no age limit

**Files:**
- Modify: `vote/contracts/RoundAccounting.sol` (`Currency`, `registerCurrency`, `CurrencyRegistered`, `_price`, `initiativeUsd`, new `lastPrice`, `priceUsd`, `PriceStored`)
- Modify: `vote/config/mainnet.json` (drop `maxPriceAge`)
- Test: `vote/test/RoundAccounting.t.sol`, `vote/test/helpers/Fixtures.sol` (`MockFeed.setReverts(bool)` if `setUnavailable` doesn't cover a revert — it does; reuse it)

**Interfaces:**
- Produces (Solidity, used by Task 2):
  - `struct LastPrice { uint192 price; uint64 updatedAt; }`; `mapping(uint256 => LastPrice) public lastPrice;`
  - `event PriceStored(uint256 indexed currencyId, uint256 price, uint256 updatedAt);`
  - `function registerCurrency(address asset, address usdFeed) external returns (uint256 id)` (no `maxPriceAge`); `CurrencyRegistered(currencyId, asset, usdFeed, amountDecimals, feedDecimals)`.
  - `function _readPrice(uint256 id, Currency memory c) internal view returns (uint256 price, uint64 updatedAt, bool good)` — feed via `try`; good per Global Constraints; not good → `(lastPrice[id].price, lastPrice[id].updatedAt, false)`; `usdFeed == 0` → `(1, 0, true)`.
  - `function _storePrice(uint256 id, uint256 price, uint64 updatedAt) internal` — writes and emits only if `updatedAt > lastPrice[id].updatedAt`.
  - `function priceUsd(uint256 currencyId) external view returns (uint256)`.
  - `initiativeUsd(i)` returns `(donatedUsd, pledgedUsd, totalUsd, askUsd)`, uses `_readPrice`, never reverts on price; `balanceOf` via `try`, revert → 0.

- [ ] **Step 1: Write failing tests** in `RoundAccounting.t.sol`:
  - `test_registerSeedsLastPrice`: register ETH with feed at `2_000e8`; `lastPrice(1)` == `(2_000e8, updatedAt)`; `PriceStored` emitted.
  - `test_registerRequiresGoodAnswer`: feed `setUnavailable(true)` → `registerCurrency` reverts `InvalidPrice(id)`.
  - `test_staleAnswerIsUsed`: warp 30 days; `initiativeUsd` values with the old answer, no revert.
  - `test_brokenFeedFallsBack` (each case → `priceUsd(1) == 2_000e8`): `setUnavailable(true)`; `set(0, now)`; `setRound(0)`; `set(3_000e8, now + 1 days)` (future); `setDecimals(18)`.
  - `test_tokenDecimalsChangeIgnored`: `MockToken.setDecimals(18)` after registration; `initiativeUsd` still converts with 6.
  - `test_revertingBalanceCountsZero`: a token whose `balanceOf` reverts (add `MockToken.setBroken(bool)` to Fixtures) → that currency contributes 0.
  - `test_olderGoodAnswerUsedNotStored`: store a price at t=100 via a ballot path stand-in (`exposed_storePrice` on a test harness subclass), feed answers good with `updatedAt` 50 → `priceUsd` returns the feed answer; `lastPrice` unchanged.
  - Rename/adjust existing tests that pass `maxPriceAge` or expect `StalePrice`.
- [ ] **Step 2:** `cd vote && forge test --match-contract RoundAccounting` → FAIL (signature and missing members).
- [ ] **Step 3: Implement** the interfaces above. Remove `maxPriceAge` from the struct, `registerCurrency`, the event and `StalePrice`; drop the `IERC20Metadata.decimals()` re-check in `_price` (delete `_price` if `_readPrice` replaces all uses). `registerCurrency` with a feed calls `_readPrice` and reverts `InvalidPrice(id)` unless good, then `_storePrice`. Remove `maxPriceAge` keys from `vote/config/mainnet.json`.
- [ ] **Step 4:** `forge test` → all PASS.
- [ ] **Step 5: Commit** `git add vote/contracts vote/test vote/config && git commit -m "Vote contract: prices never block, last good price kept"`

### Task 2: Contract rules on asks

**Files:**
- Modify: `vote/contracts/SignedBallots.sol` (`_validateBallot`, `_rankCounts`, `_checkGroups`, new `_checkTiers`), `vote/contracts/RoundAccounting.sol` (`_asksOf`, `_supportOf`)
- Test: `vote/test/BallotRules.t.sol`, new `vote/test/Gas.t.sol`

**Interfaces:**
- Consumes: Task 1 `_readPrice`, `_storePrice`.
- Produces: `function _asksOf(bytes calldata ballot) internal returns (uint256[] memory asks)` — prices read once per ballot (good answers stored via `_storePrice`), `asks[p]` for each placed `p < ballot.length`, 0 for unplaced. `_validateBallot` is non-`view`. The spike in the spec's session (`_asksOf` / `_supportOf(p, cs, prices)` / `_checkTiers(ballot, proof, counts, asks)`) is the shape that stays under the stack limit.

- [ ] **Step 1: Write failing tests** in `BallotRules.t.sol` (helper `simple()` gets goals 100 each, pool 200):
  - `test_donationMakesBallotTooSmall`: ballot of 4 passes; `vm.deal` project 0 enough ETH that asks sum < 300 → `vote` reverts `BallotTooSmall`.
  - `test_pledgeCountsAgainstAsk`: same via `setPledge(…, currency 0, …)`.
  - `test_groupRuleCountsAsks`: two related projects over half the tier by goal but not by ask (pledge one down) → passes; reverse case reverts `GroupOverHalf`.
  - `test_coveredProjectCountsAsIndependent`: S-Tier = 3 unrelated, one fully pledged ($0 ask), rest of ballot meets 1.5× → passes.
  - `test_shortBallotReadsOnlyItsProjects` (Review Focus 4): add a 5th project after `vm.warp` outside quiet spans; a 4-byte ballot passes and doesn't read project 4 (assert via `vm.expectCall` count 0 on its token `balanceOf`).
  - `test_brokenFeedDoesNotBlockVoting`: feed `setUnavailable(true)` → ballot still recorded using `lastPrice`.
  - `Gas.t.sol` (copy the spike's setup: 80 projects, ETH/USDC/EURC, a USD pledge each; run with `--isolate`): `test_gas40` asserts first send `< 1_500_000` and revision `< 1_400_000`.
- [ ] **Step 2:** `forge test --match-contract "BallotRules|Gas" --isolate` → FAIL.
- [ ] **Step 3: Implement** `_asksOf` and wire it into `_validateBallot` → `_rankCounts(ballot, asks)` and `_checkGroups(..., asks)`; balance reads through `try IERC20Metadata(asset).balanceOf(account)`, revert → 0.
- [ ] **Step 4:** `forge test --isolate` → all PASS (the fixture test is updated in Task 3; if it fails here on asks == goals it should still pass, since fixture projects have no support yet).
- [ ] **Step 5: Commit** `git commit -m "Vote contract: ballot rules count asks at the recording block"`

### Task 3: Shared rules and reference on asks, fixtures with asks

**Files:**
- Modify: `shared/vote/rules.ts` (`RulesRound.asks`), `shared/vote/manifest.ts` (`rulesRound`), `vote/reference/ballot_rules.py`, `vote/reference/export_rules_fixtures.py`, `shared/vote/fixtures/ballot-rules.json` (regenerated), `vote/test/BallotRules.t.sol` (`deployCase`)
- Test: `shared/vote/rules.test.ts`, `vote/reference/test_ballot_rules.py`

**Interfaces:**
- Produces:
  - `RulesRound = { projects: RulesProject[]; asks: bigint[]; groupNames: string[]; poolUsd: bigint; independentTiers: number }` — `asks[i]` by project; size and group rules use `asks`, never `goalUsd`. `RuleError` amounts are asks.
  - `rulesRound(m: VoteManifest, asks: bigint[], poolUsd?: bigint): RulesRound`.
  - Python: `check_ballot(ballot, projects, asks, pool, independent_tiers)` (keep the existing argument order, insert `asks` after `projects`).
  - Fixture case: `projects[i] = { goalUsd, rfp, groups }` plus top-level `asks: string[]`; `sol.asks` stays the asks, new `sol.goals`.

- [ ] **Step 1: Write failing tests:** `rules.test.ts` — `"size counts asks, not goals"` (goals 100×4, asks 10×4, pool 20 → ok; pool 30 → size error with `requested: 40n`); `"group rule counts asks"`; `"a $0 ask counts toward independence"`. Python mirrors the same three.
- [ ] **Step 2:** `deno task test shared/vote/rules.test.ts` and `pytest -q` → FAIL.
- [ ] **Step 3: Implement** in TS and Python. `export_rules_fixtures.py`: each random case draws `asks[i] = goal − randint(0, goal)` (some 0), and add the named case `covered_projects_independent_but_too_small` (Review Focus 5: S-Tier three unrelated all $0 ask, pool > 0, expect `ok: false`, error `size`). Regenerate: `python3 -I vote/reference/export_rules_fixtures.py > shared/vote/fixtures/ballot-rules.json`. `BallotRules.t.sol` `deployCase` adds each project with `sol.goals[i]` and, when `goal > ask`, `setPledge(bytes32(i + 1), i, 0, goal − ask)` before opening.
- [ ] **Step 4:** `pytest -q`, `deno task test shared/vote`, `forge test --match-test test_fixtures` → PASS. Every caller of `rulesRound`/`checkBallot` now fails typecheck; leave them for Tasks 6–7 but make `deno task typecheck` pass by passing `rulesRound(m, m.projects.map((p) => BigInt(p.goalUsd)))` as a temporary marker commented `// asks: Task 6/7`.
- [ ] **Step 5: Commit** `git commit -m "Ballot rules: shared check and reference count asks"`

### Task 4: ABI and contract wiring

**Files:**
- Modify: `shared/vote/abi.ts` (regenerated), `api/services/vote-chain.ts` (event strings unchanged except none use `maxPriceAge`; check)
- Test: none new; the existing suites

- [ ] **Step 1:** `cd vote && forge build`.
- [ ] **Step 2: Regenerate** `shared/vote/abi.ts` from `vote/out/SignedBallots.sol/SignedBallots.json`, keeping its header line and `export const SIGNED_BALLOTS_ABI = [...] as const;` shape (`deno eval` writing `JSON.stringify(abi, null, 2)`), then `deno fmt shared/vote/abi.ts`.
- [ ] **Step 3:** `deno task typecheck && deno task check:api && deno task test && deno task test:api` → PASS.
- [ ] **Step 4: Commit** `git commit -m "Vote: ABI for prices that never block and asks in the rules"`

### Task 5: Transcript check

**Files:**
- Create: `shared/vote/transcript.ts`
- Modify: `api/services/vote-chain.ts` (`ballots()` returns voter and nonce for records; new `committed(block)`), `api/routes/vote.ts` (`roundState`)
- Test: `shared/vote/transcript.test.ts`, `api/tests/vote-round.test.ts`

**Interfaces:**
- Produces:
  - `export function transcriptOf(events: TranscriptEvent[]): { transcript: Hex; count: number; lastHash: Map<string, Hex> }` where `TranscriptEvent = { tokenId: string; voter: Hex; nonce: bigint; ballot: Hex } | { tokenId: string; revoked: true }`; record entry `keccak256(encodeAbiParameters([bytes32, uint256, address, uint64, bytes32], [prev, tokenId, voter, nonce, keccak256(ballot)]))`; revocation uses `voter = 0x0`, the token's last recorded nonce (0 if none) and `bytes32(0)`; initial transcript `bytes32(0)`.
  - `VoteChain.ballots(): Promise<{ events: BallotEvent[]; block: bigint }>` — logs up to a pinned `block`; `BallotEvent` records gain `voter: Hex` and `nonce: number` (required).
  - `VoteChain.committed(block: bigint, tokenIds: bigint[]): Promise<{ transcript: Hex; recordCount: bigint; hashes: Hex[] }>` — `transcript()`, `recordCount()`, `ballotHashOf(id)` read at `block` (one multicall).
  - In `roundState`: after reading ballots, call `committed(block, distinct tokenIds)`; mismatch in transcript, count, or any token's last hash → `throw fail(503, "transcript_mismatch", "The ballots read don't match the contract; the results are back once they do.")`.

- [ ] **Step 1: Write failing tests:** `transcript.test.ts` — `"matches the contract's running hash"` (expected values from a forge run: add `test_transcriptVector` to `vote/test/SignedBallots.t.sol` that logs `transcript()` after two votes and a revocation; paste the value as a constant); `"revocation then a new ballot keeps the transcript"` (Review Focus 2); `"a changed ballot byte changes the hash"`. `vote-round.test.ts` — `"a ballot the contract didn't commit is never counted"` (fake chain `committed` returns a different transcript → GET round 503 `transcript_mismatch`).
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement** `transcriptOf`, the two `VoteChain` changes (pin `toBlock` of the last chunk and the reads to the same `block`), and the check. Update the in-memory fake chains in `api/tests` to the new `ballots()` shape.
- [ ] **Step 4:** `forge test`, `deno task test shared/vote`, `deno task test:api` → PASS.
- [ ] **Step 5: Manual check** against the deployed Sepolia round: with the API's env loaded, `deno task dev` and open `/api/vote/round` (or the route that serves it) → 200, not `transcript_mismatch`. Record the result in the commit message.
- [ ] **Step 6: Commit** `git commit -m "Vote replay: count only the ballots the contract committed to"`

### Task 6: Server: chain asks for the round, the relayer and the replay

**Files:**
- Modify: `api/services/vote-chain.ts` (`asks()`), `api/routes/vote.ts` (round JSON `asks`, relayer pre-check, `findProof` call, replay `rules` input removed), `shared/vote/quiet-ending.ts` (drop `rules` input and the size/group check; keep the shape check → `invalid_ballot`), `app/hooks/use-vote.ts` (`RoundView.asks`)
- Test: `api/tests/vote-round.test.ts`, `api/tests/vote-chain.test.ts`, `shared/vote/quiet-ending.test.ts`

**Interfaces:**
- Consumes: Task 3 `rulesRound(m, asks, poolUsd)`.
- Produces:
  - `VoteChain.asks(): Promise<bigint[]>` — `initiativeUsd(i)[3]` for `i < manifest.slugs.length` at the head block, one multicall.
  - Round JSON: `asks?: string[]` (micro-USD, manifest order), absent when the read failed (log it). `RoundView.asks?: string[]` with doc comment "Each initiative's ask on-chain now (goal less donations and open pledges), micro-USD: what the ballot rules count."
  - `replay()` input loses `rules`; `rulesHistory()` stays for the pool.

- [ ] **Step 1: Write failing tests:** `vote-round.test.ts` — `"the round carries the chain asks"`; `"the relayer judges with chain asks"` (goals pass, asks fail → 422 `invalid_ballot` with `requested` = sum of asks); `"asks unavailable: round served without asks, relay 503"` (Review Focus 3; relay error code `asks_unavailable`). `quiet-ending.test.ts` — `"a recorded ballot is not re-judged on size"` (a ballot under 1.5× by goals is accepted); keep the existing shape-rejection test.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Replace the Task 3 temporary `rulesRound` calls in `api/` with chain asks; `findProof` can take any asks (groups only) — pass the chain asks.
- [ ] **Step 4:** `deno task test:api && deno task test shared/vote && deno task check:api` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Vote API: the round's asks from the chain judge and show ballots"`

### Task 7: Page: every ask from the chain

**Files:**
- Modify: `app/lib/vote-results.ts` (`askOf`), `app/components/vote/VotePage.tsx` (items, `goalOf` → chain asks for ring, per-tier totals and `checkBallot`), `app/components/vote/VoteClosed.tsx` (ring), `app/components/vote/VoteResults.tsx` (rows, `needFor`), `app/components/vote/GiveList.tsx`, `app/components/vote/BallotMeter.tsx` (near-limit warning), `app/lib/vote-flow.ts` (`findProof` round), `app/components/vote/mock-round.ts` (mock `view.asks`; sample ballot until asks ≥ 1.5×)
- Test: `app/components/vote/TierBallot.test.tsx`, `app/components/vote/VoteResults.test.tsx`, `app/components/vote/BallotMeter.test.tsx`, `app/components/vote/mock-round.test.ts`, `app/routes/vote.code.test.tsx`

**Interfaces:**
- Consumes: Task 6 `RoundView.asks`, Task 3 `rulesRound(m, asks, poolUsd)`.
- Produces: `askOf(round: { slugs: string[] }, asks: string[] | undefined, slug: string): number | undefined` (dollars; undefined when asks are absent) replacing the card-based `askOf(card)`; `BallotItem.askUsd` and `GiveRow.askUsd` come from it. The example rounds have no chain: `mock-round.ts` keeps a local `mockAsk(card) = max(1, goalUsd − summary.total)` for its tally costs and puts the same values in `view.asks`.

- [ ] **Step 1: Write failing tests:**
  - `VoteResults.test.tsx`: `"rows show the chain ask, not goal less board raised"` (fixture round `asks` differ from `goal − total`; row reads the chain ask).
  - `vote.code.test.tsx` (the ballot editor): `"the ring and tier totals add up the rows' asks"`; `"without chain asks the page says the figures are being worked out"` (no amounts on rows, Send disabled with that reason).
  - `BallotMeter.test.tsx`: `"within 5% above 1.5× the pool, it warns a donation could make the ballot too small"` (requested = 1.52× pool → warning; 1.6× → none). Copy: "Close to the minimum: a donation landing first could make this ballot too small."
  - `mock-round.test.ts`: `"the sample ballot asks at least 1.5× the pool by asks"`; mock `view.asks` equal the tally's costs.
- [ ] **Step 2:** `deno task test app/components/vote app/routes` → FAIL.
- [ ] **Step 3: Implement.** Remove the Task 3 temporary `rulesRound` calls in `app/`.
- [ ] **Step 4:** `deno task test && deno task typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Vote page: every ask from the chain, warned near the minimum"`

### Task 8: Words: agent feed and docs

**Files:**
- Modify: `api/services/vote-llms.ts` (`voteLlms(m, entries, origin, asks?: bigint[])` and its route caller), `vote/README.md` ("Ballot rules", "USD accounting API": `initiativeUsd` fields, price fallback, `registerCurrency` without `maxPriceAge`), `docs/superpowers/specs/2026-11-11-ballot-rules-design.md` (the "Requested amount" definition points to the new spec), `vote/docs/quiet-ending-rules.md` (only if it states the rule)
- Test: `api/tests/vote-llms.test.ts`

- [ ] **Step 1: Write failing tests** in `vote-llms.test.ts`: `"the rules count asks at the recording block"` (text contains "asks" and no longer "original requested amounts"); `"each project lists its chain ask"` (`· asks $X ·` from the passed asks; "unknown" when absent).
- [ ] **Step 2:** `deno task test:api api/tests/vote-llms.test.ts` → FAIL.
- [ ] **Step 3: Implement** the feed text and the docs. Rule line: "The projects you rank must ask for at least $N in total (1.5× the pool). A project's ask is its goal less its donations and open pledges, on-chain at the block that records your ballot, so it can change before then."
- [ ] **Step 4:** `deno task test:api` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Vote: the rules in words count asks"`
