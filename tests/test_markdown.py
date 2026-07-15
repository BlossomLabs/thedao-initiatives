"""Tests for the markdown rendering of the RFP details field.

The details field is written through the admin panel and rendered as HTML on
the public RFP page, so this guards two things: structured markdown (headings,
bold, tables, checklists) renders correctly, and nothing scriptable survives
sanitization even if an admin session is compromised.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as app_mod
from markupsafe import Markup, escape


def render(text):
    return app_mod.md(text)


class TestMarkdownRendering(unittest.TestCase):
    def test_heading(self):
        self.assertIn("<h2>Scope</h2>", render("## Scope"))

    def test_bold(self):
        self.assertIn("<strong>hard requirement</strong>",
                      render("a **hard requirement** here"))

    def test_list(self):
        out = render("- alpha\n- beta")
        self.assertIn("<ul>", out)
        self.assertIn("<li>alpha</li>", out)

    def test_table(self):
        out = render("| **Status** | Open |\n|---|---|\n| **Budget** | $600k |")
        self.assertIn("<table>", out)
        self.assertIn("<td>$600k</td>", out)
        self.assertIn("<strong>Budget</strong>", out)

    def test_task_list_checkboxes(self):
        out = render("- [ ] proofs check in CI\n- [x] semantics published")
        self.assertIn("☐ proofs check in CI", out)
        self.assertIn("☑ semantics published", out)
        self.assertNotIn("[ ]", out)
        self.assertNotIn("[x]", out)

    def test_plain_text_keeps_line_breaks(self):
        # pre-markdown entries relied on white-space:pre-line; nl2br must
        # reproduce that look: single newline -> <br>, blank line -> new <p>
        out = render("line one\nline two\n\nsecond paragraph")
        self.assertIn("line one<br>", out.replace("<br />", "<br>"))
        self.assertEqual(out.count("<p>"), 2)

    def test_returns_markup_not_escaped_by_jinja(self):
        out = render("**bold**")
        self.assertIsInstance(out, Markup)
        # escape() is what Jinja autoescape applies; Markup must pass through
        self.assertIn("<strong>bold</strong>", escape(out))

    def test_empty_and_none(self):
        self.assertEqual(str(render("")), "")
        self.assertEqual(str(render(None)), "")


class TestSanitization(unittest.TestCase):
    def test_script_tag_removed_with_content(self):
        out = render("before\n<script>alert(1)</script>\nafter")
        self.assertNotIn("<script", out)
        self.assertNotIn("alert(1)", out)
        self.assertIn("before", out)
        self.assertIn("after", out)

    def test_event_handler_attribute_stripped(self):
        out = render('<p onclick="steal()">hi</p>')
        self.assertNotIn("onclick", out)
        self.assertNotIn("steal", out)
        self.assertIn("hi", out)

    def test_img_onerror_vector_stripped(self):
        out = render('<img src=x onerror=alert(1)>')
        self.assertNotIn("<img", out)
        self.assertNotIn("onerror", out)

    def test_javascript_url_neutralized(self):
        out = render("[click me](javascript:alert(1))")
        self.assertNotIn("javascript:", out)

    def test_iframe_stripped(self):
        out = render('<iframe src="https://evil.example"></iframe>ok')
        self.assertNotIn("<iframe", out)
        self.assertIn("ok", out)

    def test_links_get_noopener(self):
        out = render("[forum](https://example.com/t/1)")
        self.assertIn('href="https://example.com/t/1"', out)
        self.assertIn('rel="noopener noreferrer"', out)


class TestTemplateIntegration(unittest.TestCase):
    def test_filter_registered_and_unescaped_in_jinja(self):
        from flask import render_template_string
        with app_mod.app.test_request_context():
            out = render_template_string("{{ d | md }}", d="## Scope\n**b**")
        self.assertIn("<h2>Scope</h2>", out)
        self.assertIn("<strong>b</strong>", out)

    def test_details_are_rendered_inside_rfp_template(self):
        # the real template must emit rendered HTML, not escaped markdown
        from flask import render_template
        r = {"title": "T", "slug": "t", "summary": "s", "details": "## Scope",
             "status": "approved", "discourse_url": "", "safe_address": "",
             "funding_goal_usd": 1000}
        s = {"total": 0, "pledged": 0, "donated": 0}
        with app_mod.app.test_request_context():
            out = render_template("rfp.html", r=r, sum=s, pct=0, pledges=[],
                                  donations=[], state={}, tokens={},
                                  donations_enabled=False)
        self.assertIn("<h2>Scope</h2>", out)
        self.assertNotIn("## Scope", out)


if __name__ == "__main__":
    unittest.main()
