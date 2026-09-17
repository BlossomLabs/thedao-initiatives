# Dependency security

On 17 September 2026, `deno audit --lock=deno.lock` against the current lockfile
returned `No known vulnerabilities found`. The 15 September assessment's 14 advisories
describe its historical lockfile. Subsequent wallet/dependency changes removed that result;
no additional wallet package upgrade or exception was necessary for this retest. The final audit also
includes the newly added `@imagemagick/magick-wasm@0.0.43` raster decoder and remains clean.

CI audits the resolved, frozen lockfile on every pull request and main-branch push.
Registry failures must fail the check; never use `--ignore-registry-errors` or
`--ignore-unfixable`. There are currently no accepted advisory exceptions.

Repository maintainers own triage. From discovery, target remediation within 24 hours for
critical, 7 days for high, 30 days for moderate, and 90 days for low advisories. Evidence of
active exploitation or a reachable credential/payment compromise requires immediate containment.
Package severity alone does not prove application exploitability.

For a finding, record the locked package/version and advisory ID, owning direct dependency,
browser/server entry point, vulnerable function and whether attacker-controlled input can reach it.
The browser entry points are the wagmi/WalletConnect integration in `app/lib/wagmi.ts` and the
lazily loaded Privy SDK in `app/context/privy.tsx`. The API imports viem for cryptographic and
chain operations and uses native fetch for its integrations. User-uploaded images reach the
ImageMagick WebAssembly decoder through `api/lib/image-worker.ts`, with format, pixel, resource and
wall-time limits. Treat decoder advisories as directly reachable. Evaluate the actual resolved path,
including runtime-specific adapters; do not infer reachability merely from a lockfile entry.

Prefer supported owning-SDK updates. After changes, rerun the advisory audit, build, and
wallet/authentication/donation regression tests. Live provider workflows need a staging smoke test.
An exception requires a named maintainer, precise advisory/package scope, reachability evidence,
compensating controls, and an expiry no later than the applicable remediation deadline.
Record it in this document before introducing an explicit advisory-specific CI exclusion;
never disable the audit or broadly exclude a severity. Reassess every exception on expiry and
when its dependency path changes. A clean advisory scan is not a complete security assessment.
