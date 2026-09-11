"""Submission redesign, phase 2: one question per section, milestone rows, the
splitter end to end, admin per-field edit, migration 2, guide drift.

Run: RFPS_SKIP_LIVE=1 python -m unittest tests.test_phase2 -v
Sorts after test_comments.py on purpose (that module re-points DB_PATH)."""
import json
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config

if "app" not in sys.modules:  # same bootstrap as test_phase1
    config.DB_PATH = os.path.join(tempfile.mkdtemp(prefix="rfps-phase2-test-"), "test.db")

import app as appmod  # noqa: E402
import db  # noqa: E402
import draft  # noqa: E402

app = appmod.app
app.config["TESTING"] = True
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUMMARY = "A summary long enough to pass the forty character minimum for tests."


def example_doc():
    with open(os.path.join(ROOT, "docs", "llms-v3-example-output.md"), encoding="utf-8") as f:
        return f.read()


def form_from_doc(doc, itype="rfp", **over):
    """What the browser posts after the splitter ran: page fields, one field per
    section, the milestone rows as JSON, backers as repeated fields."""
    res = draft.split_draft(doc, itype)
    p = res["page"]
    data = {"website": "", "type": itype, "title": p.get("title", ""), "summary": p.get("summary", ""),
            "goal": p.get("goal", ""), "duration_months": re.sub(r"\D", "", p.get("duration", "")),
            "recipient_team": p.get("recipient", ""), "links": p.get("links", ""),
            "funders": p.get("funders", ""), "contact": p.get("contact", ""),
            "milestones_json": draft.milestones_to_json(res["milestones"])}
    data.update(res["fields"])
    backers = draft.parse_backers(p.get("backers", ""))
    if backers:
        data["bk_org"] = [b["org"] for b in backers]
        data["bk_amount"] = [str(b["amount"]) for b in backers]
        data["bk_url"] = [b["url"] for b in backers]
    data.update(over)
    if "title" in over:  # one body per probe: the duplicate check compares bodies
        data["why"] = data["why"] + "\n\nProbe: " + over["title"] + "."
    return data


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()
        cls.made = []

    @classmethod
    def tearDownClass(cls):
        for i in cls.made:
            db.update_rfp(i, status="archived", title="archived %d" % i)

    def csrf(self, path="/submit"):
        html = self.client.get(path).data.decode()
        return re.search(r'name="_csrf" value="([^"]+)"', html).group(1)

    def post_submit(self, data):
        appmod._buckets.clear()  # the per-IP submission limit is not under test
        data = dict(data, _csrf=self.csrf())
        return self.client.post("/submit", data=data)

    def approve(self, slug):
        row = db.rfp_by_slug(slug)
        db.update_rfp(row["id"], status="approved")
        self.made.append(row["id"])
        return db.rfp_by_id(row["id"])

    def admin(self):
        with self.client.session_transaction() as s:
            s["admin"] = True


