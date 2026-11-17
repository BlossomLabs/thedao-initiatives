# Verification record — Nov 17, 2026

This is the original commit's verification record. See [retest.md](retest.md) for the
subsequent fixes and current working-tree results.

Target: `b471ac5ee3430fb344128850cc1a6d5ef204a75b`. A separate `git archive` snapshot was tested; no application source or lockfile was modified. After testing, all 996 tracked blobs matched the target Git tree. Local installed dependency directories were reused through symlinks, with frozen/cached resolution for API tests, API type checking and the defect probes. This was not an independent clean-room dependency installation.

## Results

Commands below run from the snapshot root unless the working directory is stated. Successful checks exited 0.

| Check | Command | Result and evidence |
|---|---|---|
| API suite | `deno test --frozen --cached-only --node-modules-dir=manual -A --deny-net api/` | **638 passed, eight steps, zero failed**; [output](evidence/api-tests.txt) |
| Frontend suite | `node node_modules/vitest/vitest.mjs run --maxWorkers=4` | **183 files, 1,632 tests passed**; [output](evidence/web-tests-node.txt) |
| Original contract suite, in `vote/` | `forge test --offline` | **13 suites, 167 passed, zero failed/skipped**; before adding the two probes; [output](evidence/contract-tests.txt) |
| API/server/script type checking | `deno check --frozen --cached-only --node-modules-dir=manual api/main.ts server.ts api/scripts/*.ts shared/draft/mod.ts scripts/vote-replay.ts scripts/vote-sim.ts` | PASS; [output](evidence/api-typecheck.txt) |
| Frontend type checking | `deno task typecheck` | PASS; [output](evidence/web-typecheck.txt) |
| Lint | `deno lint` | PASS, 736 files; [output](evidence/lint.txt) |
| Production bundle and prerender | `deno task build` | PASS after permitting the build's local listener; [output](evidence/build-complete.txt) |
| Application advisory scan | `deno audit --lock=deno.lock --frozen-lockfile` | No known vulnerabilities found; [output](evidence/dependency-audit.txt) |
| Contract package advisory scan, in `vote/` | `npm audit --package-lock-only --ignore-scripts --cache=/tmp/thedao-audit-npm-cache` | Zero vulnerabilities; [output](evidence/contract-dependency-audit.txt) |
| API/replay defect probes | `deno test --frozen --cached-only --node-modules-dir=manual -A --deny-net docs/security/review-2026-11-17/evidence/*.repro.test.ts` | **Two passed**, reproducing NOV-01 and NOV-02; [output](evidence/local-reproductions.txt) |
| NOV-01 contract probe, in `vote/` | `forge test --offline --match-contract RelayerGasReproduction -vv` | **One passed**; [output](evidence/relayer-gas-contract.txt) |
| NOV-02 contract probe, in `vote/` | `forge test --offline --match-contract SettledDonationReproduction -vv` | **One passed**; [output](evidence/settled-donation-contract.txt) |

The four new probes pass when the reported defect is present. They are evidence, not assertions of safe behavior or additions to the default application suites. See the [reproduction instructions](evidence/README.md).

## Environment and deviations

- Deno 2.9.8; bundled TypeScript 6.0.3; Node 26.12.1; Vitest 5.1.0; Foundry Forge 1.5.1; Solidity compiler 0.8.28 with the repository's optimizer/via-IR settings. Frontend `tsc` resolves separately to TypeScript 7.0.2.
- Launching Vitest through Deno failed before running the suite with `fd is not from BiPipe` ([failed attempt](evidence/web-tests.txt)). Running the same locked Vitest suite under Node succeeded. This substitutes the frontend test launcher, not the tests.
- The first build compiled the bundles but could not bind its local prerender listener under the sandbox ([failed attempt](evidence/build.txt)). The same command completed with the listener allowed. Existing dynamic-import and process-environment deprecation warnings remain in the successful log.
- Advisory requests initially required network access unavailable in the sandbox. The reported audit results are the successful network-enabled scans. Neither scan proves package provenance, finds all unknown defects, or audits deployed Solidity bytecode. The Git-pinned `forge-std` dependency also needs independent provenance review beyond npm's advisory coverage.
- No live RPC, provider-backed login, browser wallet flow or production deployment was tested. Synthetic RPC data is explicitly separated from the Foundry execution evidence.
- Existing working-tree modifications and untracked material were not used. Checks ran on the requested commit, including its original lockfiles and deployment scripts.

## Evidence integrity

[`source-fingerprints.json`](source-fingerprints.json) records the reviewed Git commit/tree and SHA-256 hashes of every tracked file in the isolated snapshot. [`dependency-inventory.json`](dependency-inventory.json) records the locked graph and selected runtime packages. [`artifact-sha256.json`](artifact-sha256.json) covers the report, matrices, reproduction sources, logs and supporting artifacts, excluding itself. Regenerate the metadata with [`prepare-artifacts.py`](prepare-artifacts.py); application source, test outcomes and logs are not generated by that script.
