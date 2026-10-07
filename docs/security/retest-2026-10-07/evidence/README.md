# Retest evidence

All logs concern the [tested revision](../report.md) after integration with latest `main`.

- `api-tests.txt`: full API suite, 358 passed/eight steps.
- `web-tests.txt`: full frontend suite, 686 passed in 111 files.
- `security-regressions.txt`: 21 tests/eight steps with network explicitly denied; ENS gateways,
  private-field boundaries, admin membership races and upstream pending-edit rules.
- `api-typecheck.txt`, `web-typecheck.txt`, `lint.txt`: successful static checks.
- `build.txt`: successful production build and prerender; non-fatal bundle warnings retained.
- `dependency-audit.txt`: exact CI frozen audit command, exit 0, no known vulnerabilities.

Current regression source lives in the API/frontend test directories and is fingerprinted in
[source-fingerprints.json](../source-fingerprints.json). No credential or real production private
record is present. No new production HTTP sample was taken for this local retest.
