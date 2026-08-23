"""Funders field: required at submit, admin-editable, and NEVER public.

The funders value ("who is likely to fund this?") is private fundraising
intelligence. This suite is the enforcement for the CONTRIBUTING.md rule that
it must not appear on any public page or public API response.
"""
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config

# Point the app at a throwaway database BEFORE app import runs db.init() —
# but only if no other test module already imported app (db.connect() reads
# config.DB_PATH dynamically, so re-pointing it mid-suite would yank the DB
# out from under the other modules' fixtures; discover-mode runs us after
# test_comments, whose temp DB works fine for us too).
if "app" not in sys.modules:
    _TMP = tempfile.mkdtemp(prefix="rfps-funders-test-")
    config.DB_PATH = os.path.join(_TMP, "test.db")

import app as appmod
import db

SECRET = "ZZSECRETFUNDER Corp | would fund it | met once | yes | $9,999"


def _csrf(client):
    """GET the submit page with this client and pull the CSRF token."""
    html = client.get("/submit").data.decode()
    m = re.search(r'name="_csrf" value="([0-9a-f]+)"', html)
    return m.group(1)


class TestFundersPrivacy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rfp_id, cls.slug = db.create_rfp(
            "Privacy probe initiative", "A summary long enough to satisfy "
            "the validator, forty plus characters of text.", "", 12345, [],
            "probe@example.org", status="approved", details="Some details.",
            type="rfp", funders=SECRET)

    def setUp(self):
        self.client = appmod.app.test_client()

    def test_public_board_never_shows_funders(self):
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn(b"ZZSECRETFUNDER", resp.data)

    def test_public_initiative_page_never_shows_funders(self):
        resp = self.client.get("/initiative/%s" % self.slug)
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn(b"ZZSECRETFUNDER", resp.data)

    def test_comments_api_never_shows_funders(self):
        resp = self.client.get("/api/initiative/%s/comments" % self.slug)
        self.assertNotIn(b"ZZSECRETFUNDER", resp.data)

    def test_submit_requires_funders(self):
        token = _csrf(self.client)
        form = {"_csrf": token, "title": "A perfectly valid title",
                "type": "rfp",
                "summary": "A summary long enough to satisfy the validator, "
                           "forty plus characters of text.",
                "goal": "1000", "contact": "someone@example.org"}
        resp = self.client.post("/submit", data=form)
        self.assertEqual(resp.status_code, 400)
        self.assertIn(b"likely to fund", resp.data)

    def test_submit_with_funders_succeeds_and_stores(self):
        token = _csrf(self.client)
        form = {"_csrf": token, "title": "Another perfectly valid title",
                "type": "grant",
                "summary": "A summary long enough to satisfy the validator, "
                           "forty plus characters of text.",
                "goal": "1000", "contact": "someone@example.org",
                "funders": "Acme | pays for infra | none | no | $5,000"}
        resp = self.client.post("/submit", data=form)
        self.assertEqual(resp.status_code, 200)
        con = db.connect()
        try:
            row = con.execute(
                "SELECT funders FROM rfps WHERE title=?",
                ("Another perfectly valid title",)).fetchone()
        finally:
            con.close()
        self.assertEqual(row["funders"],
                         "Acme | pays for infra | none | no | $5,000")

    def test_llms_txt_served_plain_and_mentions_field(self):
        resp = self.client.get("/llms.txt")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.content_type.startswith("text/plain"))
        self.assertIn(b"Who is likely to fund this?", resp.data)

    def test_existing_rows_still_load(self):
        r = db.rfp_by_slug(self.slug)
        self.assertEqual(r["funders"], SECRET)
        self.assertEqual(r["status"], "approved")


if __name__ == "__main__":
    unittest.main()
