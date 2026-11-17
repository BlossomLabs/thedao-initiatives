#!/usr/bin/env python3
"""Regenerate review metadata; does not run tests or modify application source.

Usage: python3 docs/security/review-2026-11-17/prepare-artifacts.py SNAPSHOT [--retest]
SNAPSHOT must contain an unmodified archive of the target commit, plus any probes.
Run from this repository or retain this script's repository-relative location.
"""

import collections
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
COMMIT = "b471ac5ee3430fb344128850cc1a6d5ef204a75b"
DATE = "2026-11-17"
SNAPSHOT = Path(sys.argv[1]).resolve()
RETEST = "--retest" in sys.argv[2:]


def write_json(name, value):
    (HERE / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=REPO)


# Each disposition is current evidence, not a copied historical result.
ASSESSMENTS = {}


def assess(ids, status, assessment):
    for req_id in ids.split():
        assert req_id not in ASSESSMENTS, req_id
        ASSESSMENTS[req_id] = (status, assessment)


assess("V1.2.1", "PARTIAL", "React escaping, Markdown sanitization and constant-only raw HTML sinks reviewed; every output context was not exhaustively tested.")
assess("V1.3.3", "PARTIAL", "Existing CSV/export and sanitization regressions pass. Spreadsheet execution and every dangerous sink were not independently exercised.")
assess("V1.3.5", "PASS", "First-party Markdown renderer uses rehype-sanitize with constrained links; frontend rendering regressions pass. Scoped to the reviewed renderers.")
assess("V1.3.6", "PARTIAL", "Server ENS still disables CCIP-Read and its direct/nested gateway regressions pass. Fixed-host outbound services reviewed. All redirects, provider egress and deployment networking were not exhaustively tested.")
assess("V2.2.1", "PARTIAL", "API request shapes and ballot types/ranges are validated. NOV-02 demonstrates a semantic interaction missing from individually enforced rules.")
assess("V2.2.2", "PASS", "Reviewed mutations validate at API/contract boundaries; frontend checks supplement them. Existing malformed-input tests pass.")
assess("V2.3.1", "PARTIAL", "Session, moderation, pledge and voting sequencing reviewed with passing existing tests. NOV-02 prevents a legitimate later voting transition.")
assess("V2.3.2", "FAIL", "NOV-02: current-ask concentration validation conflicts with an immutable settled tier; local contract and replay counterexamples reproduce blocked later revisions.")
assess("V2.3.3", "PARTIAL", "Membership and initiative updates use atomic/CAS operations and concurrency regressions pass. Restore is batched; external chain/KV workflows require reconciliation and are not one distributed transaction.")
assess("V2.4.1", "PARTIAL", "Submission/upload limits and per-badge relay counts exist. Historical observe-mode acceptance is retained only for its original scope; NOV-01 exposes a new unbounded sponsored-cost path. No production load test.")
assess("V3.3.1 V3.3.2 V3.3.3 V3.3.4", "PASS", "Source and local session tests enforce __Host-session, Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain; browser credentials are not placed in localStorage. No live cookie sample.")
assess("V3.4.1", "PARTIAL", "Application header policy includes HSTS; local middleware tests pass. Current edge behavior and every served response were not sampled.")
assess("V3.4.2", "PARTIAL", "Origin allowlisting protects credentialed API behavior; public feeds deliberately use non-credentialed open CORS. Local Origin/preflight regressions pass; no current edge test.")
assess("V3.4.3", "PARTIAL", "Configured CSP and constant inline scripts reviewed; build/prerender succeeds. No live browser CSP enforcement or complete provider-flow exercise.")
assess("V3.4.4 V3.4.5 V3.4.6", "PARTIAL", "Header middleware and local security-header regressions pass. Production static assets, errors and all edge response classes were not independently checked.")
assess("V3.5.1", "PASS", "Cookie-authenticated mutations enforce allowed Origin at the trusted API boundary. Local CSRF/Origin negative tests pass; explicit bearer-client behavior reviewed.")
assess("V3.5.3", "PARTIAL", "Reviewed user mutations use non-safe methods. Read-triggered caches, provider refreshes and every route side effect were not exhaustively modeled.")
assess("V4.1.3", "PARTIAL", "Trusted client-IP handling has source/local-test evidence; platform proxy configuration and cross-network spoof resistance remain unverified.")
assess("V5.2.1", "PARTIAL", "Upload byte/pixel/worker limits and restore body limits reviewed; no production capacity or resource-exhaustion testing.")
assess("V5.2.2", "PASS", "Raster uploads are decoded and rewritten with allowed types rather than trusted by declared MIME; existing image validation tests pass. No live upload.")
assess("V6.1.3 V6.3.4", "PARTIAL", "SIWE signature checks and embedded-wallet entry paths reviewed. Provider recovery and consistency of upstream authentication strength were not independently verified.")
assess("V6.3.3", "ACCEPTED EXCEPTION", "Historical September authentication-profile decision only: fresh SIWE proves current wallet-key control, not an independent factor. No new MFA assurance or acceptance requested.")
assess("V7.1.1", "PARTIAL", "Documented absolute/idle/fresh-proof limits remain in source and expiry tests pass. Independent justification against the complete NIST risk profile is outside this review.")
assess("V7.2.1", "PASS", "Backend verifies hashed reference session credentials and current administrator membership; lifecycle and revocation regressions pass.")
assess("V7.2.2 V7.2.3", "PASS", "Sessions use dynamically generated cryptographic random credentials above 128 bits; inventory IDs are separate from bearer material.")
assess("V7.2.4", "PASS", "Authentication/reauthentication rotates the presented session credential with atomic backend handling; session regressions pass.")
assess("V7.3.1 V7.3.2", "PASS", "Backend enforces documented idle and absolute expiry; passive polling does not extend idle activity. Local controlled-clock tests pass.")
assess("V7.4.1", "PASS", "Logout, expiry and wallet/global revocation invalidate backend session authority. Current administrator removal and concurrency regressions pass.")
assess("V7.4.5", "PASS", "Freshly authenticated administrator routes support per-wallet/global revocation; authorization and freshness regressions pass.")
assess("V7.5.2", "PASS", "Wallet-scoped session inventory and remote termination require current authority and recent proof; local API/UI tests pass.")
assess("V8.1.1 V8.1.2", "PARTIAL", "Function, object and owner/recent-admin private-field policy documented and reflected in reviewed source/tests. Exhaustive policy-to-field inventory was not established.")
assess("V8.2.1", "PASS", "Reviewed admin functions use server authorization/current membership; removal, fixed-admin and sensitive-action recent-proof regressions pass. Scoped to reviewed application functions.")
assess("V8.2.2", "PARTIAL", "Proposer, session, watchlist, review and badge ownership are checked at trusted boundaries. Tests pass; every object/state combination was not independently enumerated.")
assess("V8.2.3", "PASS", "Private initiative fields remain owner/recent-admin scoped on reads and writes. Older unrelated administrators receive omitted fields/challenges; private-field and race regressions pass.")
assess("V8.3.1", "PASS", "Authorization resides in trusted API services/middleware and contract owner/signature checks. Client identity hints do not authorize requests.")
assess("V14.2.1", "PARTIAL", "Current session/claim API regressions pass. Historical URL credentials, external access logs and every outbound parameter were not independently audited.")
assess("V14.2.2", "PARTIAL", "Public serializers/feed allowlists and private-marker regressions pass. Classification of private free text and every cache transition remains incomplete.")
assess("V14.3.1 V14.3.3", "PARTIAL", "Viewer-scoped cache clearing and wallet-scoped draft retention reviewed; session/privacy UI tests pass. User-retained drafts are readable by origin scripts; no real-browser/provider retest.")
assess("V14.3.2", "PASS", "Private/authenticated API and private export responses apply no-store in source and local tests. Deliberately public feed caches are separate; production intermediaries unverified.")
assess("V15.1.1", "PARTIAL", "Documented application dependency policy and frozen CI advisory gate remain. The workflow lacks the separate contract package audit/test gate run manually here.")
assess("V15.1.2", "PARTIAL", "Locked npm/JSR and contract-package inventories recorded. Reused local installations and Git-pinned forge-std were not independently provenance-attested.")
assess("V15.2.1", "PASS", "Frozen Deno audit and separate contract package-lock npm audit both return no known vulnerabilities. source-map-js resolves to 1.2.2. Limited to scanner coverage/current advisories.")
assess("V15.2.2", "FAIL", "NOV-01: actual signer accepts an 8,200,000-gas ballot transaction; actual contract accepts owner code consuming over eight million gas. Transaction-count quota/funding floor do not bound individual sponsored cost.")
assess("V15.3.1", "PASS", "Explicit public/admin serializers omit withheld fields rather than returning blank substitutes. Existing public-feed/private-field regressions pass.")
assess("V15.3.2", "PARTIAL", "Resolver-directed gateway traffic remains disabled. All remaining third-party redirect behavior and deployed egress policy were not independently exercised.")
assess("V15.3.3", "PASS", "Reviewed write actions use explicit field allowlists and typed builders; unknown/nested-field negative regressions pass.")
assess("V15.3.4", "PARTIAL", "Connection/proxy IP handling has passing local tests; deployed spoof resistance and current rate-limit configuration remain unverified.")
assess("V15.3.5", "PARTIAL", "Typed request parsing and strict comparisons reviewed; both type checks pass. Every dynamic coercion is not proven safe by type checking.")
assess("V16.2.1 V16.2.5", "PARTIAL", "Structured audit/redaction regressions pass. Full production metadata, downstream redaction and retention were not independently observed.")
assess("V16.3.1", "PASS", "Reviewed authentication/session actions emit structured success/failure events and audit/auth tests pass. Scoped to application event generation.")
assess("V16.3.2 V16.3.3", "PARTIAL", "Authorization/sensitive-action event generation has local evidence; completeness of all new voting workflow events and downstream detection was not established.")
assess("V16.4.3", "ACCEPTED EXCEPTION", "Historical September logging/retention decision only: dashboard collection without independently verified external alerting/durable sink. Current deployment operations were not reassessed.")
assess("V16.5.1", "PASS", "API error middleware returns bounded generic unexpected failures; local error regressions pass. No live response/log inspection.")
assess("V16.5.2 V16.5.3", "PARTIAL", "Provider-failure, CAS, receipt verification and private-write regressions pass. Exhaustive outage/fail-safety testing was not performed; NOV-01 and NOV-02 remain open availability risks.")

