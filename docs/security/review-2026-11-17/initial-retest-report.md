# Application security review and retest — Nov 17, 2026

## Executive assessment

**Both Medium findings from the full application review at `b471ac5` are fixed in the working tree and closed by local retest.** Ballot sponsorship now has explicit gas and spending limits. Affiliation concentration now uses registered funding goals, so changes in outside support cannot invalidate an unchanged tier's affiliation share after it settles.

The original assessment and its four executable defect probes remain available in [the baseline report](assessment-b471ac5.md). The fixes add regression coverage across the real API signer, contract execution, shared validation, authoritative replay and the Python reference. No Critical or High application finding was established in the original review. This is a source assessment and local retest, not a formal smart-contract audit or ASVS certification.

**Reviewed base commit:** `b471ac5ee3430fb344128850cc1a6d5ef204a75b`  
**Base Git tree:** `7bc010d74b686709ff2ece4e48f8d402a63ec60b`  
**Remediation target:** uncommitted working-tree changes identified in [retest fingerprints](retest-source-fingerprints.json).  
**Status:** NOV-01 and NOV-02 closed in source; changes prepared for commit.

## Scope and evidence boundaries

The original whole-application review used a separate archive whose 996 tracked files matched the requested commit. It covered authentication and sessions; administrator and initiative authorization; private fields and moderation; comments and reviews; uploads, outbound fetches and ENS; donations, Safe receipts and pledges; backup/export boundaries; voting manifests, relaying, chain replay, quiet endings and first-party contracts; frontend rendering and caches; and dependencies/CI. Depth concentrated on authorization, sponsored actions and voting. The commit's ballot-error wording was not the limit of the assessment.

The retest covers the two fixes and their interactions, with the full regression suites run on the current working tree. Existing unrelated work remains present. Baseline fingerprints describe the original archive; retest fingerprints separately identify the current tracked files, added regression sources and remediation patch. Hash coverage identifies tested material, not exhaustive manual review of every line.

All application probes use local fixtures, ephemeral KV, synthetic RPC responses or Foundry's local EVM. No production login, transaction, donation or deployment was performed. Administrators, contract configuration, price feeds, RPC/indexing providers and embedded-wallet infrastructure remain trust boundaries. Live wallet/provider integration, production capacity and operational controls were not independently verified.

## Finding summary

| ID | Severity at discovery | Finding at b471ac5 | Resolution | Retest status |
|---|---|---|---|---|
| NOV-01 | Medium | Owner-supplied signature code could consume unbounded sponsored gas | Bound signature preflight, gas estimation and final signed gas/fees/cost | Closed |
| NOV-02 | Medium | Live affiliation shares could conflict with frozen settled membership | Count registered goals for affiliation concentration; retain live asks for size and funding | Closed |

### NOV-01 — Bound sponsored ERC-1271 execution and transaction cost

**Classification:** CWE-400; ASVS v5.0.0-15.2.2, with related anti-automation coverage in v5.0.0-2.4.1.  
**Fix locations:** [relay policy](../../../api/services/vote-relay-policy.ts), lines 1–31; [chain service](../../../api/services/vote-chain.ts), lines 255–278 and 318–367; [ballot route](../../../api/routes/vote.ts), lines 85–86, 610–621 and 737–752.

**Original defect.** A valid badge owner could supply ERC-1271 code that burns millions of gas before returning a valid signature result. Neither the signature preflight nor sponsored `recordFor` had an application budget. The original EVM probe successfully records a ballot after consuming 8,204,203 gas around the call. The original API probe decodes an actual signed transaction authorizing 8,200,000 gas. Per-badge transaction quotas and the 0.01 ETH relay balance floor did not bound each transaction's cost. This threatened the sponsor's balance and availability, not grant-fund ownership.

**Implemented policy.** Contract-signature preflight is limited to **500,000 gas**. Both sponsored ballot entry points, `record` and `recordFor`, estimate with a **4,000,000-gas ceiling**. Before signing, the estimate receives a 20% margin, capped at that ceiling. The maximum fee rate is **20 gwei**, and `gas × maxFeePerGas` must be no more than **0.005 ETH**. A positive fee quote and a nonnegative priority fee no larger than the maximum fee are required.

The final send boundary explicitly supplies gas and both fee fields to the signer. A later wallet-state change can make the transaction fail, but cannot increase its authorized maximum cost. The implementation uses a direct gas-limited estimate RPC because the locked client's convenience estimation method does not forward that limit. Sponsorship-policy refusals return `relay_budget` with the existing “Send it yourself” path, and do not consume the per-badge relay quota. Signature checks, ownership checks and contract ballot rules remain enforced.

**Retest evidence.** [API regressions](../../../api/tests/vote-relay-budget.test.ts) decode the actual signed transactions for both entry points, assert gas/fees/cost, and verify that the wallet does not re-estimate them. Expensive estimates, high fees, excessive total cost, malformed quotes and estimation failures do not produce a signed transaction. The public route covers bounded-preflight refusal, sponsorship refusal and a subsequent successful ordinary ballot. [EVM regressions](../../../vote/test/RelaySignatureBudget.t.sol) reject the gas-burning signature within the preflight allowance and accept an ordinary ERC-1271 wallet that then records its ballot. The existing 80-project contract gas envelope passes, and a three-million-gas estimate is sponsorable at a fee within the total budget.

