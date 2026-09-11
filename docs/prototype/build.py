#!/usr/bin/env python3
"""Assemble the Suggest-an-initiative prototype from its parts.

  p1_head.html   title + fonts link + <style> open
  p1b_site.css   the live site stylesheet, inlined (em dash swapped for a comma)
  p2_add.css     prototype-only CSS, closes </style>
  p3_body.html   markup, LOGO_SRC replaced with the logo as a data URI
  p4_script.html the one inline <script>

Writes submit-prototype.html (the artifact file) and test-render.html
(the same content inside the artifact's own head/body skeleton, for a
local look over http://localhost).
"""
import base64
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
PARTS = HERE / "parts"
SITE = HERE / "site"

SKELETON = (
    '<!doctype html><html><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    "<style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif;"
    "background:#fafaf9}img{max-width:100%}[hidden]{display:none!important}</style>"
    "</head><body>\n"
)


def main() -> None:
    logo = base64.b64encode((SITE / "dao-logo.svg").read_bytes()).decode("ascii")
    logo_uri = "data:image/svg+xml;base64," + logo

    body = (PARTS / "p3_body.html").read_text()
    body = body.replace("LOGO_SRC", logo_uri)

    doc = "".join([
        (PARTS / "p1_head.html").read_text(),
        (PARTS / "p1b_site.css").read_text(),
        (PARTS / "p2_add.css").read_text(),
        body,
        (PARTS / "p4_script.html").read_text(),
    ])

    (HERE / "submit-prototype.html").write_text(doc)
    (HERE / "test-render.html").write_text(SKELETON + doc)

    bad = {
        "em dash": doc.count("—"),
        '"the DAO"': len(re.findall(r"\bthe DAO\b", doc)),
        "TDSF": doc.count("TDSF"),
        "refundable": len(re.findall(r"refundab", doc, re.I)),
        "claimable": len(re.findall(r"claimab", doc, re.I)),
        "escrow": len(re.findall(r"escrow", doc, re.I)),
        "external script": len(re.findall(r"<script[^>]+src=", doc, re.I)),
    }
    print("built submit-prototype.html, %d bytes" % len(doc))
    for k, n in bad.items():
        print("  %-16s %d" % (k, n))


if __name__ == "__main__":
    main()