if RETEST:
    updates = {
        "V2.2.1": "API request shapes and ballot ranges are validated. The NOV-02 semantic conflict is corrected with goal-based affiliation totals; shared, API, Python and contract regressions pass. Exhaustive input validation is not established.",
        "V2.3.1": "Session, moderation, pledge and voting sequencing regressions pass. NOV-02 later voting transitions remain valid after outside-support changes; all application workflows were not exhaustively verified.",
        "V2.3.2": "NOV-02 closed in source: registered goals determine affiliation shares consistently; contract, shared replay and API tests preserve later revisions after S-Tier and A-Tier settle and reject settled-set changes. Complete workflow correctness is not established.",
        "V2.4.1": "Submission/upload limits and per-badge relay quotas remain. NOV-01 adds final sponsored gas/fee/cost caps and bounded ERC-1271 preflight. Historical observe-mode acceptance is limited to its original scope; no production load test.",
        "V15.2.2": "NOV-01 closed in source: signature preflight is bounded to 500,000 gas, sponsored gas to 4,000,000, max fee to 20 gwei and total maximum cost to 0.005 ETH. Actual signed transaction and local EVM regressions pass. All resource-consumption paths and production capacity are not verified.",
        "V16.5.2": "Provider-failure, CAS, receipt verification and private-write regressions pass. Both demonstrated voting availability defects are fixed and locally retested; exhaustive failure safety was not established.",
        "V16.5.3": "Provider-failure, CAS, receipt verification and private-write regressions pass. Both demonstrated voting availability defects are fixed and locally retested; exhaustive failure safety was not established.",
    }
    for req_id, assessment in updates.items():
        ASSESSMENTS[req_id] = ("PARTIAL", assessment)
    ASSESSMENTS["V15.2.1"] = ("PASS", "Final frozen Deno and contract-package advisory scans report no known vulnerabilities. Existing Zod override restored to 4.6.7 in the current lockfile, retaining other additions. Limited to advisory coverage; see retest.md.")

