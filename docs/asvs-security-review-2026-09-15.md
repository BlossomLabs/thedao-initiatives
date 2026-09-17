# OWASP ASVS security review — initiatives.thedao.fund

Date: 2026-09-15. Commit reviewed: `645a7ef` (main). Reviewer: Claude (code review, not a penetration test).

## Scope

- **Target**: the initiatives board at https://initiatives.thedao.fund. One Deno Deploy app: `server.ts` serves the prerendered React Router SPA and the Hono API under `/api`.
- **Files reviewed**: all of `api/` (config, middleware, routes, services, chain, db), `server.ts`, `shared/`, and the security-relevant parts of `app/` (session, API client, markdown rendering, every place a stored URL becomes an `href` or `src`, admin gating). Tests were read for intent, not re-run.
- **Live checks**: response headers of the site and the API, a CORS preflight from a foreign origin, `/healthz`, `robots.txt`. No authenticated or state-changing requests were sent.
- **Dependency scan**: `deno audit` against `deno.lock`.
- **Trust boundary**: internet-facing. Data handled: wallet addresses, optional emails (comments, support), private funder leads and proposer contacts, donation records. The server holds no private keys and no funds; donations go wallet-to-Safe.
- **Standard**: OWASP ASVS 5.0 chapters (4.0.3 requirement IDs in brackets where they are the better-known reference).
- **Recommended target level**: **L2**. The site is public, moves donor money on-chain (non-custodially), and has an admin role that binds Safes and approves initiatives. It meets L1 today with the exceptions below; the gaps to L2 are concentrated in browser security headers, session-token storage, and audit logging.

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 2 |
| LOW | 6 |
| INFO | 3 |

No injection, authentication bypass, authorization bypass, or secret leak was found. The two medium findings are defence-in-depth gaps that turn any future XSS into full session theft: the site's HTML and assets carry no security headers, and the bearer token lives in `localStorage`.

## Findings

### [MEDIUM] Site pages and assets are served without any security headers

- **ID**: NDC-2026-001
- **CWE**: CWE-693 (Protection Mechanism Failure), CWE-1021 (clickjacking)
- **OWASP Ref**: ASVS 5.0 V3.4.1–V3.4.5 [4.0: V14.4.3, V14.4.4, V14.4.5, V14.4.6]; Top 10 A05
- **Location**: `server.ts:38-51` (`withCaching`), `server.ts:53-64` (`serveStatic`). The header middleware in `api/middleware/headers.ts:8-15` only runs inside the Hono app, so it covers `/api/*` and `/healthz` but not the HTML shell, `/assets/*`, or the prerendered pages.
- **Impact**: Confirmed live. `GET https://initiatives.thedao.fund/` returns no `Strict-Transport-Security`, no `Content-Security-Policy`, no `X-Frame-Options`/`frame-ancestors`, no `X-Content-Type-Options`, no `Referrer-Policy`. Consequences: the donate widget and the admin dashboard can be framed by a third-party page (clickjacking of the "Donate" or "Approve" buttons), a first visit over plain HTTP is not upgraded, and any injected script runs with no CSP to contain it (see NDC-2026-002 for why that matters here).
- **Evidence**:
  ```
  $ curl -sI https://initiatives.thedao.fund/
  HTTP/2 200
  cache-control: no-cache
  content-type: text/html; charset=UTF-8
  etag: W/"40a7-..."
  server: deno
  (no security headers)

  $ curl -sI https://initiatives.thedao.fund/api/board
  content-security-policy: default-src 'none'; frame-ancestors 'none'
  x-content-type-options: nosniff
  x-frame-options: DENY
  referrer-policy: strict-origin-when-cross-origin
  ```
