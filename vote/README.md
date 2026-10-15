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
| [config/mainnet.json](config/mainnet.json) | Ethereum mainnet registration inputs: ETH/USD, fixed-dollar USDC and EURC/USD. |
| [shared/pbear.ts](shared/pbear.ts) | Integer-exact tally, transcripts and public replay. |
| [shared/ranks.ts](shared/ranks.ts) | Rank validation, packing and withholding marker 255. |
| [reference/pbear.py](reference/pbear.py) | Original Python tally, using only the standard library. |
| [reference/withhold.py](reference/withhold.py) | Withholding reference and comparison with padded original ballots. |
| [reference/quiet_ending_steps.py](reference/quiet_ending_steps.py) | Earlier quiet-ending models. |
| [reference/quiet_ending.py](reference/quiet_ending.py) | Earlier models and helpers still used by simulations. |
| [docs/quiet-ending.md](docs/quiet-ending.md) | Mechanism overview. |
| [docs/quiet-ending-rules.md](docs/quiet-ending-rules.md) | Detailed requirements, derived checkpoints, acceptance and remaining algorithm questions. |
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
| Voting unit | One ballot and one nonce sequence per NFT ID; owners of multiple NFTs can vote each independently. |
| Ownership | Only the current owner can authorize a revision. Token approvals do not grant voting permission. Transfers preserve the token's nonce and registration receipt. |
| Initial date | Voting opens at the configured timestamp. |
| First tally dates | Admin-configured S/A/B timestamps. Future dates can change independently, with overlap checks at deployment and on every update. |
| Initial window | Shared first-window duration. |
| Maximum windows | Includes the initial window; durations halve and must remain positive. |
| Registration deadline | Always first S tally plus the initial window. |
| Pool | One admin-recorded USD budget, which can increase but never decrease. Initial funding must be recorded strictly before S's first tally. Funding must be secured separately. |
| Initiatives | Unique project addresses and dollar asks, frozen when voting opens. |
| Donations | Actual native/ERC-20 balances at each project address, for allowed currencies only. |
| Pledges | Admin-recorded outstanding amounts keyed by unique pledge IDs; updatable and cancellable. |
| Checkpoints | Derived from canonical on-chain history; no checkpoint publication or approval. |

Role administration uses OpenZeppelin AccessControl. The deployment admin initially
holds DEFAULT_ADMIN_ROLE, ADMIN_ROLE, PLEDGE_ROLE, MINTER_ROLE and
BLOB_SUBMITTER_ROLE, and can grant/revoke them independently. ADMIN_ROLE controls
setup and the USD pool budget; PLEDGE_ROLE controls pledges; MINTER_ROLE issues internal
NFTs before registration closes; BLOB_SUBMITTER_ROLE permits hash-only blob receipts.
External NFT mode disables internal minting.

## USD accounting API

All USD inputs and results use **six decimal places**: 1,000,000 means one dollar.

- registerCurrency(asset, usdFeed, maxPriceAge) registers a native/ERC-20 asset before
  voting opens. Asset address zero means native ETH. Asset and feed decimals are
  read and checked; each must be at most 18. Currency definitions freeze at opening.
- For an ERC-20, explicitly setting both usdFeed and maxPriceAge to zero selects
  fixed $1 pricing per whole token. Token decimals still apply. Native ETH requires
  a feed. Missing or failed configured feeds never fall back to fixed pricing.
- Currency ID 0 is the virtual USD accounting unit, not a stablecoin or native ETH.
  It supports dollar pledges but never reads account balances. The pool uses the
  same USD precision and is recorded separately.
- addInitiative(account, askUsd) and setInitiative(...) configure up to 254 unique
  initiative addresses before opening. There are at most 32 currencies including USD.
- setPoolUsd(amountUsd) initializes or increases the total USD pool budget.
  Decreases always revert with PoolCannotDecrease. The first call sets
  poolInitialized and must be strictly before firstTallyAt(0); otherwise it reverts
  with InitialFundingTooLate. An explicit zero also initializes. Funding never
  changes dates. Later increases remain allowed strictly before hardDeadline.
  PoolUsdSet records previous and new totals for replay. This is a funding assertion,
  not custody or conversion.
- setDates(opensAt, firstTallyAt) lets ADMIN_ROLE change future dates independently.
  Opening must not follow S; A must be at or after S's maximum possible ending, and
  B at or after A's. These same checks run at deployment. Changed dates must be in
  the future. Opening locks once voting starts; each funded tier's first tally locks
  when it occurs. Window lengths and maximum windows remain fixed.
