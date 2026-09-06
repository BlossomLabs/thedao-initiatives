"""Round 2 dapp, batch 2: donation terms gate, chips, mailto pledge contact,
suggest-card position, submit field order, admin type chips, funder leads.

Spec: Griff, 2026-09-06 (SPEC: Round 2 dapp, batch 2). Run:
python3 -m unittest discover tests -v
"""
import csv
import io
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config

if "app" not in sys.modules:
    _TMP = tempfile.mkdtemp(prefix="rfps-batch2-test-")
    config.DB_PATH = os.path.join(_TMP, "test.db")

import app as appmod
import db
from flask import render_template

SUMMARY = ("A summary long enough to satisfy the validator, forty plus "
           "characters of text.")
FUNDERS_TRICKY = ('Acme, Inc. | "pays" for infra | none | no | $5,000\n'
                  'Second line | with a pipe | and a comma, here')


def _admin_client():
    c = appmod.app.test_client()
    with c.session_transaction() as s:
        s["admin"] = True
    return c


def _origin():
    return {"Origin": "http://localhost"}


class TestTermsPage(unittest.TestCase):
    def setUp(self):
        self.client = appmod.app.test_client()

    def test_terms_page_renders_with_version(self):
        r = self.client.get("/donation-terms")
        self.assertEqual(r.status_code, 200)
        html = r.data.decode()
        self.assertIn("Donation Terms of Service", html)
        self.assertIn("2026-09-06", html)  # version exposed to the template
        # the raw "version:" header line is stripped before rendering
        self.assertNotRegex(html, r"version:\s*2026-09-06")

    def test_terms_page_not_in_nav(self):
        r = self.client.get("/")
        self.assertNotIn(b'href="/donation-terms"', r.data.split(b"<main")[0])


class TestTermsAccept(unittest.TestCase):
    def setUp(self):
        self.client = appmod.app.test_client()
        con = db.connect()
        with con:
            con.execute("DELETE FROM terms_acceptances")
        con.close()

    def _rows(self):
        con = db.connect()
        try:
            return con.execute(
                "SELECT version, address, ip FROM terms_acceptances "
                "ORDER BY id").fetchall()
        finally:
            con.close()

    def test_accept_without_address_logs_row(self):
        r = self.client.post("/api/terms/accept",
                             json={"version": "2026-09-06"}, headers=_origin())
        self.assertEqual(r.status_code, 200)
        rows = self._rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["version"], "2026-09-06")
        self.assertEqual(rows[0]["address"], "")
        self.assertTrue(rows[0]["ip"])

    def test_accept_with_address_logs_and_dedupes(self):
        addr = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780"
        for _ in range(2):
            r = self.client.post("/api/terms/accept",
                                 json={"version": "2026-09-06", "address": addr},
                                 headers=_origin())
            self.assertEqual(r.status_code, 200)
        rows = self._rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["address"], addr)

    def test_anonymous_then_address_both_logged(self):
        addr = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780"
        self.client.post("/api/terms/accept", json={"version": "2026-09-06"},
                         headers=_origin())
        self.client.post("/api/terms/accept",
                         json={"version": "2026-09-06", "address": addr},
                         headers=_origin())
        self.assertEqual([r["address"] for r in self._rows()], ["", addr])

    def test_accept_rejects_missing_version_and_bad_address(self):
        r = self.client.post("/api/terms/accept", json={}, headers=_origin())
        self.assertEqual(r.status_code, 400)
        r = self.client.post("/api/terms/accept",
                             json={"version": "2026-09-06", "address": "nope"},
                             headers=_origin())
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self._rows(), [])

    def test_accept_rejects_cross_origin(self):
        r = self.client.post("/api/terms/accept", json={"version": "2026-09-06"},
                             headers={"Origin": "https://evil.example"})
        self.assertEqual(r.status_code, 403)

    def test_acceptances_never_public(self):
        self.client.post("/api/terms/accept",
                         json={"version": "2026-09-06",
                               "address": "0x839395e20bbB182fa440d08F850E6c7A8f6F0780"},
                         headers=_origin())
        for path in ("/", "/donation-terms", "/llms.txt"):
            self.assertNotIn(b"terms_acceptances", self.client.get(path).data)


