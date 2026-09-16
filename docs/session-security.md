# Session security policy

The API stores only hashed bearer credentials. Browser credentials remain in HttpOnly, SameSite cookies. The session inventory uses a separate random identifier; it never exposes the credential or its hash.

| Session | Absolute lifetime | Inactivity limit |
| --- | --- | --- |
| User | 7 days | 1 hour |
| Administrator | 12 hours | 15 minutes |

Both deadlines are enforced server-side. Authenticated activity updates the inactivity clock without extending the absolute lifetime. Funding refreshes and timed donation-confirmation/status retries mark themselves passive so background polling cannot keep an unattended browser signed in. Static site-lock checks are also passive. A credential holder can deliberately make active requests; the absolute lifetime still applies.

Every successful wallet authentication replaces and atomically revokes the credential presented on that request. Other devices stay signed in. Administrator access requires both administrator privilege at authentication and current membership. Dashboard promotions and removals revoke the affected wallet's sessions; promotion through environment configuration also requires fresh authentication to gain privilege. Authorization reads current membership on every check; display-only administrator badges may lag by up to five seconds.

The `/sessions` page, linked from the wallet menu, lists the signed-in wallet's active sessions, creation/activity times, and absolute expiry. Users can end individual sessions or sign out everywhere. Remote session termination, sign-out-everywhere, and administrator revocation require authentication within the last five minutes; the page always obtains a new wallet signature first. Ordinary logout remains available without another signature.

Administrators can revoke a wallet's sessions through `POST /api/admin/sessions/revoke` with `{ "address": "0x…" }`. `POST /api/admin/sessions/revoke-all` requires `{ "confirmation": "revoke all sessions" }` and ends every existing session, including the administrator's. Both controls are available on the sessions page. Durable per-wallet and global revocation epochs make invalidation independent of a potentially incomplete scan, and session creation/activity updates compare those epochs transactionally. Reauthentication after the revocation creates a valid new session. The per-wallet response count is the inventory observed before revocation; concurrent authentications can make that count approximate without escaping revocation.

## Deployment impact

Existing session rows without the new inventory, activity, and revocation metadata are rejected. Users, administrators, and scripts must sign in again after deployment. This is intentional: migrating a missing activity timestamp must not silently grant an old credential a fresh inactivity window. Old records and revoked session indexes expire at their original absolute TTL; revocation markers persist.

Session and administrator actions are integrated with the application's security audit pipeline. Deployments must configure and verify its durable sink separately. Local regression tests cover replacement of bearer/cookie credentials, privilege changes, idle/absolute expiry, inventory ownership, recent authentication, targeted/global revocation, and in-flight activity updates racing revocation. Live production sign-in and wallet flows still need a deployment smoke test.
