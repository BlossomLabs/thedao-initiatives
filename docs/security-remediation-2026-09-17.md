# Security report remediation — 17 September 2026

This records the eight authorized code changes against the 15 September reports. The historical
reports remain evidence of their original snapshots. Changes are local; production closure requires
deployment verification. No existing proposal, profile, contact or funder records were deleted.

Final local validation: 297 web tests and 232 API tests passed, together with application/API type
checks, lint, production build/prerender, and the frozen-lockfile dependency audit. An existing
zero-millisecond Safe-sync test was made deterministic by advancing its test clock at the first
response; production sync behavior is unchanged. The built homepage/wallet picker and CSP blocking/
redacted reporting were checked in a browser. Draft/logout choices and wallet isolation were verified
with component tests; the subsequent authenticated browser fixture was blocked by the browser client.

| # | Change | Verification |
| --- | --- | --- |
| 1 | Cancel/purge private queries on viewer or privilege changes; scope caches and draft storage by wallet; revalidate restricted revisions and erase a cached revision when revalidation is denied (401/403/404), so neither the page text nor the diff can keep showing it. Keep each wallet's draft through switching/reload/reauthentication; logout offers keep, delete this wallet's draft, or cancel. | Session, autosave, revision and admin component regression tests, including last-keystroke recovery, deletion choice, offline logout, late responses, and a same-viewer revision denial on refetch and remount. |
| 2 | Require recent SIWE for admin membership, initiative status/bulk changes, Safe binding, payouts, proposer reassignment and content sync (which publishes approved initiatives); the browser and the CLI script retry an explicit challenge once. | Stale/fresh/ordinary-user API checks, including that a stale sync creates nothing; client refusal and retry tests. Valid Privy embedded-wallet sessions normally renew without another email code. |
| 3 | Enforce hashed-script CSP by default, allowlist connection/frame providers, deny base/object injection, collect redacted bounded reports. | Policy and collector tests; built homepage hydration/wallet picker; browser probe blocked an unauthorized inline script. |
| 4 | Audit the frozen lockfile in CI; document ownership, deadlines and narrowly scoped exceptions. | Final `deno audit --lock=deno.lock --frozen-lockfile`: no known vulnerabilities; no exceptions. |
| 5 | Decode and re-encode PNG/JPEG/WebP before Pinata; strip metadata and appended content; bound dimensions, work and output size. | Real fixtures for all three formats, malformed/truncated images, dimension/pixel limits and provider-not-called checks; tested with server runtime permissions. |
| 6 | Send comment capabilities in POST bodies, use opaque query keys, enforce expiry and provide atomic explicit rotation; revoke on moderation. | Claim-holder access, invalid claims, retired GET, rotation, expiry, moderation and safe logging tests. |
| 7 | Rewrite static HTML only for configured browser origins or trusted deployment host suffixes. Hash the actual rewritten inline scripts. | Trusted preview, hostile suffix/port/scheme and forwarding-header cases. |
| 8 | Use shared HTTPS URL validation for admin pledge creation/editing before uploading logos; reject invalid links without changing the pledge. | HTTPS/blank success, HTTP/invalid rejection and existing-data preservation tests. |

## Image processing policy

Input and normalized output must fit the existing route byte cap (logos 1 MiB; profile images retain
their configured cap). Raster dimensions are at most 4096 per side and 4,000,000 pixels. Decode workers are
initialised once per server isolate (warmed at boot) and reused; each decode has an 8-second deadline
that starts once the worker is ready, and a worker that misses it is terminated and replaced. At most
two decode workers run per server isolate. ImageMagick limits pixel
cache and individual allocation requests to 64 MiB, disables disk cache, limits profiles to 1 MiB and
limits working-image lists to four. These are decoder limits, not a total runtime heap quota.

Only PNG/JPEG/WebP coders are permitted; external delegates are disabled. The first frame is read,
oriented and re-encoded; animations and metadata are not retained. Decoder warnings or errors fail
closed. JPEG/WebP use quality 85. A normalized result exceeding the route byte limit is rejected.
New content-logo reuse hashes include the normalization-policy version. Existing CIDs are retained;
this does not retroactively sanitize previously uploaded objects.

## Comment capability lifecycle

Claims authorize only their own held comment, independently of login state. They expire 30 days
after issuance, with both a KV TTL and an application check. Legacy records lacking `claimExpiresAt`
use `createdAt + 30 days`; old records remain stored and available to moderation after token expiry.
Publishing/discarding revokes the index. POST `/api/comments/claims/rotate` with `{ "token": "…" }`
atomically replaces an unexpired claim and returns the replacement and its expiry. The old token
immediately fails. Rotation is explicit so a routine read or lost response cannot unexpectedly replace
an author's stored token. A lost rotation response cannot recover the replacement through the old
token. A browser UI for manual rotation is not added.

POST `/api/comments/mine` accepts at most 20 claims in `{ "tokens": [...] }`, is origin-checked,
rate-limited and returns `no-store`. Query keys contain an opaque scope, never credentials. Application
audit events exclude request bodies and tokens. Configure edge/APM logging to exclude these bodies
and redact legacy `tokens` query parameters; the application cannot erase historical external logs.

## Deployment checks still required

- Ensure `CSP_ENFORCE=false` is not left in deployment configuration. Configure explicit extra browser
  API/RPC origins through `CSP_CONNECT_ORIGINS`; server-only service URLs do not belong there.
- Exercise real Privy sign-in/renewal, injected wallets, WalletConnect and a donation in staging. Local
  mocked integration checks and the built wallet picker do not prove all live provider flows.
- Verify the deployed runtime bundles the decoder worker and its npm WebAssembly asset, and upload
  each supported format through the actual image provider.
- Configure durable ingestion/alerts for the existing security audit stream and the new `securityCsp`
  events. CSP telemetry deliberately retains only directive, resource category and time, never URLs
  or script samples; use browser diagnostics when investigating a blocked provider.
- The ASVS MFA assurance gap and other operational/provider evidence remain open. Recent SIWE with
  an already unlocked embedded wallet is not an independent factor or proof of fresh human consent.

See [session policy](session-security.md) and [dependency policy](dependency-security.md) for the
data-preservation behavior and maintenance requirements.
