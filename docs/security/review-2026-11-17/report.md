# Application security review and full ASVS assessment — Nov 17, 2026

## Executive assessment

**All 253 ASVS 5.0.0 L1/L2 requirements now have evidence-linked dispositions. The two original Medium findings and one newly reproduced Low preview-cookie finding are fixed in source.** Four of the six conformance gaps are now remediated. Antivirus remains open as requested; long-lived service credentials remain an operational ASVS gap. Incomplete assurance prevents a Level 1 or Level 2 claim.

Ballot sponsorship has explicit gas and spending limits. Affiliation concentration uses registered funding goals, so changes in outside support cannot invalidate an unchanged tier's affiliation share after it settles. The optional preview cookie now expires on the server and is bound to its origin.

The original assessment and its four executable defect probes remain available in [the baseline report](assessment-b471ac5.md). The fixes add regression coverage across the real API signer, contract execution, shared validation, authoritative replay and the Python reference. No Critical or High application finding was established in the original review. This is a source assessment and local retest, not a formal smart-contract audit or ASVS certification.

**Reviewed base commit:** `b471ac5ee3430fb344128850cc1a6d5ef204a75b`  
**Base Git tree:** `7bc010d74b686709ff2ece4e48f8d402a63ec60b`  
**Remediation target:** integrated source commit ad4b955 (Nexus 334f0d6 and security fixes e123932), identified in [retest fingerprints](retest-source-fingerprints.json).  
**Status:** NOV-01, NOV-02 and NOV-03 closed in source; GAP-01, GAP-03, GAP-05 and GAP-06 remediated; GAP-02 and GAP-04 remain explicit. All source fixes are committed. Release checks are local; deployment verification is separate.

## Scope and evidence boundaries

The original whole-application review used a separate archive whose 996 tracked files matched the requested commit. It covered authentication and sessions; administrator and initiative authorization; private fields and moderation; comments and reviews; uploads, outbound fetches and ENS; donations, Safe receipts and pledges; backup/export boundaries; voting manifests, relaying, chain replay, quiet endings and first-party contracts; frontend rendering and caches; and dependencies/CI. Depth concentrated on authorization, sponsored actions and voting. The commit's ballot-error wording was not the limit of the assessment.

The retest covers the fixes and their interactions, followed by a complete ASVS applicability/evidence assessment. Regression suite results identify when each suite was run; API and frontend suites were rerun after the gap fixes. Existing unrelated work remains present. Baseline fingerprints describe the original archive; retest fingerprints separately identify the current tracked files, added regression sources and remediation patch. Hash coverage identifies tested material, not exhaustive manual review of every line.

Mutating application probes use local fixtures, ephemeral KV, synthetic RPC responses or Foundry's local EVM. Six unauthenticated public requests additionally sampled current HTTP/header behavior; these do not identify the deployed code as the remediation tree. No production login, transaction, donation or deployment was performed. Administrators, contract configuration, price feeds, RPC/indexing providers and embedded-wallet infrastructure remain trust boundaries. Live wallet/provider integration and production capacity were not independently verified. The owner confirmed hosting, authentication-provider, logging/retention and backups unchanged from September; attestation is distinguished from technical verification.

## Finding summary

| ID | Severity at discovery | Finding at b471ac5 | Resolution | Retest status |
|---|---|---|---|---|
| NOV-01 | Medium | Owner-supplied signature code could consume unbounded sponsored gas | Bound signature preflight, gas estimation and final signed gas/fees/cost | Closed |
| NOV-02 | Medium | Live affiliation shares could conflict with frozen settled membership | Count registered goals for affiliation concentration; retain live asks for size and funding | Closed |
| NOV-03 | Low | Copied private-preview cookies remained valid beyond their thirty-day browser lifetime | Authenticate and enforce expiry; add fresh randomness, origin binding and __Host- cookie scope | Closed |

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

### NOV-03 — Enforce private-preview cookie expiry on the server

**Classification:** CWE-613; ASVS v5.0.0-7.3.2 and v5.0.0-9.2.1.  
**Fix locations:** [preview token](../../../api/lib/sitelock.ts), [clock injection](../../../api/app.ts) and [cookie issuance](../../../api/middleware/headers.ts). [Regression tests](../../../api/tests/sitelock.test.ts) exercise the real gate.

**Original defect.** The optional preview gate issued a deterministic HMAC cookie with a browser Max-Age of thirty days, but the server never checked time. A holder could copy and replay it indefinitely until the shared password changed. The new controlled-clock test reproduced a 200 response after thirty days where 401 was expected. This bypass concerned the optional preview boundary; it did not grant a wallet session or administrator authority.

