# Remediation verification — Nov 17, 2026

> This is a historical working-tree run. The later gap remediation and committed release checks are recorded in [ASVS verification](asvs-verification.md#release-integration-verification).

> This record preserves the original two-finding remediation run. The later full ASVS expansion, preview-cookie fix and final 648-test API run are documented in [asvs-verification.md](asvs-verification.md); the final matrix is [control-matrix.md](control-matrix.md).

Base: `b471ac5ee3430fb344128850cc1a6d5ef204a75b`. Retest target: the uncommitted working tree identified in [retest-source-fingerprints.json](retest-source-fingerprints.json). The original archive, baseline logs and defect probes remain separate. Existing unrelated tracked edits are present; unrelated untracked files and credentials are excluded from the fingerprint inventory.

## Results

Commands run at repository root unless noted. Final checks exited 0.

| Check | Command | Result and evidence |
|---|---|---|
| API suite | `deno test --frozen --cached-only --node-modules-dir=manual -A --deny-net api/` | 645 passed, eight steps; [final output](evidence/retest-api-final.txt) |
| Frontend/shared suite | `node node_modules/vitest/vitest.mjs run --maxWorkers=4` | 1,635 passed in 184 files; [output](evidence/retest-web-fixed.txt) |
| Contracts, in `vote/` | `forge test --offline` | 173 passed in 15 suites; [output](evidence/retest-contract.txt) |
| Python reference | `python3 -m unittest discover -s vote/reference` | 217 passed; [output](evidence/retest-python.txt) |
| API/server/scripts | `deno check --frozen --cached-only --node-modules-dir=manual api/main.ts server.ts api/scripts/*.ts shared/draft/mod.ts scripts/vote-replay.ts scripts/vote-sim.ts` | PASS; [output](evidence/retest-api-typecheck-fixed.txt) |
| Frontend types | `deno task typecheck` | PASS; [output](evidence/retest-web-typecheck-fixed.txt) |
| Lint | `deno lint` | PASS, 739 files; [output](evidence/retest-lint.txt) |
| Production build/prerender | `deno task build` | PASS; [output](evidence/retest-build-fixed.txt) |
| Public ABI | Compare compiled `SignedBallots.json` ABI to `SIGNED_BALLOTS_ABI` with `assertEquals` | Exact equality; [output](evidence/retest-abi.txt) |
| Frozen installation | `deno install --frozen-lockfile --cached-only` | PASS after lock repair; [output](evidence/retest-install-fixed.txt) |
| Application advisories | `deno audit --lock=deno.lock --frozen-lockfile` | No known vulnerabilities; [output](evidence/retest-audit-fixed.txt) |
| Contract advisories, in `vote/` | `npm audit --package-lock-only --ignore-scripts --cache=/tmp/thedao-audit-npm-cache` | Zero vulnerabilities; [output](evidence/retest-contract-audit.txt) |

## NOV-01 regression coverage

`api/tests/vote-relay-budget.test.ts` uses the real viem client and transaction signer with a synthetic RPC. It checks the 4,000,000-gas estimation parameter, 500,000-gas signature preflight, decoded signed gas and EIP-1559 fees, maximum total cost, and both ballot entry points. It covers excessive estimates, expensive fees, total-cost rejection, malformed quotes, estimation failure, wrong signature magic and preflight failure. A route-level rejection leaves the quota available for a subsequent ordinary ballot. These tests perform no network transaction.

`vote/test/RelaySignatureBudget.t.sol` independently executes the gas-burning owner in a local EVM and confirms that the preflight allowance cannot reach its valid return. An ordinary ERC-1271 owner passes the same allowance and records a ballot. The existing `GasTest` suite, including its 80-project bound, still passes. The signer explicitly pins all three cost-bearing fields; even state changes after estimation cannot authorize a higher maximum cost.

## NOV-02 regression coverage

`vote/test/SettledAffiliations.t.sol` records valid ballots and exercises actual fixed-price token donations, pledges and feed-price changes. Later revisions succeed with unchanged S-Tier membership; a donation after the A-Tier window also leaves a B-Tier revision valid. Solidity alone does not calculate settlement: the complementary shared/replay and API regressions establish the actual settlement state and reject attempts to change its membership.

`shared/vote/settled-affiliations.test.ts` proves S-Tier and A-Tier have settled before the support change, verifies shared validation, accepts the next nonce and retains settled results. The API regression proves the corresponding valid submissions return 200 and changed settled sets return 409. Negative shared, Python and contract tests still reject goal concentration above 50%, including when the affiliated projects' remaining asks are zero. Existing size, independent-three, withdrawal and project-addition checks pass.

The Python exporter regenerated **85 cross-language fixtures**, consumed by TypeScript and Solidity. Funding and the 1.5-times size rule continue using live asks. Affiliation concentration uses goals consistently in the contract, shared validator, Python reference, voter errors and agent instructions. The public ABI, ballot signatures and replay transcript format are unchanged.

## Dependency reconciliation and harness notes

- The baseline commit passed its advisory scans. The current working tree initially resolved Zod 3.22.4/3.25.76 despite the existing `^4.6.6` override, and [its first scan](evidence/retest-audit.txt) reported GHSA-mrhx-c7xc-m3w5. Restoring the previously reviewed Zod 4.6.7 resolution clears the gate. Other added specifiers and non-Zod package versions are retained. Frozen installation succeeds; no package manifest or override policy changed.
- The suites and type checks were repeated after lock reconciliation. An intermediate API run reported a pending promise in the existing `ledger: 429s from parallel lanes count as one pause` test ([output](evidence/retest-api-fixed.txt)); the final full run passed without altering that test or its implementation. This is a recorded intermittent harness failure, not an omitted result.
- An initial build read an obsolete `abitype` peer-directory path while the local dependency links were being reconciled ([output](evidence/retest-build.txt)). The final build ran after reconciliation and completed. The local prerender listener required the same sandbox exception as the original review. Existing browser-module, dynamic-import and process-environment warnings remain in the logs.
- Vitest uses Node because the original Deno launcher failed with the recorded BiPipe descriptor error. Runtime versions remain Deno 2.9.8, Node 26.12.1, Vitest 5.1.0, TypeScript 7.0.2 for frontend checking, Forge 1.5.1 and Solidity 0.8.28. Installed packages/caches were reused; no clean-room package provenance attestation is made.
- No production RPC, wallet login, donation, sponsored transaction or deployment was tested. The policy does not promise sponsorship for every multisig or fee condition.

## Reproducibility

For the release, [prepare-retest.py](prepare-retest.py) accepts a verified Git ref, exports the scoped [remediation.patch](remediation.patch), and fingerprints committed source. It excludes unrelated uncommitted changes, this review directory and generated output. Earlier working-tree fingerprints/patches included the then-present lockfile additions; those historical checks remain distinct from the committed release checks.

After recording verification, regenerate current matrix and review checksums with `python3 docs/security/review-2026-11-17/prepare-artifacts.py SNAPSHOT --retest`, where SNAPSHOT is an unchanged archive of the base commit. That script verifies the original archive and regenerates baseline identity metadata; it does not generate passing test results. The original assessment and matrix are retained as `assessment-b471ac5.md` and `control-matrix-b471ac5.*`.

The PDF is generated from the updated report using [render-pdf.py](render-pdf.py), embeds the report, baseline verification, retest record, current matrix and reproduction instructions, and is checked by rendering every page to PNG. Its checksum is recorded separately to avoid self-referential attachment hashes.
