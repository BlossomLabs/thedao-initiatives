"""Regenerate this follow-up's matrix and fingerprints; no network or tests."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
COMMIT = "a70726c0f776ffcc2f50cb9f0c3774d44834d134"
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() == COMMIT
assert not subprocess.check_output(["git", "diff", "--name-only", "HEAD"], cwd=ROOT, text=True).strip()
catalog = json.loads((HERE.parent / "asvs-2026-09-15/control-matrix.json").read_text())

# Status is restricted to the evidence statement, not an assurance claim about
# provider internals or a production revision that was not independently attested.
assessments = {}


def put(ids, status, basis, assessment):
    for identifier in ids.split():
        assert identifier not in assessments, identifier
        assessments[identifier] = (status, basis, assessment)


put("V1.2.1", "PARTIAL", "Source + local suite", "React escaping and Markdown/link controls reviewed; every output context was not exhaustively tested.")
put("V1.3.3", "PARTIAL", "Source + local suite", "Current CSV neutralization and local regressions support the earlier fix; spreadsheet execution/round-trip tests were not repeated.")
put("V1.3.5", "PASS", "Source + local suite", "Reviewed Markdown rendering sanitizes HTML and constrains link schemes; relevant frontend tests pass. Restricted to these first-party renderers.")
put("V1.3.6", "FAIL", "Local counterexample", "OCT-01: resolver-directed CCIP gateway URLs reach global fetch without destination validation, including mocked loopback/link-local HTTP targets.")
put("V2.2.1", "PARTIAL", "Source + local suite", "Typed/allowlisted request parsing and validation regressions pass; complete semantic validity, including donor consent provenance, is not established.")
put("V2.2.2", "PASS", "Source + local suite", "Sampled routes enforce validation at the API, with malformed/unknown-field rejection tests. Client checks are supplementary.")
put("V2.3.1", "PARTIAL", "Source + local suite", "Sensitive admin changes use recent authentication; OCT-02/03 show that associated private-data and membership workflows are not fully protected.")
put("V2.3.3", "FAIL", "Local counterexample", "OCT-03: non-atomic whole-array membership updates lose a successful removal under a concurrent addition.")
put("V2.4.1", "ACCEPTED EXCEPTION", "Historical owner decision + source", "September production observe-mode rate limiting was accepted pending redesign. Current deployed mode and resistance to automation were not tested.")
put("V3.3.1 V3.3.2 V3.3.3 V3.3.4", "PASS", "Source + local suite", "Current browser session cookie uses __Host-session, Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain. Local session/cookie tests pass; no live Set-Cookie captured in this follow-up.")
put("V3.4.1", "PASS", "Live HTTP sample", "All 12 sampled HTTPS responses, including errors, carry HSTS max-age=63072000; includeSubDomains; preload. This does not attest every endpoint.")
put("V3.4.2", "PARTIAL", "Source + live sample + local suite", "Public feeds intentionally use open non-credentialed CORS; API origin controls and watchlist preflight tests pass. Every production origin combination was not tested.")
put("V3.4.3", "PARTIAL", "Source + live header/hash sample", "Homepage CSP is enforced and all eight inline hashes match; no browser execution-blocking or provider-flow retest performed, and every policy directive was not exhaustively assessed.")
put("V3.4.4", "PASS", "Live HTTP sample", "All sampled HTTPS responses set X-Content-Type-Options: nosniff with expected content types for the sampled bodies.")
put("V3.4.5", "PASS", "Live HTTP sample", "Sampled HTTPS responses set Referrer-Policy: strict-origin-when-cross-origin.")
put("V3.4.6", "PASS", "Live HTTP sample", "Sampled HTML/API responses restrict frame ancestors and send X-Frame-Options: DENY.")
put("V3.5.1", "PASS", "Source + local suite", "Cookie-authenticated mutations use server-side Origin protection; local CSRF/Origin regressions pass. Deliberate bearer-client handling reviewed.")
put("V3.5.3", "PARTIAL", "Source + local suite", "Reviewed state-changing application actions use non-GET methods; read-path cache/session activity changes and all routes were not exhaustively modeled.")
put("V4.1.2", "ACCEPTED EXCEPTION", "Live HTTP + historical owner decision", "HTTP homepage/auth identity endpoint return exact-HTTPS 301 at the edge. Previously accepted behavior remains; no credential was sent on HTTP.")
put("V4.1.3", "PARTIAL", "Source + local suite", "Trusted connection/proxy handling has local tests; current platform settings and two-network spoof resistance remain unverified.")
put("V5.2.1", "PARTIAL", "Source + local suite", "Upload input/pixel/decoder resource limits and restore body cap reviewed; no production exhaustion or resource-capacity test.")
put("V5.2.2", "PASS", "Source + local suite", "Reviewed image upload pipeline decodes and rewrites allowed raster formats rather than accepting arbitrary MIME-labeled bytes; image regressions pass. No live upload repeated.")
put("V6.1.3 V6.3.4", "PARTIAL", "Source + documentation", "SIWE and Privy embedded-wallet paths are described and API signature checks shared; independent provider recovery/authentication-strength evidence unavailable.")
put("V6.3.3", "ACCEPTED EXCEPTION", "Historical owner decision + documentation", "Fresh SIWE is current key control, not an independent factor. September authentication-profile tailoring is preserved; no new MFA assurance established.")
put("V7.1.1", "PARTIAL", "Source + documentation", "Current seven-day absolute/one-day idle limits and five-minute step-up are documented with rationale. Full independent NIST/risk-analysis assurance is not established; OCT-02 weakens the documented private-read safeguard.")
put("V7.2.1", "PASS", "Source + local suite", "Session verification uses backend hashed reference credentials and current admin membership; local lifecycle tests pass.")
put("V7.2.2 V7.2.3", "PASS", "Source + local suite", "Session credentials are dynamically generated with cryptographic randomness exceeding 128 bits; separate inventory IDs do not expose bearer material.")
put("V7.2.4", "PASS", "Source + local suite", "Current wallet reauthentication replaces the presented token atomically; session lifecycle regressions pass. No live rotation repeated.")
put("V7.3.1 V7.3.2", "PASS", "Source + local suite", "Backend enforces the current documented inactivity and absolute limits; passive polling does not extend idle activity. Local clock-driven expiry tests pass; real-time live expiry was not waited for.")
put("V7.4.1", "PASS", "Source + local suite", "Logout/expiry/revocation invalidate backend session state. OCT-03 also confirms the removed wallet's old token stays invalid despite restored membership.")
put("V7.4.5", "PASS", "Source + local suite", "Freshly authenticated admin revocation routes support per-wallet and global termination; authorization/freshness tests pass. Membership persistence is a separate OCT-03 defect.")
put("V7.5.2", "PASS", "Source + local suite", "Session inventory and remote termination are wallet-scoped and require recent authentication; current local session/UI regressions pass.")
put("V8.1.1 V8.1.2", "PARTIAL", "Source + documentation", "Authorization and private-field policies are documented; implementation differs for stale private reads (OCT-02) and concurrent membership transitions (OCT-03). Complete rules for every object/action not independently established.")
put("V8.2.1", "FAIL", "Local counterexample", "OCT-03: completed removal can be overwritten, reestablishing admin function permissions on subsequent fresh authentication.")
put("V8.2.2", "PARTIAL", "Source + local suite", "Proposer/session/watchlist ownership is checked server-side; cross-wallet watchlist tests pass. Entire object graph and production authenticated paths not exhaustively tested.")
put("V8.2.3", "FAIL", "Local counterexample", "OCT-02: private contact/funder fields are returned to an older administrator session despite the five-minute fresh-proof policy.")
put("V8.3.1", "PASS", "Source + local suite", "Authorization gates and membership checks reside in trusted API middleware/services. This placement does not imply correctness of every rule; see OCT-02/03.")
put("V14.2.1", "PARTIAL", "Source + local suite + live GET", "Former GET comment claim endpoints removed; sampled /api/comments/mine returns 404. All external logs and historical URL credentials remain unverified.")
put("V14.2.2", "PARTIAL", "Source + local suite + live sample", "Public feeds/cache use allowlisted shapes; synthetic private-marker feed tests pass and live feed has no sampled private keys. Every cache invalidation and private prose classification not established.")
put("V14.3.1 V14.3.3", "PARTIAL", "Source + local suite + documented decision", "Viewer-scoped server caches clear on logout/role/wallet changes and denied revision revalidation. Wallet draft retention via Keep/Delete/Cancel is intentional; origin scripts can read retained drafts. No live browser retest.")
put("V14.3.2", "PASS", "Source + live sample", "Private/authenticated API and private Markdown responses use no-store; public feed caching is deliberate. Sampled denied admin/watchlist/auth responses are no-store.")
put("V15.1.1", "PASS", "Documentation + CI source", "Dependency policy has risk-based 24-hour/7-day/30-day/90-day targets, named maintainer responsibility and scoped exception requirements; CI uses a frozen advisory gate.")
put("V15.1.2", "PARTIAL", "Lockfile + source", "Frozen direct/transitive dependency inventory and registry resolutions reviewed; independent full SBOM/provenance/maintainership assurance not established.")
put("V15.2.1", "PARTIAL", "Frozen advisory audit", "OCT-04: source-map-js@1.2.1 has a High advisory and fails the gate. First maintainer discovery date unknown, so a breached seven-day deadline is not asserted.")
put("V15.2.2", "PARTIAL", "Source + local counterexample", "Many integrations/uploads/requests have bounds; OCT-01 gateway requests lack application deadlines and response/batch bounds. Production availability testing not performed.")
put("V15.3.1", "FAIL", "Local counterexample", "OCT-02: private serializers return fields beyond those allowed by the current fresh-authentication policy for older admin sessions. Anonymous public shapes still omit private markers.")
put("V15.3.2", "PARTIAL", "Source + local counterexample", "OCT-01: CCIP gateway fetches use default redirect following with no application hop validation. Intended protocol redirects and all outbound destinations were not fully modeled.")
put("V15.3.3", "PASS", "Source + local suite", "Reviewed API writes use explicit controller/action field allowlists; unknown multipart/JSON/nested fields reject before mutation in passing regressions.")
put("V15.3.4", "PARTIAL", "Source + local suite + historical decision", "Connection metadata and trusted-proxy code tested locally; production spoof resistance remains unverified under the accepted observe-mode decision.")
put("V15.3.5", "PARTIAL", "Source + static/local checks", "Types, strict comparisons and request validators reviewed; both type checks pass. Every dynamic value coercion not exhaustively assessed.")
put("V16.2.1 V16.2.5", "PARTIAL", "Source + local suite", "Structured security events contain context and redact sensitive values in local tests; complete production metadata, timestamps, downstream redaction and retention not independently observed.")
put("V16.3.1", "PASS", "Source + local suite", "Reviewed authentication/session operations emit structured success/failure security events; audit/auth regressions pass. Scope is application event generation.")
put("V16.3.2 V16.3.3", "PARTIAL", "Source + local suite", "Middleware emits authorization-denial and sensitive-operation events; completeness for every new workflow and production detection not established.")
put("V16.4.3", "ACCEPTED EXCEPTION", "Historical owner decision", "Security output is collected in the Deno dashboard with plan retention; no external alert routing/durable sink was accepted in September. No new independent monitoring evidence.")
put("V16.5.1", "PASS", "Source + local suite + live sample", "Reviewed API/client handlers return bounded generic failures without exposing stack traces; local error tests and sampled denied/unknown routes support this scope.")
put("V16.5.2 V16.5.3", "PARTIAL", "Source + local suite", "ENS ownership checks and auth failures fail closed; integrations handle errors. The preceding gateway request in OCT-01 and membership concurrency in OCT-03 limit complete failure-safety assurance.")

known = {r["req_id"] for r in catalog["requirements"]}
assert set(assessments) <= known, set(assessments) - known
rows = []
for old in catalog["requirements"]:
    row = {k: old[k] for k in ("chapter_id", "chapter_name", "section_id", "section_name", "req_id", "req_description", "L")}
    status, basis, note = assessments.get(old["req_id"], (
        "NOT REASSESSED", "No new control-specific evidence",
        "Outside this follow-up's evidenced control set. Consult the September assessment and closure for historical evidence; no current disposition inherited.",
    ))
    row.update(status=status, basis=basis, assessment=note)
    rows.append(row)
counts = dict(sorted(Counter(r["status"] for r in rows).items()))
matrix = {
    "standard": catalog["standard"], "profile": catalog["profile"],
    "source": catalog["source"], "source_sha256": catalog["source_sha256"],
    "assessment_date": "2026-10-07", "source_commit": COMMIT,
    "note": "Evidence-bounded follow-up, not certification. Catalog reused from the versioned September inventory; historical dispositions are not inherited. Accepted exceptions are owner decisions, not passes. 92 L3-only requirements excluded.",
    "historical_baseline": "../asvs-2026-09-15/control-matrix.json",
    "historical_closure": "../production-verification-2026-09-18/report.md",
    "counts": counts, "reassessed_requirements": len(assessments),
    "chapters": [{"id": c["id"], "name": c["name"], "total": c["total"],
                  "counts": dict(sorted(Counter(r["status"] for r in rows if r["chapter_id"] == c["id"]).items()))}
                 for c in catalog["chapters"]],
    "requirements": rows,
}
(HERE / "control-matrix.json").write_text(json.dumps(matrix, indent=2) + "\n")
lines = ["# ASVS 5.0.0 control matrix — 7 October 2026", "",
         "Cumulative L1 + L2 inventory: 253 requirements; 92 L3-only requirements excluded.", "",
         f"This follow-up assigns dispositions to **{len(assessments)} controls**. Remaining controls are **NOT REASSESSED**.",
         "PASS is limited to the scope and method in each row. PARTIAL does not establish the complete requirement.",
         "ACCEPTED EXCEPTION preserves a previously recorded owner decision and is not a pass.",
         "Historical September results are not inherited into current statuses. Counts are not a compliance percentage.", "",
         "See [report](report.md), [verification](verification.md), [JSON inventory](control-matrix.json),",
         "[September matrix](../asvs-2026-09-15/control-matrix.md) and",
         "[September closure](../production-verification-2026-09-18/report.md).", "",
         f"Catalog: [official versioned ASVS 5.0.0]({catalog['source']}); reused from the previous inventory.", "",
         "| Disposition | Count |", "|---|---:|"]
lines += [f"| {s} | {n} |" for s, n in counts.items()] + ["| **Total** | **253** |", ""]
for chapter in matrix["chapters"]:
    lines += [f"## {chapter['id']} — {chapter['name']}", "",
              "| Requirement | Level | Current disposition | Exact requirement | Evidence basis and scope |",
              "|---|---:|---|---|---|"]
    for row in rows:
        if row["chapter_id"] != chapter["id"]:
            continue
        def cell(s):
            return str(s).replace("|", "\\|").replace("\n", " ")
        cells = ["v5.0.0-" + row["req_id"][1:], row["L"], row["status"], row["req_description"], row["basis"] + ": " + row["assessment"]]
        lines.append("| " + " | ".join(cell(s) for s in cells) + " |")
    lines.append("")
(HERE / "control-matrix.md").write_text("\n".join(lines))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
source_files = {p: digest(ROOT / p) for p in tracked if p and not p.startswith("docs/security/") and (ROOT / p).is_file()}
dependency_paths = [
    "node_modules/viem/package.json",
    "node_modules/viem/_esm/actions/ens/getEnsName.js",
    "node_modules/viem/_esm/actions/public/call.js",
    "node_modules/viem/_esm/utils/ccip.js",
    "node_modules/viem/_esm/utils/ens/localBatchGatewayRequest.js",
    "node_modules/.deno/source-map-js@1.2.1/node_modules/source-map-js/package.json",
    "node_modules/.deno/source-map-js@1.2.1/node_modules/source-map-js/lib/source-node.js",
    "node_modules/.deno/postcss@8.5.28/node_modules/postcss/lib/previous-map.js",
]
manifest = {
    "created_at_utc": datetime.now(timezone.utc).isoformat(),
    "repository": "https://github.com/blossomlabs/thedao-initiatives.git", "commit": COMMIT,
    "tracked_application_diff": "clean", "algorithm": "SHA-256",
    "note": "All tracked files outside docs/security are fingerprinted; inclusion does not imply every line was manually audited. Resolved dependencies are separately fingerprinted and not tracked source.",
    "runtime": {"deno": "2.9.6", "v8": "15.0.245.2-rusty", "deno_typescript": "6.0.3", "node": "26.10.0", "application_typescript": "7.0.2"},
    "tracked_file_count": len(source_files), "tracked_files": source_files,
    "resolved_dependency_files": {p: digest(ROOT / p) for p in dependency_paths},
}
(HERE / "source-fingerprints.json").write_text(json.dumps(manifest, indent=2) + "\n")
artifacts = {str(p.relative_to(HERE)): digest(p) for p in sorted(HERE.rglob("*"))
             if p.is_file() and p.name != "artifact-sha256.json" and "__pycache__" not in p.parts}
(HERE / "artifact-sha256.json").write_text(json.dumps({"algorithm": "SHA-256", "excludes": ["artifact-sha256.json"], "files": artifacts}, indent=2) + "\n")
print(json.dumps({"matrix_counts": counts, "reassessed_requirements": len(assessments),
                  "tracked_file_count": len(source_files), "artifact_count": len(artifacts)}, indent=2))
