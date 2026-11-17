# Application security review — Nov 17, 2026

## Executive assessment

**Two Medium findings remain open in the full application at `b471ac5`.** A badge owner can make the ballot relayer sponsor an expensive ERC-1271 signature, and a third-party donation can strand an otherwise valid settled S-Tier, preventing changes to later tiers. Both findings have executable local counterexamples. No Critical or High finding was established within the reviewed scope; that is not an assurance that none exists.

This is a whole-application source assessment, not a review of the commit's ballot-error wording alone. The October fixes remain present and their regressions pass. Existing suites pass **638 API tests with eight steps, 1,632 frontend tests and 167 contract tests**. Both type checks, lint, build/prerender and the two dependency audits also pass. Four additional defect probes reproduce the findings. Passing functional tests do not close either finding.

**Reviewed commit:** `b471ac5ee3430fb344128850cc1a6d5ef204a75b`  
**Git tree:** `7bc010d74b686709ff2ece4e48f8d402a63ec60b`  
**Status:** source review complete; remediation and deployment verification outstanding.

## Scope and evidence boundaries

The review used a separate `git archive` snapshot. All 996 tracked file contents were checked against the requested commit after verification, with no differences. Existing working-tree edits, untracked files and local credentials were excluded. Application code was not changed.

The source review covered the browser/API trust boundary; SIWE, cookies and session lifecycle; administrator membership and recent-authentication gates; initiative ownership, private fields and moderation; comments and reviews; uploads, outbound fetches and ENS; donations, Safe receipt verification and pledges; backup/export boundaries; voting manifests, relaying, chain-state replay, quiet endings and first-party voting contracts; frontend rendering and private caches; and dependency/CI configuration. Review depth concentrated on authorization, irreversible or sponsored actions, and the newer voting subsystem. The available security guidance supplied JavaScript/React and general OWASP references, but no Hono/Deno- or Solidity-specific checklist; those components were assessed from repository source, invariants and local counterexamples. The [source fingerprints](source-fingerprints.json) identify the snapshot, not a claim of exhaustive line-by-line verification of every file.

Attacker capabilities considered include anonymous API access, an ordinary signed-in wallet, a legitimate badge held by attacker-controlled smart-wallet code, arbitrary transfers to public initiative addresses, and hostile user content. Administrators, deployed contract configuration, price feeds, RPC/indexing providers and embedded-wallet infrastructure remain explicit trust boundaries.

All application probes used local fixtures, in-memory KV, synthetic RPC responses or Foundry's local EVM. No production login, upload, administration, on-chain transaction, donation, load test or deployment was performed. Only dependency advisory services and public standards documentation were consulted remotely. This report does not attest deployed bytecode, a live round's configuration, production balances, provider correctness or operational controls. It is not a formal smart-contract audit or an ASVS certification.

## Finding summary

| ID | Severity | Finding | Prerequisite | Status |
|---|---|---|---|---|
| NOV-01 | Medium | Ballot sponsorship has no gas/spend ceiling for owner-supplied signature code | Valid badge controlled by a malicious contract wallet; funded relay | Open |
| NOV-02 | Medium | Live affiliation checks can invalidate an immutable settled tier | An eligible settled tier near the concentration limit; a later donation changes its asks | Open |

### NOV-01 — Bound sponsored ERC-1271 execution and transaction cost

**Classification:** CWE-400, uncontrolled resource consumption; ASVS v5.0.0-15.2.2, with related anti-automation coverage in v5.0.0-2.4.1.  
**Affected source:** [`api/services/vote-chain.ts`](../../../api/services/vote-chain.ts), lines 245–255 and 294–320; [`api/routes/vote.ts`](../../../api/routes/vote.ts), lines 584–741; [`SignedBallots.sol`](../../../vote/contracts/SignedBallots.sol), lines 290–306.

The public ballot endpoint correctly requires badge ownership and an owner-valid signature. For a contract owner, however, `verifyContractVote()` invokes that owner's `isValidSignature()` without a gas budget. `send()` then leaves `recordFor` gas and fee selection to the RPC/wallet client. Only `mint` has an explicit gas limit. The contract's signature check executes the same owner-supplied code, so an attacker can return the correct ERC-1271 magic value after deliberately consuming millions of gas.

