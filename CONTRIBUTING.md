# Contributing

## The submission form and llms.txt stay in sync

Any change to the initiative submission form (fields added, removed, renamed,
or requirements changed) MUST update `llms.txt` in the same pull request, so
the AI drafting guide always matches the real form. The form is the source of
truth.

`llms.txt` is served at `GET /llms.txt` and its "Step 3: Deliver the form
fields plus the scorecard" section lists every form field in the form's
top-to-bottom order with the same required flags. When you touch
`templates/submit.html` or the submit route in `app.py`, re-check that list.

The process rules live in `content/boilerplate/{rfp,grant,topup}.md` and render
on every initiative page and on the submit form; the guide embeds the same
text under "What the site adds". Change all three in one PR, and bump the
`version:` line when the wording changes.

## Private fields are never rendered publicly

`contact` and `funders` are admin-only. They must never appear on any public
page, public API/JSON response, RSS/meta tags, or exported initiative
markdown. `tests/test_core.py::TestFundersPrivacy` enforces this for
`funders` — keep it green.
