# Ballot rules counted on asks

Design, Nov 15, 2026. Status: waiting for approval.

Amended Nov 17, 2026: the owner chose registered funding goals for the affiliation limit.
The size rule and funding still use live asks. This supersedes decision 2 and references
below to affiliation totals using asks; see the current rules in
`2026-11-11-ballot-rules-design.md`.

## Why

The ballot rules (`2026-11-11-ballot-rules-design.md`) make a ballot spread the pool: the
placed projects must request at least 1.5× the pool, and in an enforced tier no affiliation
may hold more than half of the tier's requested total. Today "requested" is each project's
**goal** (`goalUsd`, renamed from `askUsd` on Nov 15). A ballot full of nearly funded projects
passes while asking the pool for little, and the screens now show each project's **ask** (goal
less donations and open pledges), so the rule's totals and the rows a voter sees don't add up.

Both rules count **asks** instead: what the pool would actually pay.

## Decisions (the owner's)

1. **The 1.5× rule counts asks**, not goals.
2. **The affiliation rule counts asks too** ("no group over half the tier's requested total").
3. **The contract works the asks out itself when it records a ballot** (option A below), at
   the block that records it. The chain stays the only judge.
4. **Prices: Chainlink's latest answer, with no age limit.** A late feed is not a failure:
   its last answer is the previous known value and is used as it stands.
5. **A broken feed falls back to the last good price the contract saw.** No admin-set price
   and no daily update job.
6. **The vote's asks come from the chain everywhere**: the rows, the donation list and the
   agent feed show the same chain asks the rule counts. Other screens (board, initiative
   pages) keep "raised" as it is.
7. **The tally keeps its board needs for now.** The Nov 12 chain-asks design takes this
   design's price rule, so the two agree once that design is built.
8. **A token whose `balanceOf` reverts counts as $0** for that project in that currency.
   That raises the ask, so it can only help a ballot pass; it never blocks voting.
9. The cost was seen and accepted: about 26k gas per placed project plus about 24k per ballot
   on top of today's, so 0.8–1.3M gas for a 20–40 project ballot (measured with Foundry on
   mocks of mainnet's currencies; mainnet proxies add about 10%).

## Approaches

- **A. The contract computes asks at recording** (chosen). Direct: validity is judged on the
  state at the recording block, anyone can recheck it, nothing to operate. Costs gas, and a
  ballot near the limit can be pushed either way by donations or pledges made just before
  it lands.
- **B. A stored ask snapshot**, refreshed by a (permissionless) job; ballots read it. Cheap
  ballots and an exact page, but a donation counts for the rule only at the next snapshot,
  and it needs a job. Not chosen.