**Fix and evidence.** The __Host-site_lock token carries a version, signed expiry and fresh 128-bit randomness. HMAC verification binds it to the request origin and configured username; the server rejects expired tokens before allowing access. Tests reject an edited expiry/signature, a different origin/scheme and rotation of either the password or the independent signing key, and check the exact expiration boundary and cookie flags. The original failing probe and passing focused run are preserved. The updated focused preview/static suite passes 19 tests; the subsequent full API suite passes 658 tests with eight steps.

**Closure and limits.** The demonstrated expiry defect is closed. GAP-03 is also removed: HMAC now requires a separately provisioned random 32-byte SITE_COOKIE_KEY and no longer derives a key from the password. Dedicated Basic-auth brute-force quotas, idle tracking and individual preview-token revocation remain outside this fix. They do not affect the separate hashed API session authority.

## Earlier findings and retained decisions

The October fixes remain present: ENS gateway reads are disabled, private fields retain owner/recent-admin authorization, and membership updates retain CAS/revocation handling. Their regressions pass. Historical authentication, observe-mode rate limiting and logging/retention decisions remain bounded context, not new production assurance. Fresh SIWE proves possession of a wallet key, not an independent authentication factor.

During retest, the current lockfile had drifted to Zod 3.x despite the existing `^4.6.6` security override. The advisory scan reported [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Resolution was restored to the already-reviewed **4.6.7**, retaining other dependency additions; frozen installation and the final advisory scan pass. This is a dependency-gate repair, not a newly demonstrated application exploit. The original commit's dependency scan was clean.

CI still lacks the separate Foundry test and contract-package advisory steps run manually here. Production proxy/IP enforcement, provider assurance, backup recovery, external alerting and exact log retention remain outside the verified evidence. Current public samples confirm enforced CSP (all eight inline script hashes match), HSTS, no-store on the auth error and TRACE rejection; metadata/directory paths return the SPA shell. The edge API HTTP redirect persists as an accepted exception. The audit documentation now accurately describes Deno dashboard collection.

## Full ASVS disposition

The [complete matrix](control-matrix.md) and [machine-readable matrix](control-matrix.json) cover every cumulative L1/L2 requirement. Requirement text and levels come from the pinned [official ASVS 5.0.0 catalog](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json). All 186 previous NOT REASSESSED placeholders now have explicit applicability, evidence or missing-assurance explanations. The original and first-retest matrices remain preserved.

| Disposition | Count | Meaning |
|---|---|---|
| PASS | 76 | Sufficient evidence for the stated application boundary |
| PARTIAL | 85 | Controls observed, but scope or assurance is incomplete |
| FAIL | 2 | Known unmet requirement; not necessarily a demonstrated exploit |
| NOT VERIFIED | 19 | Applicable, with no adequate verification evidence |
| ACCEPTED EXCEPTION | 3 | Specific prior owner decision; never counted as passing |
| NOT APPLICABLE | 68 | Reasoned exclusion of absent features |

**Assessment coverage is 253/253. Positive verification evidence is 76/185 applicable controls (41.1%).** This is an evidence-completion ratio, not a security rating. Missing provider evidence and partial testing remain in the denominator. L1 has 33 PASS, 20 PARTIAL, two NOT VERIFIED and 15 exclusions; L2 adds 43 PASS, 65 PARTIAL, two FAIL, 17 NOT VERIFIED, three exceptions and 53 exclusions. V11.4.4 is now inapplicable because no key is derived from a password. Neither level is established.

The [official assessment guidance](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x04-Assessment_and_Certification.md) calls for scoped, reasoned verification. This review is not OWASP certification. The [verification record](asvs-verification.md) defines statuses and the evidence boundary; the [application profile](application-profile.md) inventories communication, authentication, inputs, resources, data and cryptography. The PDF embeds both, together with the full 253-control matrix as Markdown and JSON attachments.

## ASVS gap remediation

**GAP-01 — Atomic restore and bulk operations.** Versioned storage preserves large backups: changes are staged in an invisible generation and one head/revision compare-and-set publishes the whole dataset. Any concurrent durable write aborts publication. Each request pins its generation; an obsolete request cannot write. Bulk status changes, comment moderation and content sync now roll back the whole selection if any item fails, with audit outcomes deferred until publication. Sessions, live leases, quotas and private autosaves remain separate. External AI calls can still incur charges before a database rollback.

Tests cover a roughly 3 MiB restore, a failure after a later staging batch, concurrent writers, pinned readers, lease/session preservation, repeated restores, cleanup and an acknowledgement lost after successful publication. The last case proves cleanup never erases a possibly published generation. Strong reads add one KV round trip per request. Administrative staging copies the current dataset; it needs spare storage and can return a conflict under concurrent writes. Request scopes expire after ten minutes. Daily production cleanup removes retired/abandoned generations once older than one hour; interrupted jobs remain invisible until cleanup.

**GAP-03 — Independent preview signing key.** Preview cookies use a separately provisioned 256-bit random SITE_COOKIE_KEY. Missing or malformed material rejects preview startup. Provision with a cryptographic generator as documented in .env.example; do not reuse the Basic password. Rotating either credential invalidates existing cookies. Production key generation/custody is not attested by local tests.

**GAP-05 — Private server autosave.** Unpublished drafts are stored under the authenticated wallet, with no-store reads, a 256 KiB UTF-8 limit, atomic chunked writes and 30-day expiry. Version checks reject stale tabs; deletion tombstones prevent queued writes from restoring deleted data. The form keeps private content in memory only, surfaces save errors and flushes before explicit logout. Tests cover cross-wallet access, conflicting saves, large drafts, expiry, deletion and identity changes. Drafts are excluded from admin backups/restores.

**GAP-06 — Redirect refusal.** Runtime RPC, viem, Pinata, AI, ENS, indexer, Safe and support calls explicitly reject redirects. Safe next-page and resumed URLs must retain the configured origin and exact endpoint path, with no embedded credentials or fragment. Tests include hostile hosts/schemes/paths, resumed cursors, and native/viem transports. Support forwarding also has a 15-second deadline and generic failure diagnostics.

## Remaining conformance gaps

| ID / control | Current behavior | Work needed |
|---|---|---|
| GAP-02 / V5.4.3 | Raster files are decoded and rewritten without antivirus scanning | Left unchanged at the owner's request; still FAIL, not a new accepted exception |
| GAP-04 / V13.2.1 | Service integrations still consume configured API/bearer credentials | Verify service-account and credential lifecycle controls; manage replacement of long-lived keys or explicitly accept an exception |

Jev search uses Nexus's /v1/systemone endpoint, model jev, and the shared AI_SEARCH_API_KEY. The owner confirmed that Nexus keys can be revoked manually and do not expire; this [attestation](evidence/nexus-key-lifecycle.json) resolves the earlier capability question. Revocation stops a stolen key when performed; it does not establish routine replacement of long-lived credentials. No additional website revocation code is needed. GAP-04 is an operational ASVS conformance gap, not a newly demonstrated website vulnerability. The [public catalog](evidence/nexus-jev.json) establishes model compatibility; authenticated inference and live key revocation were not tested. The [Safe documentation](https://docs.safe.global/core-api/how-to-use-api-keys) describes optional key expiry. Safe, Pinata and other configured integrations still need lifecycle evidence. No exception has been assumed.

No public attacker-controlled redirect exploit, uploaded malware execution or new grant-fund theft path was demonstrated. Provider OTP/recovery, internal TLS, secret custody, backup recovery, retention and immutable/alerted logs still need external evidence. Owner confirmation does not turn these into passes.

## Verification and review artifacts

Release validation uses an isolated archive of committed source ad4b955, including both newly merged remote changes and excluding unrelated local edits. It passes **660 API tests with eight steps**, **1,645 frontend/shared tests in 186 files**, **173 contract tests in 15 suites**, and **217 Python reference tests**. API/frontend type checks and lint (749 files) pass. Application and contract advisory scans report no known vulnerabilities. The production build/prerender also passes; commands and logs are in the [release evidence](asvs-verification.md#release-integration-verification). The earlier ABI comparison remains applicable to the unchanged contract interface. Prior runs and their distinct source boundaries remain in the verification records.

One earlier expanded API run failed a pre-existing review-order assertion dependent on real-clock ULIDs; the isolated unchanged test and final full run passed. The failure is retained rather than hidden. Earlier harness/build limitations are documented in [retest.md](retest.md). Release fingerprints identify committed source only; unrelated local edits are excluded. Hash coverage is not a claim of exhaustive line-by-line inspection.

- [Gap-remediation evidence](asvs-verification.md) and [full ASVS verification and open work](asvs-verification.md), [application profile](application-profile.md) and [matrix](control-matrix.md)
- [Original assessment](assessment-b471ac5.md), [baseline verification](verification.md) and [initial retest](initial-retest-report.md)
- [Remediation verification](retest.md), [reproduction instructions](evidence/README.md) and [current public observations](evidence/asvs-live.json)
- [Baseline fingerprints](source-fingerprints.json), [final retest fingerprints](retest-source-fingerprints.json) and [artifact checksums](artifact-sha256.json)
