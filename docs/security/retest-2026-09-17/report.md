# Security remediation verification — 17 September 2026

## Verdict

**Not all reported issues are fully resolved.** Most of the implementation work is present and the API regression suite passes, but two local gaps were reproduced: content sync bypasses the recent-authentication rule when publishing a new initiative, and a revision remains in browser state after the API denies revalidation. Production also still exhibits the report-only CSP and API transport-header findings.

This review covers all 12 ASVS findings, all 11 NDC findings (including informational items), and the two additional assurance gaps in the September 15 reports. It reviews the working tree based on `2d33b24`, including uncommitted remediation. Draft/logout implementation and tests changed concurrently during the review; the final checks use the later version with the keep/delete/cancel dialog. Historical reports have not been rewritten. This is a remediation retest, not a new certification of all 253 ASVS requirements.

No application fixes or deployments were made by this review. Added files are the report, isolated reproduction tests, and supporting evidence. Production checks were five unauthenticated GET requests; no production mutations, wallet signatures, uploads, or donations were performed.

## Remaining implementation findings

### R-01 — Low: content sync can publish with stale administrator authentication

**Original finding:** NDC-2026-006. **Confidence:** high; full local route reproduction.

The new recent-authentication middleware protects the dedicated approval, bulk-status, membership, Safe-binding, payout and reassignment paths. However, [`api/routes/admin.ts:663`](../../../api/routes/admin.ts#L663) registers `/api/admin/sync-content` without that check. Submitted file text reaches `parseRfpFile`, which defaults its status to `approved` at [`api/services/content.ts:152`](../../../api/services/content.ts#L152). A new source filename reaches `insert({ ...f })` at [`api/db/rfps.ts:388`](../../../api/db/rfps.ts#L388).

The reproduction minted an administrator session, advanced its age to 301 seconds, and confirmed that the normal approval endpoint returned **403 with `reauthenticate: true`**. The same session then posted a valid synthetic content file to content sync, which returned **200**, created an **approved** initiative, and made it readable through the unauthenticated initiative endpoint.

An attacker already holding a valid but stale administrator credential can therefore publish an approved initiative without the fresh wallet proof required by the ordinary approval workflow. This is not unauthenticated access, a Safe-binding bypass, or demonstrated fund theft; the prerequisite and limited effect keep the rating Low.

**Required correction:** enforce recent authentication before content sync can create approved records, or require it for the whole sync endpoint. Update its browser/CLI callers to handle that challenge. Add a stale-session regression that checks no initiative was created before the challenge. The isolated [reproduction](admin-reauth.repro.test.ts) currently asserts the vulnerable behavior.

### R-02 — Low: rejected revision revalidation leaves the old text available

**Original finding:** ASVS-12. **Confidence:** high; browser-hook reproduction plus rendering trace.

[`app/hooks/use-revision.ts:11`](../../../app/hooks/use-revision.ts#L11) now scopes its query by viewer and revalidates on mount/focus. Those are useful fixes, but a failed background refetch does not erase TanStack Query's prior successful `data`. [`app/routes/initiative.tsx:76`](../../../app/routes/initiative.tsx#L76) chooses the historical text using `Boolean(older.data)`, even when `older.error` is present; the revision diff similarly uses `prev.data`.

The reproduction loaded a revision as an anonymous viewer, then simulated the legitimate **404** returned after an administrator archives that revision. Both a refetch and a later remount retained the old title while the query reported an error. The page can consequently keep displaying the restricted text while also claiming it is showing the current text instead.

This affects content previously delivered to that browser. It does not let a new viewer retrieve a never-authorized revision or bypass the server's 404. Nevertheless, the attempted revalidation does not enforce the intended browser cleanup.

**Required correction:** discard cached restricted content on authorization/not-found responses and prevent the rendered text and diff from using data whose revalidation has denied access. Test same-viewer permission changes, not only switching from an admin query key to an anonymous one. The isolated [reproduction](revision-cache.repro.test.tsx) currently asserts the vulnerable behavior.

## Production findings still open

### R-03 — Low: ASVS-06 remains visible on the public homepage

The live homepage returned this enforced policy:

```text
frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

Script hashes, `default-src` and `object-src` remained in `Content-Security-Policy-Report-Only`; its connections remained broadly allowed with `https: wss:`. The restrictive local implementation defaults to enforcement at [`api/config.ts:224`](../../../api/config.ts#L224), narrows connections and provides a report collector, but that behavior was not present in the sampled production response. Whether this reflects an older deployment or configuration was not established. No XSS was demonstrated.

**Closure:** deploy the reviewed implementation, ensure enforcement is enabled, and verify real Privy, injected-wallet, WalletConnect, upload and donation flows. Retest actual page/error responses and demonstrate browser blocking of an unapproved script. Do not close the production finding from local policy tests alone.

### R-04 — Low: ASVS-11 remains visible on API and health responses

Live HTTPS `/api/auth/me` (**401**) and `/healthz` (**200**) omitted HSTS. Plain HTTP `/api/auth/me` still returned **301** to HTTPS. The homepage already had HSTS, so this is the original consistency/clear-API-failure issue, not proof of an exploitable downgrade.

Local [`api/middleware/headers.ts:21`](../../../api/middleware/headers.ts#L21) now sets the existing HSTS policy centrally, and local integration tests pass. No production plaintext-API rejection was demonstrated, and local header changes alone cannot implement a rejection performed by the hosting edge before the app runs.

**Closure:** verify the deployed shared headers and configure/verify the intended plaintext API behavior at the edge. Keep the normal browser-page redirect. No credentials were transmitted over HTTP during this review.

## Assurance and accepted design limitations

- **ASVS-05 / NDC-2026-006 logging:** structured, redacted security events and a controlled test endpoint exist and passed local tests. Durable ingestion, protected retention and alert delivery were not verified. [`docs/security-audit.md:84`](../../security-audit.md#L84) explicitly records that limitation. Confirm a controlled event in the actual backend and its alert destination before closing this requirement; lack of evidence does not prove no infrastructure exists.
- **ASVS-03 consent:** the original first-writer poisoning model has been replaced. Attempts are session-bound, use recognized content-hashed terms and server time, permit independent associations for the same transfer, and retain `donorAuthenticated: false`. The API tests cover forged first claims, cross-session access, pending/RPC failures and mismatches. This resolves the demonstrated overwrite/suppression problem by changing the assurance model. It intentionally does **not** provide the original proposed donor-signature assurance: a caller can still associate their own browser agreement with someone else's public transfer. Treat this as a documented redesign requiring reassessment, not an unqualified ASVS pass. See [`docs/donation-checkbox-evidence.md:104`](../../donation-checkbox-evidence.md#L104).
- **ASVS-12 drafts:** latest code deliberately preserves wallet-scoped private drafts through wallet switching and offers Keep/Delete/Cancel on logout. Deletion cancels pending writes; keeping is an explicit recovery/privacy choice. Wallet-specific keys prevent accidental cross-wallet form restoration but do not isolate localStorage from same-origin scripts or someone with browser-profile access. This cannot be described as removal of all sensitive persistent browser data. The current policy documents the tradeoff; record the relevant ASVS exception/tailoring explicitly.
- **G-01 MFA:** fresh SIWE proves current signing-key control; it does not establish an independent factor or fresh human interaction for an already-unlocked embedded wallet. The local policy explicitly acknowledges this. The report's MFA assurance gap remains open.
- **G-02 operations:** data classification and retention, provider encryption/backups, service-credential scope/rotation, production provenance, provider authentication/recovery, egress configuration and incident procedures still lack complete closure evidence. Dependency deadlines and session procedures now have documentation, but that does not resolve all PARTIAL/NOT TESTED matrix rows.

OWASP separately distinguishes server-side session invalidation from client caching/storage controls in its [session management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). CSV consumer behavior also needs explicit validation; see [OWASP CSV injection guidance](https://community.owasp.org/attacks/CSV_Injection).

## Disposition of every ASVS finding

“Fixed locally” means the implementation and corresponding local checks support the fix; it does not attest the deployed revision.

| ID | Disposition | Evidence / outstanding requirement |
|---|---|---|
| ASVS-01 | Fixed locally | Server-side discussion-title fetch removed; no forum-fetch service remains. Eleven route tests cover authority tricks, private addresses, redirects and DNS changes without any outbound fetch. |
| ASVS-02 | Mitigated locally; consumer validation pending | `app/lib/leads-csv.ts` prefixes formula-capable strings with visible `Text: `, quotes text fields and preserves real numbers. Prefix/boundary/round-trip tests pass. Actual supported Excel/LibreOffice import/save/reopen behavior remains unverified, as documented in `docs/csv-export-safety.md`. |
| ASVS-03 | Redesign verified; original assurance not claimed | Separate browser acceptance/association records eliminate exclusive first-write claims. Twelve terms-route tests pass. Donor-authenticated consent is deliberately absent; see design limitation above. |
| ASVS-04 | Fixed locally | Atomic replacement, absolute/idle deadlines, authenticated privilege bounds, current role checks, inventories and targeted/global revocation. Lifecycle and migration/race tests pass. Live renewed-cookie invalidation was not retested. |
| ASVS-05 | Partial | Structured events, redaction and safe failure behavior pass tests. Durable collection, protection and alert delivery need operational proof. |
| ASVS-06 | Local fix present; open in production | Enforced default, hashed inline scripts, bounded redacted collector and origin allowlists pass local tests. Sampled homepage still report-only. |
| ASVS-07 | Fixed locally for new uploads | Real PNG/JPEG/WebP decode/re-encode, metadata removal, size/pixel/resource/deadline bounds and malformed-file rejection pass. Existing CIDs are not retroactively normalized. Actual deployed worker/WASM/provider workflow still needs verification. |
| ASVS-08 | Fixed locally | POST-body claims, opaque query scopes, retired GET route, 30-day expiry, rotation and moderation revocation pass tests. Edge/APM logging and historical URL-log cleanup were not inspected. |
| ASVS-09 | Fixed locally; deployment assurance limited | Both entrypoints forward Deno connection metadata; spoofed forwarding headers are ignored; missing identity fails IP quotas with 503. Tests pass. A prior single-preview check is documented, not a fresh two-network production attribution test. |
| ASVS-10 | Fixed for audited lockfile/process | Fresh frozen-lockfile audit returned no known vulnerabilities. CI audit gate and risk-based deadlines/ownership are present. No exceptions recorded. This is not proof of absence of undisclosed vulnerabilities. |
| ASVS-11 | Partial locally; open in production | Shared HSTS exists locally. Production API/health still omit it and HTTP API still redirects. |
| ASVS-12 | Partial | Logout/viewer-change query cancellation, scoping and late-response tests pass. R-02 remains; private draft persistence is a documented exception. |
| G-01 | Open | Independent-factor assurance / tailored authentication profile not established. |
| G-02 | Partially documented; open | Operational and provider evidence remains incomplete. |

## Disposition of every NDC finding

| ID | Disposition |
|---|---|
| NDC-2026-001 | Basic site headers present locally and on sampled homepage; full script-CSP closure remains ASVS-06/R-03. |
| NDC-2026-002 | Fixed locally: browser token is HttpOnly; browser storage holds identity metadata; legacy bearer migration and cookie attributes are tested. No new live sign-in was performed. |
| NDC-2026-003 | Fixed locally by removing the server-side discussion fetch, eliminating its DNS-rebinding connection path (ASVS-01). |
| NDC-2026-004 | Fixed locally; runtime deployment verification caveat as ASVS-09. |
| NDC-2026-005 | Clean current advisory scan, CI audit gate and remediation policy (ASVS-10). |
| NDC-2026-006 | Partial: sensitive named routes have step-up and audit events; content-sync publication bypass R-01 and external logging assurance remain. |
| NDC-2026-007 | Fixed locally: static origin rewriting is limited to configured origins/trusted suffixes, with hostile suffix/port/scheme tests and hashes recomputed for rewritten scripts. |
| NDC-2026-008 | Fixed locally: shared HTTPS validation runs before pledge uploads/mutation; HTTP/malformed links are rejected and existing data preserved. |
| NDC-2026-009 | Informational behavior unchanged: preview cookie remains deterministic HMAC with browser Max-Age, without a server-enforced issuance timestamp. Original report accepted it for a preview gate; do not describe it as a repaired expiring authentication credential. |
| NDC-2026-010 | Informational/provider check outstanding: on-ramp keys remain public in widget URLs by design. Publishable key type and provider-side domain restrictions were not verified. No secret exposure is asserted. |
| NDC-2026-011 | Informational footgun unchanged: `DISABLE_RATE_LIMITS` still disables all quota checks, including login, with a boot warning. No production assertion or admin warning was found. Deployment value was not inspected. |

## Verification and evidence

See [verification results](verification.md) for commands, results and limitations. The two reproduction tests deliberately pass when the outstanding weaknesses exist and are excluded from the normal suites; they must not be counted as passing security acceptance tests.

The review does not close unauthenticated/operational observations by assuming that uncommitted local code is deployed. Recheck the deployed revision after the two implementation gaps and any accepted profile exceptions are addressed.