class TestSubmitEndToEnd(Base):
    def test_example_submits_and_renders_in_order(self):
        data = form_from_doc(example_doc(), title="Phase two example probe")
        r = self.post_submit(data)
        self.assertEqual(r.status_code, 200, r.data[:600])
        self.assertIn(b"Thank you", r.data)
        row = self.approve("phase-two-example-probe")
        self.assertEqual(row["structured"], 1)
        self.assertEqual(row["duration_months"], int(data["duration_months"]))
        self.assertTrue(row["why"].startswith("Your keys, your devices"), row["why"][:60])
        html = self.client.get("/initiative/" + row["slug"]).data.decode()
        self.assertNotIn("Full initiative details", html)
        heads = [draft.FIELDS[k]["heading"] for k in draft.SECTIONS["rfp"]]
        pos = [html.index("<h2>%s</h2>" % h) for h in heads]
        self.assertEqual(pos, sorted(pos), "sections out of order")
        self.assertIn("<h2>Milestones (draft)</h2>", html)
        self.assertIn("A - Agreed standard - $50,000", html)
        self.assertIn("C - Adoption evidence - $75,000 (adoption milestone)", html)
        self.assertIn('<li class="tl">☐', html, "criteria render as checkboxes, glyph is the bullet")
        self.assertIn("Rules v", html)
        self.assertIn("About %s months" % data["duration_months"], html)
        self.assertNotIn(data["contact"], html)
        self.assertNotIn("Who is likely to fund this", html)

    def test_missing_section_and_bad_sums_return_the_findings(self):
        data = form_from_doc(example_doc(), title="Phase two missing probe", hard_req="")
        r = self.post_submit(data)
        self.assertEqual(r.status_code, 400)
        errs = json.loads(re.search(r"data-errors='([^']*)'", r.data.decode()).group(1))
        self.assertIn("hard_req", [e["field"] for e in errs])
        rows = draft.milestones_from_json(data["milestones_json"])
        rows[0]["amount"] = 1
        r = self.post_submit(dict(data, hard_req="Must.", milestones_json=draft.milestones_to_json(rows)))
        self.assertEqual(r.status_code, 400)
        self.assertIn(b"Milestone amounts total", r.data)
        self.assertIsNone(db.rfp_by_slug("phase-two-missing-probe"))

    def test_topup_with_everything_done_needs_no_adoption_milestone(self):
        rows = [{"name": "Shipped", "amount": 1000, "adoption": False, "done": True,
                 "link": "https://example.org/done", "month": "", "criteria": ["Merged."]}]
        data = form_from_doc(example_doc(), itype="grant", title="Phase two topup probe", topup="1",
                             recipient_team="Verity Labs", goal="1000", milestone_reviewer="Jane Doe",
                             team="Us.", why_grant="Head start.", commitments="MIT.",
                             milestones_json=draft.milestones_to_json(rows),
                             bk_org=["Argot"], bk_amount=["500"], bk_url=["https://argot.org"])
        r = self.post_submit(data)
        self.assertEqual(r.status_code, 200, r.data[:600])
        row = self.approve("phase-two-topup-probe")
        self.assertEqual(row["topup"], 1)
        html = self.client.get("/initiative/" + row["slug"]).data.decode()
        self.assertIn("<b>$500.00</b> already committed by Argot", html)  # site convention: cents under $1,000
        self.assertIn("raises the remaining <b>$500.00</b>", html)
        self.assertIn("Milestone reviewer: Jane Doe", html)
        self.assertIn("☑", html, "done milestone renders checked")
        self.assertIn("<h2>The team</h2>", html)
        self.assertNotIn("<h2>Hard requirements</h2>", html)

    def test_same_text_twice_is_a_duplicate(self):
        data = form_from_doc(example_doc(), title="Phase two duplicate probe one")
        data["why"] += "\n\nA sentence that makes this body unlike the other probes."
        self.assertEqual(self.post_submit(data).status_code, 200)
        self.made.append(db.rfp_by_slug("phase-two-duplicate-probe-one")["id"])
        r = self.post_submit(dict(data, title="Phase two duplicate probe two"))
        self.assertEqual(r.status_code, 400)
        self.assertIn(b"already submitted", r.data)

    def test_form_has_every_section_once_with_examples(self):
        html = self.client.get("/submit").data.decode()
        for key in draft.FIELDS:
            self.assertEqual(html.count('data-sec="%s"' % key), 1, key)
        self.assertIn("from the gold-standard initiative", html)
        self.assertIn('id="ex-team"', html)
        for kind in ("rfp", "grant", "topup"):
            self.assertIn('data-rules="%s"' % kind, html)


