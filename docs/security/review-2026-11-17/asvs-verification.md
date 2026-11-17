# Full ASVS verification record — Nov 17, 2026

## Standard, target and meaning

The assessment uses the pinned OWASP ASVS 5.0.0 English catalog already present in this repository: 253 cumulative L1/L2 requirements (70 L1 and 183 L2); 92 L3-only requirements are outside this profile. Requirement wording and levels are preserved verbatim. The official catalog URL and its recorded SHA-256 appear in control-matrix.json. complete-asvs.py checks exact ID coverage, rejects duplicates and verifies that every evidence reference exists.

The current release target is committed source ad4b955, integrating Nexus commit 334f0d6, security fixes e123932 and the two intervening remote commits. retest-source-fingerprints.json identifies that exact committed source; earlier working-tree runs remain recorded below. The base assessment and original failing probes remain unchanged. initial-retest-report.md and initial-retest-control-matrix.* retain the first 67-control retest. The expanded matrix replaces every NOT REASSESSED placeholder with a reasoned disposition; this does not mean every control has been verified successfully.

The [official assessment guidance](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x04-Assessment_and_Certification.md) requires a reasoned scope, applicable requirements and evidence. ASVS is not an official numeric security score and OWASP does not certify this review. Neither L1 nor L2 achievement can be claimed while applicable requirements are failed, partial, unverified or excepted.

Definitions:

- PASS: sufficient source/test or specifically identified public-observation evidence for the described application boundary.
- PARTIAL: controls or first-party evidence exist, but the requirement has unresolved scope/assurance limitations.
- FAIL: a known unmet requirement. This may be a design/operational conformance gap without a demonstrated exploitable vulnerability.
- NOT VERIFIED: applicable control with no adequate verification evidence; typically provider/infrastructure configuration.
- NOT APPLICABLE: a reasoned exclusion based on absent application features; vendor email/session dependencies are not hidden in exclusions.
- ACCEPTED EXCEPTION: a specific documented prior owner decision. It remains outside the PASS numerator.

Counts can measure assessment coverage and the fraction with positive verification evidence, but must not be presented as a security rating. Exclusions are omitted only from the applicable denominator; PARTIAL, FAIL, NOT VERIFIED and ACCEPTED EXCEPTION remain in it. The exact counts and separate L1/L2 distributions are generated in the JSON matrix.

## Work performed

The original full source review and retest already covered API, frontend/shared, contract and Python suites, type checks, lint, build/prerender, ABI consistency and dependency advisory scans. See verification.md and retest.md for commands, baseline fingerprints and existing harness limits.

This expansion mapped all remaining requirements to the current architecture, source boundaries, test evidence or an explicit missing evidence item. Focused inspection covered parsing/rendering, file handling, cryptography, backend sessions/roles/private fields, provider transports, backup transactions, quotas, audit generation and deployment surfaces. The new application-profile.md inventories communication, inputs, authorization, data, keys and expensive operations. Automated source search was used to locate and check absent protocol/interpreter interfaces; absence is not used to dismiss the configured Privy email or WalletConnect dependencies.

New negative tests exercise copied preview-cookie expiry, token tampering, origin/scheme replay, secret rotation, fresh token randomness, cookie flags, hidden static files, encoded path traversal, directory listing and non-read static methods. The copied-cookie test failed before the fix (200 instead of 401 after thirty days), then passed with the same injected clock after the implementation change. No live account was used.

## Current public observations

Six unauthenticated, low-volume requests sampled the public site, auth error, plain-HTTP API redirect, TRACE, hidden metadata path and asset directory. Exact response headers, hashes, small error bodies and inline CSP hash checks are in evidence/asvs-live.json. Normal curl trust verification was used, without insecure options or credentials.

- Homepage: enforced CSP, HSTS, nosniff, frame-ancestors none and referrer policy. Inline script hashes were compared to the received CSP.
- Anonymous /api/auth/me: 401, JSON and no-store, with expected API security headers.
- Plain HTTP /api/auth/me: 301 to HTTPS, retaining the documented September edge exception. No credential was transmitted.
- TRACE /: 405, with no reflected credential/body.
- /.git/config and /assets/: the same HTML SPA fallback, not source metadata or a directory listing. Local sentinel tests additionally verify actual hidden/outside files are inaccessible.

These observations verify sampled deployment properties only. They do not identify the deployed source as the remediation tree, establish every edge response, enumerate TLS ciphers, test request smuggling, or demonstrate production admin/provider flows.

## Operational confirmation and limits

The owner answered “Unchanged from the September review” for Deno Deploy hosting, Privy authentication, log collection/retention and backups. This is recorded as owner attestation, not fresh platform evidence. The September decisions concerning single-factor authentication, observe-mode limits and dashboard-only logging remain bounded prior decisions. The known edge redirect is separately retained as an explicit exception. No new conformance gap was silently accepted.