**Closure and limits.** Closed for the demonstrated unbounded ballot-sponsorship path. These limits deliberately make sponsorship conditional on cost; valid expensive ballots can use self-funded submission. They do not eliminate all resource consumption or replace quotas. The tests cover an ordinary contract-wallet fixture, not every production multisig or provider configuration.

### NOV-02 — Keep affiliation concentration stable under outside support

**Classification:** CWE-841; ASVS v5.0.0-2.3.2.  
**Fix locations:** [contract group check](../../../vote/contracts/SignedBallots.sol), lines 446–468; [shared validator](../../../shared/vote/rules.ts), lines 98–141; [Python reference](../../../vote/reference/ballot_rules.py), lines 76–113. The voter error copy, agent instructions, fixtures and ballot-rule documentation use the same basis.

**Original defect.** An unchanged settled tier could fail a new concentration check because donations, pledges or prices changed its remaining asks. In the reproduced case, S-Tier held goals/asks of $100,000, $50,000 and $50,000; only the first project belonged to the tested affiliation. A one-dollar donation to the second project raised that affiliation's share of remaining asks above 50%. Swapping later choices failed contract validation, while expanding S-Tier to repair the ratio failed authoritative replay's settled-membership rule. Earlier accepted ballots and awards remained in force.

**Agreed rule.** Affiliated Initiatives' combined funding goals must not exceed half of the total funding goals of all Initiatives in a ballot's S-Tier. Exactly half is allowed. A-Tier uses the same rule when its constraints are enabled. Each affiliation is checked separately; a project with multiple affiliations contributes its full registered goal to each applicable group.

Only the concentration basis changes. The minimum-size rule still counts live remaining asks and requires at least the smaller of 1.5 times the pool and the sum of all available asks. The three pairwise non-affiliated Initiatives requirement remains. Funding still uses live asks. Fully funded and withdrawn projects retain their registered goal for the affiliation calculation; withdrawn projects contribute zero to ballot size. Appending projects does not change an unchanged tier's goal share, although a new revision must still meet the live size rule.

**Practical consequence.** This limits the concentration of registered goals, not remaining asks or actual awards. With $100,000 in affiliated goals and $100,000 in unrelated goals, the share is 50%. If the unrelated projects later receive $50,000, the goal share remains 50%, even though the affiliation represents two-thirds of the remaining $150,000 ask. This is the chosen rule, rather than a hidden exception for settled tiers. Trusted administrative changes to registered goals or affiliations can still change the calculation.

**Retest evidence.** [Contract regressions](../../../vote/test/SettledAffiliations.t.sol) exercise actual token donations, open pledges and feed-price changes while preserving the settled prefix, and the equivalent A-Tier case. [Shared validation/replay regressions](../../../shared/vote/settled-affiliations.test.ts) demonstrate successful later revisions after S-Tier and A-Tier settle, unchanged settled results, and continued rejection of changed settled membership. [API regressions](../../../api/tests/vote-round.test.ts) return 200 for those valid revisions and 409 for settled-set changes. Separate shared/Python/contract tests reject affiliations whose goals exceed half even after their asks fall to zero. Updated cross-language fixtures, withdrawal/addition tests and live-size tests pass. The compiled public contract ABI is unchanged.

**Closure.** Closed for outside-support changes to affiliation concentration. No settlement exemption, deferred validation or replay-protocol change is introduced.

## Earlier findings and retained decisions

The October fixes remain present: ENS gateway reads are disabled, private fields retain owner/recent-admin authorization, and membership updates retain CAS/revocation handling. Their regressions pass. Historical authentication, observe-mode rate limiting and logging/retention decisions remain bounded context, not new production assurance. Fresh SIWE proves possession of a wallet key, not an independent authentication factor.

During retest, the current lockfile had drifted to Zod 3.x despite the existing `^4.6.6` security override. The advisory scan reported [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Resolution was restored to the already-reviewed **4.6.7**, retaining other dependency additions; frozen installation and the final advisory scan pass. This is a dependency-gate repair, not a newly demonstrated application exploit. The original commit's dependency scan was clean.

CI still lacks the separate Foundry test and contract-package advisory steps run manually here. Production proxy/IP enforcement, provider assurance, backup recovery, external alerting and log retention remain outside the verified evidence.

## Verification and control coverage

Full local suites pass: **645 API tests with eight steps, 1,635 frontend/shared tests in 184 files, 173 contract tests in 15 suites, and 217 Python reference tests**. API and frontend type checking, lint (739 files), the public ABI comparison, dependency audits and the final production build/prerender pass. Commands, output and harness limitations are recorded in [the retest record](retest.md).

The updated [control matrix](control-matrix.md) retains the same 253 cumulative L1/L2 requirements: **26 PASS, 39 PARTIAL, two historical ACCEPTED EXCEPTION and 186 NOT REASSESSED**. The two baseline FAIL dispositions move to PARTIAL because the demonstrated defects are fixed, while complete workflow and resource-control assurance exceeds this retest. The [baseline matrix](control-matrix-b471ac5.md) preserves the original findings. These counts are coverage bookkeeping, not a compliance score.

- [Original assessment](assessment-b471ac5.md) and [baseline verification](verification.md)
- [Remediation verification](retest.md) and [reproduction instructions](evidence/README.md)
- [Current ASVS matrix](control-matrix.md) and [machine-readable matrix](control-matrix.json)
- [Baseline fingerprints](source-fingerprints.json), [retest fingerprints](retest-source-fingerprints.json) and [artifact checksums](artifact-sha256.json)
