# Local defect reproductions

The fixes and their positive/negative regression tests are documented in
[retest.md](../retest.md). Files named `retest-*` contain remediation evidence. The probes
below preserve the original counterexamples and must run against the original commit;
they are not expected to keep passing after the fixes.

These probes demonstrate NOV-01 and NOV-02 at commit `b471ac5ee3430fb344128850cc1a6d5ef204a75b`. **A passing probe means the defect was reproduced.** They use only synthetic RPC data, an ephemeral test database and a local EVM. The repeated-byte private key in the API fixture is public test data; it must never receive funds.

Use a separate checkout/archive of that commit with its locked dependencies and Solidity compiler installed. Copy this review's `evidence` directory into the same `docs/security/review-2026-11-17/evidence` path in that checkout. From its root, run:

```sh
deno test --frozen --cached-only --node-modules-dir=manual -A --deny-net docs/security/review-2026-11-17/evidence/*.repro.test.ts
```

The TypeScript files import the actual application route, signer and shared voting code. The API probe intercepts RPC requests, supplies an expensive estimate and decodes the resulting signed transaction; it does not execute that transaction. The replay probe establishes the settlement/validation conflict without a provider.

For contract execution, copy the two Solidity probes into `vote/test/` in that isolated checkout, where their imports resolve against the existing fixtures:

```sh
cp docs/security/review-2026-11-17/evidence/RelayerGas.repro.t.sol vote/test/
cp docs/security/review-2026-11-17/evidence/SettledDonation.repro.t.sol vote/test/
cd vote
forge test --offline --match-contract RelayerGasReproduction -vv
forge test --offline --match-contract SettledDonationReproduction -vv
```

The gas probe executes a valid but deliberately expensive ERC-1271 implementation against the actual ballot contract. The donation probe transfers one dollar of a locally deployed fixed-price token and checks the contract's concentration failure. Together with the TypeScript probes they substantiate each finding across its relevant boundaries; they are not a single production end-to-end run.

The original suite logs were captured before the contract probes were added. `web-tests.txt` and `build.txt` retain failed environment attempts; `web-tests-node.txt` and `build-complete.txt` contain the successful reruns. See [verification.md](../verification.md) for exact counts and limitations.

## Full ASVS expansion

The asvs-* logs record the added preview/static probes, the pre-fix copied-cookie failure, the initial full API failure, its isolated retry, the final full API pass, API type checking and lint. asvs-live.json preserves six unauthenticated public observations with response headers and content hashes. These samples are not deployed-remediation identity proof. See ../asvs-verification.md for limits and ../complete-asvs.py for the full matrix generator.

## Gap remediation

The gap-* logs identify the versioned-storage, independent preview key, server autosave and redirect-refusal changes. gap-api.txt is the full 658-test/eight-step API pass; gap-dataset.txt adds two later failure cases within a seven-test storage suite. gap-web.txt is the 1,635-test frontend/shared pass. Type/lint/build and focused autosave evidence are separate. gap-api-initial.txt preserves the intermediate failures, including the index CAS-budget regression subsequently repaired. nexus-jev.json is a credential-free model catalog excerpt; it proves endpoint compatibility only.

GAP-02 remains open by request. GAP-04 remains open pending provider-supported credential expiry/rotation and deployment evidence. Neither is silently accepted or counted as passing. See ../asvs-verification.md and ../report.md for the final boundary.

Shared Nexus key follow-up: nexus-shared-key-tests.txt/types.txt/lint.txt record 54 passing focused API tests, type checks and lint in the remediation working tree. nexus-commit-tests.txt/types.txt record the same 54 tests and API/server type checks for the isolated eight-file patch committed as 334f0d6. These are local mocked checks; no authenticated Nexus call or credential provisioning occurred.

## Committed release validation

The release-* logs identify the isolated ad4b955 source archive: 660 API tests/eight steps, 1,645 frontend/shared tests, 173 contract tests, 217 Python tests, API/frontend type checks, lint, production build/prerender and dependency advisories. Unrelated local changes were excluded. nexus-key-lifecycle.json records the owner's confirmation of manual Nexus key revocation and no expiration, without claiming a live credential test. See ../asvs-verification.md for the complete release boundary.
