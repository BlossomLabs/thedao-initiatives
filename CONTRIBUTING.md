# Contributing

## The submission form and llms.txt stay in sync

Any change to the initiative submission form (fields added, removed, renamed,
or requirements changed) MUST update `llms.txt` in the same pull request, so
the AI drafting guide always matches the real form. The form is the source of
truth.

`llms.txt` is served at `GET /llms.txt` from its byte-identical mirror
`public/llms.txt` (copy the root file over it; `app/data/llms.test.ts` fails
when the two differ). Its "Step 3: Deliver the form fields plus the scorecard"
section lists every form field in the form's top-to-bottom order with the same
required flags. When you touch the form in `app/components/initiative-form/`,
the rules in `shared/draft/` or the submit routes in `api/routes/initiatives.ts`,
re-check that list; `shared/draft/guide-drift.test.ts` checks the headings.

The process rules live in `content/boilerplate/{rfp,grant,topup}.md` and render
on every initiative page and on the submit form; the guide embeds the same
text under "What the site adds". Change all three in one PR, and bump the
`version:` line when the wording changes.

## Private fields are never rendered publicly

`contact` and `funders` are admin-only. They must never appear on any public
page, public API/JSON response, RSS/meta tags, or exported initiative
markdown. `api/tests/routes.test.ts` enforces this — keep it green.

## Content files are permanent

- A file under `content/rfps/` is never renamed: its slug is the initiative's
  public URL. Archive it in the admin panel instead.
- A published `content/donation-terms/<date>.md` is never edited or deleted;
  publish a new dated file (see "Publishing a new version of the donation
  terms" in the README).