previous = json.loads((HERE.parent / "retest-2026-10-07/control-matrix.json").read_text())
requirements = []
known_ids = {r["req_id"] for r in previous["requirements"]}
assert set(ASSESSMENTS) <= known_ids
for old in previous["requirements"]:
    row = {k: old[k] for k in ("chapter_id", "chapter_name", "section_id", "section_name", "req_id", "req_description", "L")}
    disposition = ASSESSMENTS.get(row["req_id"])
    if disposition:
        row["status"], row["assessment"] = disposition
        row["basis"] = "Current source/local verification; scope and limits in report.md and verification.md."
        if row["status"] == "ACCEPTED EXCEPTION":
            row["basis"] = "Historical owner decision recorded in ../production-verification-2026-09-18/report.md; not a current pass."
    else:
        row.update(status="NOT REASSESSED", basis="No sufficient current evidence.", assessment="Not independently assessed in this review; no pass or non-applicability inferred.")
        if row["req_id"] == "V4.1.2":
            row["assessment"] = "Earlier edge HTTP redirect exception is historical; no current deployment/edge observation was made."
    requirements.append(row)
assert len(requirements) == 253
counts = dict(sorted(collections.Counter(r["status"] for r in requirements).items()))
chapters = []
for chapter in previous["chapters"]:
    rows = [r for r in requirements if r["chapter_id"] == chapter["id"]]
    chapters.append({"id": chapter["id"], "name": chapter["name"], "total": len(rows), "counts": dict(sorted(collections.Counter(r["status"] for r in rows).items()))})
