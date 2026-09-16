# Security assessment — initiatives.thedao.fund

**Assessment date:** 15 September 2026  
**Target:** [initiatives.thedao.fund](https://initiatives.thedao.fund/)  
**Standard:** OWASP ASVS **5.0.0**, cumulative **Level 2** (L1 + L2)  
**Assessment type:** source-assisted review, bounded production checks, and isolated local reproductions

## Executive assessment

**The assessed application does not meet ASVS Level 2.** There are 12 technical findings and additional authentication and operational assurance gaps. The most consequential findings concern outbound URL validation, CSV exports, donation consent integrity, and session management. Several L1 requirements also fail, so this report does not establish L1 compliance.

The implementation has useful security controls: SIWE signatures and single-use nonces, server-side authorization, hardened browser session cookies, API cache prevention, sanitized Markdown, and donation verification against chain receipts. Production checks confirmed that an ordinary wallet cannot access the sampled administrator APIs and that logout revokes the selected session. These controls do not compensate for the independent weaknesses described below.

Technical findings are rated **six Medium and six Low**, considering the demonstrated prerequisites and impact. No Critical or High application exploit was established in this assessment. The dependency scanner separately reported two High-severity package advisories; their applicability to deployed execution paths is unresolved. Severity here is a contextual triage judgment, not a calculated CVSS score or evidence that untested areas are safe.

### ASVS coverage

| Disposition | Requirements | Meaning |
|---|---:|---|
| PASS | 52 | Supported within the stated scope and verification method |
| FAIL | 26 | A counterexample or identified control absence |
| PARTIAL | 55 | Some elements supported; the full requirement is unverified |
| NOT TESTED | 39 | Insufficient evidence to assess |
| NOT APPLICABLE | 81 | First-party feature or technology absent, with rationale |
| **Total** | **253** | All cumulative L1/L2 requirements mapped |

The 92 L3-only requirements are outside this profile. These counts are **not a compliance percentage**. Mapping every requirement does not mean every requirement was dynamically tested. A finding can affect several requirements, and an unmet documentation requirement is not necessarily an exploitable vulnerability.

See the complete [control matrix](control-matrix.md) and [machine-readable matrix](control-matrix.json), including the exact requirement text, evidence basis, limitations, and applicability rationale for every row.

## 1. Scope and evidence boundaries

### Application and source snapshot

The reviewed application is a React/React Router frontend and Hono API served by Deno, using Deno KV for application state. Authentication supports wallet SIWE, including a source-reviewed contract-wallet verification path, and Privy email-based wallet access. Other integrations include Ethereum RPC, Safe donation addresses, Pinata/IPFS uploads, WalletConnect, and optional AI and support services.

Important assets are administrator authority, proposal status and payout metadata, private proposal/contact/funder data, session and comment claim credentials, and records associating donations with terms acceptance. The donation flow transfers funds from the user's wallet to a Safe; the server does not take custody of the wallet's private key.

The final source evidence snapshot is commit **`bc446e429c028d8d8f7d352f947b8251157addeb`**. The evidence manifest fingerprints **308 source/configuration files**. All matched at final verification. The source tree was clean when this manifest was captured; this assessment adds only its report/evidence directory. The production build revision was **not independently attested**, so source findings describe this snapshot unless explicitly labeled live.

### Work performed

- Read application routes, middleware, authentication/session storage, authorization, rendering, input validation, uploads, integrations, deployment entry points, lockfile, CI, and relevant documentation.
- Collected 20 bounded public HTTP response observations, plus successful TLS 1.2 and 1.3 connections. Production HTTP evidence was captured around **20:56 UTC**; authenticated evidence around **20:57 UTC**.
- Used a fresh, assessor-controlled wallet for the user-authorized SIWE checks: sign-in, nonce replay, ordinary-user access boundaries, Origin rejection, re-authentication, logout, and logout-all.
- Ran existing application tests and isolated reproductions using in-memory state and mocked upstream services.
- Ran the dependency advisory audit against the checked-in lockfile and mapped the official ASVS 5.0.0 L1/L2 catalog.

The disposable address was `0x6829fdC49A4a96D9A325740FB55A4f5F1e01afDa`. Its key and session credentials stayed in memory and are absent from the evidence. Both created sessions were revoked; subsequent identity requests returned 401. No proposal, comment, profile, upload, donation, or administrator mutation was made in production.

### Limitations

No production administrator account, provider administration access, infrastructure configuration export, private production data, or production logs were supplied. Privy recovery/MFA behavior, actual proxy and egress configuration, KV encryption/backups, service credential scope, security alerting, and incident procedures remain partly or wholly unverified. No production internal-network requests, load/exhaustion tests, transactions, or invasive payloads were sent. Local reproduction success does not demonstrate production network reachability or a matching deployment revision.

This is a web application assessment, not a smart-contract, Safe signer-custody, wallet-provider, or infrastructure penetration audit. Technology-specific N/A rows concern the reviewed first-party application; they do not certify provider internals. TLS observations do not establish that every obsolete protocol or cipher is disabled. The existing `docs/asvs-security-review-2026-09-15.md` is preserved; this report uses its own evidence and version-correct ASVS 5.0.0 identifiers.

## 2. Finding summary

`ASVS-01` through `ASVS-12` below are report finding IDs. Requirement references such as `v5.0.0-1.3.6` identify the standard's controls.

| Finding | Severity | Evidence | Primary failed requirement(s) |
|---|---|---|---|
| [ASVS-01 — Forum URL can replace the validated destination](#asvs-01--forum-url-can-replace-the-validated-destination) | Medium | Local full-route reproduction | 1.3.6 |
| [ASVS-02 — CSV export preserves spreadsheet formulas](#asvs-02--csv-export-preserves-spreadsheet-formulas) | Medium | Exact export function executed locally | 1.3.3 |
| [ASVS-03 — Unauthenticated first writer can poison consent](#asvs-03--unauthenticated-first-writer-can-poison-consent) | Medium | Local route and database reproduction | 2.2.1, 2.2.3, 2.3.1, 8.2.2, 8.2.3 |
| [ASVS-04 — Session renewal and privilege lifetime gaps](#asvs-04--session-renewal-and-privilege-lifetime-gaps) | Medium | Live renewal; local promotion; source | 7.2.4, 7.3.1, 7.3.2, 7.4.5, 7.5.2 |
| [ASVS-05 — Missing application security audit events](#asvs-05--missing-application-security-audit-events) | Medium | Source | 16.2.1, 16.3.1–16.3.3 |
| [ASVS-06 — Script restrictions remain report-only](#asvs-06--script-restrictions-remain-report-only) | Low | Live headers and source | 3.4.3 |
| [ASVS-07 — Invalid image accepted by file validation](#asvs-07--invalid-image-accepted-by-file-validation) | Low | Local upload-service reproduction | 5.2.2 |
| [ASVS-08 — Comment capability tokens appear in URLs](#asvs-08--comment-capability-tokens-appear-in-urls) | Low | Source | 14.2.1 |
| [ASVS-09 — Server discards client connection metadata](#asvs-09--server-discards-client-connection-metadata) | Medium, conditional | Local integration reproduction; production config unknown | 15.3.4 |
| [ASVS-10 — Vulnerable dependencies lack a remediation timetable](#asvs-10--vulnerable-dependencies-lack-a-remediation-timetable) | Low, reachability unresolved | Lockfile advisory scan and CI/docs | 15.1.1 |
| [ASVS-11 — API transport policy is inconsistent](#asvs-11--api-transport-policy-is-inconsistent) | Low | Live responses | 3.4.1, 4.1.2 |
| [ASVS-12 — Private browser data survives logout](#asvs-12--private-browser-data-survives-logout) | Low | Two local component reproductions and source | 14.3.1, 14.3.3 |

All requirement numbers in this report are prefixed by **v5.0.0** unless another version is explicitly written.

## 3. Detailed findings

### ASVS-01 — Forum URL can replace the validated destination

**Medium · High confidence in source defect; production reachability untested · v5.0.0-1.3.6**

[forum.ts:19](/home/sem/Projects/thedao-initiatives/api/services/forum.ts:19) constructs a new URL from the submitted pathname and a validated base hostname. A pathname beginning with `//` is interpreted as a new authority. The host checked by DNS validation is therefore not necessarily the host fetched.

The full submit-route reproduction used `https://forum.example.com//127.0.0.1:8443/admin`. Both resolver calls checked only `forum.example.com`, while mocked fetch received **`https://127.0.0.1:8443/admin.json`**. The request happens when an authenticated, named proposer omits the title, before complete form validation. The incomplete form ultimately returned 400, after the outbound call had already occurred. See [local results](evidence/local-reproductions.txt) and [reproduction source](evidence/api-reproductions.test.ts).

An eligible proposer can bypass the destination check and cause server-side HTTPS requests to another host/port. Exploit impact depends on reachable services and valid TLS: the method is GET, the path ends in `.json`, redirects are disabled, and a timeout is present. Internal data theft or code execution was not demonstrated.

**Fix:** Modify the pathname on a cloned absolute URL without reparsing it as a relative reference; assert the final origin is unchanged. Validate/allowlist the final protocol, host, port and path. Apply egress restrictions or vetted address pinning to address DNS changes between validation and connection.

**Retest:** Leading-double-slash and related URL cases must never change the fetched authority. Private/loopback IPv4/IPv6, redirects, and DNS changes must fail closed. Verify that rejected forms cannot initiate unintended requests.

### ASVS-02 — CSV export preserves spreadsheet formulas

**Medium · High confidence · v5.0.0-1.3.3**

[admin.leads.tsx:19](/home/sem/Projects/thedao-initiatives/app/routes/admin.leads.tsx:19) quotes CSV separators correctly but does not neutralize spreadsheet expressions. The exact `leadsCsv` function was extracted and executed locally with a harmless `=1+1` funder field. Its output retained that value as an unquoted, formula-capable cell. The input originates in submitted proposal data, and the administrative leads export includes pending/rejected records.

An attacker needs a submitted value to be exported and opened by an administrator in a spreadsheet. Depending on spreadsheet settings and supported formulas, this can alter displayed values or trigger other formula behavior. No spreadsheet, external connection, or command was executed during the assessment. [CSV evidence](evidence/csv.json). Ordinary CSV quoting is not a sufficient formula defense. [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection).

**Fix:** Export untrusted fields as explicitly typed strings in a suitable spreadsheet format, or implement CSV formula neutralization tested against supported consumers. Preserve legitimate numeric fields and handle dangerous prefixes, leading whitespace/control characters, quotes and delimiters.

**Retest:** Open harmless formula-prefix fixtures in the supported spreadsheet applications and confirm literal display with no formula evaluation, including save/reopen behavior.

### ASVS-03 — Unauthenticated first writer can poison consent

**Medium · High confidence · v5.0.0-2.2.1, 2.2.3, 2.3.1, 8.2.2, 8.2.3**

[donate.ts:76](/home/sem/Projects/thedao-initiatives/api/routes/donate.ts:76) accepts confirmation without authentication. It stores the supplied terms record **before** verifying the transaction. [terms.ts:27](/home/sem/Projects/thedao-initiatives/api/db/terms.ts:27) preserves the first value for each transaction hash. Format checks do not prove that the claimed address accepted a published terms version or owns the donation.

Locally, an unauthenticated request saved an arbitrary version/address claim for a nonexistent transaction. A subsequent request with a mocked, valid USDC receipt and the actual donor's different acceptance confirmed the donation but **left the forged consent unchanged**. [Reproduction](evidence/api-reproductions.test.ts).

This compromises the integrity of the acceptance record. Public transaction hashes can support targeting where no prior record exists. It does **not** forge the on-chain transfer, create demonstrated donation-accounting inflation, or establish a legal conclusion about enforceability.

**Fix:** Verify an acceptance signature binding donor identity, chain, transaction hash, recognized terms version and time. Handle contract wallets/account abstraction according to the actual donor model. Store pre-verification submissions as untrusted claims; they must not permanently prevent a later verified record. Retain a correction/audit history.

**Retest:** A third party cannot create trusted acceptance for someone else's donation; unknown versions are rejected; unverified first writes cannot defeat verified evidence; RPC failures do not convert claims into trusted consent.

### ASVS-04 — Session renewal and privilege lifetime gaps

**Medium · High confidence · v5.0.0-7.2.4, 7.3.1, 7.3.2, 7.4.5, 7.5.2**

Production re-authentication issued a new session while the presented old cookie still returned **200** from `/api/auth/me`. [auth.ts:63](/home/sem/Projects/thedao-initiatives/api/routes/auth.ts:63) creates the replacement without invalidating the current session. This extends the usefulness of a copied old credential despite successful re-authentication. [Live evidence](evidence/siwe.json).

There is also a privilege-lifetime mismatch. [sessions.ts:30](/home/sem/Projects/thedao-initiatives/api/db/sessions.ts:30) selects a seven-day ordinary lifetime or twelve-hour administrator lifetime at creation; [auth middleware:29](/home/sem/Projects/thedao-initiatives/api/middleware/auth.ts:29) updates privileges from the current administrator list on every request. After a legitimate administrator promotion in the local fixture, the old ordinary session retained administrator access at age **43,260 seconds**, with **561,540 seconds** remaining. This requires an authorized promotion; it is not self-escalation by an ordinary user.

The source provides absolute expiry but no inactivity timeout, no administrator per-user/global session termination facility, and no user session inventory with re-authenticated termination. Conversely, **production logout and logout-all worked** for the disposable wallet.

**Fix:** Invalidate the presented current token when re-authenticating. Require fresh authentication and a newly bounded session for privileged access after promotion; enforce the administrator lifetime regardless of the original session type. Define idle limits and add audited session-management/revocation facilities.

**Retest:** The replaced token returns 401; idle and absolute limits work; promoting a user does not grant long-lived administrator access to old sessions; users and administrators can revoke the intended sessions.

### ASVS-05 — Missing application security audit events

**Medium · High confidence in first-party gap; production log infrastructure unverified · v5.0.0-16.2.1, 16.3.1, 16.3.2, 16.3.3**

[app.ts:31](/home/sem/Projects/thedao-initiatives/api/app.ts:31) returns expected HTTP errors without structured logging. Authentication and session operations, authorization denials, and administrator changes do not emit consistent actor/action/target/outcome events. Relevant mutation paths include [admin.ts:105](/home/sem/Projects/thedao-initiatives/api/routes/admin.ts:105) and [admins.ts:48](/home/sem/Projects/thedao-initiatives/api/services/admins.ts:48). Revision authorship exists, but is not a complete security audit trail.

Missing events impair investigation of account abuse and privileged changes. Platform request logs may exist; their presence and retention were not verified, and generic URL/status logs do not supply all application-level semantics.

**Fix:** Emit structured authentication success/failure, logout/revocation, authorization denial, validation/abuse, and sensitive administrative change events. Include UTC time, request ID, safe actor and target identifiers, action and outcome; exclude credentials and sensitive payloads. Send them to a protected durable sink with retention and alerting appropriate to the data.

**Retest:** Exercise each event type and prove its delivery, necessary metadata, access restriction and redaction; verify alert routing using a controlled test event.

### ASVS-06 — Script restrictions remain report-only

**Low · Live confirmed · v5.0.0-3.4.3**

Production HTML enforces only `frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. The larger policy containing script hashes, `default-src` and `object-src 'none'` appears in **`Content-Security-Policy-Report-Only`**. It reports violations rather than blocking them. [Header evidence](evidence/public-site.json); [site-headers.ts:18](/home/sem/Projects/thedao-initiatives/api/lib/site-headers.ts:18).

Framing protection is active. No XSS was demonstrated. The issue is an incomplete defense should script injection become possible. The report-only policy also lacks a reporting destination, and its `connect-src` permits arbitrary HTTPS/WSS destinations. The ASVS minimum additionally specifies `base-uri 'none'`, while this policy uses `'self'`.

**Fix:** Test wallet, Privy, embedded frames and inline-script hashes against a restrictive policy, then enforce it. Use the ASVS minimum directives, narrow third-party destinations, and configure appropriate violation collection during rollout.

**Retest:** A harmless unapproved script is blocked in a browser while sign-in, uploads and donation preparation still function. Check all HTML/error paths, not just the home page.

### ASVS-07 — Invalid image accepted by file validation

**Low · Locally confirmed · v5.0.0-5.2.2**

[validate.ts:163](/home/sem/Projects/thedao-initiatives/api/lib/validate.ts:163) identifies image formats using short byte prefixes. [pinata.ts:18](/home/sem/Projects/thedao-initiatives/api/services/pinata.ts:18) then sends the original bytes. A four-byte PNG marker, `89 50 4e 47`, passed validation and was forwarded to mocked Pinata as `image/png`, despite not being an image.

Existing upload size/rate limits and serving through a separate content origin reduce exposure. The demonstrated impact is acceptance of invalid content and failure to establish the promised file type. Stored XSS, malware execution, or decoder exploitation was not demonstrated.

**Fix:** Decode and re-encode accepted raster formats with a maintained library, constrain dimensions/pixel count, and reject incomplete or malformed files. Define metadata handling and verify the upload provider's malware/content controls where required.

**Retest:** Truncated headers, malformed bodies, oversized dimensions and unsupported types are rejected; valid permitted images are transformed and still render correctly.

### ASVS-08 — Comment capability tokens appear in URLs

**Low · Source confirmed · v5.0.0-14.2.1**

[comments/api.ts:10](/home/sem/Projects/thedao-initiatives/app/components/comments/api.ts:10) sends private claim tokens in `/api/comments/mine?tokens=...`. [comments.ts:170](/home/sem/Projects/thedao-initiatives/api/routes/comments.ts:170) uses these tokens to authorize access to held comment bodies.

The query contains a bearer capability, exposing it to any URL logging or diagnostic collection along this request path. API `no-store` reduces caching but does not redact logs. Actual token leakage was not demonstrated, and these are fetch URLs rather than evidence of top-level browser navigation/history leakage.

**Fix:** Transfer the capability in an authorization header or a POST body, redact it from logs/telemetry, and define expiry and rotation. Keep server-side permission checks independent of UI visibility.

**Retest:** Held comments remain accessible to their claim holder, invalid claims fail, and no capability appears in request URLs or retained telemetry.

### ASVS-09 — Server discards client connection metadata

**Medium, conditional · Local defect confirmed; production configuration unknown · v5.0.0-15.3.4**

[server.ts:81](/home/sem/Projects/thedao-initiatives/server.ts:81) calls `app.fetch(req)` without passing Deno's connection information. With the default `TRUST_PROXY=false`, [ip.ts:10](/home/sem/Projects/thedao-initiatives/api/middleware/ip.ts:10) cannot read the remote address and falls back to **`?`**. Locally, the existing dispatch produced `?`; forwarding mocked connection metadata produced `203.0.113.42`.

In this configuration, unrelated clients share IP-based quota keys. An attacker could consume shared budgets and disrupt authentication or other limited functions. Production `TRUST_PROXY`, trusted-edge forwarding behavior and `DISABLE_RATE_LIMITS` were not available, so production quota exhaustion or spoofing is **not claimed**.

**Fix:** Forward the handler information to Hono. Verify the deployment's actual trusted proxy chain and header-overwrite rules before enabling forwarded-IP trust. Define a deliberate fallback for unknown addresses rather than silently merging all traffic into one identity; retain account/global controls as appropriate.

**Retest:** Controlled requests from distinct clients receive distinct expected attribution; attacker-supplied forwarding headers cannot choose quota identity. Verify this on the deployed runtime with low-volume instrumentation, not production exhaustion.

### ASVS-10 — Vulnerable dependencies lack a remediation timetable

**Low application rating pending reachability review · v5.0.0-15.1.1; 15.2.1 remains NOT TESTED**

`deno audit --lock=deno.lock` reported **14 advisories: two High and twelve Moderate**. Affected locked copies include `axios@1.16.0`, `decode-uri-component@0.2.2`, `uuid@8.3.2/9.0.1`, and older `ws@8.18.x`. The two High reports concern an Axios Node adapter proxy gadget and `ws` memory exhaustion. See [full audit output and advisory links](evidence/dependency-audit.txt).

The lockfile result is reproducible package evidence, not proof of 14 exploitable website vulnerabilities. Several packages sit beneath wallet SDKs; first-party API code uses native fetch. Vulnerable adapters/functions and attacker-controlled inputs were not shown reachable. Some other locked `ws` copies are outside the vulnerable ranges.

[CI configuration](/home/sem/Projects/thedao-initiatives/.github/workflows/ci.yml) lacks an advisory audit gate. Weekly Dependabot updates exist, but no risk-based remediation timetable was found. Without an agreed timetable, this review cannot determine a breach of requirement 15.2.1's remediation deadline.

**Fix:** Update the owning SDKs, inventory actual deployed dependency paths, document risk-based deadlines, and add advisory triage to CI with time-limited, reasoned exceptions.

**Retest:** Audit the resolved lockfile, verify browser/server reachability of remaining advisories, and rerun wallet/authentication integration tests after updates. Record evidence and owners for accepted exceptions.

### ASVS-11 — API transport policy is inconsistent

**Low · Live confirmed · v5.0.0-3.4.1, 4.1.2**

Static HTTPS pages send `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, but sampled HTTPS `/api/*` and `/healthz` success/error responses omit HSTS. Plain HTTP `/api/auth/me` returns a transparent **301** redirect to HTTPS. Browser-page redirection is appropriate; ASVS distinguishes non-browser API endpoints to avoid concealing clients accidentally sending plaintext requests. [Live evidence](evidence/public-site.json); [API headers:8](/home/sem/Projects/thedao-initiatives/api/middleware/headers.ts:8).

No sensitive data was sent over HTTP. Existing hostname HSTS and Secure cookies reduce practical exposure; this is not evidence of a demonstrated downgrade attack or confirmation of browser preload-list enrollment.

**Fix:** Apply the existing HSTS policy consistently to HTTPS API/health/error responses. Configure API plaintext handling to fail clearly at the edge instead of transparently redirecting API clients. This recommendation does not require expanding policy to the parent domain.

**Retest:** Check representative HTTPS status codes and the plain HTTP API behavior; retain the expected browser-page redirect.

### ASVS-12 — Private browser data survives logout

**Low · Source and local component reproductions · v5.0.0-14.3.1, 14.3.3**

[session.tsx:112](/home/sem/Projects/thedao-initiatives/app/context/session.tsx:112) clears session state but does not purge the long-lived React Query cache. [use-revision.ts:5](/home/sem/Projects/thedao-initiatives/app/hooks/use-revision.ts:5) keys revisions by slug/version without viewer identity and uses `staleTime: Infinity`. Two local component tests established that logout leaves private administrator leads in cache and that a cached restricted revision is returned without a fresh API permission check. [Tests](evidence/client-cache.test.tsx); [results](evidence/client-cache-tests.txt).

Separately, [useAutosave.ts:10](/home/sem/Projects/thedao-initiatives/app/components/initiative-form/useAutosave.ts:10) uses the origin-wide key `thedao:submit-draft`; its snapshot includes private funder/contact fields and persists them in localStorage. These can survive logout and page reload.

Exposure requires access to the same browser/origin state, a later viewer of that session, or script execution in the origin. It is not a demonstrated remote API authorization bypass. Reload clears the in-memory cache but not the persistent draft.

**Fix:** Cancel in-flight private requests and purge sensitive query data on logout, wallet changes and privilege changes. Include viewer identity/authorization scope in private cache keys and define revalidation for restricted revisions. Avoid persistent private drafts where possible; otherwise scope and clear them deliberately with an explicit privacy design.

**Retest:** Sign out, switch wallets and revoke roles after viewing private content; neither cached responses nor restored drafts reveal the prior viewer's data. Cover late-arriving requests and offline logout.

## 4. Additional assurance gaps

### G-01 — L2 multifactor assurance is not established

**v5.0.0-6.3.3: FAIL.** A newly generated single-key wallet signed in without a second factor. The first-party service does not attest any wallet-local PIN, hardware, or independent factor. Such wallet protections may exist for some users, but cannot be assumed for all accepted accounts. No fully documented rationale and compensating-control set for relaxing this L2 requirement was found.

Decide the application's authentication assurance policy, especially for administrators. Enforce independent step-up/multifactor assurance where required, or document an explicitly tailored profile and complete risk rationale. Privy email OTP/recovery/factor controls need separate evidence. Successful SIWE signature verification proves control of the signing key; it does not by itself prove L2 multifactor assurance.

### G-02 — Operational and design evidence remains incomplete

Before an L2 claim, resolve the PARTIAL/NOT TESTED matrix rows with evidence covering:

- Data classification, retention/deletion, browser persistence and exposure to AI/support/upload providers.
- Cryptographic/key inventories, service credential scopes, rotations, and provider encryption/backups.
- Production proxy attribution, egress boundaries, security configuration and deployment/source provenance.
- Logging ownership, immutable/protected storage, retention, incident alerting and session revocation procedures.
- Dependency remediation deadlines and reachable-component inventory.
- Privy authentication, recovery and factor controls, plus administrative authentication tests.

These are assurance gaps. Their existence does not prove all the underlying controls are absent. Provider documentation and configuration evidence may resolve some rows without code changes.

## 5. Verified strengths and test results

### Production observations

- SIWE sign-in succeeded for the disposable EOA; replay of the signed nonce failed with 401.
- Browser sessions used `__Host-session`, `Secure`, `HttpOnly`, `SameSite=Lax` and `Path=/`; cookie-mode verification returned no token in the response body.
- Unauthenticated protected API samples returned 401. The ordinary audit wallet received 403 from the sampled administrator APIs and only its own empty initiative list.
- Foreign and literal `null` Origin logout requests were rejected with 403 while the test session was valid.
- Logout and logout-all revoked the expected credentials, verified by subsequent 401 responses.
- Sampled APIs used `Cache-Control: no-store`. Site responses had `nosniff`, framing restrictions and a referrer policy. Detailed policy gaps remain ASVS-06/11.
- TLS 1.2 and 1.3 connections validated the target hostname. The observed certificate expires 11 December 2026. Older protocols and the entire cipher set were not enumerated.
- `/.env` and `/.git/HEAD` returned the SPA HTML fallback, not secret files or Git metadata. Status 200 alone would have been a false-positive exposure finding.

### Local validation

| Run | Result | What it supports |
|---|---|---|
| Existing API suite | **140 passed** | Existing auth, authorization, validation, chain-verification and route behavior under fixtures |
| Focused frontend suite | **37 passed in 7 files** | Markdown, session migration/authentication, avatar processing, donation and editing behavior |
| API audit reproductions | **5 passed** | The observed ASVS-01/03/04/07/09 weaknesses exist in the reviewed source |
| Client-cache audit reproductions | **2 passed** | The observed ASVS-12 cache behavior exists |
| CSV function execution | **Formula preserved** | ASVS-02 output is not neutralized |
| Lockfile advisory audit | **14 advisories** | Package inventory requires triage; exploit reachability remains unresolved |

**The seven audit reproduction tests assert the insecure behavior and therefore pass while those weaknesses exist.** They are evidence, not security regression acceptance tests; invert their assertions when fixing the defects. The local API reproductions used mocked network services and temporary state. Commands and evidence details are in the [evidence README](evidence/README.md).

Source review also found structured Deno KV keys, server-side validation and object authorization, random session credentials stored as hashes, and sanitized Markdown. Existing tests cover several of these paths. None of this constitutes exhaustive proof against every injection, race, or authorization flaw.

## 6. Remediation order and completion criteria

| Order | Work | Completion evidence |
|---|---|---|
| 1 | ASVS-01/02/03: outbound URL construction, safe export, verified consent | Inverted local reproductions pass; supported spreadsheet test; staging outbound and consent tests |
| 2 | ASVS-04/12 and G-01: session lifetimes, cache cleanup, administrator authentication assurance | Re-auth invalidates old token; promotion/idle cases bounded; private data erased on viewer changes; factor policy evidenced |
| 3 | ASVS-05/06/09: audit trail, enforced CSP, deployed IP attribution | Controlled events reach protected logs; browser workflow tests with enforcement; measured proxy attribution |
| 4 | ASVS-07/08/10/11: upload structure, capability transport, dependency triage and transport headers | Negative file tests; credential-free URLs; resolved/reasoned advisories; production header retest |
| 5 | G-02 and remaining matrix gaps | Evidence reviewed per requirement; exceptions explicit; deployment revision attested |

Resolve failed applicable requirements and complete partial/untested coverage before claiming the selected level. Recheck the deployed build after fixes; do not mark a production finding closed solely because a local patch passes tests. This assessment made no application fixes or deployment changes.

## 7. Evidence and standard provenance

- [Complete requirement matrix](control-matrix.md) and [JSON matrix](control-matrix.json).
- [Public HTTP/TLS observations](evidence/public-site.json) and [sanitized live SIWE observations](evidence/siwe.json).
- [Source fingerprint manifest](evidence/source-fingerprints.json).
- [API suite output](evidence/api-tests.txt), [focused frontend output](evidence/web-tests.txt), [API reproduction output](evidence/local-reproductions.txt), [client cache output](evidence/client-cache-tests.txt), and [CSV output](evidence/csv.json).
- [Dependency advisory output](evidence/dependency-audit.txt).
- [Reproduction instructions and scripts](evidence/README.md).

Requirement catalog: [official OWASP ASVS v5.0.0 flat JSON](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json). Download SHA-256: `8201b20eec2908c3380ac600c91c8ba746346fbb808859366abb232027532311`.

The standard text reproduced in the matrix is OWASP material licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Requirement text is unchanged; assessment columns are additions. The reproduced/adapted matrix is distributed under the same license. This report is an evidence-bounded assessment, not an OWASP certification.
