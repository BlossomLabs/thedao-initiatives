#!/usr/bin/env python3
"""Fingerprint a verified source commit and export its scoped remediation patch.

Run after verification, optionally passing the verified Git ref (default HEAD).
This does not run tests or certify files. Uncommitted changes, credentials and
the review/output artifacts themselves are excluded from source fingerprints.
"""

import hashlib
import io
import sys
import tarfile
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
BASE = "b471ac5ee3430fb344128850cc1a6d5ef204a75b"
NEW = [
    'api/db/dataset.ts',
    'api/routes/draft.ts',
    'api/tests/dataset.test.ts',
    'api/tests/draft.test.ts',
    'api/tests/outbound.test.ts',
    'shared/draft/autosave.ts',

    "api/services/vote-relay-policy.ts",
    "api/tests/vote-relay-budget.test.ts",
    "shared/vote/settled-affiliations.test.ts",
    "vote/test/RelaySignatureBudget.t.sol",
    "vote/test/SettledAffiliations.t.sol",
]
CHANGED = [
    ".env.example",
    "README.md",
    "api/README.md",
    "api/app.ts",
    "api/bootstrap.ts",
    "api/chain/reviewer.ts",
    "api/chain/rpc.ts",
    "api/config.ts",
    "api/db/initiatives.ts",
    "api/db/mod.ts",
    "api/lib/sitelock.ts",
    "api/middleware/headers.ts",
    "api/routes/admin.ts",
    "api/routes/ai.ts",
    "api/routes/board.ts",
    "api/routes/feeds.ts",
    "api/routes/support.ts",
    "api/routes/vote.ts",
    "api/services/ai.ts",
    "api/services/audit.ts",
    "api/services/backup.ts",
    "api/services/content.ts",
    "api/services/daily-cache.ts",
    "api/services/ens.ts",
    "api/services/funding.ts",
    "api/services/pinata.ts",
    "api/services/safe-api.ts",
    "api/services/vote-chain.ts",
    "api/services/vote-llms.ts",
    "api/services/vote-round-read.ts",
    "api/tests/app-helpers.ts",
    "api/tests/audit.test.ts",
    "api/tests/backup.test.ts",
    "api/tests/card-summary.test.ts",
    "api/tests/eventual-reads.test.ts",
    "api/tests/kv-depth.test.ts",
    "api/tests/moderation.test.ts",
    "api/tests/routes.test.ts",
    "api/tests/rpc.test.ts",
    "api/tests/safe-api.test.ts",
    "api/tests/safe-deploy.test.ts",
    "api/tests/site.test.ts",
    "api/tests/sitelock.test.ts",
    "api/tests/status-index.test.ts",
    "api/tests/structured.test.ts",
    "api/tests/vote-llms.test.ts",
    "api/tests/vote-round.test.ts",
    "api/tests/write-fields.test.ts",
    "app/components/initiative-form/InitiativeForm.tsx",
    "app/components/initiative-form/useAutosave.test.ts",
    "app/components/initiative-form/useAutosave.ts",
    "app/components/wallet/DraftLogoutDialog.tsx",
    "app/context/session.test.tsx",
    "app/context/session.tsx",
    "app/lib/browser-privacy.ts",
    "app/lib/vote-rules-copy.test.ts",
    "app/lib/vote-rules-copy.ts",
    "deno.lock",
    "docs/security-audit.md",
    "docs/session-security.md",
    "docs/superpowers/specs/2026-11-11-ballot-rules-design.md",
    "docs/superpowers/specs/2026-11-15-ballot-rules-on-asks-design.md",
    "shared/vote/fixtures/ballot-rules.json",
    "shared/vote/rules.test.ts",
    "shared/vote/rules.ts",
    "vote/README.md",
    "vote/contracts/SignedBallots.sol",
    "vote/reference/ballot_rules.py",
    "vote/reference/export_rules_fixtures.py",
    "vote/reference/test_ballot_rules.py",
    "vote/test/BallotRules.t.sol"
]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=REPO)


def digest(data):
    return hashlib.sha256(data).hexdigest()


source_commit = git("rev-parse", (sys.argv[1] if len(sys.argv) > 1 else "HEAD") + "^{commit}").decode().strip()
patch = git("diff", "--no-ext-diff", BASE, source_commit, "--", *CHANGED, *NEW)
(HERE / "remediation.patch").write_bytes(patch)

files = {}
review_prefix = HERE.relative_to(REPO).as_posix() + "/"
with tarfile.open(fileobj=io.BytesIO(git("archive", source_commit))) as archive:
    for member in archive.getmembers():
        name = member.name
        if member.isdir() or name.startswith((review_prefix, "output/")):
            continue
        if member.isfile():
            data = archive.extractfile(member).read()
        elif member.issym():
            data = member.linkname.encode()
        else:
            raise ValueError(f"Unexpected archive member: {name}")
        files[name] = {"sha256": digest(data), "bytes": len(data)}
remediation_files = git("diff", "--name-only", BASE, source_commit, "--", *CHANGED, *NEW).decode().splitlines()
result = {
    "assessment_date": "2026-11-17", "base_commit": BASE,
    "source_commit": source_commit,
    "source_tree": git("rev-parse", source_commit + "^{tree}").decode().strip(),
    "status": "Committed source tested before push. Deployment verification is separate.",
    "note": "Hashes identify the exact committed source used for release validation, not exhaustive review coverage. Uncommitted edits, unrelated local files, credentials, generated output and this review's artifacts are excluded. The scoped patch excludes unrelated merged changes; their files are still fingerprinted as part of the tested source.",
    "remediation_files": remediation_files,
    "tracked_changes_present": git("diff", "--name-only", BASE, source_commit).decode().splitlines(),
    "patch_sha256": digest(patch), "files": dict(sorted(files.items())),
}
(HERE / "retest-source-fingerprints.json").write_text(json.dumps(result, indent=2) + "\n")
print(f"Fingerprinted {len(files)} files at {source_commit}; exported {len(remediation_files)} remediation files.")
