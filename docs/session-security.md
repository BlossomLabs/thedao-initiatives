# Session security policy

The API stores only hashed bearer credentials. Browser credentials remain in HttpOnly, SameSite cookies. The session inventory uses a separate random identifier; it never exposes the credential or its hash.

| Session | Absolute lifetime | Inactivity limit |
| --- | --- | --- |
| User | 7 days | 1 hour |
| Administrator | 12 hours | 15 minutes |

Both deadlines are enforced server-side. Authenticated activity updates the inactivity clock without extending the absolute lifetime. Funding refreshes and timed donation-confirmation/status retries mark themselves passive so background polling cannot keep an unattended browser signed in. Static site-lock checks are also passive. A credential holder can deliberately make active requests; the absolute lifetime still applies.

Every successful wallet authentication replaces and atomically revokes the credential presented on that request. Other devices stay signed in. Administrator access requires both administrator privilege at authentication and current membership. Dashboard promotions and removals revoke the affected wallet's sessions; promotion through environment configuration also requires fresh authentication to gain privilege. Authorization reads current membership on every check; display-only administrator badges may lag by up to five seconds.

The `/sessions` page, linked from the wallet menu, lists the signed-in wallet's active sessions, creation/activity times, and absolute expiry. Users can end individual sessions or sign out everywhere. Remote session termination, sign-out-everywhere, and administrator revocation require authentication within the last five minutes; the page always obtains a new wallet signature first. Ordinary logout remains available without another signature.

Administrator membership changes, initiative status changes (including bulk actions), Safe binding,
payout totals, proposer reassignment and content sync (which creates approved initiatives) also
require authentication within five minutes. The browser, and the `sync-content` script when given a
private key, retry once after a fresh SIWE signature only when the API explicitly challenges before mutation.
Ordinary permission failures and ambiguous network failures do not trigger a retry.

Privy email users can sign with their existing embedded wallet session. A valid Privy session normally
does not require another email OTP for this renewal; provider recovery/MFA/expired-session requirements
can still apply. The API applies the same recent-wallet-proof rule to every admin. This is not evidence
of a second authentication factor or fresh human confirmation; the assessment's MFA assurance gap
remains a separate policy/provider-evidence item.

Administrators can revoke a wallet's sessions through `POST /api/admin/sessions/revoke` with `{ "address": "0x…" }`. `POST /api/admin/sessions/revoke-all` requires `{ "confirmation": "revoke all sessions" }` and ends every existing session, including the administrator's. Both controls are available on the sessions page. Durable per-wallet and global revocation epochs make invalidation independent of a potentially incomplete scan, and session creation/activity updates compare those epochs transactionally. Reauthentication after the revocation creates a valid new session. The per-wallet response count is the inventory observed before revocation; concurrent authentications can make that count approximate without escaping revocation.

## Deployment impact

Valid sessions from the original four-field schema are upgraded automatically on their first server read, including existing HttpOnly cookies, script bearers, session inventory reads, and the localStorage-to-cookie exchange. The credential, original sign-in time, and privilege at authentication stay unchanged; absolute expiry is never extended and is capped by the current user/admin lifetime. No blanket sign-in is required for this deployment.

Because old rows never recorded activity, migration grants one initial inactivity window (one hour for users, 15 minutes for administrators), starting when the upgrade is persisted. This is a deliberate compatibility allowance, not evidence of recent wallet authentication. Subsequent passive requests do not refresh it; session-management reauthentication still uses the original sign-in time. Partially upgraded/malformed rows and expired credentials are rejected. A per-wallet or global revocation marker blocks legacy migration, and conditional writes prevent concurrent logout/revocation from restoring an old credential. Old records and revoked session indexes expire at their original absolute TTL; revocation markers persist. Retire old server versions during rollout so they cannot keep minting the legacy schema.

Session and administrator actions are integrated with the application's security audit pipeline. Deployments must configure and verify its durable sink separately. Local regression tests cover legacy cookie/bearer upgrades, replacement of credentials, privilege changes, idle/absolute expiry, inventory ownership, recent authentication, targeted/global revocation, and migration/activity writes racing revocation. Live production sign-in and wallet flows still need a deployment smoke test.
