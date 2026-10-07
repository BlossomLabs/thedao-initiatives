# October security retest — 7 October 2026

## Verdict

**OCT-01 through OCT-04 pass the source retest. No open finding from the October assessment remains in the tested source.** The original [assessment](../review-2026-10-07/report.md) is retained as historical evidence. This closure applies to the source revision below; production deployment has not been verified. Earlier owner exceptions and unverified ASVS/provider/operational requirements remain separate and are not promoted to passes.

The fixed tree passes **358 API tests and 686 frontend tests**, both type checks, lint, the production build/prerender and the exact CI dependency audit. A network-denied security run separately passes **21 tests with eight steps**, including the original counterexamples converted into safe-behavior regressions and the new moderation workflow. The frozen audit reports **No known vulnerabilities found**.

## Reviewed revision and commits

**Published source snapshot:** `5914155d28798ffd09f777e017342d08169db254`  
**Upstream main:** `27d5280b66e81efe585c17ec06f6f6f77180fee1`  
**Local publication branch:** `security/upstream-october-review-fixes`

The source tree is identical to local retest revision `12baf1930d8c32ebb01964363a1eba7990baf9c4`. Publication through the GitHub connection recreated commit metadata; [publication-history.json](publication-history.json) maps the local and published commit IDs and their identical tree hashes. The branch contains latest `main` as fetched again before recording the retest. Its new proposer-edit moderation and category-revision changes are preserved. The original review is stored in its own documentation commit (`7dcd0ca`); each remaining implementation fix has a separate commit. OCT-04 was already fixed by upstream, so that change is credited and retained rather than duplicated.

| Finding | Result | Fix commit | Verified behavior |
|---|---|---|---|
| OCT-01 — ENS gateway SSRF | **PASS / closed in source** | `32b40bb5a0476aedfa012fe931387613b6f74097` | CCIP-Read disabled in the server ENS client; direct/nested gateway envelopes produce no gateway fetch across reverse, forward and avatar/text lookups. |
| OCT-02 — Private reads bypass fresh proof | **PASS / closed in source** | `7314f74b48054986b950128139c1e7bcc52f4a28` | Older admin responses omit contacts/funders, exports challenge, and owning proposers retain their data. All response paths use the field policy. |
| OCT-03 — Admin membership resurrection | **PASS / closed in source** | `5914155d28798ffd09f777e017342d08169db254` | Strong-read/CAS membership updates retry conflicts; competing additions cannot overwrite successful removals. |
| OCT-04 — Vulnerable source-map dependency | **PASS / closed in source** | Upstream `946cb57fa5dc2cf570d29c7606b544c3ca3d6475` | Lockfile resolves `source-map-js@1.2.2`; the exact frozen CI advisory gate exits 0. |

The implementation revision above is the retest's source snapshot. Upstream publication and CI
are checked separately after the push; no production deployment attestation is inferred from them.

## Retest evidence by finding

### OCT-01

[ens.ts](../../../api/services/ens.ts) explicitly sets `ccipRead: false`. The regression uses actual locked **viem 2.57.3** with ABI-valid direct and Universal Resolver local-batch `OffchainLookup` responses. Its eight cases include loopback IPv4, loopback IPv6, link-local metadata and a public gateway, each in direct and nested form. The anonymous ENS route, forward lookup and avatar/text lookup produce **zero gateway fetches**. The fixed-domain ENS fallback is separately observed, and an ordinary on-chain address still resolves.

This intentionally removes server-side resolver-directed gateway support. Ordinary on-chain resolution and the existing fixed `api.ensdata.net` fallback remain. Supporting custom CCIP gateways later would require a vetted egress and resource policy. No internal endpoint or malicious mainnet resolver was contacted. See [ENS regression source](../../../api/tests/ens-ccip.test.ts) and [security run](evidence/security-regressions.txt).

### OCT-02

[private-fields.ts](../../../api/lib/private-fields.ts) centralizes owning-proposer/recent-admin access, using the same five-minute predicate as the authentication challenge. Administrator serializers require an explicit private-field decision. Initiative/admin JSON reads, dashboard cards, status/review responses and ordinary edit responses apply the policy; private Markdown additionally requires recent admin authentication.