- Without funding, no tally can settle and registration, receipts, minting and
  pledges remain open. If S's date passes, an admin must explicitly set a valid future
  S date before initializing funding. Registration always closes at S plus the
  initial window; hardDeadline is B plus the maximum tier duration. ScheduleConfigured
  records the initial dates and every valid update for replay.
- setPledge(pledgeId, initiativeId, currencyId, amount) creates or replaces a pledge.
  Reusing an ID replaces its previous contribution; amount zero cancels it.
- quoteUsd(currencyId, amount) converts a quantity using its fixed-dollar rule or
  latest valid Chainlink USD price. Fixed-dollar accounting ignores depegs; an asset
  with its own market-price feed can reflect them.
- poolUsd() returns the recorded USD budget, independently of prices, project
  support or feed availability. After registration, replay adds each increase equally
  to accepted registered NFTs' remaining shares without changing settled charges.
- initiativeUsd(initiativeId) returns donated USD, pledged USD, their total, and
  max(dollar ask minus total support, zero).
- initiativeCurrencyAmounts(...) exposes the underlying donated and pledged quantities.

Nonzero amounts in feed-priced currencies require a positive, timely oracle answer. Missing,
future-dated, stale or precision-changing data reverts instead of excluding an asset
silently. Token precision changes also revert for fixed-dollar currencies.
Conversions round down; donation and pledge components are valued separately.

Donations mean the entire allowed-currency balance at a project address. Withdrawals
or spending lower that balance. The admin must cancel/reduce a pledge when it becomes
a donation to avoid counting both. The contract cannot infer that relationship.
Likewise, transfers from the pool to a project must not be counted a second time as
outside support by a later settlement process.

These are **live block-state views**, not final results or arbitrary timestamp lookups.
To reproduce a historical checkpoint, call them at the canonical prefix block using
an archive RPC block tag. That recovers historical balances, pool/pledge state and
oracle state together. An old oracle round alone cannot recover old balances.
The configured maxPriceAge is evaluated against the selected block's timestamp.
All tallies use the ordinary [cutoff rules](docs/quiet-ending-rules.md#checkpoints-derived-from-on-chain-data):
the last canonical block strictly before the tally timestamp.
No funds are transferred or custody/payout mechanism supplied by these accounting views.

### Ethereum mainnet currencies

[config/mainnet.json](config/mainnet.json) supplies the asset, usdFeed and maxPriceAge
arguments for registerCurrency on chain ID 1. Register each entry before opening;
the file itself does not submit transactions or configure the existing application API.
Native ETH uses asset address zero; virtual USD remains the separate currency ID 0.

| Currency | Chainlink USD feed | Maximum price age |
| --- | --- | --- |
| ETH | 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419 | 2 hours |
| USDC | None: explicitly fixed at $1 per token | Not applicable |
| EURC | 0x04F84020Fdf10d9ee64D1dcC2986EDF2F556DA11 | 25 hours |

USDC uses a zero feed address and zero maxPriceAge, matching the existing app's
fixed-dollar policy for donations and pledges. The pool is recorded directly in USD.
Other USD stablecoins can be registered the same way; this preset currently includes
only ETH, USDC and EURC. Virtual USD remains separate from every token balance.

Both configured feeds report eight decimals. Their published heartbeats are
1 hour for ETH and 24 hours for EURC; age limits include a delay margin.
Addresses, decimals and descriptions were checked against mainnet and the
[Chainlink feed directory](https://reference-data-directory.vercel.app/feeds-mainnet.json).
Recheck feed availability and freshness limits before deployment. These are mainnet
addresses and must not be used for Sepolia.

## Receipts, replay and settlement policy

The EIP-712 domain is BlossomBallots version 2. The signed vote binds the NFT ID,
its current owner, nonce and rank bytes to the chain and this contract. Calldata,
relayed EOA/ERC-1271 signatures and authorized blob submissions are supported.
The ordered transcript includes NFT ID and submitting owner. Ballot bytes live in
events or blobs; ballotHashOf and nonceOf identify the latest recorded revision.

hasRegistrationReceipt and registrationReceiptCount describe timely receipts,
including unvalidated blobs. They are **not** an accepted-ballot roll. Full replay
must validate blob contents and account for every receipt before determining the
accepted NFT roll and tally.

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
charges and remaining shares belong to deterministic replay, not contract storage;
that replay and precise quiet-comparison thresholds remain to be implemented.

The complete replay checker, versioned .pb blob codec, retention policy, deployment
tooling, payout integration and frontend are still subsequent
work. The contract tests mock price feeds and blob hashes; they are not live Sepolia tests.

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