The real-round balance floor of 0.01 ETH and five relays per badge limit eligibility and transaction count, not the cost of an individual transaction. The shared relayer lease prevents nonce collisions but provides no cost ceiling. A legitimate badge holder can spend a disproportionate share of the sponsor's balance, stopping subsidized voting for other participants once the floor is reached. Self-funded voting remains available. This finding does not bypass ownership or authorize access to grant funds.

**Local evidence.** The [Solidity probe](evidence/RelayerGas.repro.t.sol) transfers a fixture badge to a wallet whose ERC-1271 method burns eight million gas before returning the valid magic value. The actual `recordFor()` call succeeds, updates the nonce and ballot hash, and consumes **8,204,203 gas measured around the call**. Separately, the [API probe](evidence/relayer-gas.repro.test.ts) uses the real Hono route and locked viem signing path with a synthetic RPC. An 8,200,000-gas estimate is accepted; the route returns 200 and the decoded signed transaction contains `recordFor`, gas `8200000` and `maxFeePerGas` `2200000000`. This establishes an unbounded sponsorship decision in the application and a feasible expensive signature in the contract. It is not a live-network transaction or a measurement of a provider's call limits. See [contract output](evidence/relayer-gas-contract.txt) and [API output](evidence/local-reproductions.txt).

**Recommended change.** Apply explicit limits to sponsored gas, fee rate and total maximum transaction cost before signing, with a bounded contract-signature preflight. Enforce the final limits at the common send boundary so re-estimation or alternate callers cannot bypass them. Reject transactions outside the sponsorship policy with the existing self-send option. Calibrate the policy against legitimate large ballots and supported multisigs: the repository's 80-project gas test already allows up to three million gas, so a small generic transfer limit would reject valid ballots. A per-badge quota remains useful but is not a substitute for a cost budget.

**Retest acceptance.** A gas-burning owner must not cause the relayer to sign an over-budget transaction. Test high RPC estimates, high fee quotes, estimation/preflight failures and state-dependent ERC-1271 behavior; verify total maximum cost at signing. Ordinary owners, supported multisigs and the largest supported valid ballot must still work within the chosen policy. No remediation was applied in this review.

### NOV-02 — Preserve the admissibility of an unchanged settled tier

**Classification:** CWE-841, improper enforcement of behavioral workflow; ASVS v5.0.0-2.3.2.  
**Affected source:** [`SignedBallots.sol`](../../../vote/contracts/SignedBallots.sol), lines 369–397 and 450–468; [`RoundAccounting.sol`](../../../vote/contracts/RoundAccounting.sol), lines 558–578 and 617–644; [`rules.ts`](../../../shared/vote/rules.ts), lines 98–138; [`quiet-ending.ts`](../../../shared/vote/quiet-ending.ts), lines 226–235 and 442–455; [`api/routes/vote.ts`](../../../api/routes/vote.ts), lines 623–658.

Each revision rechecks the affiliation concentration rule using current asks: goals less live donations and open pledges. The check applies to every enforced tier, including a settled one. Independently, quiet-ending replay requires the settled tier's set of projects to remain unchanged. A donation to a project outside an affiliation can reduce that tier's total ask without reducing the affiliation's ask. A formerly valid settled tier then exceeds the 50% concentration limit, and the voter cannot repair its membership without violating the settlement rule.

This is a cross-rule liveness defect even though each component follows its documented rule. The [ballot design](../../superpowers/specs/2026-11-11-ballot-rules-design.md) explicitly preserves later voting when a settled project is withdrawn; an equivalent preservation rule is missing for donation-driven concentration changes. The failure can arise innocently or be induced by a third party who needs neither a badge nor an administrator session.

**Concrete counterexample.** A $300,000 pool has five projects with asks of $100,000, $50,000, $50,000, $100,000 and $100,000. Only the first project belongs to the tested affiliation. A valid ballot places the first three projects in S-Tier, the fourth in A-Tier and the fifth in B-Tier. After S-Tier settles, a donor sends one dollar of a registered fixed-price token to the second project. S-Tier's total ask becomes $199,999 while the affiliation still asks $100,000, exceeding half. Swapping the A-Tier and B-Tier choices now fails despite preserving the settled set. Adding the fourth project to S-Tier repairs concentration but changes the settled set and is rejected by replay.