At **exactly 300 seconds**, the reproduced older administrator still gets ordinary JSON responses, but neither private marker is present, and the private fields are absent rather than blank substitutes. Harmless PATCH responses also omit them. Leads and private Markdown return **403 with `reauthenticate: true`**. A fresh admin receives the expected fields; an older owning proposer can read and edit their own pending row; another user cannot access that row. An administrator who loses proposer ownership during a private-field write, or crosses the freshness deadline inside the write, is challenged before the field is committed.

The browser requests fresh proof on an explicit button click, handles the private-download challenge once, and does not initialize an editor from withheld fields. Refusing a signature keeps fields hidden. An in-progress editor retains its initial data and unsaved draft when background polling later omits private fields. Pending-revision metadata remains available to authorized administrators independently of lead access, preserving upstream moderation. See [API regressions](../../../api/tests/private-fields.test.ts), [confirmation tests](../../../app/components/admin/ConfirmPrivateFields.test.tsx), [editor tests](../../../app/routes/initiative.edit.test.tsx) and the [updated policy](../../session-security.md).

### OCT-03

[meta.ts](../../../api/db/meta.ts) provides a bounded strong-read/compare-and-set update, and [admins.ts](../../../api/services/admins.ts) validates membership against each retry's current array. Session revocation follows a successful membership commit; fixed-admin, self-removal and recent-authentication restrictions remain.

The deterministic reproduction pauses the first membership read after capturing its value/version, lets a second authorized request commit, then resumes the first writer. The final state correctly preserves add/remove, add/add and remove/remove outcomes. Duplicate simultaneous additions have one winner and one 409. A successfully removed wallet remains a non-admin; its old token returns 401 and a simulated new session issued from current membership returns 403 from admin APIs. Session issuance is simulated, not a live SIWE login. See [concurrency regressions](../../../api/tests/admins-concurrency.test.ts).

### OCT-04

Upstream `946cb57` already updated the resolved component and other dependencies. That commit is an ancestor of the tested revision. No advisory exclusion, registry-error suppression or scanner downgrade was introduced. `source-map-js@1.2.1` is absent from the current lockfile; **1.2.2** resolves through the owning build/test packages. `deno audit --lock=deno.lock --frozen-lockfile` exits **0**, and the full build and test suites pass with the frozen updated graph. See [audit output](evidence/dependency-audit.txt) and [resolved inventory](dependency-inventory.json).

## Upstream changes reviewed during integration

The five newer `main` commits include dependency updates, revisioned category changes, proposer edits held for review, and rechecking lifecycle/ownership inside writes. Rebase conflicts were resolved to preserve those behaviors. Held/rejected/superseded revisions remain restricted to their proposer and administrators; anonymous history stays published-only. Accept/reject actions retain recent authentication. Lifecycle/proposer changes racing an edit are checked by the write. Existing API/UI regressions for this workflow pass, including the additional private-write checks described above.

## Scope, ASVS and deployment limits

The [updated matrix](control-matrix.md) retains the same 253-control inventory and 67-control evidence scope: **33 PASS, 30 PARTIAL, four ACCEPTED EXCEPTION and 186 NOT REASSESSED**, with **zero FAIL** in that evidenced scope. Counts are not a compliance percentage. Closing these findings is not an ASVS Level 2 certification. Retained rate-limit, transport-edge, logging and authentication-profile decisions remain owner exceptions, and untested controls/provider infrastructure remain unverified.

This retest is local source/configuration and mocked integration verification. No production login, administrator mutation, upload, transaction, invasive gateway, flood, restore or deployment was performed. The earlier public HTTP sample remains historical and does not attest this revision. A deployment closure requires proof that the corrected code and lockfile are running, plus a bounded staging/production smoke test of supported identity and private-data workflows.

## Evidence

- [Verification commands and results](verification.md)
- [ASVS matrix](control-matrix.md) and [JSON](control-matrix.json)
- [Source fingerprints](source-fingerprints.json), [artifact checksums](artifact-sha256.json), [dependency inventory](dependency-inventory.json)
- [API tests](evidence/api-tests.txt), [frontend tests](evidence/web-tests.txt), [network-denied security regressions](evidence/security-regressions.txt)
- [API type check](evidence/api-typecheck.txt), [frontend type check](evidence/web-typecheck.txt), [lint](evidence/lint.txt), [build](evidence/build.txt), [audit](evidence/dependency-audit.txt)