- **Remediation**: Add the headers in `withCaching` (or a wrapper around `serveStatic`) so every non-API response carries them:
  ```ts
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy", CSP);
  ```
  For the CSP, start in `Content-Security-Policy-Report-Only` and tighten. The page has two inline scripts in `app/root.tsx:43-55` (critical CSS and the shell script); either move them to a hashed `<script>` (compute the SHA-256 at build time and add `'sha256-…'` to `script-src`) or to an external file. A starting policy:
  ```
  default-src 'self';
  script-src 'self' 'sha256-<shell-script>';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src https://fonts.gstatic.com;
  img-src 'self' data: https:;
  connect-src 'self' https://*.walletconnect.com wss://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org https://*.privy.io https://ethereum-rpc.publicnode.com https://eth.llamarpc.com https://cloudflare-eth.com https://eth.drpc.org https://*.alchemy.com;
  frame-src https://*.privy.io https://verify.walletconnect.com https://verify.walletconnect.org;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  ```
  `style-src 'unsafe-inline'` is needed for the inline `<style>` and Tailwind's runtime; drop it once the critical CSS is hashed. Verify the wallet-connector origins against the report-only violations before enforcing.
- **Confidence**: HIGH
- **Status (2026-09-15)**: FIXED. `api/lib/site-headers.ts` adds HSTS, nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy and an enforced `frame-ancestors 'none'; base-uri 'self'; form-action 'self'` to every static response from `server.ts`. The full policy (with SHA-256 hashes of the 17 inline scripts in the build, computed at startup) ships as `Content-Security-Policy-Report-Only`; set `CSP_ENFORCE=true` once the wallet flows show no violations in the console. Tests: `api/tests/site-headers.test.ts`.

### [MEDIUM] Session bearer token stored in `localStorage`, readable by any script on the origin

- **ID**: NDC-2026-002
- **CWE**: CWE-922 (Insecure Storage of Sensitive Information), CWE-522
- **OWASP Ref**: ASVS 5.0 V3.3 (cookie setup), V7.2/V7.5 [4.0: V3.2.3 "session tokens … not exposed in URLs or accessible to client-side script", V3.4]; Top 10 A07
- **Location**: `app/context/session.tsx:24,39-44` (`localStorage.setItem("thedao:session", …)`); `app/lib/api.ts:31-32` (attached as `Authorization: Bearer`).
- **Impact**: The token is a capability for the whole session: admin sessions last 12 h (`api/config.ts:95`) and can add new admins (`api/routes/admin.ts:106-109`), approve initiatives, and bind Safes. Any XSS on the origin, or a compromised third-party script (the Privy SDK chunk, WalletConnect modal, Google Fonts CSS are all loaded cross-origin), reads the token with one line. With no CSP (NDC-2026-001) there is nothing between an injected script and the token. Today's code has no XSS I could find (see Positive observations), so this is a defence-in-depth finding, not an exploitable one.
- **Evidence**:
  ```ts
  // app/context/session.tsx
  const KEY = "thedao:session";
  function save(s: SessionInfo | null) {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
  ```
- **Remediation**: Two acceptable paths.
  1. **Cookie session** (preferred for L2): have `POST /api/auth/verify` set `__Host-session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/` and have `sessionLoader` (`api/middleware/auth.ts:11-23`) read the cookie when no `Authorization` header is present. CSRF is already covered by the Origin guard (`api/middleware/headers.ts:22-35`) plus `SameSite=Lax`; keep the bearer path for the dev scripts. The site-lock code already shows the pattern (`api/lib/sitelock.ts:86-88`).
  2. **Keep the bearer, add compensating controls**: ship the CSP from NDC-2026-001 with `script-src` limited to `'self'` plus hashes, add Subresource Integrity to any cross-origin `<script>`, and shorten the admin session (e.g. 2 h with idle timeout).
- **Confidence**: HIGH (fact), MEDIUM (risk, since it needs a prior XSS)
- **Status (2026-09-15)**: FIXED. `POST /api/auth/verify` with `cookie: true` sets `__Host-session` (`HttpOnly; Secure; SameSite=Lax; Path=/`, plain `session` without `Secure` on http dev) and omits the token from the body; `sessionLoader` and the preview lock read the cookie when no bearer is sent; logout clears it. The browser now stores only `{address, isAdmin, expiresAt}`. The bearer path is unchanged for the dev scripts. Sessions stored before the change are migrated on the next page load (`POST /api/auth/cookie` exchanges the stored bearer for the cookie, `app/lib/session-migration.ts`), so nobody is signed out; that endpoint and helper can be removed a week after the deploy. Tests: `api/tests/session-cookie.test.ts`, `app/lib/session-migration.test.ts`. Verify after deploy that the `Set-Cookie` on production carries the `__Host-` name (it depends on the request scheme, or `X-Forwarded-Proto` with `TRUST_PROXY`).

