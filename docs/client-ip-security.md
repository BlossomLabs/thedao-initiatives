# Client identity from Deno

Both Deno entrypoints pass runtime handler information to Hono through `dispatchApi`.
IP quotas use Deno's `remoteAddr.hostname`. The application ignores `X-Forwarded-For`,
`X-Real-IP`, and `Forwarded`; request origins and cookie security use the request URL's scheme
and ignore `X-Forwarded-Proto`. There are no application-level proxy-trust settings.

Only plain IPv4 and IPv6 addresses are accepted. Equivalent IPv6 forms, including IPv4-mapped
IPv6, are normalized so they use the same quota. IP quota checks call `requireClientIp` and
return **503** if runtime identity is missing or invalid, before consuming the quota or starting
the protected operation. There is no shared `?` bucket. Public reads, cache hits, and account-only
operations remain available where they do not require an IP quota. `DISABLE_RATE_LIMITS` does
not waive the requirement to establish a client identity.

## Deployment verification

On the Deno preview deployment of `codex/check-client-ip`, the temporary `/healthz` diagnostic
reported matching runtime and quota IPs, `trustProxy: false`, `requestScheme: https`, and
`secureRequest: true`. The operator confirmed that the reported address matched their public IP.
This verifies that tested connection; it is not a guarantee about every hosting arrangement.
The temporary diagnostic was removed after that check, and the raw address is not recorded here.

Keep passing Deno's handler information into Hono. A change of hosting platform or network
arrangement requires verifying that Deno still supplies the actual client address and public
scheme. Do not restore trust in arbitrary request headers as a fallback for missing metadata.
If migrating from the previous implementation, remove `TRUST_PROXY` and `TRUSTED_PROXY_IPS`
from deployment configuration; those variables are no longer read.

For future checks, use temporary diagnostics on an isolated preview deployment. Compare the
runtime and quota addresses with a controlled client's public address, accounting for IPv4,
IPv6, and VPNs. Repeat from a second network, and verify forged forwarding headers cannot
change the selected address or HTTPS decision. Avoid exhausting quotas or recording raw
client addresses in general-purpose logs. Remove diagnostics after verification.

Regression checks:

```sh
deno test -A api/tests/ip.test.ts api/tests/origin.test.ts api/tests/session-cookie.test.ts
```
