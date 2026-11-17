# Blossom voting

NFT-keyed ballot receipts, role-controlled round records, Chainlink USD valuation,
and the Python/TypeScript PB-EAR references. The planned test network is Sepolia.
The contracts are a development implementation, not a deployed round.

## Contents

| Path | Purpose |
| --- | --- |
| [contracts/SignedBallots.sol](contracts/SignedBallots.sol) | Internal or external voter NFTs, signed NFT-ID ballot receipts, roles and independently editable future dates. |
| [contracts/RoundAccounting.sol](contracts/RoundAccounting.sol) | Increase-only USD pool, allowed project currencies, initiatives, pledges and live USD views. |
| [contracts/IPriceFeed.sol](contracts/IPriceFeed.sol) | Minimal Chainlink AggregatorV3 reader interface. |
| [config/mainnet.json](config/mainnet.json) | Ethereum mainnet registration inputs for every website donation asset. |
| [shared/pbear.ts](shared/pbear.ts) | Integer-exact tally, transcripts and public replay. |
| [shared/ranks.ts](shared/ranks.ts) | Rank validation, packing and withholding marker 255. |
| [reference/pbear.py](reference/pbear.py) | Original Python tally, using only the standard library. |
| [reference/withhold.py](reference/withhold.py) | Withholding reference and comparison with padded original ballots. |
| [reference/scheduled_replay.py](reference/scheduled_replay.py) | Independent complete-history reference for the production three-stage vote. |
| [reference/quiet_ending.py](reference/quiet_ending.py) | Earlier models and helpers still used by simulations. |
| [docs/quiet-ending.md](docs/quiet-ending.md) | Mechanism overview. |
| [docs/quiet-ending-rules.md](docs/quiet-ending-rules.md) | Detailed requirements, asks from the chain, covered projects, derived checkpoints, acceptance, rounding and finality. |
| [docs/settlement-policy.md](docs/settlement-policy.md) | Accepted decision: secure USD funding, share increases equally, and lock awards and NFT charges when each tier settles. |
| [docs/withholding.md](docs/withholding.md) | Withholding background, examples and reference construction. |
| [docs/simulation-agent-prompt.txt](docs/simulation-agent-prompt.txt) | Investigation brief for changing currency valuations during a round. |
| [docs/papers](docs/papers) | PB-EAR and expanding-approvals papers. |
| [reference](reference) | Python tests, simulations and the initiative fixture. |
| [test](test) | Contract tests and TypeScript/Python tally parity checks. |
| [package.json](package.json) | Pinned Solidity dependencies installed into node_modules, plus Foundry build/test commands. |
| [package-lock.json](package-lock.json) | Exact dependency sources and integrity hashes for reproducible installs. |

## Published mechanism