matrix = {k: previous[k] for k in ("standard", "profile", "source", "source_sha256")}
matrix.update(assessment_date=DATE, source_commit=COMMIT,
              note="Repository's prior exact ASVS 5.0.0 catalog reused; dispositions reassessed against local evidence. Historical exceptions are not new acceptance. No certification or deployment attestation. 92 L3-only requirements excluded.",
              historical_baseline="../retest-2026-10-07/control-matrix.json",
              historical_closure="../production-verification-2026-09-18/report.md",
              counts=counts, reassessed_requirements=len(ASSESSMENTS), chapters=chapters, requirements=requirements)
if RETEST:
    matrix.update(source_scope="Base commit plus reviewed remediation; see the exact committed release in retest-source-fingerprints.json and asvs-verification.md.",
                  baseline_matrix="control-matrix-b471ac5.json")
write_json("control-matrix.json", matrix)

md = ["# ASVS control matrix — Nov 17, 2026", "",
      "Target: `" + COMMIT + "`" + (" plus the remediation identified in [retest fingerprints](retest-source-fingerprints.json)" if RETEST else "") + ". The repository's existing ASVS 5.0.0 catalog supplies the same 253 cumulative L1/L2 requirements; requirement text is unchanged. [Official catalog](" + matrix["source"] + ").", "",
      "Current dispositions: " + ", ".join(f"**{n} {s}**" for s, n in counts.items()) + ". " + str(len(ASSESSMENTS)) + " requirements have a bounded disposition; all others remain NOT REASSESSED. Historical exceptions are recorded separately from technical passes. Counts are not a compliance percentage or certification.", "",
      "PASS is limited to the described source/local-test evidence. PARTIAL identifies incomplete verification; FAIL identifies a reproduced counterexample. Production observations from earlier reviews have not been inherited as current results. See [report](report.md) and [verification](verification.md) for evidence and limitations.", ""]