The one-dollar example requires a tier exactly at the limit; a tier farther below the limit requires a larger change. The finding does not imply that every ballot is affected. It blocks ballot revisions while the incompatible state persists; a later change in support could restore validity. Earlier accepted ballots and settled awards are retained. Direct self-submission does not solve the conflict because contract validation and authoritative replay enforce the two opposing requirements. Other participants can continue changing later choices, potentially affecting the later outcome while the affected voter cannot respond.

**Local evidence.** The [Solidity probe](evidence/SettledDonation.repro.t.sol) records the valid ballot, advances past the first quiet window, performs an actual local token transfer, and observes `GroupOverHalf(0, 0)` when only later choices change. Its repaired ballot succeeds on-chain. The complementary [TypeScript probe](evidence/settled-donation.repro.test.ts) proves S-Tier has settled, confirms that the intended revision satisfies the frozen-set rule but fails the shared concentration rule, and demonstrates rejection of the repaired ballot with `tier_settled`; accepted nonce 1 remains in force. See [contract output](evidence/settled-donation-contract.txt) and [replay output](evidence/local-reproductions.txt).

**Recommended change.** Define a protocol-level rule that preserves admissibility of an authenticated unchanged settled prefix. Options include preserving the validation inputs for that prefix, safely grandfathering its previously accepted membership through a settlement-aware mechanism, or adopting an agreed immutable basis for concentration. Any choice must agree across contract validation, shared rules, authoritative replay and the UI. Merely suppressing a frontend error or dropping contract checks would not fix the inconsistency and could create a new bypass.

**Retest acceptance.** After S-Tier settles, donation, pledge and price changes must not prevent a valid edit confined to still-open tiers. Cover the equivalent case after A-Tier settles when its constraints are enforced, exact and near-threshold concentrations, withdrawals and appended projects. Actual settled-set changes must still be rejected, and an invalid unsettled tier must not receive an unintended exemption. No remediation was applied in this review.

## Earlier findings and retained decisions

The [October closure](../retest-2026-10-07/report.md) remains supported in the reviewed source: server ENS uses `ccipRead: false` and its gateway regressions pass; private fields use the owner/recent-admin policy and its negative cases pass; administrator membership updates retain CAS retry/revocation behavior and concurrency regressions pass; and the locked dependency advisory gate is clean. These are source observations, not renewed production verification.

September's accepted observe-mode rate limiting, edge redirect behavior, SIWE authentication profile and logging/retention decisions remain historical context. Fresh SIWE proves current key possession, not an independent authentication factor. Production proxy/IP enforcement, provider assurance, backup recovery, external alerting and log retention were not independently verified here. Those earlier decisions do not accept or close NOV-01 or NOV-02.

The CI workflow runs the application suites but has no Foundry contract test or contract-package audit step. Both were run manually for this assessment. Adding them would make the existing contract coverage a repeatable release gate; it would not by itself catch the two uncovered interactions. Browser/provider integration and production capacity remain additional assurance gaps.

## Verification and control coverage

The [verification record](verification.md) includes commands, runtime versions, audit results and environment limitations. Deno's Vitest launch failed with a local child-process descriptor error; the same installed Vitest suite passed under Node. The build initially hit the sandbox's local-listener restriction and then passed when rerun with that restriction lifted. These are recorded as harness deviations, not silently reported as exact CI execution.

The [control matrix](control-matrix.md) retains the earlier reports' 253 cumulative L1/L2 requirements from [OWASP ASVS 5.0.0](https://asvs.owasp.org/): **26 PASS, 37 PARTIAL, two FAIL, two historical ACCEPTED EXCEPTION and 186 NOT REASSESSED**. Requirements outside the evidence remain NOT REASSESSED; historical production observations are not current passes. Counts are coverage bookkeeping, not a compliance percentage. ASVS also does not replace protocol-specific voting and smart-contract reasoning.

- [Verification commands and results](verification.md)
- [ASVS matrix](control-matrix.md) and [machine-readable matrix](control-matrix.json)
- [Reproduction instructions](evidence/README.md)
- [Source fingerprints](source-fingerprints.json), [dependency inventory](dependency-inventory.json) and [artifact checksums](artifact-sha256.json)