### [LOW] DNS-rebinding window in the SSRF guard for Discourse links

- **ID**: NDC-2026-003
- **CWE**: CWE-918 (SSRF), CWE-367 (TOCTOU)
- **OWASP Ref**: ASVS 5.0 V2 (validation), [4.0: V12.6.1]; Top 10 A10
- **Location**: `api/services/forum.ts:17-27` and `api/lib/validate.ts:70-89`. `resolvePublicIps` resolves the host and checks every IP is public, then `fetch()` resolves the host a second time.
- **Impact**: A submitter controls `discourseUrl`. A DNS name that answers a public IP on the first lookup and `10.x`/`169.254.169.254` on the second lets the server issue one `GET https://<host>/<path>.json` to an internal address. Exposure is small: TLS must succeed for that host, redirects are not followed, the body is capped at 512 KB, and only the JSON `title` field (140 chars) is kept, as the initiative title visible to the proposer and admins. On Deno Deploy there is little internal network to reach. This is why it is LOW, but the pattern is the textbook one.
- **Evidence**:
  ```ts
  const [ips] = await resolve(u.hostname.toLowerCase());   // check
  if (!ips) return null;
  ...
  const res = await f(jsonUrl.toString(), { redirect: "manual", ... });  // separate resolution
  ```
- **Remediation**: The simplest fix is to stop fetching server-side: the form already has a title field, and the client can read the topic title itself. If the server fetch stays, restrict it to an allow-list of known forum hosts (`ethereum-magicians.org`, `ethresear.ch`, the Telegram case needs no fetch), which removes both the SSRF and the rebinding class. Pinning the resolved IP is not practical with Deno's `fetch` for HTTPS.
- **Confidence**: HIGH (pattern), LOW (exploitability)

### [LOW] Client-IP derivation can collapse every anonymous user into one rate-limit bucket

- **ID**: NDC-2026-004
- **CWE**: CWE-799 (Improper Control of Interaction Frequency), CWE-290
- **OWASP Ref**: ASVS 5.0 V2/V6.2 anti-automation [4.0: V11.1.4]
- **Location**: `api/middleware/ip.ts:10-27`; consumers in `api/routes/comments.ts:117-123`, `api/routes/initiatives.ts:274`, `api/routes/auth.ts:22,30`, `api/routes/support.ts:48`.
- **Impact**: When `getConnInfo` throws and `TRUST_PROXY` is unset, the IP becomes `"?"` and all anonymous traffic shares one bucket: three anonymous comments per hour for the whole site, five submissions per hour site-wide, five login attempts per minute for everyone. That is a self-inflicted denial of service. Conversely, if `TRUST_PROXY=1` is set but the edge in front does not append the client address as the right-most hop, a client can pick its own bucket by sending `X-Forwarded-For` and bypass every per-IP limit. Whether either applies depends on the Deno Deploy configuration, which I could not verify from the repo.
- **Remediation**: Add a startup log line and an admin-dashboard field showing the IP the server derived for the current request, and confirm on production which branch is active. If Deno Deploy exposes the client address through `Deno.ServeHandlerInfo.remoteAddr` (it does for `Deno.serve`), keep `TRUST_PROXY` off. Treat `ip === "?"` as an error state (reject anonymous state-changing requests, or log loudly) rather than a shared bucket.
- **Confidence**: MEDIUM

### [LOW] Vulnerable transitive dependencies in the browser bundle and no audit gate in CI

- **ID**: NDC-2026-005
- **CWE**: CWE-1395 (Dependency on Vulnerable Third-Party Component)
- **OWASP Ref**: ASVS 5.0 V15.2 [4.0: V14.2.1]; Top 10 A06
- **Location**: `deno.lock`; `.github/workflows/ci.yml` (no `deno audit` step).
- **Impact**: `deno audit` reports 14 advisories (2 high, 12 moderate), all transitive from the wallet stack (WalletConnect, Privy): `axios < 1.18.0` (ten advisories, one high: Node HTTP adapter proxy inheritance), `ws < 8.21.0` (high: memory exhaustion DoS; moderate: uninitialized memory disclosure), `uuid < 11.1.1`, `decode-uri-component ≤ 0.4.2`. None of these packages run on the server (`api/` uses `fetch` and viem only), and the high-severity axios and ws issues concern Node-side behaviour. Real exposure is low. The process gap is the real finding: Dependabot opens PRs but nothing fails a build when a known-vulnerable version is in the lock.
- **Evidence**:
  ```
  $ deno audit
  ws: Memory exhaustion DoS … Vulnerable: >=8.0.0 <8.21.0   (high)
  Axios Node HTTP adapter can use an inherited proxy …  <1.18.0 (high)
  Found 14 vulnerabilities: 0 low, 12 moderate, 2 high, 0 critical
  ```
