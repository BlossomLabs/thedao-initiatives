# Production verification and closure — 18 September 2026

## Verdict

**The September 2026 security review is closed.** The remediation reported on
[15 September](../asvs-2026-09-15/report.md) and retested on
[17 September](../retest-2026-09-17/report.md) was verified against the live site at
https://initiatives.thedao.fund on 17–18 September. The two implementation gaps from the retest
(R-01, R-02) are in the deployed build, and the two production findings (R-03, R-04) are resolved.
Three items are closed as accepted exceptions rather than passes; they are listed under
[Accepted exceptions](#accepted-exceptions) with the owner's decision.

Checks were made with unauthenticated requests, a throwaway wallet signed locally, and the owner's
own non-admin wallet in a browser. No admin session was used. Side effects on production: two
sessions and one nickname on the owner's wallet (since signed out), sessions for the throwaway
wallet `0xa71E3Aaa…7354` (all revoked), and three test images pinned under that wallet.

## Deployed revision

Production served exactly the frontend chunks of a local build of `f052a0a`: 55 of 64 asset names
matched byte for byte, and the nine remaining chunks were identical after normalising the content
hashes in their import paths, except `site-*.js`, which differs only in a trailing slash in the
production `SITE_URL`. The retest's disposition therefore attests the deployed code, not only the
working tree. The upload change in `175c243` was verified separately after its own deploy.

## Retest findings

| ID | Result | Evidence |
|---|---|---|
| R-01 content sync step-up | Closed | Fix `b7bc72a` is in the deployed build. The same middleware was exercised live: at 345 s of session age, session revoke and logout-all returned 403 `reauthenticate: true`; a fresh signature presented with the old token then succeeded and invalidated the old token. |
| R-02 revision cache | Closed | Fix `5d4a4f7` is in the deployed build; archiving a revision needs an admin and was not repeated live. |
| R-03 CSP report-only | Closed | Homepage, unknown pages and API responses send an enforced policy with hashed inline scripts, an explicit `connect-src` allowlist, `object-src 'none'`, `base-uri 'none'` and `report-uri /api/csp-report`. All eight inline scripts on the homepage match the header hashes. In Chrome, an injected inline script and a script from cdn.jsdelivr.net were blocked (`disposition: enforce`), and the violation POST to `/api/csp-report` returned 204. The Rabby, WalletConnect QR and email sign-in flows opened without violations. |
| R-04 HSTS on API | Closed | `/api/auth/me`, `/healthz` and `/api/<unknown>` send `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` plus nosniff, `X-Frame-Options: DENY`, referrer and permissions policies. Plain-HTTP requests still receive a 301 to HTTPS from the platform edge; the app cannot change that, and no credential is sent before the redirect. |

## Live checks by finding

| ID | Result | Evidence |
|---|---|---|
| ASVS-02 CSV | Closed | A leads export with `=`, `+`, `-`, `@`, tab-prefixed and full-width formula cells opened in LibreOffice headless produced zero formula cells, kept numeric goals numeric, and kept the `Text:` prefix through a save-and-reopen round trip. Excel was not available. |
| ASVS-04 sessions | Closed | Throwaway wallet against the live API: renewal with the previous token invalidated it atomically (old 401, new 200, session count unchanged); revoke-by-id 200 then 401 for that session and 404 on repeat; logout 200 then 401; logout-all revoked both remaining sessions. Session TTL 7 days for a non-admin. |
| ASVS-07 uploads | Closed | A 200×120 JPEG with EXIF make, model, description and a COM comment, and a PNG with tEXt chunks, came back from the IPFS gateway re-encoded and byte-identical to the local normaliser output, with no EXIF and none of the planted strings. |
| ASVS-08 claim URLs | Closed | `GET /api/comments/mine` and `GET /api/comments/claims` return 404 on production. |
| ASVS-12 browser state | Closed | The submit draft is stored under `thedao:submit-draft:<wallet>`. Signing out with a draft present showed the Keep / Delete / Cancel dialog; after Delete, no `thedao:` keys remained in either storage, the draft text was gone from the page, and `/api/auth/me` returned 401. |
| NDC-2026-002 cookie | Closed | `Set-Cookie: __Host-session=…; Path=/; Max-Age=604799; HttpOnly; SameSite=Lax; Secure`. The verify response body carries no token in cookie mode; `document.cookie` was empty in a signed-in browser while credentialed API calls succeeded; localStorage holds only address, admin flag and expiry. |
| NDC-2026-002 replay | Closed | Re-posting a used SIWE message and signature returned 401 `nonce invalid or already used`. |
| NDC-2026-010 on-ramp | Closed, moot | No initiative on production had donations enabled and the board reported `onramp: false`; the on-ramp code was then removed in `ce317a3`. |
| Health | Pass | `/healthz` reported 9 of 9 tokens verified on-chain. |

## Accepted exceptions

These close the review by decision of the owner, not by evidence. Each names what would reopen it.

1. **Rate limiting (NDC-2026-011, ASVS-09 attribution).** Production runs `RATE_LIMIT_MODE=observe`:
   74 requests to `/api/auth/nonce` in two minutes against a cap of 30 per minute all returned 200.
   Only submissions, support messages and uploads are refused over their caps. Because nothing was
   refused, the spoofed `X-Forwarded-For` / `X-Real-IP` / `CF-Connecting-IP` / `Forwarded` test is
   inconclusive on production. Decision: rate limiting is being redesigned in the short term; the
   burst and spoofed-header tests are to be repeated when the redesign ships in enforce mode.
2. **Logging (ASVS-05, NDC-2026-006).** The application emits structured, redacted security events
   to stdout, which the Deno Deploy dashboard collects. OpenTelemetry export, an external retention
   store and alert routing are not configurable for this deployment. Decision: collection is the
   Deno Deploy log view with the retention of the current plan; there is no alerting. The `audit.test`
   endpoint remains available for a future backend.
3. **G-01 authentication profile and G-02 operations.** Fresh SIWE proves current key control, not an
   independent factor. Provider credentials, backups, data classification and incident procedures
   have documentation but no independent evidence. Decision: recorded as tailoring of the ASVS
   profile; unchanged from the retest.

## Not security, noted for completeness

- **Upload cold start.** The first two uploads of valid images on 17 September were rejected as
  invalid, and warm uploads took 4.6 s, because each request spawned a fresh decoder whose 8-second
  deadline began before the 15 MB ImageMagick WASM had initialised. It failed closed, so it was an
  availability defect. Fixed in `175c243` (decoders initialised once per isolate, warmed at boot,
  deadline measured after readiness); after the deploy, the first upload succeeded in 2.0 s and warm
  uploads in 1.6–1.7 s, of which the IPFS pin is the remainder.
- **WalletConnect project id.** The API's board flags report an empty WalletConnect project id while
  the frontend build carries one; the QR option works. Two configurations disagree; no security effect.
- **Unknown page paths** return 200 with the SPA fallback and the full CSP rather than 404.

## Not verified

No admin flow was run live (content sync, audit test event, revision archive, leads CSV export
from the real admin page). Excel was not used for the CSV check. Idle-timeout expiry (one hour) and
absolute expiry (seven days) were not waited for. Edge request logs were not inspected for
historical claim URLs. The two-network IP attribution test could not be meaningful in observe mode.
