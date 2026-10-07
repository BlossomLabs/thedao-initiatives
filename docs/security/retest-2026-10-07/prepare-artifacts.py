"""Build a bounded source retest record; never performs network requests/tests."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCE = "5914155d28798ffd09f777e017342d08169db254"
MAIN = "27d5280b66e81efe585c17ec06f6f6f77180fee1"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


assert git("rev-parse", "HEAD") == SOURCE
assert git("rev-parse", "origin/main") == MAIN
assert not [p for p in git("diff", "--name-only", "HEAD").splitlines() if not p.startswith("docs/security/")]
assert "No known vulnerabilities found" in (HERE / "evidence/dependency-audit.txt").read_text()
assert "358 passed (8 steps) | 0 failed" in (HERE / "evidence/api-tests.txt").read_text()
assert "686 passed" in (HERE / "evidence/web-tests.txt").read_text()
assert "Prerender (html): SPA Fallback" in (HERE / "evidence/build.txt").read_text()

baseline = json.loads((HERE.parent / "review-2026-10-07/control-matrix.json").read_text())
updates = {
    "V1.3.6": ("PASS", "Source + network-denied regression", "OCT-01 closed: server CCIP-Read disabled. Eight direct/local-batch cases with private IPv4/IPv6, link-local and public gateways produce no gateway fetch through reverse/forward/text paths. Configured RPC and fixed-domain fallback remain; infrastructure egress outside this path not attested."),
    "V2.3.1": ("PARTIAL", "Source + local suite", "Recent proof protects sensitive actions and private team reads; membership changes use CAS. New held-edit acceptance/rejection/lifecycle races tested. Complete business-process assurance remains unverified."),
    "V2.3.3": ("PASS", "Source + deterministic concurrency regressions", "OCT-03 closed within membership scope: strong-read/CAS retries preserve add/remove, add/add and remove/remove outcomes; duplicate add has one winner. Broader transactions and moderation race regressions pass; no assertion about external provider transactions."),
    "V7.1.1": ("PARTIAL", "Source + documented policy", "Current seven-day absolute/one-day idle limits and five-minute step-up documented with rationale. OCT-02's private-read bypass fixed. Independent NIST/risk-analysis assurance remains incomplete."),
    "V7.4.1": ("PASS", "Source + local suite", "Logout/expiry/revocation invalidate session state. Successful membership removals remain authoritative under competing writes; old credentials return 401. Scope is the local application lifecycle."),
    "V8.1.1": ("PARTIAL", "Source + documentation", "Current function/object and owner/fresh-admin field policies documented and implemented in tested paths. Independent exhaustive documentation coverage remains incomplete."),
    "V8.1.2": ("PARTIAL", "Source + documentation", "Owning proposer and recent-admin initiative-field rules documented; serialization/write boundaries tested. Complete field-policy inventory for all objects remains unverified."),
    "V8.2.1": ("PASS", "Source + local suite", "OCT-03 closed: completed removals survive competing additions/removals and current membership denies new admin access. Fixed/self-removal/fresh-auth gates preserved. New moderation routes retain server admin/recent-proof gates."),
    "V8.2.3": ("PASS", "Source + local counterexample regressions", "OCT-02 closed in initiative-field scope: owning proposers keep their fields; older unrelated admins receive no contact/funder fields from detail/dashboard/read/edit responses. Private exports challenge; freshness/ownership rechecked inside private writes."),
    "V15.2.1": ("PASS", "Exact frozen CI advisory audit", "OCT-04 closed by upstream 946cb57: source-map-js@1.2.2 locked, affected 1.2.1 absent; frozen audit exits 0 with no known vulnerabilities. Scope is known advisories in this resolved snapshot, not undisclosed package defects."),
    "V15.2.2": ("PARTIAL", "Source + local suite", "CCIP gateway work removed; configured RPC, uploads and other costly operations have reviewed bounds. Production capacity/load and complete availability assurance remain unverified."),
    "V15.3.1": ("PASS", "Source + local suite", "OCT-02 closed: serializer decisions omit withheld contact/funder fields rather than substituting blanks; authorized pending-revision metadata preserved separately. Public feed marker/allowlist regressions and existing suites pass."),
    "V15.3.2": ("PARTIAL", "Source + network-denied regression", "Resolver-directed gateway requests and their default redirects no longer execute. All remaining third-party redirect policies and production connection/egress behavior were not exhaustively reassessed."),
    "V16.5.2": ("PARTIAL", "Source + local suite", "ENS failures no longer initiate resolver gateway fetches; current error and integration regressions pass. Complete external-provider failure/capacity testing remains unverified."),
    "V16.5.3": ("PARTIAL", "Source + local suite", "Membership conflicts retry or fail without overwriting authority. Ownership/freshness/lifecycle checked at private/edit writes; relevant negative cases pass. Exhaustive fail-safety assurance remains unverified."),
}
for row in baseline["requirements"]:
    if row["req_id"] in updates:
        row["status"], row["basis"], row["assessment"] = updates[row["req_id"]]
counts = dict(sorted(Counter(r["status"] for r in baseline["requirements"]).items()))
assert counts == {"ACCEPTED EXCEPTION": 4, "NOT REASSESSED": 186, "PARTIAL": 30, "PASS": 33}
baseline.update(assessment_date="2026-10-07", source_commit=SOURCE, upstream_main=MAIN,
                note="Evidence-bounded source retest of the October findings, not ASVS certification or deployment attestation. 67 control dispositions retained; unassessed controls and prior owner exceptions not promoted. 92 L3-only controls excluded.",
                counts=counts, historical_baseline="../review-2026-10-07/control-matrix.json")
for chapter in baseline["chapters"]:
    chapter["counts"] = dict(sorted(Counter(r["status"] for r in baseline["requirements"] if r["chapter_id"] == chapter["id"]).items()))
(HERE / "control-matrix.json").write_text(json.dumps(baseline, indent=2) + "\n")
lines = ["# ASVS 5.0.0 matrix — October source retest", "",
         "253 cumulative L1/L2 requirements; 67 have evidence-bounded dispositions, 186 are NOT REASSESSED.",
         "The 92 L3-only requirements remain outside scope. Owner exceptions are not passes; counts are not a compliance percentage.",
         "PASS is limited to the method and scope in its row. No deployment or provider attestation is implied.", "",
         "See [report](report.md), [verification](verification.md), [JSON](control-matrix.json) and",
         "[pre-fix matrix](../review-2026-10-07/control-matrix.md).", "",
         f"Catalog: [official versioned ASVS 5.0.0]({baseline['source']}); exact texts reused from the previous inventory.", "",
         "| Disposition | Count |", "|---|---:|"]
lines += [f"| {s} | {n} |" for s, n in counts.items()] + ["| FAIL | 0 |", "| **Total** | **253** |", ""]
for chapter in baseline["chapters"]:
    lines += [f"## {chapter['id']} — {chapter['name']}", "",
              "| Requirement | Level | Disposition | Exact requirement | Evidence and scope |",
              "|---|---:|---|---|---|"]
    for row in baseline["requirements"]:
        if row["chapter_id"] != chapter["id"]:
            continue
        cells = ["v5.0.0-" + row["req_id"][1:], row["L"], row["status"], row["req_description"], row["basis"] + ": " + row["assessment"]]
        lines.append("| " + " | ".join(str(c).replace("|", "\\|").replace("\n", " ") for c in cells) + " |")
    lines.append("")
(HERE / "control-matrix.md").write_text("\n".join(lines))

lock = json.loads((ROOT / "deno.lock").read_text())
assert "source-map-js@1.2.2" in lock["npm"] and "source-map-js@1.2.1" not in lock["npm"]
assert git("merge-base", "--is-ancestor", "946cb57", "HEAD") == ""
inventory = {"source_commit": SOURCE, "upstream_dependency_fix": git("rev-parse", "946cb57"),
             "lockfile_sha256": hashlib.sha256((ROOT / "deno.lock").read_bytes()).hexdigest(),
             "locked_packages": sorted(lock["npm"]),
             "source_map_direct_parents": [k for k, v in lock["npm"].items() if "source-map-js" in v.get("dependencies", [])],
             "advisory_gate": "No known vulnerabilities found; exit 0; no exclusions or ignored registry errors"}
(HERE / "dependency-inventory.json").write_text(json.dumps(inventory, indent=2) + "\n")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
files = {p: digest(ROOT / p) for p in tracked if p and not p.startswith("docs/security/") and (ROOT / p).is_file()}
resolved = ["node_modules/viem/package.json", "node_modules/viem/_esm/actions/ens/getEnsName.js",
            "node_modules/viem/_esm/actions/public/call.js", "node_modules/viem/_esm/utils/ccip.js",
            "node_modules/viem/_esm/utils/ens/localBatchGatewayRequest.js",
            "node_modules/.deno/source-map-js@1.2.2/node_modules/source-map-js/package.json",
            "node_modules/.deno/source-map-js@1.2.2/node_modules/source-map-js/lib/source-node.js",
            "node_modules/.deno/postcss@8.5.28/node_modules/postcss/lib/previous-map.js"]
manifest = {"created_at_utc": datetime.now(timezone.utc).isoformat(), "source_commit": SOURCE,
            "upstream_main": MAIN, "branch": "security/upstream-october-review-fixes", "algorithm": "SHA-256",
            "note": "All tracked files outside docs/security are fingerprinted; this is not a claim of manually auditing every line. Publication/CI are checked separately afterward.",
            "tracked_file_count": len(files), "tracked_files": files,
            "resolved_dependency_files": {p: digest(ROOT / p) for p in resolved}}
(HERE / "source-fingerprints.json").write_text(json.dumps(manifest, indent=2) + "\n")
artifacts = {str(p.relative_to(HERE)): digest(p) for p in sorted(HERE.rglob("*"))
             if p.is_file() and p.name != "artifact-sha256.json" and "__pycache__" not in p.parts}
(HERE / "artifact-sha256.json").write_text(json.dumps({"algorithm": "SHA-256", "excludes": ["artifact-sha256.json"], "files": artifacts}, indent=2) + "\n")
print(json.dumps({"counts": counts, "tracked_files": len(files), "artifacts": len(artifacts)}, indent=2))