- **Remediation**: Bump `@walletconnect/ethereum-provider` and `@privy-io/react-auth` to releases that pull `ws ≥ 8.21.0` and `axios ≥ 1.18.0`, then add to `ci.yml`:
  ```yaml
  - name: dependency audit
    run: deno audit
  ```
  If the wallet SDKs lag, allow the specific advisories with an expiry rather than skipping the step.
- **Confidence**: HIGH (advisories), LOW (exploitability)

### [LOW] No re-authentication or audit trail for high-impact admin actions

- **ID**: NDC-2026-006
- **CWE**: CWE-778 (Insufficient Logging), CWE-306 (step-up)
- **OWASP Ref**: ASVS 5.0 V16.2 (security event logging), V7.3/V6 (re-authentication for sensitive operations) [4.0: V7.1.3, V7.2.1, V2.2.x]
- **Location**: `api/routes/admin.ts:106-112` (add/remove admin), `:283-307` (status change and bulk), `:448-475` (Safe bind), `:157-164` (paid-out amount). `api/services/admins.ts:48-69` writes the admin list to KV with no record of who changed it.
- **Impact**: The text history is excellent (every revision stores author and source, `api/db/rfps.ts:309-342`), but the actions that move money or membership are not recorded anywhere except the console log stream: who approved an initiative, who bound which Safe, who set `paidOutUsd`, who added an admin. A stolen 12-hour admin token (NDC-2026-002) can add a persistent admin, and the incident would be reconstructible only from Deno Deploy logs. The Safe deployment itself is safe: it needs a wallet transaction and the server verifies the on-chain result (`api/chain/safe.ts:73-115`).
- **Remediation**:
  1. Append an immutable `["audit", ulid]` KV row `{at, actor, action, target, before, after}` from a small helper called in each admin mutation; show the last N on the dashboard.
  2. For admin add/remove and `approve`, require a fresh SIWE signature (a `POST /api/auth/verify` within the last 5 minutes, tracked as `session.reauthAt`) instead of the 12-hour token alone. The client already has `requireSession()`; add `requireFreshSession()`.
  3. Consider an idle timeout on admin sessions (refresh `expiresAt` on use, cap at 12 h).
- **Confidence**: HIGH

### [LOW] Host header drives origin rewriting of prerendered HTML without an allow-list

- **ID**: NDC-2026-007
- **CWE**: CWE-644 (Improper Neutralization of HTTP Headers)
- **OWASP Ref**: ASVS 5.0 V3.5/V13 [4.0: V14.1]
- **Location**: `server.ts:24-32` (`rewriteOrigin`), compared with the stricter `api/lib/origin.ts:15-23` (`selfOrigin`), which only trusts hosts under `SELF_HOST_SUFFIXES`.
- **Impact**: `rewriteOrigin` replaces every occurrence of `SITE_URL` in the HTML (canonical link, `og:url`, `og:image`) with the origin of the incoming request, whatever the `Host` header says. Deno Deploy routes by hostname, so an attacker cannot make the app answer for an arbitrary host, and HTML is `no-cache`, so there is no cache poisoning. The residual risk is a staging or a custom-domain misconfiguration that turns a Host-header value into social-card URLs. Low.
- **Remediation**: Reuse `selfOrigin()` (or the `webOrigins` list) and only rewrite when the request origin is one the app is configured to serve.
- **Confidence**: HIGH (behaviour), LOW (impact)

### [LOW] Admin pledge editor accepts `http://` links while every other path is https-only

