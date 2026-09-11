"""Phase 2 splitter, amount parser and checks (draft.py). Pure functions, no DB.
Run: python -m unittest tests.test_draft -v"""
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import draft  # noqa: E402

DOCS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs")


def example_doc():
    return open(os.path.join(DOCS, "llms-v3-example-output.md"), encoding="utf-8").read()


class TestAmounts(unittest.TestCase):
    def test_table(self):
        cases = {"150,000": 150000, "150.000": 150000, "150,00": 150, "150.00": 150,
                 "1.234.567,89": 1234567.89, "$300,000 USD": 300000, "300k": 300,
                 "": 0, "abc": 0, "  12 ": 12, "1,234,567": 1234567}
        for raw, want in cases.items():
            self.assertAlmostEqual(draft.parse_amount(raw), want, places=2, msg=raw)

    def test_usd(self):
        self.assertEqual(draft.usd(150000), "$150,000")
        self.assertEqual(draft.usd(1234.5), "$1,234.50")


class TestSplitter(unittest.TestCase):
    def test_example_sorts_with_nothing_unsorted(self):
        res = draft.split_draft(example_doc(), "rfp")
        self.assertEqual(res["unsorted"], "")
        for k in draft.SECTIONS["rfp"]:
            self.assertTrue(res["fields"].get(k), k)
        self.assertEqual(res["page"]["title"], 'OPSEC Ratings Coalition to Build & Maintain an "L2Beat for OPSEC"')
        self.assertEqual(draft.parse_amount(res["page"]["goal"]), 150000)
        self.assertEqual(res["page"]["duration"], "18")
        self.assertEqual(len(res["milestones"]), 3)
        self.assertEqual([m["amount"] for m in res["milestones"]], [50000, 25000, 75000])
        self.assertTrue(res["milestones"][2]["adoption"])
        self.assertFalse(res["milestones"][0]["adoption"])
        self.assertEqual(len(res["milestones"][0]["criteria"]), 3)
        self.assertIn("frameworks.securityalliance.org", res["page"]["links"])
        self.assertIn("Ethereum Foundation |", res["page"]["funders"])
        self.assertEqual(res["page"]["contact"], "opsec-coalition@example.org")

    def test_example_passes_the_checks_with_zero_errors(self):
        res = draft.split_draft(example_doc(), "rfp")
        page = dict(res["page"], goal=draft.parse_amount(res["page"]["goal"]))
        errs, warns = draft.check_submission("rfp", False, page, res["fields"], res["milestones"], [])
        self.assertEqual(errs, [])
        self.assertEqual(warns, [])

    def test_old_format_letters_and_headings_inside_fields(self):
        doc = ("# Grant: A thing\n\n## Why this matters\n\nText\n\n### Sub heading\n\nmore\n\n"
               "## Milestones (draft)\n\nThese milestones are a draft.\n\n### A - First - $10,000\n\n"
               "- [ ] one\n- [ ] two\n\n### B - Second - $5,000 (adoption)\n\n- [x] done thing\n")
        res = draft.split_draft(doc, "grant")
        self.assertEqual(res["page"]["title"], "A thing")
        self.assertIn("**Sub heading**", res["fields"]["why"])
        self.assertEqual([m["name"] for m in res["milestones"]], ["First", "Second"])
        self.assertTrue(res["milestones"][1]["adoption"])
        self.assertEqual(res["milestones"][0]["criteria"], ["one", "two"])
        self.assertIn("These milestones are a draft", res["unsorted"])

    def test_type_dependent_aliases(self):
        doc = "## What already exists\n\nx\n\n## The recipient\n\ny\n"
        self.assertEqual(set(draft.split_draft(doc, "grant")["fields"]), {"why_grant", "team"})
        self.assertEqual(set(draft.split_draft(doc, "rfp")["fields"]), {"existing", "who"})

    def test_topup_milestone_lines_and_backers(self):
        doc = ("## Backers already committed\n\nArgot Collective | $151,000 | https://argot.org\n\n"
               "## Milestones\n\n### Infra - $13,000 (done)\n\nDelivered: https://example.org/pr/1\n"
               "- [x] tests in CI\n\n### Yul - $33,000\n\nTarget month: 2026-10\n- [ ] round trips\n")
        res = draft.split_draft(doc, "grant")
        b = draft.parse_backers(res["page"]["backers"])
        self.assertEqual(b, [{"org": "Argot Collective", "amount": 151000.0, "url": "https://argot.org"}])
        m = res["milestones"]
        self.assertTrue(m[0]["done"]); self.assertEqual(m[0]["link"], "https://example.org/pr/1")
        self.assertEqual(m[1]["month"], "2026-10")
        self.assertEqual(m[1]["criteria"], ["round trips"])