[Blossom Budgeting](https://blossom.software/budgeting/) explains the tiered ballot
and slow quiet ending. The contract requirements below refine that explanation:
each NFT ID, rather than each holder address, is one equal voting unit.

Unplaced proposals receive no support by default. The calldata registry enforces
explicit withholding with byte 255 and valid competition ranks for placed projects.
The references retain byte 0 for the older optional unplaced tail.

## Contract requirements

| Setting or record | Implementation |
| --- | --- |
| Voter NFT | The round issues ERC-721s itself, or uses one external ERC-721 address. |
| Voting unit | One ballot and one nonce sequence per NFT ID; owners of multiple NFTs can vote each independently. Each record must use exactly the next nonce. |
| Ownership | Only the current owner can authorize a revision. Token approvals do not grant voting permission. Transfers preserve the token's nonce and registration receipt. |
| Initial date | Voting opens at the configured timestamp. |
| First tally dates | Admin-configured S-Tier, A-Tier and B-Tier timestamps. Future dates can change independently, with overlap checks at deployment and on every update. |
| Initial window | Shared first-window duration. |
| Maximum windows | Includes the initial window; durations halve and must remain positive. |
| Registration deadline | First ballots until S's latest possible settlement (`registrationDeadline`); replay accepts one only before S actually settles. Minting and burning close at the end of S's first window (`mintDeadline`). |
| Pool | One admin-recorded USD budget. It can be corrected in either direction strictly before S's first tally, then only increases. Initial funding must be recorded strictly before S's first tally. Funding must be secured separately. |
| Initiatives | Permanent numeric IDs; accounts, goals, RFP status and affiliations can be corrected outside scheduled quiet-ending spans. |
| Donations | Actual native/ERC-20 balances at each project address, for allowed currencies only. |
| Pledges | Admin-recorded outstanding amounts keyed by unique pledge IDs; updatable and cancellable. |
| Checkpoints | Derived from canonical on-chain history; no checkpoint publication or approval. |

Role administration uses OpenZeppelin AccessControl. The deployment admin initially
holds DEFAULT_ADMIN_ROLE, ADMIN_ROLE, PLEDGE_ROLE and MINTER_ROLE, and can
grant/revoke them independently. ADMIN_ROLE controls
setup and the USD pool budget; PLEDGE_ROLE controls pledges; MINTER_ROLE issues internal
NFTs and burns mistaken ones before S's first window ends.
External NFT mode disables internal minting.

## USD accounting API

All USD inputs and results use **six decimal places**: 1,000,000 means one dollar.

- registerCurrency(asset, usdFeed) registers a native/ERC-20 asset before
  voting opens. Asset address zero means native ETH. Asset and feed decimals are
  read and checked; each must be at most 18. A feed must answer a good price when it is
  registered: that answer seeds the stored last price. Currency definitions freeze at opening.
- For an ERC-20, explicitly setting usdFeed to zero selects
  fixed $1 pricing per whole token. Token decimals still apply. Native ETH requires
  a feed. Missing or failed configured feeds never fall back to fixed pricing.
- Currency ID 0 is the virtual USD accounting unit, not a stablecoin or native ETH.
  It supports dollar pledges but never reads account balances. The pool uses the
  same USD precision and is recorded separately.
- addInitiative(account, goalUsd, rfp, groups) and setInitiative(...) configure up to 254
  unique initiative addresses before opening or outside every scheduled quiet-ending span,
  strictly before the hard deadline. Corrections preserve the initiative ID and withdrawal flag. There are at most 32 currencies including USD.
- setInitiativeGroups(id, groups) changes a project's groups (affiliations) whenever
  projects may be added: before opening, or outside every tier's quiet-ending span.
  Ballots are judged when recorded, so a change only applies to ballots sent after it.
- TestUSD (test votes on Sepolia only) is a six-decimal dollar anyone may mint, up to a
  million at a time, to any account; a test round registers it at a fixed $1.
- setPoolUsd(amountUsd) initializes or corrects the total USD pool budget strictly before
  S-Tier's first tally. Any value is accepted then, so a mistyped total can be lowered.
  After that tally, increases use proposePoolUsd(amountUsd) followed by
  activatePoolUpdate(nonce) in a later block; direct increases revert with PoolUpdatePending,
  and decreases revert with PoolCannotDecrease. The first call sets
  poolInitialized and must be strictly before firstTallyAt(0); otherwise it reverts
  with InitialFundingTooLate. An explicit zero also initializes. Funding never
  changes dates. Later increases remain allowed strictly before hardDeadline.
  A proposal may be replaced or cancelled with cancelPoolUpdate(nonce). A stale nonce
  cannot activate a replacement; activation rechecks funding deadlines and the increase-only
  rule. Proposals and cancellations do not affect replay; only PoolUsdSet does.
  PoolUsdSet records previous and new totals for replay. This is a funding assertion,
  not custody or conversion.
- setDates(opensAt, firstTallyAt) lets ADMIN_ROLE change future dates independently.
  Opening must not follow S; A must be at or after S's maximum possible ending, and
  B at or after A's. These same checks run at deployment. Changed dates must be in
  the future. Opening locks once voting starts; each funded tier's first tally locks
  when it occurs. setSchedule(schedule) can also correct window lengths and maximum
  windows before opening, recalculating every derived deadline atomically. Window
  parameters freeze at opening.
- Without funding, no tally can settle and registration, receipts, minting and
  pledges remain open. If S's date passes, an admin must explicitly set a valid future
  S date before initializing funding. Registration closes at S's latest possible
  settlement (replay: when S settles) and minting at the end of S's first window;
  hardDeadline is B plus the maximum tier duration. ScheduleConfigured
  records the initial dates and every valid update for replay.
- setPledge(pledgeId, initiativeId, currencyId, amount) creates or replaces a pledge.
  Reusing an ID replaces its previous contribution; amount zero cancels it.
- quoteUsd(currencyId, amount) converts a quantity using its fixed-dollar rule or
  latest good Chainlink USD price (see "Prices never block" below). Fixed-dollar accounting
  ignores depegs; an asset
  with its own market-price feed can reflect them.
- poolUsd() returns the recorded USD budget, independently of prices, project
  support or feed availability. After registration, replay adds each increase equally
  to accepted registered NFTs' remaining shares without changing settled charges.
- priceUsd(currencyId) returns the price a conversion would use now.
- initiativeUsd(initiativeId) returns (donatedUsd, pledgedUsd, totalUsd, askUsd): donated USD,
  pledged USD, their total, and the ask, max(dollar goal minus total support, zero). It never
  reverts on a price or a balance.
- initiativeCurrencyAmounts(...) exposes the underlying donated and pledged quantities.

**Prices never block.** A feed answer is good when the read succeeds, the round is not 0, the
answer is positive and fits a uint192, `updatedAt` is not 0 and not after the block's time, and
the feed's decimals are unchanged. Its age never matters: Chainlink's latest answer is used as
it stands. A feed that is not good (reverting, malformed, codeless, zero or negative answer,
changed decimals) falls back to the stored last price: the last good answer the contract saw,
written when a recorded ballot reads a newer good answer (event `PriceStored`) and seeded at
registration. Feed and token reads are staticcalls capped at 50k gas that copy only the
bytes they expect (32, or 160 for a feed answer), so a malformed, reverting, codeless or
blob-returning feed or token never reverts a ballot or a view; a token whose balance
read fails counts as $0. Conversions round down; donation and pledge components are valued
separately; sums saturate instead of overflowing.

Donations mean the entire allowed-currency balance at a project address. Withdrawals
or spending lower that balance. The admin must cancel/reduce a pledge when it becomes
a donation to avoid counting both. The contract cannot infer that relationship.
Likewise, transfers from the pool to a project must not be counted a second time as
outside support by a later settlement process.

These are **live block-state views**, not final results or arbitrary timestamp lookups.
To reproduce a historical checkpoint, call them at the canonical prefix block using
an archive RPC block tag. That recovers historical balances, pool/pledge state and
oracle state together. An old oracle round alone cannot recover old balances.
A fallback uses the stored last price as of the selected block.
All tallies use the ordinary [cutoff rules](docs/quiet-ending-rules.md#checkpoints-derived-from-on-chain-data):
the last canonical block strictly before the tally timestamp. In-window tallies
are taken at each block that holds a [tally event](docs/quiet-ending-rules.md#tally-events).
No funds are transferred or custody/payout mechanism supplied by these accounting views.

### Admin corrections and replay

New deployments expose `configRevision` and emit `ConfigurationChanged` for configuration
edits. Admin → Vote offers reviewed Safe Transaction Builder batches. Each batch checks
`requireConfigRevision` before its edit, so a batch prepared against stale settings cannot
silently overwrite a later correction. Pool proposals, cancellations and activations also
advance this revision. No transaction is sent by the site.

- `setCurrency(id, usdFeed, disabled)` corrects pricing or enables/disables an existing
  currency before opening. IDs, tokens and token decimals never change. Disabled entries
  retain their pledge quantities but contribute no donations or pledges; cancellations
  remain possible. Virtual USD cannot be disabled. Replacing a feed validates it and resets
  its cached fallback price, even if the new feed's timestamp is older. Disable a wrong
  token and register its replacement under a new ID.
- `setGroupName(id, name)` and `setBaseURI(uri)` remain available after opening and closing.
  Names and metadata cannot change group membership or voting rights.
- Initiative edits retain earlier ballots. The site refuses edits of funded or covered
  initiatives after settlement; the receipt contract does not store settlement and cannot
  enforce that restriction. Even a direct edit cannot rewrite replay's settled awards or
  voter charges. A corrected account switches the balance counted; it moves no funds.

The server refreshes changed configuration automatically. An existing initiative keeps its
board identity by chain, round contract and numeric ID, regardless of account changes.
Configuration, ballot logs and accounting reads share one pinned chain head. A canonical
block anchors cached configuration, detecting reorgs even when the revision number is unchanged.
The standalone replay refreshes configuration from the chain as well, including historical
`--at` requests; board labels are optional for newly discovered IDs.

Historical asks still come from `initiativeUsd(id)` at the requested block. Donation scans
follow the account periods in `InitiativeConfigured` history, watching only the addresses
active in each period. Configuration edits are discovered as accounting events. Cached
balance scans are separated by configuration revision and anchor; hash-keyed finalized
raw block states remain reusable. Settlements are always derived again; saved results cannot override replay.

### Ethereum mainnet currencies

[config/mainnet.json](config/mainnet.json) supplies the asset and usdFeed
arguments for registerCurrency on chain ID 1. Register each entry before opening;
the file itself does not submit transactions or configure the existing application API.
Native ETH uses asset address zero; virtual USD remains the separate currency ID 0.

| Currency | Chainlink USD feed |
| --- | --- |
| ETH | 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419 |
| USDC, USDT, DAI, USDS, crvUSD, BOLD, fxUSD | None: explicitly fixed at $1 per token |
| EURC | 0xb49f677943BC038e9857d61E7d053CaA2C1734C1 (EUR/USD) |
| ZCHF | 0x449d117117838fFA61263B61dA6301AA2a88B13A (CHF/USD) |

USD stablecoins use zero feed addresses, matching the website's fixed-dollar policy:
this does not detect a token depeg. ZCHF uses the website's CHF/USD feed, assuming
one ZCHF equals one CHF; it does not measure ZCHF's market price. EURC uses the
website's fiat EUR/USD feed, assuming one EURC equals one EUR; it does not detect
an EURC depeg. The pool is recorded directly in USD. Virtual USD remains
separate from every token balance.

All ten website assets fit within the 32-currency limit (11 entries including virtual
USD). Register them before opening: both registration and feed corrections freeze at
opening. Only balances in each registered initiative account on this chain count.
Additional assets increase ballot gas and replay reads; the three-currency gas fixture
does not establish the cost of the full preset.

All three configured feeds report eight decimals. A late answer is still used;
the contract has no price-age limit and falls back to the last stored good answer
when a feed fails. The website instead rejects stale feed answers.
Addresses, decimals and descriptions were checked against mainnet and the
[Chainlink feed directory](https://reference-data-directory.vercel.app/feeds-mainnet.json).
Recheck feed availability before deployment. These are mainnet
addresses and must not be used for Sepolia.

## Receipts, replay and settlement policy

The EIP-712 domain is BlossomBallots version 2. The signed vote binds the NFT ID,
its current owner, nonce and rank bytes to the chain and this contract. Direct
calls, batched signatures and relayed EOA/ERC-1271 signatures are supported, and
every one carries the ballot bytes in calldata, so the contract checks each ballot
against the ballot rules before recording it.
The ordered transcript includes NFT ID and submitting owner. Ballot bytes live in
BallotRecorded events; ballotHashOf and nonceOf identify the latest recorded revision.
Each record must carry nonceOf + 1, so a mistyped nonce reverts instead of locking
the NFT out of later revisions; a batch may carry consecutive revisions of one NFT.

burn(tokenId) lets MINTER_ROLE remove an internal NFT minted by mistake, under the
same cutoff as mint. No tier can settle before that cutoff (the end of S's first window). If the token
already has a receipt, the burn clears it and its ballotHashOf, emits
RegistrationRevoked and appends a revocation record to the transcript, with voter
address zero and the unchanged nonce. Replay must void that token's earlier ballots.
The nonce persists, so a re-minted ID continues its sequence.

hasRegistrationReceipt and registrationReceiptCount describe timely receipts.
They are **not** an accepted-ballot roll. Full replay must account for every
receipt (settlement, burns, revisions) before determining the accepted NFT roll
and tally.

The registry enforces opening, the registration receipt cutoff and the latest possible
scheduled ending. windowDuration, windowCutoff and latestSettlementAt expose the
configured schedule; candidate cutoffs do not assert that a tier stayed open.
Actual early settlement, supporter commitments, and which revisions count remain
properties of deterministic replay, not admin assertions.

The accepted [settlement decision](docs/settlement-policy.md) uses secured USD
funding that may only increase, and locks USD awards and NFT charges at each tier's
settlement tally. Provisional tallies use current project needs; later support
changes do not reprice settled awards. Results may differ from a fresh final-input
PB-EAR tally. The contract enforces increase-only funding, its initial deadline and
nonoverlapping date updates. Settlement awards, NFT
charges and remaining shares belong to deterministic replay, not contract storage.
The rules the replay follows are in [quiet-ending-rules.md](docs/quiet-ending-rules.md):
the ask at a block, a tally with its own asks and pool at every event, settlement from the
cutoff block (the stored record is only a cache), covered projects, and the size minimum.
The staged tally differs from plain PB-EAR only for $0 projects, which it does not fund.
Only the round's chain, each project's registered account and the registered currencies
count; other chains, addresses and tokens never do (an admin may record them as a pledge).

**Signed pledges.** `setPledgeBySig(pledgeId, initiativeId, currencyId, amount, signer,
nonce, deadline, signature)` checks an EIP-712 `Pledge` signature in the round's domain
against the named `signer` (`SignatureChecker`: an EOA's ECDSA or a smart wallet's
ERC-1271), requires `signer` to hold PLEDGE_ROLE, takes the signer's next consecutive nonce
and a deadline, and does what `setPledge` does (same `PledgeSet`). The site signs with deadlines of 10 minutes and records
a pledge only once the chain has it; during the real vote admin pledges are on-chain only.

**Build settings.** The contract compiles with `via_ir` (see foundry.toml) to stay under
the EIP-170 size limit; `test/Size.t.sol` keeps it under 24,576 bytes.

Payout integration and the frontend are still subsequent work. The contract tests mock
price feeds; they are not live Sepolia tests.

### Replay the round yourself

Anyone with an archive RPC gets the site's results from the chain alone: no site
database, no keys. From the repository root, with Deno:

    deno task vote:replay --rpc <archive RPC URL>

It runs the same replayer as the site (`shared/vote/replay-round.ts`): it reads every
ballot, checks them against the contract's `transcript`, `recordCount` and
`ballotHashOf`, reads each project's ask and the pool at every tally block, and
replays the quiet ending. It prints each tier's status, window, funded projects with
their awards and covered projects, then the transcript check and the head block.
By default it replays the round the site runs (its public `/api/vote/manifest`, which
the site reads from the round's contract; `--site <url>` for another site).
`--manifest <file>` replays another round (a manifest JSON), `--at <unix seconds>`
replays it as of that time, and `--json` prints `{round, transcript, head}`: `round` is
the replay part of `/api/vote/round`, all of it but the what-ifs the site adds
(`live.next`, `live.threat` with `null` for no threat found, `live.give` and `final`).

The transcript check proves that the ballots counted are exactly those the contract
recorded: their number matches `recordCount`, their order and content match `transcript`,
and each NFT's latest ballot matches `ballotHashOf`, so nothing is added, dropped or
reordered. That replay must equal the same part of what `/api/vote/round` returns, so
anyone can compare the site's results with their own replay; a difference is a bug in one
of them.

A read the node can't serve (a pruned node, no past state) or a
transcript mismatch exits 1 with the error.

## Run the checks

From this folder with Node.js/npm, Python 3, Bun and Foundry installed:

    npm ci --ignore-scripts
    npm test
    python3 -m unittest discover -s reference -p 'test_*.py'
    bun test test/pbear.test.ts

The Python and JavaScript checks need no extra packages. Foundry uses Solidity
0.8.28 and Cancun. npm installs dependencies into the ignored node_modules folder;
Foundry resolves them through foundry.toml. npm test runs forge test, and npm run build
runs forge build. Commit the package manifest and lockfile, not node_modules.

The dependency versions preserve the previously used sources:

- OpenZeppelin Contracts 5.7.0, from the official npm package.
- forge-std 1.16.2, from the official repository archive at revision
  bf647bd6046f2f7da30d0c2bf435e5c76a780c1b.

The voting package is independent of the parent app's Deno dependencies.
Existing simulations remain available:

    python3 reference/quiet_ending_sim.py 30
    python3 reference/withhold_sim.py 30

## Sources

References adapted from [ranked-shares](https://github.com/sembrestels/ranked-shares)
revision c4b8cf64a9492fb305558f4a850c3adc00e7758e and working-copy quiet-ending
documentation. The contracts have since been extended locally. There is no runtime
dependency on that checkout.

Oracle interface and historical-state considerations:
[Chainlink API](https://docs.chain.link/data-feeds/api-reference) and
[historical rounds](https://docs.chain.link/data-feeds/historical-data).

## Ballot rules (rounds deployed from 11 November 2026)

A ballot is valid only if (docs/superpowers/specs/2026-11-11-ballot-rules-design.md):

- its ranked projects ask for at least min(1.5× the pool, the sum of every project's ask)
  (the placed asks satisfy `2 × Σ askUsd ≥ 3 × poolUsd`, or every project left out asks $0;
  owner's decision, Nov 15, 2026; sums saturate; a project's
  ask is its goal less its donations and open pledges, `initiativeUsd(i).askUsd`, and the pool
  is `poolUsd`, both on-chain at the block that records the ballot);
- S-Tier (its first rank group; also A-Tier when `independentTiers` has bit 1) holds at
  least 3 projects with no shared affiliation, and no affiliation holds more than half of the
  tier's total registered funding goals (a $0-ask project still counts toward independence
  and contributes its full goal to the affiliation totals). RFPs have no
  affiliations; B-Tier is never checked;
- it has at most three rank groups.

Affiliated Initiatives' combined funding goals must not exceed half of the total funding
goals of all Initiatives in a ballot's S-Tier. The same limit applies to A-Tier when enforced.
Donations, pledges and price changes affect live asks and funding, but do not change the
affiliation share of an unchanged tier (owner's decision, Nov 17, 2026).

Affiliations are registered as groups (`addGroup`, a `groups` bitmask per initiative). The
contract checks every ballot with a proof: three unrelated project indexes per enforced
tier, sent alongside the ballot and not signed. The contract is the only judge: the replay
does not re-judge the rules but checks the contract's `transcript`, `recordCount` and
`ballotHashOf` at each block it uses, and counts only the ballots the contract committed
to (rounds deployed before 14 November 2026 are checked with the earlier transcript
formula). A project's ask can move between a ballot's checks and its recording block, so
the round's `asks` (read from `initiativeUsd`) are what the page and the relay pre-check
with; only the recording block decides. New projects may join during the vote outside
every tier's quiet-ending span; a ballot shorter than the project list reads the missing
ones as unplaced. The Python reference is `reference/ballot_rules.py`, kept equal to the
TypeScript and Solidity versions by `shared/vote/fixtures/ballot-rules.json`.

### Finality, diagnostics and reference checks

Logical tier settlements take effect at their cutoffs. The results label them as awaiting chain
finality until the RPC's finalized block reaches that cutoff. No elapsed-time rule promotes a result
to final. Historical input caches are bound to canonical block hashes, and settlement/result
snapshots are not replay inputs.

`valuationDiagnostics(initiativeId)` exposes four bits per currency ID: stored price (1), failed
balance read (2), changed token precision (4), unavailable precision (8). These explain the
contract's valuation without changing it. The API serves evidence at the head and settlements; the
results' Funding details expose the same evidence. This view requires the updated contract; existing
deployments remain replayable and are explicitly marked when diagnostics are unavailable.

Regenerate the complete-history parity fixtures from the repository root:

    python3 vote/reference/export_scheduled_fixtures.py > shared/vote/fixtures/scheduled-replay.json
    python3 -m unittest discover -s vote/reference -p 'test_scheduled_replay.py'

The [voting rules](docs/quiet-ending-rules.md) specify cumulative share rounding and firm awards,
including how later support can leave gaps or excess coverage.
