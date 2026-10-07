# Security assessment — 7 October 2026

**Repository:** [blossomlabs/thedao-initiatives](https://github.com/blossomlabs/thedao-initiatives)  
**Source revision:** `a70726c0f776ffcc2f50cb9f0c3774d44834d134` (`main`)  
**Public target:** [initiatives.thedao.fund](https://initiatives.thedao.fund/)  
**Standard:** OWASP ASVS **5.0.0**, cumulative **Level 2** (L1 + L2)  
**Method:** source-assisted follow-up, isolated local reproductions, dependency audit, bounded public HTTP observations

## Executive assessment

**Four findings remain open: two Medium and two Low.** The most consequential are an indirect ENS/CCIP-Read outbound-request boundary and a concurrent administrator-membership update that can restore a removed administrator. A further authorization gap allows an older administrator session to read private contacts and funder leads through alternative endpoints despite the documented fresh-signature requirement. The current dependency audit reports one High-severity package advisory; its application-context rating here is Low because a public attacker-controlled path to the vulnerable function was not established.

The September review's [closure and owner decisions](../production-verification-2026-09-18/report.md) remain the historical baseline. These findings do not revoke that closure or silently turn accepted exceptions into passes. This follow-up does **not** establish ASVS Level 2 compliance or independently attest the deployed source revision.

The existing suites passed **336 API tests and 666 frontend tests**. Three additional isolated tests reproduce the defects in OCT-01 through OCT-03. Those tests intentionally pass when the reported defects exist; they are evidence, not proof that the application is secure. API and frontend type checks and application lint passed. See [verification](verification.md) for commands, results and limitations.

## 1. Scope and evidence boundaries

The review covers first-party routes and middleware, SIWE/session lifecycle and authorization, proposal and donation records, private-field serialization, rendering, uploads, external integrations, caches, public feeds, account watchlists, administrator changes, backup/restore, deployment entry points, CI and the resolved lockfile. Particular attention was given to functionality and policy changes since the September review. No application fixes were made; the working-tree additions are this report and its evidence.

Local reproductions use the application harness and actual application routes/services against temporary KV state, synthetic credentials and mocked upstream responses. The ENS reproduction uses the **locked viem 2.56.8 implementation**, rather than a rewritten approximation. The final reproduction run explicitly denies network access. Source and resolved dependency fingerprints are in [source-fingerprints.json](source-fingerprints.json).

The live sample contains **14 unauthenticated GET requests**, collected at **02:29:22–02:29:27 UTC on 7 October 2026**: 12 HTTPS requests and two HTTP redirect observations. Requests carried no credential, followed no redirects, and made no production mutation. Response reads were capped at 1 MiB plus one byte and only metadata, hashes and limited structural checks were saved in [public-site.json](evidence/public-site.json). No sampled body was truncated. No internal-network URL, exploit gateway, transaction, upload, load test or production administrator action was submitted.

The observed application version was `a857654e`. The code derives this identifier from build assets; it is **not evidence that production runs commit `a70726c`**. Source findings concern the cloned revision unless explicitly described as live observations.

No authenticated live session, provider administration access, production logs, secrets, deployment configuration export or private production data was supplied. Production egress reachability, Privy recovery/MFA, credential scope, KV durability/encryption, backup recovery and external security alerting remain unverified. This is an application review, not a smart-contract, Safe custody or infrastructure penetration audit.

### ASVS coverage

The [control matrix](control-matrix.md) and [JSON inventory](control-matrix.json) retain all **253** cumulative L1/L2 requirement identifiers and exact texts from the previous assessment's versioned official catalog. This follow-up assigns dispositions to **67 controls**: 27 PASS, 5 FAIL, 31 PARTIAL and 4 ACCEPTED EXCEPTION. The other **186 are NOT REASSESSED**, meaning this follow-up makes no current claim for them. Counts are not a compliance percentage. The September matrix is linked separately, rather than copied into current passes or failures. Owner exceptions have a distinct disposition and are not passes. The 92 L3-only controls remain outside scope.

## 2. Finding summary

Severity is a contextual triage judgment, not a calculated CVSS score. No Critical or High application exploit was demonstrated.

| ID | Finding | Severity | Evidence | ASVS 5.0.0 |
|---|---|---|---|---|
| [OCT-01](#oct-01--ens-ccip-read-can-request-private-http-destinations) | ENS CCIP-Read can request private HTTP destinations | Medium, conditional | Public route + real viem, mocked RPC/fetch | 1.3.6; related 15.2.2, 15.3.2 |
| [OCT-02](#oct-02--private-lead-reads-bypass-fresh-authentication) | Private lead reads bypass fresh authentication | Low | Three full-route counterexamples | 8.2.3, 15.3.1 |
| [OCT-03](#oct-03--concurrent-admin-updates-can-restore-removed-membership) | Concurrent admin updates can restore removed membership | Medium | Two overlapping authenticated routes | 2.3.3, 8.2.1 |
| [OCT-04](#oct-04--locked-source-map-js-advisory-fails-the-dependency-gate) | Locked source-map-js advisory fails the dependency gate | Low; package advisory High | Frozen lockfile audit + dependency paths | 15.2.1, evidence partial |

## 3. Detailed findings

### OCT-01 — ENS CCIP-Read can request private HTTP destinations

**Medium, conditional · CWE-918 · high confidence in local request behavior; production network reachability untested**

[ens.ts:36](../../../api/services/ens.ts#L36) creates a mainnet viem public client without disabling or overriding CCIP-Read. [bootstrap.ts:73](../../../api/bootstrap.ts#L73) enables this resolver in the application. The unauthenticated [ENS-name route](../../../api/routes/profile.ts#L21) resolves a user-selected wallet address; profile name/ownership and avatar resolution also use the same service.

The five-second timeout and injected `fetchFn` apply to the **RPC transport**. They do not constrain viem's subsequent offchain gateway fetches. The locked `utils/ccip.js` calls global `fetch` with resolver-supplied URLs, no destination allowlist, no application deadline, default redirect following and no response-size cap. Its local batch gateway implementation recursively executes nested resolver requests. A valid outer `OffchainLookup.sender` check binds the callback to the called resolver; it does not make the nested HTTP destination safe.

The [reproduction](evidence/api-reproductions.test.ts) provides a correctly encoded Universal Resolver `OffchainLookup` envelope with `x-batch-gateway:true` and an embedded resolver query. It observes:

| Entry point | Mocked gateway request | Result |
|---|---|---|
| Anonymous `GET /api/ens-name/<wallet>` | `GET http://127.0.0.1:8888/internal/0x1234` | Route returns 200 after callback failure; request was already attempted |
| Application forward ENS resolver | `POST http://169.254.169.254/metadata` with CCIP JSON body | Gateway request attempted before callback failure |

Both requests have no abort signal and use the fetch default for redirects. All destinations are intercepted by a mock; **neither address was actually contacted**. A failed final ENS identity check does not undo an earlier HTTP request. The public-route rate limit and cache reduce frequency, but do not validate destinations.

**Prerequisites and impact:** an attacker must control a resolver/name or reverse-resolution path capable of producing an offchain query, or influence the trusted RPC response. The protocol permits resolver-directed offchain queries: [EIP-3668](https://eips.ethereum.org/EIPS/eip-3668) describes gateway URL templates and GET/POST behavior, and the [ENS Universal Resolver documentation](https://docs.ens.domains/resolvers/universal/) describes the local batch gateway behavior supported by viem. The source/test establish that such an envelope reaches unvalidated fetches; an attacker-controlled resolver was not deployed on mainnet during this review. Impact depends on production egress and reachable services. Internal responses, metadata credentials, fund theft and code execution were not demonstrated. Unbounded gateway work also creates an availability concern.

**Fix:** set `ccipRead: false` if offchain ENS resolution is unnecessary. If needed, supply a vetted `ccipRead.request` policy and enforce egress restrictions for every gateway and nested batch request. Restrict protocols, hosts and ports; block loopback, private, link-local and other prohibited IPv4/IPv6 destinations at connection time; disable redirects or validate every hop. DNS rebinding and redirect validation require actual connection/egress enforcement, not merely a preliminary hostname lookup. Bound total time, response bytes, batch size, recursion and concurrency. Changing only the RPC `fetchFn` or avatar image URL validation does not close this path.

**Retest:** repeat against reverse, forward and text-record resolution with valid local-batch envelopes. Forbidden destinations and redirect/DNS changes must generate no outbound connection. Slow/oversized gateways and nested batches must terminate within the documented limits. Then verify legitimate supported offchain names still resolve.

### OCT-02 — Private lead reads bypass fresh authentication

**Low · CWE-863 · confirmed locally; requires an existing administrator credential**

The [session policy](../../session-security.md#L10) requires a wallet signature within five minutes for funder leads/private contacts, specifically to limit a leaked administrator cookie. `/api/admin/leads` implements that check at [admin.ts:624](../../../api/routes/admin.ts#L624). Other readers return the same private fields with only current administrator membership:

- `GET /api/admin/initiatives/:id` returns `adminInitiative` at [admin.ts:219](../../../api/routes/admin.ts#L219).
- `GET /api/initiatives/:slug` treats every administrator as entitled to the proposer/private shape at [initiatives.ts:166](../../../api/routes/initiatives.ts#L166).
- `GET /initiative/:slug-PRIVATE.md` checks `requireAdmin` and explicitly enables private fields at [markdown.ts:23](../../../api/routes/markdown.ts#L23).

`adminInitiative` includes both `contact` and `funders`; `proposerInitiative` is an alias at [json.ts:107](../../../api/lib/json.ts#L107). The dashboard card shape also includes `contact`, and edit responses use the private shape. Protecting only the dedicated leads endpoint is insufficient.

**Reproduction:** create an approved initiative owned by another synthetic wallet with distinctive private markers. Mint an admin session, advance the clock to **301 seconds**, and request the leads export. It returns **403 with `reauthenticate: true`**. The three alternative paths each return **200 containing both markers** with the same session. The anonymous initiative response omits the markers, and the private Markdown request without credentials returns 401. See [local output](evidence/local-reproductions.txt).

**Impact:** a stolen or retained administrator credential older than five minutes can read the private data without the new wallet proof required by policy. Current membership and normal session expiry still apply. This is not an anonymous disclosure or ordinary-user privilege escalation. The current documented absolute/idle limits are seven days/one day for both user and admin sessions; active requests can keep the idle clock alive within the absolute limit.

**Fix:** enforce freshness when deciding whether an administrator may receive private contact/funder fields, across JSON, Markdown, dashboard rows and mutation responses. Either challenge before the read or omit those fields until recent authentication is present. Preserve a proposer's access to their own fields under the documented ownership policy. Make browser callers handle the existing reauthentication challenge consistently.

**Retest:** cover fresh/stale administrators, ordinary users, anonymous users and the owning proposer across every private serializer and export. Older administrators must not retrieve another proposer's private markers through an alternative read or a harmless edit response.

### OCT-03 — Concurrent admin updates can restore removed membership

**Medium · CWE-362 · confirmed locally; requires overlapping authorized membership changes**

[admins.ts:52–72](../../../api/services/admins.ts#L52) stores all dynamic administrator addresses in one KV array. Addition and removal each read that array, compute a replacement and call `db.meta.set` without a version check or transaction. Independent authorized requests can therefore overwrite each other's changes.

**Reproduction:** begin with dynamic administrator A. A fresh fixed administrator starts `POST /api/admin/admins` to add B; the test pauses the write after it has computed `[A, B]`. `DELETE /api/admin/admins/A` then returns 200, removes A and revokes A's sessions. Releasing the earlier addition writes `[A, B]` over the removal and returns 200. Current membership reports A as an administrator again.

The old A session still returns **401**: revocation itself worked. The test then simulates the membership lookup and session issuance performed during fresh authentication; the newly issued session receives **200** from the admin-list API. No real wallet signature was supplied in this last step; it demonstrates that the restored authoritative membership will be used when A next authenticates normally. See [reproduction source](evidence/api-reproductions.test.ts) and [results](evidence/local-reproductions.txt).

**Impact:** a successful administrator removal can be silently reversed by an unrelated simultaneous addition, restoring continuing privileged access to the removed wallet on fresh login. Concurrent additions/removals can also lose intended changes. An anonymous user cannot create this race through the membership endpoints; both operations require a current administrator and recent authentication. The removed wallet must still control its key to sign in again.

**Fix:** update the membership list with KV compare-and-set and retry on conflicts, or use independent per-wallet membership keys with appropriate transactional checks. Ensure a successful removal remains authoritative and session revocation follows the committed membership transition. Preserve fixed-admin and self-removal restrictions and the fresh-authentication gate.

**Retest:** deterministic overlapping add/add, add/remove and remove/remove operations must preserve both intended transitions. After successful removal, the wallet must remain a non-admin after competing operations and normal fresh authentication. Previously issued sessions must remain invalid.

### OCT-04 — Locked source-map-js advisory fails the dependency gate

**Low in application context · High package advisory · runtime exploitability unresolved**

The frozen audit of the checked-in lockfile exits **1** with one advisory: [GHSA-68fv-2mgg-jv7q / CVE-2026-93749](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), an event-loop denial of service involving indexed source-map section offsets in `source-map-js`. The locked **1.2.1** is affected; the advisory identifies **1.2.2** as patched. See [audit output](evidence/dependency-audit.txt).

The [lockfile traversal](evidence/dependency-tree.txt) identifies direct parents `@tailwindcss/node@4.3.3`, `postcss@8.5.28` and `css-tree@3.2.1`, with paths through Tailwind/Vite/React Router build tooling and jsdom/Vitest test tooling. PostCSS consumes source maps, but this review did not establish that a public application request provides a malicious indexed source map to the vulnerable `SourceNode.fromStringWithSourceMap` path. A deployed denial-of-service exploit was not attempted or demonstrated.

**Impact:** the current dependency gate fails, and development/build/test processing retains a known vulnerable component. The High scanner rating is not evidence of High application impact. The [dependency policy](../../dependency-security.md) already sets a seven-day remediation target from discovery for High advisories. Its clean September scan is a historical result. This review does not establish when maintainers first discovered this advisory, so it does not claim that the remediation deadline has already been breached.

**Fix:** update the owning dependencies or narrowly resolve `source-map-js` to a supported patched version, regenerate the lockfile, and rerun the frozen audit, build and relevant regressions. If an exception is justified, record the precise package/advisory, reachability evidence, owner, compensating controls and expiry under the existing policy; do not disable the audit or ignore registry errors broadly.

**Retest:** the lockfile must no longer resolve an affected version, or contain a documented policy-compliant exception. The exact CI audit command must succeed and production build and source-map processing must remain functional.

## 4. Previous closures, owner exceptions and new functionality

| Area | Current evidence and disposition |
|---|---|
| Earlier forum SSRF | The old forum-fetch integration is absent. OCT-01 concerns a different ENS gateway path; no regression of that specific fix was established. |
| Fresh authentication and content sync | Sensitive admin routes, including sync, backup/restore and membership changes, have the freshness gate. Existing admin-reauth tests pass. OCT-02 identifies alternate private reads, not a reopened content-sync gate. |
| Restricted revision cache | Current denied-revalidation cleanup and existing frontend tests support the September fix locally. Administrator revision actions were not repeated live. |
| Browser CSP | Live homepage uses enforced CSP, has no report-only policy, and all eight observed inline script hashes are allowed by the enforced policy. Header/hash checks do not repeat the earlier browser execution-blocking test. |
| API HSTS and transport | All 12 sampled HTTPS responses, including 401/404 errors, have HSTS and the expected security headers. The two plain-HTTP requests still receive exact-HTTPS 301 redirects. The previously accepted edge redirect exception is unchanged; no credentials were sent. |
| CSV, upload rewriting and claim URLs | Current CSV/image validation code and passing local suites support the fixes. CSV was not opened in Excel/LibreOffice again and no image was uploaded live. Retired `GET /api/comments/mine` still returns 404. |
| Session lifecycle | Local lifecycle tests pass. Current documented limits are seven days absolute and one day idle for users/admins, with five-minute step-up and passive polling. The older September lifetimes must not be treated as current policy. No live rotation/replay/logout test was repeated. |
| Donation consent | Receipt verification and authenticated donor flags remain distinct. The previously accepted browser-only consent redesign decision is preserved; this review does not turn unauthenticated terms submission into proof of wallet consent. |
| Rate limiting/IP attribution | The earlier production `observe` decision remains an owner exception. Source defaults/configuration and local IP/rate-limit tests do not prove current deployed mode or spoof resistance. No live burst test was performed. |
| Security logging and MFA/operations | Structured audit events are present. The accepted stdout/dashboard retention and lack of external alerting remain exceptions. Fresh SIWE is not an independent second factor. Provider, operations and recovery assurance remain unverified. |
| Browser drafts | Wallet-scoped drafts and Keep/Delete/Cancel behavior are intentional current policy. Retaining a draft is not classified as a new server-data leak; origin scripts can still read retained local drafts. Local privacy/session/revision tests pass. |
| Public feeds and shared cache | Source uses explicit public field shapes and approved-only feed selection. Feed tests contain private markers and pass. The live JSON feed has 49 entries and no sampled private field names. This does not detect secrets manually placed in public prose. |
| Account watchlists | Server ownership comes from the session wallet. Tests cover cross-wallet isolation, bounds, rate limits, approved-only IDs and concurrent imports; all pass locally. No authenticated live watchlist operation was performed. |
| Database backup/restore | Export/restore require fresh admin auth; restore also requires maintenance mode and a 32 MiB limit. Local tests cover exclusion of sessions/TTL secrets, malformed-input rejection and restoration behavior. Production confidentiality, recovery durability and a real restore were not verified. |

## 5. Remediation order and closure evidence

1. Contain ENS gateway requests by disabling unsupported CCIP-Read or adding vetted gateway/egress enforcement and resource limits.
2. Make administrator membership changes atomic and add overlapping-operation regressions.
3. Apply the documented private-field freshness policy to all readers and serializers.
4. Remove the vulnerable source-map resolution and restore a passing frozen dependency gate under the existing remediation policy.

Each source fix needs a counterexample-based regression test and a fresh report of its locked dependencies and revision. Deployment closure additionally needs evidence that the corrected source is deployed. Production egress/identity-provider/operational assurance and earlier owner exceptions remain separate evidence items. Neither passing the existing suites nor closing these four findings would by itself establish full ASVS compliance.

## Evidence index

- [Verification methods and commands](verification.md)
- [ASVS control matrix](control-matrix.md) and [machine-readable inventory](control-matrix.json)
- [Evidence README](evidence/README.md), [local probes](evidence/api-reproductions.test.ts), [local results](evidence/local-reproductions.txt)
- [Bounded live observations](evidence/public-site.json), [collector](evidence/public-site-check.py)
- [Dependency audit](evidence/dependency-audit.txt) and [dependency paths](evidence/dependency-tree.txt)
- [Source/dependency fingerprints](source-fingerprints.json) and [evidence checksums](artifact-sha256.json)