class TestWidgetGate(unittest.TestCase):
    """The widget partial itself: every method locked until the box is checked."""

    def _render(self):
        with appmod.app.test_request_context("/"):
            return render_template(
                "_donate_widget.html", slug="probe",
                address="0x839395e20bbB182fa440d08F850E6c7A8f6F0780",
                tokens=["USDC"], manual=True)

    def test_checkbox_links_to_terms_in_new_tab(self):
        html = self._render()
        self.assertRegex(html, r'<input[^>]*type="checkbox"[^>]*class="[^"]*dw-terms')
        self.assertRegex(html, r'<a[^>]*href="/donation-terms"[^>]*target="_blank"')
        self.assertIn("I agree to the", html)
        self.assertIn('data-terms-version="2026-09-06"', html)

    def test_checkbox_precedes_method_tabs(self):
        html = self._render()
        self.assertLess(html.index("dw-terms"), html.index("dw-methods"))

    def test_all_methods_locked_by_default(self):
        html = self._render()
        self.assertRegex(html, r'<button[^>]*class="[^"]*dw-send[^"]*"[^>]*disabled')
        self.assertRegex(html, r'<button[^>]*class="[^"]*dw-copy[^"]*"[^>]*disabled')
        # exchange address masked; the real address is only in a data attribute
        self.assertIn("0x····…····", html)
        self.assertNotRegex(html, r'dw-addr-text">0x839395')

    def test_chips_and_placeholder(self):
        html = self._render()
        chips = re.findall(r'class="dw-chip" data-amount="(\d+)">([^<]+)<', html)
        self.assertEqual([c[0] for c in chips], ["50", "500", "5000", "50000"])
        self.assertEqual([c[1] for c in chips], ["$50", "$500", "$5,000", "$50,000"])
        self.assertIn('placeholder="Custom amount ($1 minimum)"', html)


class TestPledgeContact(unittest.TestCase):
    def setUp(self):
        self.client = appmod.app.test_client()

    def test_front_page_and_footer_use_mailto(self):
        html = self.client.get("/").data.decode()
        self.assertIn('href="mailto:info@thedao.fund"', html)
        self.assertIn("Email info@thedao.fund to pledge", html)
        self.assertIn("To back an initiative, email", html)
        self.assertNotIn("griffgreen", html.lower())

    def test_no_griffgreen_on_other_pages(self):
        rid, slug = db.create_rfp(
            "Contact probe initiative", SUMMARY, "", 1000, [], "c@example.org",
            status="approved", details="d", type="rfp",
            funders="Someone | reason | none | no | $1")
        try:
            for path in ("/submit", "/donation-terms", "/initiative/" + slug):
                html = self.client.get(path).data.decode().lower()
                self.assertNotIn("griffgreen", html, path)
                self.assertNotIn("x.com/griff", html, path)
            self.assertIn('href="mailto:info@thedao.fund"',
                          self.client.get("/initiative/" + slug).data.decode())
        finally:
            db.update_rfp(rid, status="archived")


class TestSuggestCardPosition(unittest.TestCase):
    """Fewer than 20 approved: suggest card first. 20 or more: last."""

    def setUp(self):
        self.client = appmod.app.test_client()
        self.created = []
        # Other modules may have left any number of approved rows behind;
        # park all but 18 of them so the 19/20 boundary is exact, and restore
        # them afterwards.
        con = db.connect()
        try:
            ids = [r[0] for r in con.execute(
                "SELECT id FROM rfps WHERE status='approved' ORDER BY id")]
        finally:
            con.close()
        self.parked = ids[18:]
        for rid in self.parked:
            db.update_rfp(rid, status="archived")
        self.base = min(len(ids), 18)

    def tearDown(self):
        for rid in self.created:
            db.update_rfp(rid, status="archived")
        for rid in self.parked:
            db.update_rfp(rid, status="approved")

    def _fill_to(self, n):
        while self.base + len(self.created) < n:
            rid, _ = db.create_rfp(
                "Position probe %d" % len(self.created), SUMMARY, "", 1000, [],
                "p@example.org", status="approved", details="d", type="rfp",
                funders="Someone | reason | none | no | $1")
            self.created.append(rid)

    def _order(self):
        html = self.client.get("/").data.decode()
        grid = html[html.index('class="rfp-grid"'):]
        return grid.index("suggest-card"), grid.index('data-rfp-id=')

    def test_suggest_first_at_19(self):
        self._fill_to(19)
        s, first_card = self._order()
        self.assertLess(s, first_card)

    def test_suggest_last_at_20(self):
        self._fill_to(20)
        html = self.client.get("/").data.decode()
        grid = html[html.index('class="rfp-grid"'):]
        self.assertGreater(grid.index("suggest-card"), grid.rindex('data-rfp-id='))