- **ID**: NDC-2026-008
- **CWE**: CWE-319
- **OWASP Ref**: ASVS 5.0 V12 [4.0: V9.1.1]
- **Location**: `api/routes/admin.ts:347-350` (`/^https?:\/\//i`), versus `api/lib/validate.ts:134-150`, `api/lib/structured.ts:96-104`, and `app/lib/utils.ts:12-14` which all insist on `https:`.
- **Impact**: Admin-only input, rendered as an anchor in `app/components/initiative/Backers.tsx:22` and `app/routes/admin.initiative.tsx:833`. No script injection (the scheme check blocks `javascript:`), just an inconsistency that lets a backer link be plain HTTP.
- **Remediation**: Call `validateHttpsLink` in `readPledge`.
- **Confidence**: HIGH

### [INFO] Private-preview lock cookie is static and long-lived

- **ID**: NDC-2026-009
- **Location**: `api/lib/sitelock.ts:53-66, 86-88`.
- **Note**: The cookie is `HMAC-SHA256(password, "site-lock:" + username)`, so it never changes until the password does, and it is valid for 30 days. Comparisons are constant-time and the cookie is `HttpOnly; Secure; SameSite=Lax`, which is correct. For a preview gate this is fine; if the lock is ever used to protect something sensitive, include a time bucket in the HMAC input so cookies expire without a password change. The `Secure` flag also means the lock cookie is never set on plain-HTTP local dev, which is intentional.

### [INFO] Public on-ramp links embed the provider API key

- **ID**: NDC-2026-010
- **Location**: `api/lib/onramp.ts:9-24`, served on every board and initiative response.
- **Note**: Transak and MoonPay widget keys are publishable by design, so this is expected. Make sure the key configured in `ONRAMP_API_KEY` is the widget key with domain restrictions enabled on the provider dashboard, not a secret/server key.

### [INFO] `DISABLE_RATE_LIMITS` is a production footgun

- **ID**: NDC-2026-011
- **Location**: `api/config.ts:196`, `api/db/ratelimit.ts:26-28`, `api/bootstrap.ts:38-40`.
- **Note**: The flag switches off every limit, including login throttling. It logs a warning at boot, which is good. Consider surfacing it on the admin dashboard as a red banner so it is not forgotten after a live session, and consider excluding the login limits from the switch.
- **Update (2026-09-17)**: `DISABLE_RATE_LIMITS` is removed. `RATE_LIMIT_MODE=observe` replaces the all-or-nothing switch for production: every bucket keeps counting and reports breaches as structured log lines, while submissions, support messages and uploads keep refusing. `off` remains available for live sessions. IPv6 quota identities are the /64 prefix.

## ASVS 5.0 chapter coverage