for chapter in chapters:
    md.extend(["## " + chapter["id"] + " — " + chapter["name"], "", "| Requirement | Level | Status | Current assessment |", "|---|---|---|---|"])
    for r in requirements:
        if r["chapter_id"] == chapter["id"]:
            label = r["req_id"] + " — " + r["req_description"]
            md.append("| " + " | ".join(str(v).replace("|", "\\|").replace("\n", " ") for v in (label, r["L"], r["status"], r["assessment"])) + " |")
    md.append("")
(HERE / "control-matrix.md").write_text("\n".join(md))

files = {}
for entry in git("ls-tree", "-rz", "--full-tree", COMMIT).split(b"\0"):
    if not entry:
        continue
    meta, name = entry.split(b"\t", 1)
    mode, kind, oid = meta.split()
    if kind != b"blob":
        continue
    path = name.decode()
    data = (SNAPSHOT / path).read_bytes()
    actual_oid = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    assert actual_oid == oid.decode(), f"Snapshot differs from commit: {path}"
    files[path] = {"git_blob": actual_oid, "sha256": sha256(data), "bytes": len(data)}
write_json("source-fingerprints.json", {
    "source_commit": COMMIT, "git_tree": git("rev-parse", COMMIT + "^{tree}").decode().strip(),
    "assessment_date": DATE, "tracked_blobs_verified": len(files), "mismatches": [],
    "note": "Every tracked blob in the archived snapshot matched the requested Git tree after verification. Hash coverage is snapshot identity, not a claim that every line was manually reviewed. Untracked files, credentials, installed dependencies and generated build files are excluded.",
    "files": files,
})

lock = json.loads((SNAPSHOT / "deno.lock").read_text())
pkg = json.loads((SNAPSHOT / "package.json").read_text())
vote_pkg = json.loads((SNAPSHOT / "vote/package.json").read_text())
vote_lock = json.loads((SNAPSHOT / "vote/package-lock.json").read_text())
selected = ("react@", "react-router@", "viem@", "vitest@", "typescript@", "source-map-js@", "@privy-io/react-auth@", "@walletconnect/ethereum-provider@", "@imagemagick/magick-wasm@")
write_json("dependency-inventory.json", {
    "source_commit": COMMIT, "assessment_date": DATE,
    "note": "Inventory is lockfile metadata, not installed-package provenance verification. Versions with peer suffixes retain Deno's exact lock keys. Advisory output is in evidence/.",
    "lockfile_sha256": {p: files[p]["sha256"] for p in ("deno.lock", "vote/package-lock.json")},
    "runtime_tools": {"deno": "2.9.8", "deno_bundled_typescript": "6.0.3", "node": "26.12.1", "forge": "1.5.1", "solc": "0.8.28"},
    "application_direct_dependencies": pkg["dependencies"],
    "application_dev_dependencies": pkg["devDependencies"],
    "deno_specifiers": lock["specifiers"],
    "locked_npm_entries": len(lock["npm"]),
    "locked_jsr_entries": len(lock["jsr"]),
    "selected_resolutions": {k: v for k, v in lock["npm"].items() if k.startswith(selected)},
    "jsr_resolutions": lock["jsr"],
    "contract_direct_dependencies": vote_pkg["devDependencies"],
    "contract_locked_packages": vote_lock["packages"],
})
# A current retest regeneration must retain the completed 253-control assessment.
if RETEST and (HERE / "complete-asvs.py").is_file():
    subprocess.run([sys.executable, str(HERE / "complete-asvs.py")], check=True)
    current_matrix = json.loads((HERE / "control-matrix.json").read_text())
    counts = current_matrix["counts"]
    ASSESSMENTS = {r["req_id"]: r for r in current_matrix["requirements"]}

artifacts = {p.relative_to(HERE).as_posix(): sha256(p.read_bytes()) for p in sorted(HERE.rglob("*")) if p.is_file() and p.name != "artifact-sha256.json" and "__pycache__" not in p.parts}
write_json("artifact-sha256.json", {"source_commit": COMMIT, "algorithm": "SHA-256", "note": "Covers this review's artifacts except this checksum manifest itself.", "files": artifacts})
print(json.dumps({"counts": counts, "assessed": len(ASSESSMENTS), "tracked_files": len(files), "artifacts": len(artifacts)}, indent=2))
