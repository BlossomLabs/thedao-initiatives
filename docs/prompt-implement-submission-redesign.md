# Implement the initiative submission redesign on fund.thedao.fund

You are implementing a decided design, not exploring one. Every product decision is already made and written down; the prototype already contains working JavaScript for the hard parts. Your job is to turn it into the Flask app, with tests, in two pull requests against `Giveth/thedao-rfps` main. Work from origin/main, which is ahead of some local checkouts.

## Read these first, in this order

1. `docs/submission-redesign-proposal-2026-09-10.md`: the design. Sections 3, 4, 5 define fields, section lists, and milestone rows. Section 7 is the flow. Section 10 is the migration. Section 11 is the phasing you follow.
2. `docs/feedback-2026-09-10-prototype-round-1.md`: Griff's 17 decisions. Where this file and the proposal differ, this file wins.
3. `docs/rules-panel-text-2026-09-10.md`: the exact text and order of the three rules panels. Use it verbatim; do not edit the wording.
4. `docs/llms-v3-2026-09-10.txt`: the new AI guide, already written. It replaces `llms.txt`. Its output format is the paste format the form must sort. `docs/llms-v3-example-output.md` is a paste that must sort cleanly with zero errors; use it as a test fixture.
5. `docs/prototype/`: the clickable prototype Griff approved (live copy at https://claude.ai/code/artifact/bf0ef8de-816c-4bbe-b9bc-03256fdeb21c). `parts/p4_script.html` holds the reference JavaScript, `parts/p3_body.html` the markup, `parts/p2_add.css` the added styles on top of the site stylesheet. `build.py` rebuilds the single file.
6. `docs/submissions-inventory-2026-09-10.md` and `docs/submissions-export-2026-09-10.md`: what the 29 live submissions look like. The migration has to survive all of them.
7. `docs/prompt-revise-shared-text-proposal.md` and `~/Downloads/rfps_shared_text_proposal.md` if present: the Phase 1 design for the boilerplate files, opt-out flag, and duplicate guard. Keep what those settled (two markdown boilerplate files loaded like `content/donation-terms.md`, `boilerplate` column with `auto`/`none`, sync warning) and drop what Griff later overruled (no render-time injection of sentences, no form error on pasted Process sections).
8. `CONTRIBUTING.md`: the form and the guide change in the same PR. `HANDOFF-DEVOPS.md` and `DEPLOY.md` for how production runs (gunicorn, Caddy, SQLite file on a persistent disk, `deploy/backup.sh`).

## Reuse this code instead of rewriting it

From `docs/prototype/parts/p4_script.html`, port these as-is into `static/submit.js` (the CSP is `script-src 'self'`, so no inline scripts) and mirror the parsing rules in Python for the server side:

- `parseAmount()`: the locale rule (separator plus exactly three trailing digits is thousands; one or two digits is a decimal; mixed separators, the last one is the decimal). Implement the same function in Python and test both against the same table: `150,000`, `150.000`, `150,00`, `150.00`, `1.234.567,89`, `$300,000 USD`, `300k` (reject), blank (reject).
- `headingKey()`, `splitDraft()`, `rowFromHeading()`, `parseBackers()`: the paste splitter, its alias table, the milestone heading format `### Name - $50,000 (adoption)` / `(done)`, the backer line format `Org | $amount | link`, and the unsorted bucket. The alias table is the contract with the guide; if you change it, change the guide.
- `runChecks()`, `mark()`, `err()`, `warn()`, `paintFindings()`: the error and warning rules, inline field marking, scroll to first error, and the log. Errors block, warnings do not. The list of what is an error and what is a warning is in the feedback file (items 10, 17) and proposal section 5.
- `renderMilestones()`, `renderBackers()`, `renderRules()`, `renderPreview()`, `setType()`: milestone rows with automatic letters and one input per criterion, backer rows with logo preview, the rules panel swap, the page preview, and type switching that keeps shared section text.
- `p2_add.css`: the styles for eyebrows, rules panel, milestone rows, criteria rows, checks box, error state, backer chips. Keep them in `static/style.css` in the same token vocabulary.

Server side, the same rules run again on submit: parse amounts, split nothing (the form posts fields), validate required fields per type, sum milestones against the goal, apply the adoption rule, reject byte-identical bodies to an existing submission, strip any `#` headings inside a field body, and return the same error list the client showed. The client is a convenience; the server is the gate.

## Phase 1 pull request: boilerplate out, page fields in

1. `content/boilerplate/rfp.md`, `grant.md`, `topup.md` with the text from `docs/rules-panel-text-2026-09-10.md`, a `version: 2026-09` line, loaded at startup like donation terms.
2. Render the panel on `templates/rfp.html` in a distinct box titled per type, and on `templates/submit.html` under the type radios, open by default, swapping with the radio. Version line under it.
3. Schema: add `duration_months INTEGER`, `recipient_team TEXT`, `topup INTEGER DEFAULT 0`, `boilerplate TEXT DEFAULT 'auto'`. Add a `backers` table (rfp_id, org, amount_usd, url, logo path) or extend the existing pledge/sponsor table if its shape fits; backer logos render with the existing sponsor chip markup on cards and pages. Keep `details` as the legacy body.
4. Header on the initiative page: type badge, goal, "About N months", "$X already committed by A, B" from backers, and for top-ups "this grant raises the remaining $Y".
5. Strip the canned blocks from every existing row: header table, proposal window row, milestones preamble, disclosure sentence, Milestone review and acceptance, Process, closing line, with tolerant matching for the variants the inventory lists (section 3 of the inventory). Migration script with `--dry-run` printing a per-row unified diff, then `--apply`. Run on production only after `deploy/backup.sh`. Fill `duration_months` from the old table row where one exists (16 rows). Set `boilerplate='none'` on the two ethdebug rows if they do not fit the panel.
6. Fix two live defects in the same migration: remove the sentence containing "claimable by the donors" from the approved Community Fuzzing Tooling initiative, and remove the contradictory window statements from Securing Ethereum with Formal Verification (the panel now carries the window).
7. Sync guard: `sync_content()` warns (result line) when a content file with `boilerplate: auto` still contains a Process or Milestone review heading; it does not fail.
8. Remove the Transparency dashboard link everywhere (footer in `base.html`, and anywhere else `transparency.thedao.fund` appears).
9. `/api/ai-search` and any other reader of `details` gets the type's boilerplate appended so answers about process stay correct.
10. Replace `llms.txt` with `docs/llms-v3-2026-09-10.txt` in this PR only if Phase 2 ships within the same week; otherwise ship an interim guide that drops the verbatim blocks and the table and keeps the single details field, and switch to v3 in Phase 2. Say which you did.
11. Tests: panel renders per type; window text never appears in a stored body after migration; migration dry run on a copy of the export leaves no row with a Process heading under `auto`; duration renders; backers render; the two defects are gone; Transparency link is gone.

## Phase 2 pull request: one question per section

1. Schema: one nullable TEXT column per section key (`why`, `in_scope`, `out_scope`, `existing`, `who`, `hard_req`, `team`, `why_grant`, `commitments`) and a `milestones` table (rfp_id, position, name, amount_usd, adoption INTEGER, done INTEGER, evidence_url, target_month, criteria as JSON list). `details` stays for legacy rows; the page renders structured sections when present, else the legacy body.
2. `templates/submit.html`: the prototype's layout. Type radios and top-up checkbox, rules panel, empty paste box that sorts on the `paste` event and then collapses to a "Sort again" link, page fields, section fields with eyebrow, question, helper, example toggle, word count, Required marker; milestone rows; backer rows with logo upload (reuse the pledge logo upload path and its size and type limits); private fields; Submit always enabled; inline errors plus the log; confirmation page states what the site adds.
3. Field names posted by the form use the splitter's keys. Document them at the end of the guide (the guide already lists them; keep it in sync).
4. Server validation as above. Duplicate body check compares the concatenated section text.
5. `templates/rfp.html`: render the sections with the site's headings in type order, milestones as `### A - Name - $50,000` with checkbox lists, target months on top-ups, done milestones checked with their link, then the rules panel. The admin edit page gets the same per-field form.
6. Migration 2: run the splitter server-side over every legacy `details` body (after Phase 1 stripping). Write structured columns only for rows where all required sections for the type matched, milestones parsed, and amounts sum to the goal. Everything else stays legacy and gets a "legacy format" chip in admin. Dry run with per-row report first.
7. Replace `llms.txt` with v3. Add a test that fails when the guide's field list or the alias table drifts from the form (parse the guide's field section and compare to the form's field names).
8. Tests: the example output fixture sorts with zero unsorted text and submits with zero errors; each error rule fires on a crafted body; adoption rule blocks; top-up exemption; amount parsing table; criteria render as checkboxes; grant and RFP section order; legacy row still renders; admin edit round-trips every field.

## Conventions fixed by guide v3 (the splitter already honors them)

- Top-up milestones: the first line under a milestone heading may be `Target month: YYYY-MM` (remaining work) or `Delivered: https://...` (completed work, with `(done)` on the heading). The prototype's `parseMilestones()` reads both; port that version.
- The guide's interview is now questions 1 to 11, with 1 to 7 mandatory before drafting. Anything in the app or tests that cites "questions 1 to 4" should say 1 to 7.
- The example initiative lists no committed backer, because none exists. Do not seed one.
- The guide is about 35,000 characters because it embeds the rules panel text and the full example. Keep the embedded rules panel: proposers paste the guide into LLMs that may have no web access. The test that guards drift should compare the guide's embedded panel to `content/boilerplate/*.md`.

## Hard constraints

- No inline JavaScript anywhere; CSP is `script-src 'self'`. No new dependencies beyond the stdlib and Flask.
- Never write refundable, claimable, held, reserved, or escrowed about donated funds anywhere. The stalled-milestone sentence in the boilerplate files is the only reclaim language, exactly as written there.
- "TheDAO" is one word, never "the DAO", never abbreviated. No em dashes in any user-facing string.
- The form is the source of truth; the guide changes in the same PR as any form change (CONTRIBUTING.md).
- Do not touch money paths: donations, Safes, the scanner, pledges' payment status.
- Logos: only uploaded files, rendered with the existing sponsor chip markup. Never generate or approximate one.
- Keep `run.sh`, `serve-prod.sh`, and `deploy/` working. Run the full test suite before each PR.

## What to deliver

Two PRs, each with: a description that lists the decisions it implements by number from the feedback file, the migration commands to run on the server with the backup step first, and the test output. Before opening Phase 1, post a short note with anything in the decisions that the code cannot honor as written, with your proposed substitute. Do not start Phase 2 until Griff has seen Phase 1 on the live site.
