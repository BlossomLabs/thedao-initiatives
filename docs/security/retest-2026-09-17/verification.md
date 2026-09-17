# Verification evidence

Review date: 17 September 2026, Europe/Madrid (the runs began on 16 September UTC).

## Final completed checks

| Command | Result |
|---|---|
| `deno task test:api` | 232 passed, 0 failed; real raster decoder tests included. |
| `node node_modules/vitest/vitest.mjs run` | 62 files, 297 tests passed, 0 failed. |
| `deno task check:api` | Passed. |
| `deno task typecheck` | Passed on the final recheck. |
| `deno task lint` | Passed; 346 files checked. |
| `deno audit --lock=deno.lock --frozen-lockfile` | Exit 0: `No known vulnerabilities found`. Registry network access was required. |
| `git diff --check` | No whitespace errors reported. |

The default `deno task test` could not start Vitest's fork worker in this tool environment (`fd is not from BiPipe`). The full frontend suite was therefore run with Node against the same installed Vitest. This is not a verified successful run of the Deno Vitest launcher or GitHub CI itself.

An earlier Node run reported four failing tests and the early TypeScript check reported three errors while the draft/logout source and tests were changing concurrently. Those were superseded by the passing final suite, focused 25-test recheck and final TypeScript check. They are not listed as outstanding application defects.

The source snapshot is recorded in [source-fingerprints.json](source-fingerprints.json). This is a working-tree snapshot, not a deployed-commit attestation. Existing application changes predate this review or were made concurrently; this review adds only its own report/evidence directory.

## Isolated defect reproductions

These tests assert the observed insecure behavior. **A passing reproduction confirms a defect; it does not certify its remediation.** Both use isolated local fixtures. No real credentials, private user records or live administrative writes are involved.

```sh
deno test -A docs/security/retest-2026-09-17/admin-reauth.repro.test.ts
node node_modules/vitest/vitest.mjs run --config docs/security/retest-2026-09-17/vitest.config.ts
```

Each ran one test and passed. The first demonstrates a stale admin credential receiving a reauthentication challenge on ordinary approval, then successfully publishing through content sync. The second demonstrates previously fetched revision data surviving a 404 response and remount. They are outside the normal API/frontend suite include paths.

## Live response observations

Five unauthenticated GET requests were made with redirects disabled. No cookies, authorization, sensitive query values or request bodies were supplied. Only public response status/security headers were inspected.

| Request | Observed response |
|---|---|
| `https://initiatives.thedao.fund/` | 200; HSTS `max-age=63072000; includeSubDomains; preload`; enforced CSP `frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. Full script-hash policy remained report-only, with `connect-src 'self' https: wss:`. |
| `https://initiatives.thedao.fund/api/auth/me` | 401; no HSTS; `Cache-Control: no-store`; API CSP `default-src 'none'; frame-ancestors 'none'`. |
| `https://initiatives.thedao.fund/healthz` | 200; no HSTS; `Cache-Control: no-store`; same API CSP. |
| `http://initiatives.thedao.fund/api/auth/me` | 301; Location `https://initiatives.thedao.fund/api/auth/me`. |
| `http://initiatives.thedao.fund/` | 301; Location `https://initiatives.thedao.fund/`. |

The three HTTPS responses also had `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin`. These observations establish the deployed differences described in the report, not which commit/configuration caused them.

## Not verified

No fresh authenticated production session lifecycle, provider dashboard settings, actual alert ingestion/routing, spreadsheet application execution, two-network production IP attribution, deployed image upload, or real wallet/donation workflow was tested. Earlier documents describe some preview/browser checks, but those were not repeated here and are not presented as new evidence.