Exact log retention/IAM/immutability, alerting, secret lifecycle, key custody, backup encryption/restore drills, data-retention schedules, internal TLS, provider OTP/recovery/MFA, provider WebSocket/session coordination and production capacity remain either partial or unverified. docs/security-audit.md now accurately describes dashboard collection instead of implying a verified Grafana export.

## Conformance gap disposition after remediation

| ID | Requirement | Current disposition |
|---|---|---|
| GAP-01 | V2.3.3 | Closed in source: large restores, bulk status/moderation and content sync stage in an invisible generation and publish with one CAS. Fault/concurrency tests verify all-or-nothing database results. |
| GAP-02 | V5.4.3 | Open, unchanged at the owner's request. Raster normalization does not implement antivirus. Still FAIL; no exception inferred. |
| GAP-03 | V11.4.4 | Removed: independent random 32-byte SITE_COOKIE_KEY replaces password-derived HMAC material. The KDF requirement is now NOT APPLICABLE; production key provisioning still needs evidence. |
| GAP-04 | V13.2.1 | Open operational gap: the owner confirms Nexus keys are manually revocable and do not expire. Routine credential replacement and other providers' lifecycle controls remain unverified; no new website revocation feature is required. |
| GAP-05 | V14.3.3 | Closed in source: wallet-authorized server autosave, no-store, 256 KiB cap, atomic versioned chunks, deletion tombstones and 30-day expiry; no browser persistence of private draft text. |
| GAP-06 | V15.3.2 | Closed in source: runtime native/viem HTTP calls reject redirects; Safe next and resumed URLs retain the trusted origin and exact path. |

The owner chose versioned storage to preserve large restores. Staging requires spare KV space and can conflict with concurrent durable writes. One additional strong read pins each request. Obsolete scopes cannot write; daily production cleanup collects retired/abandoned generations after a one-hour grace period (scopes expire after ten minutes). A lost acknowledgement after successful publication must never trigger deletion of the active generation; the fault-injection regression exercises that case. AI charges and other external effects are not represented as reversible KV writes.

Nexus's public model catalog advertises model jev and endpoint systemone; the native request/response mapping matches the existing ranker. No authenticated provider inference or credential creation/rotation was performed. The owner subsequently confirmed manual revocation and no key expiry (evidence/nexus-key-lifecycle.json); this resolves the capability question but does not by itself close GAP-04. Safe documents optional key expiry; actual configuration, Pinata lifecycle and the configured AI/support providers still need evidence. Local expiry timers alone would not invalidate stolen upstream keys.

## Initial full-assessment validation and reproducibility

Run the commands documented in retest.md for the unchanged contract/frontend/Python work. For this API-only extension:

```sh
deno test --frozen --cached-only --node-modules-dir=manual -A --deny-net api/tests/sitelock.test.ts api/tests/site.test.ts
deno test --frozen --cached-only --node-modules-dir=manual -A --deny-net api/
deno check --frozen --cached-only --node-modules-dir=manual api/main.ts server.ts api/scripts/*.ts shared/draft/mod.ts scripts/vote-replay.ts scripts/vote-sim.ts
deno task lint
python3 docs/security/review-2026-11-17/complete-asvs.py
python3 docs/security/review-2026-11-17/prepare-retest.py
```

The focused run passes 18 tests. The first expanded full API run passed 647 tests with eight steps and failed one pre-existing review-order assertion: two real-clock ULIDs can sort differently despite advancing the injected fixture clock. The isolated unchanged test passed. The final full API run passes **648 tests with eight steps**; API type checking and lint (739 files) also pass. Both the failure and subsequent full-run result are retained in evidence; a successful rerun does not erase the observed test nondeterminism. The preview/static regression cases themselves passed.

At that earlier preview-only stage, frontend code and contracts were unchanged; the subsequent gap remediation changes frontend code and is tested separately below. The final source fingerprints, matrix, PDF attachments and checksum manifests identify the delivered material. No commit or deployment had been made at that stage.

## Concurrent source change at finalization

After verification, a separate commit, 5966c79, changed only app/app.css to wrap long Markdown links. The review did not create that commit. Its CSS-only diff was inspected; the API/contract/security implementation was unchanged. The source fingerprints at that stage included that commit and all security remediation remained uncommitted. The pre-change fingerprint is retained as retest-source-before-concurrent-css.json. Those earlier frontend suite/build results did not attest the later CSS change; the subsequent gap-remediation frontend suite and build include it. The remediation patch excludes the CSS-only commit.

## Gap remediation verification

