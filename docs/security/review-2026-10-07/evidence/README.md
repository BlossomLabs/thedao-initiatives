# Evidence guide

These artifacts support the [report](../report.md) at commit
`a70726c0f776ffcc2f50cb9f0c3774d44834d134`. Full commands, runtime versions and limitations are in
[verification.md](../verification.md).

| Artifact | Purpose |
|---|---|
| `api-reproductions.test.ts` | Isolated OCT-01/02/03 counterexamples using application routes and temporary KV; synthetic credentials and mocked external services |
| `local-reproductions.txt` | Successful run with network access explicitly denied; tests pass when the defects exist |
| `public-site-check.py` | Collector for 14 bounded unauthenticated GETs; running it again performs fresh public requests |
| `public-site.json` | Successful public observation set; no complete production body or credential stored |
| `api-tests.txt`, `web-tests.txt` | Existing suite output: 336 API and 666 frontend tests passed |
| `api-typecheck.txt`, `web-typecheck.txt`, `lint.txt` | Successful static checks |
| `build.txt` | Successful production build and prerender; non-fatal bundle warnings retained |
| `dependency-audit.txt` | Frozen advisory scan: one High advisory, command exits 1 |
| `dependency-tree.txt` | Owning paths to the affected package from the checked-in lockfile |

Findings concern the source snapshot and demonstrated local behavior. The public sample does not
attest the deployed revision or internal network reachability. No live authenticated operation or
production mutation was performed in this follow-up. Evidence hashes are in
[artifact-sha256.json](../artifact-sha256.json).
