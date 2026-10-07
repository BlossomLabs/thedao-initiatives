# Verification — 7 October 2026

## Snapshot and environment

- Repository: `https://github.com/blossomlabs/thedao-initiatives.git`, branch `main`.
- Reviewed commit: `a70726c0f776ffcc2f50cb9f0c3774d44834d134`.
- Deno: **2.9.6**, V8 **15.0.245.2-rusty**, built-in TypeScript **6.0.3**.
- Node: **26.10.0**. The application compiler resolves **TypeScript 7.0.2** from the lockfile.
- Frozen dependencies installed with `deno install --frozen`. Dependency lifecycle build scripts were not approved or run during installation.
- No environment file, production credential, test private key or real authenticated session is included in the evidence.

The executable used in this workspace is
`/home/sem/.npm/_npx/05b6ef7b13673c57/node_modules/deno/deno`, installed through the npm Deno package.
Commands below use `deno` for portability and run from the repository root. The dependency graph
and tracked application source remained unchanged. Build output and dependency caches are ignored
by Git; only `docs/security/review-2026-10-07/` is added.

## Completed checks

| Command | Result | Evidence |
|---|---|---|
| `deno task test:api` | Exit 0; 336 passed, 0 failed | [API log](evidence/api-tests.txt) |
| `deno task test` | Exit 0; 109 files, 666 passed | [Frontend log](evidence/web-tests.txt) |
| `deno task check:api` | Exit 0 | [API type check](evidence/api-typecheck.txt) |
| `deno task typecheck` | Exit 0 | [Frontend type check](evidence/web-typecheck.txt) |
| `deno task lint` | Exit 0; 498 files checked | [Lint log](evidence/lint.txt) |
| `deno task build` | Exit 0; production build and prerender complete | [Build log](evidence/build.txt) |
| `deno audit --lock=deno.lock --frozen` | Exit 1; one High package advisory | [Audit log](evidence/dependency-audit.txt) |
| `deno test --cached-only -A --deny-net docs/security/review-2026-10-07/evidence/api-reproductions.test.ts` | Exit 0; three defect probes reproduced | [Local log](evidence/local-reproductions.txt) |

`--frozen` is the audit's accepted alias for the `--frozen-lockfile` option used by CI.
The audit failed because it found the advisory, not because registry access failed.
The first sandboxed production build compiled the bundles but could not bind the local prerender
server (`listen EACCES: permission denied 127.0.0.1`). Rerunning outside that restriction completed
successfully; the saved build log is the successful run. Bundle-size and ineffective-dynamic-import
warnings do not constitute security findings.

The probes are deliberately separate from `api/` and the default test suite. They assert the
reported behavior at the audited commit. After a fix, they should fail or be converted into
regression tests asserting the safe behavior. Temporary KV state is closed after each test.

## Evidence assertions

1. **OCT-01:** the actual public ENS-name route and locked viem code consume an ABI-valid mocked
   Universal Resolver local-batch envelope. Mocked gateway fetch receives loopback GET and
   link-local POST destinations, without a deadline or explicit redirect mode. Network is denied;
   no malicious resolver is deployed and no private endpoint is contacted. The final callback is
   rejected to show that a final identity failure does not prevent an earlier request.
2. **OCT-02:** a 301-second-old administrator session receives a freshness challenge from the leads
   endpoint and both synthetic private markers from three alternative routes. Anonymous access is
   checked as a negative control. This proves the policy bypass, not anonymous exposure.
3. **OCT-03:** an injected scheduling pause exposes the genuine unprotected read/write interval
   between two admin routes. The removal succeeds and revokes old sessions, then the competing
   addition restores membership. Fresh session issuance is simulated from the resulting membership
   lookup; the test does not exercise actual SIWE signing.
4. **OCT-04:** the frozen audit identifies `source-map-js@1.2.1`. Direct traversal of the lockfile
   proves its owning paths. Package source confirms source-map processing; public attacker input
   reaching the advisory's vulnerable function is unproven. No exhaustion payload is executed.

## Public HTTP sample

The [collector](evidence/public-site-check.py) ran once successfully. It uses bounded GETs without
cookies or redirect following, stops reading after 1 MiB plus one byte and flags truncation, and
stores metadata rather than complete content. No sampled body was truncated. The
[observations](evidence/public-site.json) include request timestamps, selected headers,
body sizes/hashes, CSP hash checks and feed field-name checks.

| Sample | Observed result |
|---|---|
| Homepage | 200; enforced CSP; eight inline script hashes all present in policy |
| `/api/auth/me` | 401; `Cache-Control: no-store` |
| `/healthz`, `/api/version`, `/api/board/settings` | 200 |
| `/api/initiatives.json` | 200; 49 entries; explicit public caching; no sampled private field names |
| `/llms.txt` | 200; public caching |
| `/api/admin/leads`, `/api/admin/backup`, `/api/watchlist` | 401; no-store |
| `/api/comments/mine`, `/api/security-review-nonexistent` | 404 |
| HTTP `/` and `/api/auth/me` | 301 to their exact HTTPS equivalents; no credential sent |
| All 12 HTTPS observations | HSTS, nosniff, framing/referrer/permissions protections present |

The `a857654e` application version is an asset-based identifier, not a deployed commit attestation.
No live login, reauthentication, upload, draft dialog, donation, admin workflow, rate-limit burst,
CSV spreadsheet opening or browser CSP execution-blocking test was repeated. Earlier production
evidence remains historical and is identified as such in the report.

## Fingerprints and reproducibility

[source-fingerprints.json](source-fingerprints.json) records the commit, locked/runtime versions,
tracked-file hashes outside security-report directories and the exact resolved dependency files
used for the findings. Fingerprinting a file does not claim that every line was manually audited.
[artifact-sha256.json](artifact-sha256.json) fingerprints this review's artifacts except itself.
[prepare-artifacts.py](prepare-artifacts.py) regenerates the matrix and manifests from the checked-out
snapshot. Run it only after logs/documents are final; it does not rerun any network probe or test.