The full post-fix API suite passes **658 tests with eight steps**, including the new ownership/draft, redirect, restore and bulk-rollback checks. Two further storage fault-injection cases were then added; the complete seven-test dataset suite passes. The frontend/shared suite passes **1,635 tests in 184 files**; the final focused autosave/session run passes 47 tests. API/script and frontend type checks pass, and lint checks 745 files. The production build/prerender passes (evidence/gap-build.txt). The first attempt was denied permission to bind its localhost prerender server; the permitted rerun succeeds, with ordinary upstream bundler/deprecation warnings retained in the log. Earlier contract/Python/ABI/advisory results remain applicable to those unchanged files and are not described as newly executed.

Evidence: [API](evidence/gap-api.txt), [storage fault injection](evidence/gap-dataset.txt), [frontend](evidence/gap-web.txt), [autosave/session](evidence/gap-draft-web.txt), [API types](evidence/gap-api-types.txt), [frontend types](evidence/gap-web-types.txt), [lint](evidence/gap-lint.txt), [build](evidence/gap-build.txt), [Nexus public catalog](evidence/nexus-jev.json).

An intermediate full API run is retained as gap-api-initial.txt. It caught changed batch-result/strong-read expectations and an index-rebuild transaction that exceeded the check limit after adding the generation guard. The index batch now leaves room for that guard; the 200-item watchlist regressions and final full suite pass. Historical before-gap-fixes-* reports/matrices/fingerprints preserve the earlier six-gap assessment.

Final dispositions: 76 PASS, 85 PARTIAL, two FAIL, 19 NOT VERIFIED, three ACCEPTED EXCEPTION and 68 NOT APPLICABLE. All 253 requirements are assessed; 76/185 applicable controls have positive verification evidence (41.1%). This is not a security score, a level claim or certification. At the shared-key follow-up, only the Nexus migration was committed as 334f0d6. The later release integration below commits the remaining source fixes.

## Shared Nexus credential follow-up

At the owner's request, Jev and the configured chat integration share AI_SEARCH_API_KEY; the separate NEXUS_JEV_API_KEY setting was removed before committing the migration. The regression verifies the same Authorization header reaches Nexus systemone and chat/completions, and both features stay disabled without the shared key. Chat base URL/model remain configurable.

The four focused API suites pass **54 tests** in the full remediation working tree and again in an isolated copy of HEAD plus the exact eight-file Nexus patch. API/server type checks pass in both snapshots, and repository lint passes (745 files). The isolated snapshot matches commit 334f0d664ab29a6ce03872fa7d1dc0100fb3a006. These focused checks followed the earlier full-suite results above; no authenticated live inference was performed.

Evidence: [working-tree tests](evidence/nexus-shared-key-tests.txt), [working-tree types](evidence/nexus-shared-key-types.txt), [lint](evidence/nexus-shared-key-lint.txt), [isolated commit tests](evidence/nexus-commit-tests.txt), [isolated commit types](evidence/nexus-commit-types.txt). GAP-04's provider credential-lifecycle disposition is unchanged.

## Release integration verification

The owner authorized committing and pushing all reviewed security changes. Source commit e123932 contains the remaining security fixes; merge commit ad4b955512b7b23ae2dcb1409ff432c2ee8689e4 also preserves remote commits 491de7c and 6256b6d. The release checks use an isolated archive of that merge commit. Unrelated working-tree changes, including dependency-lock additions, deployment-script work and other plans, are excluded. Existing installed dependency caches were reused; this is not a clean-room provenance attestation. The committed lockfile already retains the reviewed Zod resolution.

The release passes **660 API tests with eight steps**, **1,645 frontend/shared tests in 186 files**, **173 contract tests in 15 suites**, and **217 Python reference tests**. API/server/script and frontend type checks pass; lint checks 749 files. Both application and contract dependency advisory scans report no known vulnerabilities. The production build/prerender also passes ([build evidence](evidence/release-build.txt)); the local prerender listener used the required sandbox exception. Existing upstream bundler/deprecation warnings remain in the log.

Reproduction uses the same commands as the earlier runs, executed from an isolated `git archive ad4b955` snapshot. Evidence: [API](evidence/release-api.txt), [web/shared](evidence/release-web.txt), [API types](evidence/release-api-types.txt), [frontend types](evidence/release-web-types.txt), [lint](evidence/release-lint.txt), [contracts](evidence/release-contract.txt), [Python](evidence/release-python.txt), [application audit](evidence/release-audit.txt), [contract audit](evidence/release-contract-audit.txt).

Nexus credentials are manually revocable and have no expiration, according to the owner. This capability confirmation is recorded in evidence/nexus-key-lifecycle.json. No live credential test occurred and no exception was requested. GAP-04 remains an operational ASVS conformance gap; no additional website revocation feature is pending. The source review and local release checks do not attest production behavior after push.
