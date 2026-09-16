# Assessment evidence and reproduction instructions

These files accompany the [ASVS report](../report.md). Run commands from `/home/sem/Projects/thedao-initiatives` with the project's dependencies already installed. Source/configuration SHA-256 values are in [source-fingerprints.json](source-fingerprints.json). Evidence describes 15 September 2026; rerunning a live check gives a new observation, not the original snapshot.

## Offline finding reproductions

The reproduction tests intentionally assert the observed weaknesses. A passing reproduction means the weakness is present. Convert them into assertions for secure behavior when implementing fixes; do not add them unchanged as release-acceptance tests.

### Five API/integration cases

```sh
deno test --config deno.json --cached-only --no-check --allow-env --allow-read --allow-write=/tmp docs/security/asvs-2026-09-15/evidence/api-reproductions.test.ts
```

Uses the existing in-memory test harness, a fake chain, mocked Pinata/forum fetch, and documentation-only IP fixtures. Network permission is not granted. Covers ASVS-01/03/04/07/09. The captured [output](local-reproductions.txt) predates copying the script from `/tmp`; the copied script was rerun successfully at its delivered path.

### Two browser-component cache cases

```sh
node node_modules/vitest/vitest.mjs run --config docs/security/asvs-2026-09-15/evidence/vitest.config.ts --pool=threads --maxWorkers=1
```

Uses React testing-library/jsdom, a fresh QueryClient, fake private data and mocked API responses. These are component tests, not a production browser session. Covers ASVS-12. The copied tests also passed at the delivered path.

### CSV expression preservation

```sh
node docs/security/asvs-2026-09-15/evidence/csv-reproduction.mjs
```

Extracts the actual `leadsCsv` declaration with the TypeScript parser, transpiles it, and invokes it in an isolated JavaScript context with `=1+1`. It does not reimplement the export algorithm or invoke a spreadsheet. Prints sanitized JSON to stdout; [csv.json](csv.json) is the captured result.

## Existing regression tests

```sh
deno test --cached-only --no-check --allow-env --allow-read --allow-write=/tmp api/
```

140 passed. Captured output: [api-tests.txt](api-tests.txt).

```sh
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=2 app/components/Markdown.test.tsx app/context/session.test.tsx app/lib/session-migration.test.ts app/lib/avatar-image.test.ts app/components/donate/useDonation.test.tsx app/routes/initiative.edit.test.tsx app/routes/admin.initiative.test.tsx
```

37 passed in seven files. Captured output: [web-tests.txt](web-tests.txt). These commands do not perform a whole-project typecheck. The audit did not change application code.

## Dependency audit

```sh
deno audit --lock=deno.lock
```

This accesses the advisory registry. Results change over time. The captured [dependency-audit.txt](dependency-audit.txt) reports 14 advisories, two High and twelve Moderate. Package advisory severity must not be treated as demonstrated application exploitability.

## Live scripts — run separately

These scripts are not included in the offline test commands:

- [public-site-check.py](public-site-check.py) performs bounded public HTTP/OPTIONS and TLS checks against the named production target and writes sanitized response metadata to `/tmp/asvs-live-evidence.json`.
- [siwe-check.ts](siwe-check.ts) creates a fresh wallet in memory, signs into the **production** service twice, makes identity/access/Origin/replay checks and revokes its sessions. It writes sanitized evidence to `/tmp/asvs-siwe-evidence.json`. It creates authentication state, so rerun it only when that live activity is intended.

The SIWE script can be executed with the project Deno configuration and network access to `initiatives.thedao.fund:443`, plus write access to its `/tmp` output file. Dependencies must already be installed/cached. Do not substitute a funded or personal wallet: the script generates its own disposable identity.

The original live evidence contains no private keys, session tokens, production private records, or uploaded content. Public response metadata includes edge trace IDs and body hashes, not full application responses. SIWE cleanup is supported by the recorded 401 responses after logout and logout-all, not solely by the script's `finally` block.

## Scope of evidence

- Live observations support deployed behavior at the recorded time.
- Local reproductions support the fingerprinted source behavior under the stated fixture conditions.
- Source-only conclusions do not prove deployment configuration.
- Mocked internal destinations and fake transactions must not be mistaken for production network access or real donations.
- The matrix's PASS results are bounded by their individual scope and method; untouched provider/internal controls are not silently treated as passed.