| Chapter | Status | Basis |
|---------|--------|-------|
| V1 Encoding & Sanitization | Pass | JSON API only, no SQL/shell; markdown through `rehype-sanitize` with the default schema (`app/components/Markdown.tsx`); stored URLs re-checked for `https:` at render (`app/lib/utils.ts`). |
| V2 Validation & Business Logic | Pass, with NDC-004 | Allow-lists for enums (comment types, actions, statuses), length caps on every string, numeric ranges, structured-body byte caps, honeypots, KV-backed per-IP and per-address rate limits that fail closed under contention. |
| V3 Web Frontend Security | **Gap** (NDC-001, NDC-002) | API responses carry headers; site responses carry none. CORS is a strict allow-list (verified: preflight from a foreign origin returns no `Access-Control-Allow-Origin`). Origin guard on all non-GET requests. |
| V4 API & Web Service | Pass | 2 MB body limit, JSON parsing tolerant of garbage, multipart only where expected, `Content-Disposition` filenames restricted to `[a-z0-9-]`. |
| V5 File Handling | Pass | Uploads sniffed by magic bytes (`api/lib/validate.ts:163-174`), size-capped, pinned to IPFS, only the CID stored; pre-submit CIDs bound to the uploading wallet for 24 h. |
| V6 Authentication | Pass | SIWE (EIP-4361) with domain, URI origin, chain, `issuedAt` window (±300 s), `notBefore`/`expirationTime`, single-use nonce consumed atomically; EIP-1271 fallback fails closed; per-IP and global login throttles. No passwords. |
| V7 Session Management | Partial (NDC-002, NDC-006) | 256-bit CSPRNG tokens stored as SHA-256 hashes, TTL enforced server- and KV-side, logout and logout-all, admin flag re-read on every request. Missing: HttpOnly storage, idle timeout, re-auth for sensitive actions. |
| V8 Authorization | Pass | `requireAdmin` applied router-wide to `/api/admin`; proposer checks compare the session address to the stored `proposer`; pending/rejected rows hidden from everyone else (`api/routes/initiatives.ts:94-107`); private fields (`contact`, `funders`, comment `email`) leave only through the admin serializers (`api/lib/json.ts`); `initiativeId` binding prevents writes to a reused slug. |
| V9 Self-contained Tokens | N/A | Opaque server-side sessions. |
| V10 OAuth/OIDC | N/A | Privy email login is client-side and produces an EOA that signs SIWE like any wallet; the API never sees Privy. |
| V11 Cryptography | Pass | WebCrypto HMAC, `crypto.getRandomValues`, viem for keccak/ECDSA recovery; no custom crypto. |
| V12 Secure Communication | Partial (NDC-001 HSTS) | TLS terminated by Deno Deploy; every outbound call (RPC, Safe API, Pinata, ENS, AI, support) is HTTPS with timeouts. |
| V13 Configuration | Partial (NDC-001 CSP, NDC-011) | Secrets only via env; `.env` ignored and absent from history; `deno task start` runs without `--allow-run`; config addresses checksum-validated at boot. |
| V14 Data Protection | Pass | `Cache-Control: no-store` on the API; minimal PII; private fields scoped; donation records hold only public chain data plus the terms-acceptance hash. |
| V15 Secure Coding & Architecture | Partial (NDC-005) | Extensive tests (SIWE, origin, sitelock, Safe verification, structured input); Dependabot weekly; no SCA gate. |
| V16 Logging & Error Handling | Partial (NDC-006) | Generic `{error}` bodies, stack traces only to the log; AI screening decisions logged; no admin audit trail. |
| V17 WebRTC | N/A | |

## Positive observations

- **Money never trusts the browser.** Donation amounts, donors and tokens come from the receipt logs or the transaction (`api/chain/verify.ts`), credited only after `MIN_CONFIRMATIONS`; Chainlink answers are rejected when stale or out of range (`api/chain/price.ts`); the headline "raised" is the Safe's own balance.
- **Safe binding is verified on-chain**, not taken from the client: predicted CREATE2 address, then threshold, owner set, singleton and fallback handler are read back before an initiative can be approved (`api/chain/safe.ts:73-115`, `api/routes/admin.ts:448-475`). Approval without a verified Safe is refused.
- **SIWE is implemented carefully** and covered by tests: every field the spec calls for is checked, the nonce is single-use with a 5-minute TTL, and the `*.deno.net` self-origin logic is explicit about why a bare `Host` header is not trusted.
- **Impersonation controls**: `.eth` display names and nicknames must forward-resolve to the signing wallet; forward resolution fails closed.
- **SSRF hardening** already exists (public-IP check, no redirects, 6 s timeout, 512 KB cap); NDC-003 is about the last gap in it.
- **AI outputs are treated as untrusted**: ranking results are intersected with known IDs, moderation verdicts are enum-checked, and prompts state that user text is data. Any AI failure holds the comment rather than publishing it.
- **One serializer module** (`api/lib/json.ts`) decides what leaves the API, which is the right structure for keeping private fields private.
- **Preview lock** uses constant-time comparison and a properly flagged cookie.
- **No secrets** in tracked files or in git history (pattern scan for private keys, JWTs, API keys).

## Suggested order of work

1. Security headers on the static server, CSP in report-only first (NDC-001). Half a day.
2. `deno audit` in CI and bump the wallet SDKs (NDC-005). One hour plus whatever the bumps break.
3. Audit-log helper for admin mutations (NDC-006). Half a day.
4. Decide on cookie sessions versus CSP-as-compensating-control (NDC-002). One day if cookies.
5. Drop or allow-list the Discourse title fetch (NDC-003). One hour.
6. Verify the client-IP path on Deno Deploy and harden the `"?"` case (NDC-004). One hour.
7. `validateHttpsLink` in the pledge editor, `selfOrigin` in `rewriteOrigin` (NDC-007, NDC-008). Minutes.