class TestChecks(unittest.TestCase):
    def base(self):
        res = draft.split_draft(example_doc(), "rfp")
        page = dict(res["page"], goal=draft.parse_amount(res["page"]["goal"]))
        return page, res["fields"], res["milestones"]

    def errs_for(self, page, fields, ms, itype="rfp", topup=False, backers=()):
        e, w = draft.check_submission(itype, topup, page, fields, ms, list(backers))
        return [x["field"] for x in e], [x["field"] for x in w]

    def test_sum_mismatch_blocks(self):
        page, f, ms = self.base()
        ms[0]["amount"] = 40000
        e, _ = self.errs_for(page, f, ms)
        self.assertIn("goal", e)

    def test_adoption_rule_blocks(self):
        page, f, ms = self.base()
        ms[2]["adoption"] = False
        e, _ = self.errs_for(page, f, ms)
        self.assertIn("milestones", e)
        ms[2]["adoption"] = True; ms[2]["amount"] = 25000; ms[0]["amount"] = 100000
        e, _ = self.errs_for(page, f, ms)
        self.assertIn("milestones", e)  # 25k of 150k is under a third

    def test_adoption_floor_at_300k(self):
        self.assertEqual(draft.adoption_floor(150000), 50000)
        self.assertEqual(draft.adoption_floor(300000), 100000)
        self.assertEqual(draft.adoption_floor(240000), 80000)
        self.assertEqual(draft.adoption_floor(600000), 200000)

    def test_topup_exempt_only_when_all_done(self):
        page, f, ms = self.base()
        for m in ms:
            m["adoption"] = False; m["done"] = True; m["link"] = "https://x"
        e, _ = self.errs_for(page, f, ms, "rfp", True)
        self.assertNotIn("milestones", e)
        ms[1]["done"] = False
        e, w = self.errs_for(page, f, ms, "rfp", True)
        self.assertIn("milestones", e)
        self.assertIn("ms_1_month", w)

    def test_missing_fields_and_grant_sections(self):
        page, f, ms = self.base()
        e, _ = self.errs_for(dict(page, contact=""), f, ms)
        self.assertIn("contact", e)
        e, _ = self.errs_for(page, f, ms, "grant")
        self.assertIn("team", e); self.assertIn("why_grant", e); self.assertIn("commitments", e)
        self.assertIn("recipient_team", e)

    def test_criteria_warnings_do_not_block(self):
        page, f, ms = self.base()
        ms[0]["criteria"][0] = "Between 20-30 firms sign, as needed [TBD]"
        e, w = self.errs_for(page, f, ms)
        self.assertEqual(e, [])
        self.assertIn("ms_0_c0", w)

    def test_backer_half_rows(self):
        page, f, ms = self.base()
        e, _ = self.errs_for(page, f, ms, backers=[{"org": "Acme", "amount": 0, "url": ""}])
        self.assertIn("bk_amount_0", e)

    def test_render_and_roundtrip(self):
        page, f, ms = self.base()
        js = draft.milestones_to_json(ms)
        back = draft.milestones_from_json(js)
        self.assertEqual([m["name"] for m in back], [m["name"] for m in ms])
        md = draft.render_milestones_md(back)
        self.assertIn("### A - Agreed standard - $50,000", md)
        self.assertIn("### C - Adoption evidence - $75,000 (adoption milestone)", md)
        self.assertIn("- [ ] At least 20 teams", md)
        self.assertEqual(draft.strip_inline_headings("## x\n\ntext\n### y"), "**x**\n\ntext\n**y**")


if __name__ == "__main__":
    unittest.main()