class TestLegacyAndAdmin(Base):
    def test_legacy_row_still_renders_its_body(self):
        rid, slug = db.create_rfp("Phase two legacy probe", SUMMARY, "", 1000, [], "c@example.org",
                                  status="approved", details="## Why this matters\n\nBecause.",
                                  type="rfp", funders="Acme | pays | none | no | $1")
        self.made.append(rid)
        html = self.client.get("/initiative/" + slug).data.decode()
        self.assertIn("Full initiative details", html)
        self.assertIn("Because.", html)
        self.admin()
        ahtml = self.client.get("/admin/rfp/%d" % rid).data.decode()
        self.assertIn("legacy format", ahtml)
        self.assertIn('name="details"', ahtml)
        self.assertNotIn('name="sec_why"', ahtml)

    def test_admin_edits_one_field_and_the_milestones(self):
        data = form_from_doc(example_doc(), title="Phase two admin probe")
        self.assertEqual(self.post_submit(data).status_code, 200)
        row = self.approve("phase-two-admin-probe")
        self.admin()
        ahtml = self.client.get("/admin/rfp/%d" % row["id"]).data.decode()
        self.assertNotIn("legacy format", ahtml)
        self.assertIn('name="sec_why"', ahtml)
        self.assertIn("### Agreed standard - $50,000", ahtml)
        csrf = re.search(r'name="_csrf" value="([^"]+)"', ahtml).group(1)
        post = {"_csrf": csrf, "action": "edit", "title": row["title"], "summary": row["summary"],
                "goal": "150000", "duration_months": "12", "type": "rfp", "structured": "1",
                "contact": "c@example.org", "funders": "Acme | pays", "boilerplate": "auto",
                "milestones_md": "### Only one - $150,000 (adoption)\n- Edited criterion.",
                "links": "https://example.org/edited"}
        for k in draft.SECTION_KEYS:
            post["sec_" + k] = row[k] or ""
        post["sec_why"] = "Edited why text.\n\n### Not a heading"
        r = self.client.post("/admin/rfp/%d" % row["id"], data=post)
        self.assertEqual(r.status_code, 200)
        html = self.client.get("/initiative/" + row["slug"]).data.decode()
        self.assertIn("Edited why text.", html)
        self.assertIn("<strong>Not a heading</strong>", html)
        self.assertIn("A - Only one - $150,000 (adoption milestone)", html)
        self.assertIn("Edited criterion.", html)
        self.assertIn("https://example.org/edited", html)
        self.assertNotIn("Agreed standard", html)

    def test_structure_page_converts_only_clean_bodies(self):
        doc = example_doc()
        body = doc[doc.index("## Why this matters"):doc.index("## Who is likely to fund this")]
        good, gslug = db.create_rfp("Phase two structure good", SUMMARY, "", 150000, [], "c@example.org",
                                    status="approved", details=body, type="rfp", funders="Acme")
        bad, bslug = db.create_rfp("Phase two structure bad", SUMMARY, "", 150000, [], "c@example.org",
                                   status="approved", details=body.replace("## Hard requirements", "## Nope"),
                                   type="rfp", funders="Acme")
        self.made += [good, bad]
        self.admin()
        html = self.client.get("/admin/structure").data.decode()
        self.assertIn('value="%d" checked' % good, html)
        self.assertNotIn('value="%d" checked' % bad, html)
        self.assertIn("missing: Hard requirements", html)
        csrf = re.search(r'name="_csrf" value="([^"]+)"', html).group(1)
        r = self.client.post("/admin/structure", data={"_csrf": csrf, "action": "apply",
                                                        "rfp_id": [str(good), str(bad)]})
        self.assertEqual(r.status_code, 302)
        g, b = db.rfp_by_id(good), db.rfp_by_id(bad)
        self.assertEqual(g["structured"], 1)
        self.assertEqual(b["structured"], 0)
        self.assertEqual(len(draft.milestones_from_json(g["milestones_json"])), 3)
        self.assertTrue(g["details"], "the body stays in the row after conversion")
        page = self.client.get("/initiative/" + gslug).data.decode()
        self.assertIn("<h2>Hard requirements</h2>", page)
        self.assertNotIn("Full initiative details", page)


class TestGuideDrift(unittest.TestCase):
    """The guide, the splitter and the form must agree on the field names."""
    def setUp(self):
        with open(os.path.join(ROOT, "llms.txt"), encoding="utf-8") as f:
            self.guide = f.read()

    def test_guide_field_list_matches_the_splitter_and_the_form_order(self):
        block = re.search(r"An RFP, in this order:\n\n```\n(.*?)```", self.guide, re.S).group(1)
        names = re.findall(r"^## (.+)$", block, re.M)
        keys = [draft.heading_key(n, "rfp") for n in names]
        self.assertNotIn(None, keys, list(zip(names, keys)))
        self.assertEqual([k for k in keys if k in draft.FIELDS], draft.SECTIONS["rfp"])
        for key in ("team", "why_grant", "commitments"):
            self.assertIn("`## %s`" % draft.FIELDS[key]["heading"], self.guide, key)
        self.assertIn("## Recipient team", self.guide)

    def test_js_alias_map_equals_the_python_one(self):
        with open(os.path.join(ROOT, "static", "submit.js"), encoding="utf-8") as f:
            js = f.read()
        body = re.search(r"var map = \{(.*?)\};", js, re.S).group(1)
        pairs = dict(re.findall(r'"([^"]+)":\s*"([a-z_]+)"', body))
        self.assertEqual(pairs, draft.ALIASES)
        self.assertEqual(json.loads(re.search(r"var SECTIONS = (\{.*?\});", js, re.S).group(1)
                                    .replace("rfp:", '"rfp":').replace("grant:", '"grant":')),
                         draft.SECTIONS)

    def test_guide_rules_text_equals_the_boilerplate_files(self):
        for kind, head in (("rfp", "### How RFPs work"), ("grant", "### How grants work"),
                           ("topup", "### How top-up grants work")):
            with open(os.path.join(ROOT, "content", "boilerplate", kind + ".md"), encoding="utf-8") as f:
                want = re.findall(r"^\d+\. .+$", f.read(), re.M)
            sect = self.guide[self.guide.index(head):]
            sect = sect[:sect.index("\n### ") if "\n### " in sect[1:] else None]
            sect = sect.split("\n## ")[0]
            got = re.findall(r"^\d+\. .+$", sect, re.M)
            self.assertEqual(got, want, kind)

    def test_guide_example_feeds_the_form_examples(self):
        appmod._EXAMPLE_CACHE.clear()
        ex = draft.split_draft(appmod._guide_example(), "rfp")["fields"]
        for key in draft.FIELDS:
            self.assertTrue(ex.get(key), key)


if __name__ == "__main__":
    unittest.main()
