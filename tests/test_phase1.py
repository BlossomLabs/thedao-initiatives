"""Submission redesign, phase 1: rules panels, page fields, canned-text strip.

Run: RFPS_SKIP_LIVE=1 python -m unittest tests.test_phase1 -v
Sorts after test_comments.py on purpose (that module re-points DB_PATH)."""
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config

if "app" not in sys.modules:  # same bootstrap as test_round2_batch2
    config.DB_PATH = os.path.join(tempfile.mkdtemp(prefix="rfps-phase1-test-"), "test.db")

import app as appmod  # noqa: E402
import canned  # noqa: E402
import db  # noqa: E402

app = appmod.app
app.config["TESTING"] = True
SUMMARY = "A summary long enough to pass the forty character minimum for tests."
EXPORT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "docs", "submissions-export-2026-09-10.md")

CANNED_BODY = """| | |
|---|---|
| **Status** | Draft |
| **Budget** | $150,000 USD |
| **Proposal window** | 30 days, opening once the RFP is fully funded |
| **Indicative duration** | 12 months (the team sets the final timeline) |

## Why this matters

Keys and devices matter.

## Who we expect to do this

Nobody is pre-selected.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

### A - Standard - $50,000

- [ ] A public template

## Milestone review and acceptance

- Criteria with objective public evidence are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer.

## Process

- The proposal window opens once the RFP is fully funded and stays open for 30 days.
- If a milestone stalls, the team gets a 21-day deadline to complete it.

---

Questions, pushback, better ideas? Post them below.
"""


def export_rows():
    s = open(EXPORT, encoding="utf-8").read()
    rows = []
    for b in re.split(r"^---\n\n## \[", s, flags=re.M)[1:]:
        rid = int(re.search(r"- Admin id: (\d+)", b).group(1))
        title = b.split("\n", 1)[0].split("] ", 1)[1]
        details = b.split("### Full details\n\n", 1)[1] if "### Full details\n\n" in b else ""
        rows.append({"id": rid, "title": title, "details": details,
                     "duration_months": None, "topup": 0, "milestone_reviewer": ""})
    return rows


class TestStrip(unittest.TestCase):
    def test_strips_every_canned_block(self):
        new, info = canned.strip_canned(CANNED_BODY)
        self.assertNotIn("Proposal window", new)
        self.assertNotIn("stays open for", new)
        self.assertNotIn("These milestones are a draft", new)
        self.assertNotIn("must disclose", new)
        self.assertNotIn("Milestone review", new)
        self.assertNotIn("## Process", new)
        self.assertNotIn("Questions, pushback", new)
        self.assertIn("## Why this matters", new)
        self.assertIn("### A - Standard - $50,000", new)
        self.assertIn("- [ ] A public template", new)
        self.assertEqual(info["duration_months"], 12)
        self.assertFalse(info["topup_hint"])
        self.assertFalse(canned.has_canned_headings(new))

    def test_untouched_body_comes_back_unchanged(self):
        body = "## Why this matters\n\nPlain text, nothing canned.\n"
        new, info = canned.strip_canned(body)
        self.assertEqual(new, body.strip("\n"))
        self.assertEqual(info["removed"], [])

    def test_export_dry_run_leaves_no_canned_text(self):
        """All 29 live bodies (docs export): no Process heading, no window text."""
        rows = export_rows()
        self.assertEqual(len(rows), 29)
        plans = {p["id"]: p for p in canned.plan(rows)}
        for r in rows:
            new = plans[r["id"]]["new"] if r["id"] in plans else r["details"]
            self.assertFalse(canned.has_canned_headings(new), r["id"])
            self.assertNotRegex(new, r"(?i)proposal window|stays open for \d+ days", r["id"])
        # the two live defects: id 7's donor-claimable clause, id 9's window contradiction
        self.assertNotIn("claimable", plans[7]["new"].lower())
        self.assertNotRegex(plans[9]["new"], r"\d+ days")
        # ethdebug is recognised as a top-up and its reviewers are carried over
        self.assertEqual(plans[4]["topup"], 1)
        self.assertIn("D'Andrea", plans[4]["reviewer"])
        # duration comes from the old table row where one existed
        self.assertEqual(plans[3]["duration_months"], 18)
        self.assertEqual(plans[1]["duration_months"], 12)