- **C. Off-chain only**: page, relayer and replay enforce it, the contract doesn't. No gas,
  but a ballot sent straight to the contract skips the rule. Against the rules spec ("the
  contract reverts it"). Not chosen.
- Within A, an **admin price updated daily** was considered and rejected (decision 5).

## The ask at a block

For project `i` at block `b`, as in `2026-11-12-chain-asks-in-quiet-ending-design.md`:

```
support_i(b) = Σ over registered currencies c of
                 usd(c, balance of account_i in c at b) + usd(c, pledged(i, c) at b)
ask_i(b)     = max(goalUsd_i − support_i(b), 0)
```

`usd()` is `RoundAccounting._convert` exactly (six decimals, rounded down, donations and
pledges converted separately). Currency 0 (virtual USD) has pledges only. The balance read
uses `try`: a token whose `balanceOf` reverts counts as a $0 balance (decision 8); native ETH
balances can't fail.

### The price of a currency

`price(c)` for a feed-priced currency:

1. Call `latestRoundData()` on the feed (with `try`, so a reverting feed is caught).
2. The answer is **good** when the call succeeds, `roundId != 0`, `answer > 0` and
   `answer <= type(uint192).max` (the stored price is a `uint192`, so a larger answer is not
   good), `updatedAt != 0`, `updatedAt <= block.timestamp`, and the feed's `decimals()` call
   succeeds and still equals the registered `feedDecimals`. Its age does not matter. (The
   contract also refuses a `roundId` above `uint80`'s maximum, which no real feed reaches; a
   replay uses the same checks.)
3. Good: use it. Otherwise: use `lastPrice[c]`, the last good answer the contract stored.

`lastPrice[c] = { price, updatedAt }` is stored:

- at `registerCurrency`, which must read a good answer (a currency can't be registered
  without one), so a fallback always exists;
- whenever a ballot is recorded and the good answer's `updatedAt` is newer than the stored
  one.

Token decimals: use the registered `amountDecimals`; stop reverting when a token's
`decimals()` changes (today `_price` reverts with `InvalidPrice`).

`maxPriceAge` no longer has any use *(my call: remove it from `registerCurrency`, the
`Currency` struct, its event, `vote/config/mainnet.json` and the deploy script; mainnet is not
deployed)*.

## What gets built

### Contract (`vote/contracts`)

- `_validateBallot` computes the asks of the placed projects (prices read once per ballot)
  and uses them in the 1.5× check and in `_checkGroups`. The S-Tier proof is unchanged
  (groups only). The spike in the Nov 15 session (scratchpad, not in the repo) did this with
  `_asksOf` / `_supportOf` / `_checkTiers` to stay under the stack limit.
- Recording a ballot may now write `lastPrice`, so the validation path is no longer `view`.
- `initiativeUsd(i)` uses the same `price(c)` (view, no write) and never reverts on age.
  Its last return value is `askUsd`.
- New view `priceUsd(currencyId)`: the price the rule would use now. *(My call.)*
- An event when `lastPrice` changes, so replay and the page can follow it from logs.
  *(My call: `PriceStored(currencyId, price, updatedAt)`.)*
- Tests: the rule on asks (donation, pledge and balance changes flip validity), the fallback
  (reverting feed, zero answer, round 0, future timestamp, changed feed decimals, changed
  token decimals), seeding at registration, the gas test from the spike kept as a
  regression bound.

### Shared rules (`shared/vote/rules.ts`, `vote/reference/ballot_rules.py`)

- `RulesRound` gains the asks to judge with (`asks: bigint[]`, by project). The size rule and
  the group rule use them; error values (`requested`, `needed`) are in asks.
- The shared fixtures (`shared/vote/fixtures/ballot-rules.json`, from
  `export_rules_fixtures.py`) carry asks; the contract's fixture test sets balances or pledges
  so its asks equal the fixture's.

### Server (`api`)

- `vote-chain.ts` reads every project's ask at the head block (`initiativeUsd`, one multicall)
  and returns it with the round, so the page and the relayer judge with chain asks.
- The relayer's pre-check (`api/routes/vote.ts`, "The ballot rules, judged with the pool
  on-chain now") uses those asks instead of goals.
- The relayer keeps sending one ballot per `record()` call, as today, so a ballot that turns
  invalid before inclusion sinks no one else's *(my call)*.
- Replay (`shared/vote/quiet-ending.ts`, `valid()`): for rounds with `ballotRules`, a ballot
  the contract recorded passed the rules at its block, so replay stops re-checking size and
  groups for those rounds *(my call)* and keeps the shape check.
- Instead, replay **checks that the ballots it counts are exactly what the contract accepted**
  *(owner's decision)*. From the `BallotRecorded` and `RegistrationRevoked` events, in chain
  order, it recomputes the contract's running hash
  (`transcript = keccak256(abi.encode(transcript, tokenId, voter, nonce, ballotHash))`, with
  voter zero, the unchanged nonce and a zero hash for a revocation) and the count, and both
  must equal `transcript()` and `recordCount()` read at the same block. Each badge's last
  counted ballot must hash to `ballotHashOf(tokenId)`. On any mismatch, replay counts nothing
  and the round reports an error (as `needs_unavailable` does today), never a partial
  result.

### Page (`app`)

- Every ask on the vote's screens comes from the round's chain asks: the ballot tiles, phone
  card and details card, the donation list ("Needs"), the donation preview, the ring, the send
  sheet's per-tier totals and the rule messages. Today the rows compute
  `goalUsd − summary.total` from the board (`askOf` in `app/lib/vote-results.ts`); that
  changes to the chain ask. If chain asks are unavailable, the page says the figures are being
  worked out rather than falling back to board figures *(my call)*.
- The vote results' bars and final amounts stay as today (they measure against the goal and
  the tally's figures).
- Near the limit (within 5% above 1.5×) the page warns that a donation landing first could
  make the ballot too small *(my call)*.
- Example rounds (`mock-round.ts`): the sample ballot is built until its asks reach 1.5×.

### Words

- `vote/README.md` "Ballot rules", the rules spec's definitions, `vote/docs/quiet-ending-rules.md`
  if it mentions the rule, and the agent feed (`api/services/vote-llms.ts`, which today tells
  agents to "use the original requested amounts"): asks, at the block that records the ballot.
  The feed lists each project's chain ask.

## Which round *(my call)*

A clean switch: the next deployment (the Sepolia rehearsal, then mainnet) uses the new
contract. The current test round (`0x681d…f603`, no `ballotRules`, no currencies) keeps
working unchanged: the server never reads `CurrencyRegistered`, `initiativeUsd` or
`maxPriceAge`, and parameter names don't change selectors or event topics. No second ABI and
no rules version in the manifest.

## Known limits (accepted with option A)

- A donation or pledge change just before a ballot lands can make it valid or invalid. The
  money isn't lost, so a donor can do this cheaply; the pledge role can too.
- An initiative moving funds out of its own Safe raises its ask while it's out.
- The board's "raised" counts paid-out money; the chain counts only the current balance. So
  an initiative's ask on the vote's screens can differ from what its board card implies.
- The tally still charges board needs (decision 7) until the Nov 12 design is built, so the
  rule's ask and the tally's can differ for a paid-out initiative meanwhile.

## Covered projects

- A project with a $0 ask (fully covered) **still counts as one of S-Tier's three independent
  projects** *(owner's decision)*. It adds $0 to the 1.5× total and to its tier's and groups'
  totals in the affiliation rule.

## Left to the builder

Names of internal functions, how the relayer drops failing ballots, gas optimisations
(e.g. one USD pledge total per initiative), test layout.
