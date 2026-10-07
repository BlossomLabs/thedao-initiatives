# Retest verification

**Date:** 7 October 2026. **Published source:** `5914155d28798ffd09f777e017342d08169db254`.
**Upstream main:** `27d5280b66e81efe585c17ec06f6f6f77180fee1`.

Local checks were run on the source snapshot recorded as `12baf1930d8c32ebb01964363a1eba7990baf9c4`.
GitHub publication regenerated commit metadata. The resulting source commit above has the exact
same Git tree (`635a3ab230f70e5cf7390d3b0f647e0acdf9336f`); downloading it and comparing both
trees with `git diff --exit-code` confirmed there are no file differences. See
[publication-history.json](publication-history.json) for the commit mapping. The network-denied
security regressions were also rerun on the downloaded GitHub source commit.

The new `main` was fetched, fixes rebased, conflicts resolved, then the merged source tested.
GitHub `main` was fetched again before the final evidence record and remained at the same revision.
The import cleanup and additional private-write regression were folded into the private-field fix
after testing; this changed commit IDs without changing the tested file content.

The environment is Deno **2.9.6**, V8 **15.0.245.2-rusty**, built-in TypeScript **6.0.3**,
Node **26.10.0**, and locked application TypeScript **7.0.2**. Dependencies were installed with
`deno install --frozen`; package lifecycle build scripts were not approved.
The executable used locally is `/home/sem/.npm/_npx/05b6ef7b13673c57/node_modules/deno/deno`.
Use `deno` from the repository root for the commands below.

| Command | Exit | Result |
|---|---:|---|
| `deno task test:api` | 0 | 358 passed, eight steps, zero failures |
| `deno task test` | 0 | 111 files, 686 tests passed |
| `deno task check:api` | 0 | API, server, scripts and shared draft type checks |
| `deno task typecheck` | 0 | Frontend type generation and compiler |
| `deno task lint` | 0 | 507 files checked |
| `deno task build` | 0 | Production bundles and all prerender targets |
| `deno audit --lock=deno.lock --frozen-lockfile` | 0 | No known vulnerabilities found |
| `deno test --cached-only -A --deny-net api/tests/ens-ccip.test.ts api/tests/private-fields.test.ts api/tests/admins-concurrency.test.ts api/tests/pending-revisions.test.ts` | 0 | 21 tests/eight steps; safe outcomes and upstream moderation boundaries verified without network |

Raw logs are in [evidence/](evidence/README.md). Vitest/prerender ran outside the sandbox because its
worker IPC and localhost listener could not run under the sandbox restriction. Non-fatal jsdom
scrolling and bundle warnings are retained in the logs. No lockfile relaxation or advisory
suppression was used. No deployment was performed.

The original [vulnerable-state probes](../review-2026-10-07/evidence/api-reproductions.test.ts) are
historical, snapshot-specific counterexamples. Use the current regression command above on the
fixed revision. In particular, the old admin-race probe intercepts the removed `meta.set` path;
its scheduling hook is replaced by a held KV read in the current regression.

[source-fingerprints.json](source-fingerprints.json) fingerprints tracked application files outside
security-report directories and the resolved dependency implementation files used by this retest.
[artifact-sha256.json](artifact-sha256.json) fingerprints the retest artifacts except itself.
[prepare-artifacts.py](prepare-artifacts.py) regenerates those records and the ASVS matrix without
network requests or tests, and refuses to run against a different source commit or modified
application tree. Fingerprinting a file does not imply every line was manually audited.