class TestPagesAndForm(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()
        cls.rfp_id, cls.rfp_slug = db.create_rfp(
            "Phase one RFP probe", SUMMARY, "", 150000, [], "c@example.org",
            status="approved", details="## Why this matters\n\nBecause.", type="rfp",
            funders="Acme | pays | none | no | $1", duration_months=12)
        cls.grant_id, cls.grant_slug = db.create_rfp(
            "Phase one grant probe", SUMMARY, "", 300000, [], "c@example.org",
            status="approved", details="## Why this matters\n\nBecause.", type="grant",
            funders="Acme | pays | none | no | $1", duration_months=9)
        db.update_rfp(cls.grant_id, recipient_team="Giveth")
        cls.topup_id, cls.topup_slug = db.create_rfp(
            "Phase one topup probe", SUMMARY, "", 236500, [], "c@example.org",
            status="approved", details="## Why this matters\n\nBecause.", type="grant",
            funders="Acme | pays | none | no | $1", topup=1)
        db.update_rfp(cls.topup_id, milestone_reviewer="Jane Doe (ethdebug)")
        db.add_pledge(cls.topup_id, "Argot Collective", 151000, "pledged", "", "https://argot.org", "")
        cls.legacy_id, cls.legacy_slug = db.create_rfp(
            "Phase one legacy probe", SUMMARY, "", 1000, [], "c@example.org",
            status="approved", details="## Process\n\nOwn process text.", type="grant",
            funders="Acme | pays | none | no | $1")
        db.update_rfp(cls.legacy_id, boilerplate="none")

    @classmethod
    def tearDownClass(cls):
        for i in (cls.rfp_id, cls.grant_id, cls.topup_id, cls.legacy_id):
            db.update_rfp(i, status="archived")

    def page(self, slug):
        r = self.client.get("/initiative/" + slug)
        self.assertEqual(r.status_code, 200)
        return r.data.decode()

    def test_rfp_page_gets_the_rfp_panel_and_duration(self):
        html = self.page(self.rfp_slug)
        self.assertIn("How RFPs work", html)
        self.assertIn("30-day proposal window", html)
        self.assertIn("Rules v2026-09", html)
        self.assertIn("About 12 months", html)
        self.assertNotIn("How grants work", html)

    def test_grant_page_gets_the_grant_panel_and_team(self):
        html = self.page(self.grant_slug)
        self.assertIn("How grants work", html)
        self.assertIn("15-day window", html)
        self.assertIn("to Giveth", html)
        self.assertIn("About 9 months", html)

    def test_topup_page_gets_topup_panel_backers_and_reviewer(self):
        html = self.page(self.topup_slug)
        self.assertIn("How top-up grants work", html)
        self.assertIn("no proposal window", html)
        self.assertIn("already committed by Argot Collective", html)
        self.assertIn("raises the remaining", html)
        self.assertIn("$85,500", html)
        self.assertIn("Milestone reviewer: Jane Doe (ethdebug)", html)
        self.assertIn("Duration not stated", html)

    def test_legacy_body_gets_no_panel(self):
        html = self.page(self.legacy_slug)
        self.assertIn("Own process text", html)
        self.assertNotIn("Rules v2026-09", html)

    def test_transparency_link_is_gone(self):
        for path in ("/", "/initiative/" + self.rfp_slug, "/submit"):
            html = self.client.get(path).data.decode()
            self.assertNotIn("transparency.thedao.fund", html, path)

    def test_submit_form_shows_panels_and_duration_field(self):
        html = self.client.get("/submit").data.decode()
        self.assertIn('name="duration_months"', html)
        self.assertIn('data-rules="rfp"', html)
        self.assertIn('data-rules="grant"', html)
        self.assertIn('data-rules="topup"', html)
        self.assertIn('name="milestone_reviewer"', html)

    def test_submit_requires_duration(self):
        html = self.client.get("/submit").data.decode()
        csrf = re.search(r'name="_csrf" value="([^"]+)"', html).group(1)
        base = {"_csrf": csrf, "website": "", "type": "grant", "title": "A duration probe title",
                "summary": SUMMARY, "details": "## Why this matters\n\nBecause.", "goal": "1000",
                "funders": "Acme | pays | none | no | $1", "contact": "x@example.org"}
        r = self.client.post("/submit", data=dict(base, duration_months=""))
        self.assertEqual(r.status_code, 400)
        self.assertIn(b"Expected duration", r.data)
        r = self.client.post("/submit", data=dict(base, duration_months="7", topup="1",
                                                  milestone_reviewer="Jane Doe"))
        self.assertEqual(r.status_code, 200)
        self.assertIn(b"How top-up grants work", r.data)
        row = db.rfp_by_slug("a-duration-probe-title")
        self.assertEqual(row["duration_months"], 7)
        self.assertEqual(row["topup"], 1)
        self.assertEqual(row["milestone_reviewer"], "Jane Doe")
        db.update_rfp(row["id"], status="archived")

    def test_sync_guard_warns_on_canned_headings(self):
        cdir = tempfile.mkdtemp()
        with open(os.path.join(cdir, "guard-probe.md"), "w", encoding="utf-8") as f:
            f.write("---\ntitle: Guard probe initiative\ngoal: 1000\nsummary: %s\n---\n"
                    "## Process\n\n- pasted\n" % SUMMARY)
        real = appmod._content_dir
        appmod._content_dir = lambda: cdir
        try:
            created, updated, errors = appmod.sync_content()
        finally:
            appmod._content_dir = real
        self.assertEqual(created, 1)
        self.assertTrue(any(e.startswith("warning:") for e in errors), errors)
        db.update_rfp(db.rfp_by_slug("guard-probe")["id"], status="archived")

    def test_content_files_carry_no_canned_text(self):
        cdir = appmod._content_dir()
        for name in os.listdir(cdir):
            if name.endswith(".md") and name != "README.md":
                body = open(os.path.join(cdir, name), encoding="utf-8").read()
                self.assertFalse(canned.has_canned_headings(body), name)
                self.assertNotRegex(body, r"(?i)\| \*\*Proposal window\*\*", name)

    def test_guide_dropped_the_verbatim_blocks(self):
        txt = self.client.get("/llms.txt").data.decode()
        self.assertIn("What the site adds", txt)
        self.assertIn("How RFPs work", txt)
        self.assertIn("Expected duration (months)", txt)
        self.assertNotIn("| **Proposal window** |", txt)
        self.assertNotIn("Copy these five blocks unchanged", txt)


if __name__ == "__main__":
    unittest.main()