class TestSubmitFieldOrder(unittest.TestCase):
    def setUp(self):
        self.client = appmod.app.test_client()

    def test_type_before_title_on_form(self):
        html = self.client.get("/submit").data.decode()
        self.assertLess(html.index('name="type"'), html.index('id="f-title"'))

    def test_llms_guide_lists_type_first(self):
        txt = self.client.get("/llms.txt").data.decode()
        self.assertLess(txt.index("**Type**"), txt.index("**Title**"))


class TestAdminTypeChip(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rid, cls.slug = db.create_rfp(
            "Chip probe grant", SUMMARY, "", 1000, [], "c@example.org",
            status="approved", details="d", type="grant",
            funders="Someone | reason | none | no | $1")

    @classmethod
    def tearDownClass(cls):
        db.update_rfp(cls.rid, status="archived")

    def test_dashboard_rows_show_type_chip(self):
        html = _admin_client().get("/admin/dashboard").data.decode()
        row = html[html.index("Chip probe grant") - 400:html.index("Chip probe grant")]
        self.assertRegex(row, r'class="chip static type-chip[^"]*">Grant<')

    def test_manage_page_header_shows_type_chip(self):
        html = _admin_client().get("/admin/rfp/%d" % self.rid).data.decode()
        head = html[html.index("<h1"):html.index("</h1>")]
        self.assertRegex(head, r'type-chip[^"]*">Grant<')


class TestFunderLeads(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rid, _ = db.create_rfp(
            "Leads probe initiative", SUMMARY, "", 4200, [], "lead@example.org",
            status="pending", details="d", type="grant", funders=FUNDERS_TRICKY)
        cls.empty_id, _ = db.create_rfp(
            "Leads empty initiative", SUMMARY, "", 100, [], "x@example.org",
            status="pending", details="d", type="rfp", funders="")

    @classmethod
    def tearDownClass(cls):
        db.update_rfp(cls.rid, status="archived")
        db.update_rfp(cls.empty_id, status="archived")

    def test_anonymous_redirected(self):
        for path in ("/admin/leads", "/admin/leads.csv"):
            r = appmod.app.test_client().get(path)
            self.assertIn(r.status_code, (301, 302, 303, 401, 403), path)
            self.assertNotIn(b"Acme, Inc.", r.data)

    def test_leads_page_lists_only_rows_with_funders(self):
        html = _admin_client().get("/admin/leads").data.decode()
        self.assertIn("Leads probe initiative", html)
        self.assertIn("Acme, Inc.", html)
        self.assertIn("lead@example.org", html)
        self.assertNotIn("Leads empty initiative", html)

    def test_dashboard_links_to_leads(self):
        html = _admin_client().get("/admin/dashboard").data.decode()
        self.assertIn('href="/admin/leads"', html)

    def test_csv_quoting_survives_commas_and_newlines(self):
        r = _admin_client().get("/admin/leads.csv")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.content_type.startswith("text/csv"))
        rows = list(csv.reader(io.StringIO(r.data.decode("utf-8"))))
        self.assertEqual(rows[0], ["initiative", "slug", "type", "status",
                                   "goal_usd", "funders", "contact", "created_at"])
        probe = [x for x in rows[1:] if x[0] == "Leads probe initiative"]
        self.assertEqual(len(probe), 1)
        self.assertEqual(probe[0][5], FUNDERS_TRICKY)
        self.assertEqual(probe[0][2], "grant")
        self.assertEqual(probe[0][4], "4200")
        self.assertNotIn("Leads empty initiative", [x[0] for x in rows])

    def test_funders_still_never_public(self):
        c = appmod.app.test_client()
        for path in ("/", "/llms.txt"):
            self.assertNotIn(b"Acme, Inc.", c.get(path).data)


if __name__ == "__main__":
    unittest.main()
