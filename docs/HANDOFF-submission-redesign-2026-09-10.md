# Submission redesign: complete handoff bundle for the implementing agent

Assembled 2026-09-10 for Griff's coding agent. This ONE file contains everything referenced by the implementation prompt: the prompt itself, the decisions, the rules text, the design, the new AI guide and its test paste, the inventory of the 29 live submissions, and the prototype's source code. The prompt below refers to files under `docs/`; every one of them is included in this bundle in full, in the order listed here. Save the pieces back to those paths in the repo when you start (each part begins with a `FILE:` line giving the path), or work straight from this bundle.

Live, clickable prototype (uses the site's real stylesheet and logo): https://claude.ai/code/artifact/bf0ef8de-816c-4bbe-b9bc-03256fdeb21c

Repository: https://github.com/Giveth/thedao-rfps (work from origin/main).

Not included because of size, available from Griff on request: `docs/submissions-export-2026-09-10.md` (the raw export of all 29 submissions, 340 KB) and the built single-file prototype `docs/prototype/submit-prototype.html`, which `docs/prototype/build.py` rebuilds from the parts included here plus the site's own `static/style.css`, `static/dao-logo.svg`, and templates.

## Contents

1. `docs/prompt-implement-submission-redesign.md`: the implementation prompt. Start here.
2. `docs/feedback-2026-09-10-prototype-round-1.md`: Griff's decisions. Wins over the proposal where they differ.
3. `docs/rules-panel-text-2026-09-10.md`: the three rules panels, verbatim.
4. `docs/submission-redesign-proposal-2026-09-10.md`: the design.
5. `docs/llms-v3-2026-09-10.txt`: the new AI guide (replaces `llms.txt`).
6. `docs/llms-v3-example-output.md`: test fixture, must sort with zero errors.
7. `docs/submissions-inventory-2026-09-10.md`: structural inventory of the 29 live submissions.
8. `docs/prototype/parts/p4_script.html`: reference JavaScript (splitter, parseAmount, checks, renderers).
9. `docs/prototype/parts/p3_body.html`: prototype markup.
10. `docs/prototype/parts/p2_add.css`: styles added on top of the site stylesheet.
11. `docs/prototype/build.py`: rebuilds the single-file prototype.



---

# Part 1. FILE: docs/prompt-implement-submission-redesign.md

````markdown
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
````



---

# Part 2. FILE: docs/feedback-2026-09-10-prototype-round-1.md

````markdown
# Griff's decisions on the redesign proposal and prototype, 2026-09-10

Everything in the proposal not listed here is accepted as written ("all the suggestions that I don't explicitly call out sound great"). Apply these to the prototype, the proposal, the rules panel, and guide v3.

## Fields and sections

1. **Backers already committed, with logos.** Replace the plain "Already committed (USD)" number with a pledge list any initiative can fill in (not only top-ups): organization, amount in USD, link, and the organization's logo file. The sum shows as "$X already committed" in the header, and each logo renders on the initiative page and the board card exactly as sponsor logos do today. Evidence: the ethdebug grant added an "Anchor backer" row to its table because there was nowhere else to put it.
2. **Logos are always the real file.** Guide v3 gets a rule: the AI never draws, recreates, or approximates a logo. It finds the organization's official logo (press kit, brand page, repository) and the proposer uploads that file. The form's logo field says the same in its helper.
3. **"Why this matters" stops asking for an incident.** Question: "What gap does this close, and what can people do afterwards that they cannot today?" Helper: "1 to 2 short paragraphs or a bullet list." Delete "Name the real event" everywhere, including the guide's interview question 2, which should ask for the gap and accept an incident as one kind of evidence.
4. **Commitments** stays as the grant heading. Its helper never says "the grant twin of Hard requirements"; that phrase means nothing to someone writing a grant. Helper: "What you commit to on license, maintenance after the money is spent, and pinned targets. State any exception you are asking for."
5. **"Why a grant: what already exists"** stays.
6. **Example for "The team"** uses Giveth, not Verity Labs: Griff Green, Lauren Luz, Jake Schumacher, Cotabe Moral, Anamarija Begonja. Roles per the roster lookup.
7. **Transparency dashboard link is removed everywhere** on the site (footer today, anywhere else it appears). Note for the coding agent, separate from this redesign.

## Milestones

8. **Labels are automatic: A, B, C.** No label input. Rows are lettered in order and re-lettered on remove.
9. **The adoption checkbox is labelled "Adoption milestone".** Nothing else.
10. **The adoption rule blocks submission.** At least one adoption milestone, and adoption-tied amounts at least a third of the goal (at least $100,000 at $300,000 and above). Error, not warning. Top-ups are exempt only when every remaining milestone is already flagged done.
11. **Acceptance criteria are one input each.** A criterion is its own short input row with a checkbox glyph, a remove control, and Enter adding the next row. No shared textarea; on mobile the textarea read as one run-on paragraph.
12. **Amounts are left-aligned** like every other field.
13. **Top-up milestones carry a target month** (a month input) on every remaining milestone, and a done checkbox plus evidence link on completed ones.
14. **Amount parsing handles a global audience.** "150.000" and "150,000" both mean one hundred fifty thousand; "150.00" and "150,00" both mean one hundred fifty dollars. Rule: a separator followed by exactly three digits at the end of the number is a thousands separator; a separator followed by one or two digits is a decimal point; mixed separators use the last one as the decimal point. Show the parsed value back to the user next to the field ("$150,000") so a wrong read is visible.

## Rules panel

15. Text and order per `docs/rules-panel-text-2026-09-10.md`. Changes from the earlier draft: every milestone pass or fail is decided by an independent technical reviewer appointed before work begins, Giveth is not the reviewer unless explicitly named, Giveth oversees the arrangement; deliveries are reviewed by the reviewer and paid within 14 days of acceptance; the stall sentence says TheDAO Security Fund "can reclaim"; RFPs welcome a different solid solution to the same problem; a line that in some circumstances a grant may be managed by the Ethereum Foundation or another established ecosystem organization.

## Paste and errors

16. **Sorting happens automatically on the first paste.** No button needed. The paste box starts empty (no example content in it). After the first paste sorts into the sections, the person edits the sections directly. A quiet "Sort again from the paste box" link covers re-pastes. The prototype keeps a "Try it with an example draft" control in its banner so the flow can be demonstrated; that control does not ship.
17. **Submit is always clickable.** Clicking it with problems shows the errors inline on the questions that have them (red edge, message under the field, the first one scrolled into view) and keeps the checks log at the bottom as well. Required-for-submission questions are visibly marked as such.

## Context, not a change

- Many rejected submissions were rejected because Griff knew the team would rework them, so the rejected set is not evidence of bad format. The inventory already refrains from inferring reasons.

## Team roster for the example (from the lookup)

| Name | Role | Org |
|---|---|---|
| Griff Green | Co-founder, leads TheDAO Security Fund | Giveth |
| Lauren Luz | Project management | Giveth |
| Jake Schumacher | Business development and fundraising lead | Giveth |
| Cotabe Moral | Business development and partnerships | Giveth |
| Anamarija Begonja | Communications lead | Giveth |
````



---

# Part 3. FILE: docs/rules-panel-text-2026-09-10.md

````markdown
# Rules panel text, by type

Griff's wording decisions from 2026-09-10, ordered chronologically as a reader experiences the process. This text renders on the initiative page, on the submit form under the Type choice, and inside the AI guide as do-not-paste reference. Version line under each panel: "Rules v2026-09, shown on every initiative of this type".

Legal rule kept throughout: donated funds are never described as refundable, claimable, held, reserved, or escrowed. The stalled-milestone sentence is the only language about reclaiming money.

## How RFPs work

1. Funding comes first. Nothing starts until the initiative is fully funded.
2. When funding completes, a 30-day proposal window opens. Any qualified team can bid.
3. This page describes the solution we want. A team with another solid way to solve the same problem is welcome to propose it, even if it departs from the draft milestones below.
4. A proposal contains the team and its track record, the technical approach, a milestone plan with a per-milestone budget (the draft on this page or a stronger version), and full disclosures. Every applicant discloses their relationships to the teams, codebases, and firms named on this page.
5. Giveth selects the team within 7 days of the window closing, weighing credibility, price, and the strength of the proposed milestones.
6. The milestones on this page are a draft. Final milestones and payments get negotiated with the selected team and fixed in the grant agreement.
7. Before work begins, an independent technical reviewer with no ties to the team is appointed and named in the grant agreement. The reviewer decides whether each milestone passes or fails. Giveth is not the reviewer unless explicitly named, and Giveth oversees the arrangement so the reviewer stays independent of the team. The reviewer's fee comes out of the milestone payment, or the reviewer works pro bono; the team coordinates that payment.
8. The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
9. Milestone deliveries are reviewed by the technical reviewer and paid within 14 days of acceptance.
10. If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund can reclaim the unspent funds and put them toward other Ethereum security initiatives.
11. In some circumstances the resulting grant may be managed by the Ethereum Foundation or another established ecosystem organization, when that is a better fit than Giveth.

## How grants work

1. Funding comes first. Nothing starts until the initiative is fully funded.
2. When funding completes, a 15-day window opens. In that window the recipient submits the formal proposal: the final milestone plan, the per-milestone budget, and full disclosures. The same window is an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
3. Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement. Until then, the milestones on this page are a draft.
4. Before work begins, an independent technical reviewer with no ties to the team is appointed and named in the grant agreement. The reviewer decides whether each milestone passes or fails. Giveth is not the reviewer unless explicitly named, and Giveth oversees the arrangement so the reviewer stays independent of the team. The reviewer's fee comes out of the milestone payment, or the reviewer works pro bono; the team coordinates that payment.
5. The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
6. Milestone deliveries are reviewed by the technical reviewer and paid within 14 days of acceptance.
7. If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund can reclaim the unspent funds and put them toward other Ethereum security initiatives.
8. In some circumstances a grant may be managed by the Ethereum Foundation or another established ecosystem organization, when that is a better fit than Giveth.

## How top-up grants work (work already under way with another funder)

1. This grant tops up work that is already under way. There is no proposal window and no challenge period.
2. The funding goal on this page is the total project budget. The amount already committed, and by whom, is shown in the header with each backer's logo; this grant raises the remainder.
3. Completed milestones are marked done with a link to the delivered work. Each remaining milestone carries a target month.
4. Payments from this grant start only once the earlier milestones have been accepted.
5. An independent technical reviewer with no ties to the team, appointed before this grant begins and named in the grant agreement, decides whether each remaining milestone passes or fails. Giveth is not the reviewer unless explicitly named, and Giveth oversees the arrangement so the reviewer stays independent of the team.
6. Milestone deliveries are reviewed by the technical reviewer and paid within 14 days of acceptance.
7. If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund can reclaim the unspent funds and put them toward other Ethereum security initiatives.
8. In some circumstances a grant may be managed by the Ethereum Foundation or another established ecosystem organization, when that is a better fit than Giveth.
````



---

# Part 4. FILE: docs/submission-redesign-proposal-2026-09-10.md

````markdown
# Initiative submission redesign: standard sections, one question per section, and a flow for people and agents

Changelog: revised 2026-09-10 evening after Griff's review; decisions in `docs/feedback-2026-09-10-prototype-round-1.md`.

Draft for Griff, 2026-09-10. Evidence comes from the structural inventory of all 29 live submissions (`docs/submissions-inventory-2026-09-10.md`), the Sept 7 to 10 calls (`docs/canned-text-context-2026-09-10.md`), the live guide as served by the Copy button (`docs/llms-live-2026-09-10.txt`, identical to origin/main), and the July format standard and research notes in `rfp-drafts/`.

## 1. What changes, in one screen

1. The header table goes. Budget and proposal window already render on the page. Expected duration becomes its own required field next to the funding goal.
2. Every process rule leaves the body and renders on the page by type: "How RFPs work" and "How grants work". This is the decision from the Sept 10 call, already specified in the shared-text proposal and the revision prompt.
3. The site owns the section headings. The submit form asks one question per section, in a fixed order that differs for RFPs and grants. Nobody can rename, drop, or reorder a section again.
4. Milestones become structured rows (name, amount, adoption flag, acceptance criteria) instead of free markdown, lettered automatically. The form adds them up against the goal.
5. A "Paste your whole draft" box at the top of the form splits an AI-written draft into the fields the moment it is pasted, so the copy-the-guide flow still takes one paste and no button.
6. The guide shrinks to the interview, the writing rules, and a field-by-field output format. All verbatim blocks, the table, and the closing line disappear from it.

## 2. Why, in ten lines of evidence

- The header table is the most-dropped element: 13 of 29 have none and 2 more paste it as plain text that never renders.
- The proposal window row never carries submitter information. Where it survives, 11 of 16 copy the canonical string; approved id 9 says 15 days in its table and 30 in its Process.
- Duration is stated once or never. 12 of 29 never state one, and ids 3 and 4 contradict themselves.
- Three grants (28, 4, 5) invented a Team section and a Budget summary table because "The recipient" asks why this team, with no place for who this team is.
- Grant submitters keep re-arguing the head start in prose (ids 24, 28, 19, 17, 9, 20). Id 13 built a section called "Why this is an RFP". That is a form question trying to escape.
- Existing work is near-universal (22 of 29, 6 of 7 approved) yet optional in the guide. "What this actually pays for" is optional and 5 of 7 approved drop it.
- Acceptance criteria are formatted five different ways; id 29's checkboxes never render.
- Nothing checks arithmetic or placeholders: pending id 17 sums to $45,000 against a $40,000 goal; ids 22 and 20 carry 16 unresolved brackets.
- Markdown died in the paste for 4 submissions; id 15 spent a full reject-and-resubmit cycle on it.
- Under-400-word submissions (ids 27, 16, 8, 21) have no headings, no milestones, no team. Two answer the guide's interview questions as prose. They needed a form that asks the questions.

## 3. Page-level fields (both types)

These render in the header of the initiative page, next to the type badge, and are never part of any body section.

| Field | Required | Public | Notes |
|---|---|---|---|
| Type | yes | yes | RFP or Grant. Grant gets one sub-option: "Work is already under way with another funder" (a top-up). This switches the rules panel to the no-window variant, marks completed milestones done with a link, and asks every remaining milestone for a target month. |
| Title | yes | yes | Up to 140 characters, no "RFP:" or "Grant:" prefix. |
| Short summary | yes | yes | 2 to 4 sentences. Board card text. |
| Funding goal (USD) | yes | yes | One flat number. |
| Expected duration (months) | yes | yes | Griff's wording: months from funding until the last milestone is complete. Integer. Renders as "About 9 months". Replaces the Indicative duration row. |
| Recipient team | grants only | yes | Short name of the team, for the header and the board card ("Grant to Verity Labs"). |
| Backers already committed | no | yes | Open to every type, not top-ups only. A repeating row: organization, amount in USD, link, and the organization's logo file. The header renders "$120,000 already committed by X, Y" from the rows, a top-up adds "this grant raises the remaining $Z", and each logo renders on the initiative page and the board card exactly as backer logos do today. A top-up with no backer listed gets a warning, because the type says another funder is already in. |
| Links | no | yes | Repo, site, prior write-up, one per line. Today these are buried in prose. |
| Who is likely to fund this | yes | no | Unchanged. |
| Contact | yes | no | Unchanged. Make it required; the schema allows blank today. |

Logos are always the real file. Nothing in this flow draws, recreates, or approximates a logo: the AI finds the organization's official logo (press kit, brand page, repository) and the proposer uploads that file. The logo field's helper says it in those words: "Upload the organization's official logo file (from their press kit, brand page, or repository). Never a redrawn or AI-made version." The evidence for the field is the ethdebug grant, which added an "Anchor backer" row to its own table because there was nowhere else to put it.

## 4. Standard sections, one question each

The site renders the heading. The field asks the question and shows a two-line helper and an "example" toggle that reveals that section from the gold-standard example. Inside a field, submitters may use bold, links, bullet lists, and numbered lists. No headings inside a field; the splitter strips any that arrive.

### RFP sections, in order

| # | Rendered heading | Form question | Required | Helper |
|---|---|---|---|---|
| 1 | Why this matters | What gap does this close, and what can people do afterwards that they cannot today? | yes | 1 to 2 short paragraphs or a bullet list. |
| 2 | In scope | What gets built or delivered? | yes | Concrete deliverables. This is also where you say what the money actually pays for. |
| 3 | Out of scope | What is deliberately not included? | yes | This is where the expensive misunderstandings get prevented. |
| 4 | Existing work | What prior art should bidders build on? | yes, "none" allowed | Links. Say what would justify building on something else. |
| 5 | Who we expect to do this | What does a winning team look like, and who co-drafted this initiative? | yes | Nobody is pre-selected. Name co-authors and your own relationship to any team or codebase named above. |
| 6 | Hard requirements | What must every proposal meet or be ignored? | yes | Numbered. Open source under an OSI license where code is delivered, verifiable acceptance, a maintenance plan, plus what the domain demands. |
| 7 | Milestones (draft) | Structured rows, see section 5. | yes | |

### Grant sections, in order

| # | Rendered heading | Form question | Required | Helper |
|---|---|---|---|---|
| 1 | Why this matters | Same as RFP. | yes | |
| 2 | The team | Who does the work? Names, roles, track record, links. | yes | Also state any other funding you have for this work, and your relationships to codebases or firms named in this initiative. |
| 3 | Why a grant: what already exists | What have you already built or done that gives you a decisive head start, and where can a stranger check it? | yes | Links to code, reports, deployments. Say why the price is below a from-scratch build. If the head start is thin, say so; the admin may ask you to resubmit as an RFP. |
| 4 | In scope | Same as RFP. | yes | |
| 5 | Out of scope | Same as RFP. | yes | |
| 6 | Commitments | What do you commit to on license, maintenance after the money is spent, and pinned targets? Any exception you are asking for? | yes | What you commit to on license, maintenance after the money is spent, and pinned targets. State any exception you are asking for. |
| 7 | Milestones | Structured rows, see section 5. | yes | Top-ups mark completed milestones as done with a link, and every remaining milestone carries a target month. |

The example that opens under "The team" is the Giveth roster: Griff Green (co-founder, leads TheDAO Security Fund), Lauren Luz (project management), Jake Schumacher (business development and fundraising), Cotabe Moral (business development and partnerships), Anamarija Begonja (communications). It is written as a short team paragraph in the guide's register, with the other-funding line and the disclosure the helper asks for.

Judgment calls in this table, now confirmed by Griff:

- "Commitments" instead of "Hard requirements" on grants. The RFP wording addresses unknown bidders; a named team is making promises.
- "Why a grant: what already exists" merges three things that today sprawl across The recipient and Existing work: the head start, the prior work links, and the type justification. One question, one place.
- "What this actually pays for" is gone. Its good uses (id 24 flagging slow human work) fit under In scope.
- Scope becomes two fields rather than one with two bold labels, because 17 of 20 grants kept both labels and a split field lets the page render them side by side.

### Removed from the body entirely

Header table, proposal window, indicative duration, the milestones preamble, the disclosure sentence, Milestone review and acceptance, Process, the closing line. All of it either becomes a page field or lives in the rules panel.

## 5. Milestones as structured rows

Each row: name, amount in USD, a checkbox labelled "Adoption milestone", and acceptance criteria as one input per criterion. Labels are automatic. Rows are lettered A, B, C in the order they sit in the form and re-lettered when one is removed, so nobody types a label and nobody renumbers after a deletion. The page renders each row as `### A - Name - $50,000` with a checklist under it, which is what 17 of 25 submitters tried to hand-write. Top-ups get a "done" checkbox per row with a link to the delivered work, and every remaining row carries a target month (a month input).

Acceptance criteria are one input each: a short row with a checkbox glyph, a remove control at the end, Enter opening the next row, and an "Add criterion" link under the list. The shared textarea is gone. On a 375px screen it read as one run-on paragraph, and nothing could be marked as the offending line.

Amounts are left-aligned like every other field, and one `parseAmount()` reads every money field on the form: the funding goal, every milestone amount, every backer amount. The audience is global, so "150.000" and "150,000" both mean one hundred fifty thousand, and "150.00" and "150,00" both mean one hundred fifty dollars. The rule: a separator followed by exactly three digits at the end of the number is a thousands separator, a separator followed by one or two digits is a decimal point, and with mixed separators the last one is the decimal point. Every amount field echoes the parsed number back next to it as "$150,000", so a wrong read is visible before anyone submits it.

Checks the form runs, warning in yellow and never blocking except where marked:

- Milestone amounts sum to the funding goal. Mismatch blocks submit (id 17).
- At least one adoption milestone, and adoption-tied amounts total at least a third of the goal (at least $100,000 when the goal is $300,000 or more). Blocks submit. A top-up is exempt only when every milestone it lists is already flagged done.
- No criterion contains a range, "[", "TBD", "PLACEHOLDER", or hedges like "as needed" (ids 22, 20, 13). Warn, and mark the criterion itself.
- Every criterion has a number or a named evidence source. Warn.
- On a top-up, every milestone that is not done carries a target month, and every done one carries its link. Warn.

Structured milestones also become the base for the later payout flow: each accepted milestone maps to a Safe payment, which free-form markdown never could.

## 6. The rules panel, by type

The text is settled and lives in `docs/rules-panel-text-2026-09-10.md`: three panels, "How RFPs work", "How grants work" and "How top-up grants work", each an ordered list in the order a reader meets the process. The site renders them from `content/boilerplate/rfp.md`, `grant.md` and the top-up variant, on the initiative page, on the submit form under the type radio, and inside the guide as do-not-paste reference. Version line under each panel: "Rules v2026-09, shown on every initiative of this type".

What changed from the earlier draft:

- Every milestone pass or fail is decided by an independent technical reviewer appointed before work begins and named in the grant agreement. Giveth is not the reviewer unless explicitly named, and Giveth oversees the arrangement so the reviewer stays independent of the team.
- Deliveries are reviewed by that reviewer and paid within 14 days of acceptance, and the stall sentence now says TheDAO Security Fund "can reclaim" the unspent funds after the 21-day deadline.
- An RFP welcomes a team with another solid way to solve the same problem, even one that departs from the draft milestones, and a closing line says that in some circumstances the grant may be managed by the Ethereum Foundation or another established ecosystem organization.

## 7. The submit flow for a person

1. **Top of the page: three steps, as now.** Copy the guide, answer the AI's questions, paste the result. Step 3 changes to "Paste the whole draft below, we sort it into the sections".
2. **Type first, then the rules panel for that type, open by default.** Switching type swaps the panel and the section list below it.
3. **Paste-to-fill box, sorted on the paste itself.** One textarea: "Paste your whole draft here". It starts empty and there is no button. The moment a draft lands, client-side JS splits the markdown on the known headings (exact names plus a short alias list: "Milestones" for "Milestones (draft)", "What already exists" for "Existing work", "Team" for "The team") and fills the fields; the box then collapses to a quiet "Sort again from the paste box" link for re-pastes. Milestone headings of the form `### Name - $50,000` become rows, and a leading `A - ` from the old format is accepted and dropped, since the letter is now the row's position. `- [ ]` and plain bullets under them become criteria, one per input. Backer lines under "Backers already committed" read as `Organization | amount | link`. Anything that matched nothing lands in an "Unsorted text" box the person can copy from. This handles the 12 FULL and most of the 10 PARTIAL cases automatically and gives the 7 NONE cases a scaffold instead of a blank.
4. **The section fields**, each with the question, the helper, the example toggle, and a word count. Fields autosave to localStorage so a closed tab does not lose an hour of work.
5. **Milestone rows** with add and remove buttons, a running total against the goal, and the checks from section 5.
6. **Preview.** A "See it as a page" toggle renders the initiative exactly as it will appear, including the rules panel. This is the fix for paste fidelity: the four submitters who lost their markdown would have seen it.
7. **Submit for review.** The button is always clickable. Pressing it runs the checks and marks every problem on the question it belongs to: a red edge, one line under the field naming the fix, and the first one scrolled into view. The full list stays in the checks log at the bottom, and every required question carries a visible "Required" marker. Marks clear from a field the moment it is fixed. Warnings are marked in yellow and never stop a submission; errors do, until they are fixed. The confirmation card shows what the site will add (rules panel), and states that a duplicate body was blocked if that check fired (ids 11 and 12).

What this replaces: a single 20,000-character "Full initiative details" textarea into which people pasted, with no idea what would render.

## 8. The submit flow for an agent

Same form, same fields, plus three things that make it agent-friendly:

1. The guide's Step 3 output is one fenced block per field, in form order, with the field's `name` attribute on the fence line (`title`, `summary`, `why`, `in_scope`, ... `milestones`). An agent with browser access can fill the form field by field from its own output; a person can paste field by field or use paste-to-fill.
2. The guide documents the form: URL, field names, which are required, the milestone row format, and the checks the form runs, so an agent can self-validate before it touches the page. Stefan already points a computer-use agent at conference forms; this makes ours a known target.
3. Later, not now: `POST /api/submit` accepting the same fields as JSON, gated by the same rate limits and the honeypot, returning the warnings list. Skip it until an agent actually asks for it; the form is enough for v1.

## 9. Guide v3: what changes in llms.txt

Keep: the purpose paragraph, the interview (questions 1 to 8), the register example, the milestone rules, the budget rules, the reformatting rules, the legal rules, the writing rules, the readiness discipline. These are the parts that make the drafts good.

Change:

1. Delete "The shared skeleton", "Shared rules and verbatim text", "If it is an RFP", "If it is a grant", and "If the work is already funded" as drafting instructions. Replace with "What the site adds" (the rules panel text, marked do-not-paste) and "The sections, by type" (the two tables from section 4 above, with the question and helper for each).
2. Step 3 becomes the field list in form order, one fenced block per field, with the milestone row format spelled out. State plainly: no `#` headings inside any field, the site owns the headings.
3. The interview gains three questions the form now needs answered: expected months to the last milestone (question 6 asks it, the output never carried it), the team members and roles for grants, and "is this work already under way with another funder" asked right after question 4, because it changes the rules.
4. Rewrite the gold-standard example as filled fields rather than a document. Same OPSEC content.
5. Scorecard: drop "Window correct for the type" and "Format matches the gold-standard example"; add "Milestone amounts sum to the goal" and "Expected duration stated". Length target becomes 600 to 1,800 words across all fields, since the boilerplate is gone.
6. Legal rule 1 keeps the reclaim sentence but the guide no longer asks anyone to reproduce it; the site does.
7. Sync rule in CONTRIBUTING.md stands: form fields, guide, and boilerplate files change in one PR, and a test fails when the guide's field list drifts from the form.
8. A logo rule: the AI never draws, recreates, or approximates a logo. When an initiative names a backer, the guide has it find the organization's official logo file (press kit, brand page, repository) and tell the proposer to upload that file in the form. The form's logo helper carries the same sentence.
9. Interview question 2 asks for the gap, not an incident: what people cannot do today that this makes possible, with an incident accepted as one kind of evidence. "Name the real event" comes out of the guide and out of the form helper.
10. Acceptance criteria come out of Step 3 as a list, one criterion per line, because the form now has one input per criterion and can mark a single line as unclear.
11. Milestone letters are automatic, so the output format no longer carries a label: `### Name - $50,000`, and the order on the page is the letter. Guide v3 says so plainly, since an AI that writes `### A - Name` is not wrong, only redundant.
12. The example "The team" section uses the Giveth roster (Griff Green, Lauren Luz, Jake Schumacher, Cotabe Moral, Anamarija Begonja) rather than an invented lab.

Two defects the inventory found on the live board that need fixing regardless of this redesign:

- Approved id 7 (Community fuzzing tooling) contains "unused funds become claimable by the donors who backed the RFP for 30 days". That is the exact wording the August legal memo bans. Edit it in admin today.
- Approved id 9 (Securing Ethereum with formal verification) states a 15-day window in its table and a 30-day window in its Process. The migration removes both, but until then the page contradicts itself.

## 10. Migrating the 29 existing submissions

- Add nullable columns for the new fields and sections. Keep `details` as a legacy field. The page renders the structured sections when present, otherwise the legacy body.
- Run the same splitter server-side over every row, with the canned blocks stripped first. Write the result to the new columns only for rows that split cleanly (all required sections matched, milestones parsed, amounts sum). Expect roughly the 12 FULL and most PARTIAL rows to pass.
- Rows that do not split stay on the legacy body and get a flag in admin: "legacy format". Griff decides per row whether to ask for a resubmission (the 7 NONE, of which 4 are already rejected) or leave it.
- Dry run first with a per-row diff for Griff, backup with `deploy/backup.sh`, then apply on the server.
- Duration: the migration fills it from the table row where one exists (16 rows) and leaves it blank otherwise; blank renders as "Duration not stated" until the admin sets it.

## 11. Phasing

Phase 1, this week, before the announcement: the shared-text change as already specified (rules panel, canned text stripped, table removed, duration field added, closing line gone, migration of the 29). Roughly one to two days.

Phase 2, next: one question per section, milestone rows, paste-to-fill, preview, autosave, the new checks, guide v3, and the server-side split of existing rows into the new columns. Roughly three to four days of Xerxes time, with the guide rewrite done by an agent against the field list.

Phase 3, only on demand: the JSON submit endpoint for agents.

Phase 1 is safe to ship alone. Phase 2 builds on it and does not undo anything.

## 12. Decisions for Griff

Settled on 2026-09-10 and already applied above: "Commitments" as the grant heading, the adoption-share check blocking rather than warning, submission past warnings staying allowed with every problem marked on its own question, and the paste-to-fill splitter shipping in Phase 2.

1. Top-up as a sub-option of Grant rather than a third type. Accepted by default; say so if you want a third badge on the board instead.
2. Team example confirmed by Griff on 2026-09-10: Cotabe Moral, Giveth.

**Also for the coding agent:** remove the Transparency dashboard link everywhere on the site, the footer today and anywhere else it appears. Separate from this redesign.
````



---

# Part 5. FILE: docs/llms-v3-2026-09-10.txt

````markdown
# TheDAO Security Fund: guide for AI assistants drafting initiatives

## Purpose and scope

TheDAO Security Fund co-funds Ethereum security work. Initiatives are listed at https://fund.thedao.fund, ecosystem stakeholders and donors fund them, and teams get paid as milestones are accepted. This file is your complete instruction set for proposing a new initiative, and it does not cover bids on an initiative that is already funded. There are two types: an RFP (nobody is pre-selected, teams compete once it is funded) and a grant (a named team does the work, justified by a head start). Giveth runs the board, raises money alongside proposers, selects teams, and reviews milestones. The admin is the person at Giveth who accepts or rejects a submission.

You hand over one markdown document. The form at https://fund.thedao.fund/submit sorts it into its fields the moment it is pasted, matching the `## ` headings listed in Step 2. Get the heading names exactly right and nothing lands in the Unsorted box. Match the example at the end of this file in tone, length, and level of detail.

- Interview first. Ask questions 1 to 7 and wait for replies before drafting.
- Nothing is READY until the weak parts are fixed.

## Step 1: Interview the proposer. Do not draft yet.

If the proposer already has a written proposal, read it first, ask only the questions it leaves open, and follow "Reformatting a proposal the proposer already wrote". Ask whether a companion initiative exists.

Ask two or three questions at a time and wait for real answers. Questions 1 to 7 are mandatory before drafting, 8 to 11 before the draft can be marked READY. Ask at least twice, even if the proposer says "just draft it." If they still refuse, draft with [PLACEHOLDER: ...] in every field that depends on a missing answer, log each unanswered question in Gaps, and mark NOT READY. Collect their contact (email or Telegram), and name any co-author in the draft.

1. **What exactly gets built?** The concrete deliverables, in their own words.
2. **What gap does this close?** What can people do afterwards that they cannot today, and who is stuck without it? An incident or a loss is one kind of evidence for the gap, welcome but not required.
3. **Who would fund this, and why?** Push hardest here. TheDAO never funds an initiative alone: expect roughly 25% or more of the goal from ecosystem stakeholders, and TheDAO's own share tops out around $200,000. Ask which L2s, wallets, exchanges, protocols, security firms, or large Ethereum teams benefit enough to pay serious money, on the order of $50,000 from one stakeholder on a large initiative and less on smaller asks. Commitments are not required before submitting: Giveth raises money alongside the proposer and can approach stakeholders directly, and the proposer still names plausible funders and says why each would pay. For each one, get the relationship (none, met once, know them well), whether a warm intro is possible, and the size of the ask. If neither of you can name anyone, say so. This initiative is not viable yet.
4. **RFP or grant?** A grant is only justified when already-done work gives a named team a decisive head start: they built the prototype, they did half the verification, they hold expertise nobody else has. An idea with no prototype is an RFP. Grants still open for challenges once funded, so make them defend the head start.
5. **Is this work already under way with another funder?** Ask it right after question 4, because a top-up changes the rules: no proposal window, no challenge period, the goal is the whole project budget, milestones another funder paid for are marked done with a link, and every remaining milestone carries a target month.
6. **Which organizations have already committed money?** Name, amount in USD, and a link for each. Read Logos before you go looking for a logo.
7. **For a grant, who is on the team?** Names, roles, a link that shows each person's track record, and what other funding they have for this work.
8. **Who will use the result**, and what public evidence of adoption could a stranger check? A demo is not adoption.
9. **What does it cost per milestone, and how many months from funding until the last milestone is complete?** One integer for the months. Would a lean, competent team call those numbers fair?
10. **Who maintains it after the money is spent, and why would they?** Name the person, team, or body, and their reason to keep going.
11. **Is there a business model or funding model that makes it sustainable?** Membership fees, commercial products on an open core, ecosystem budgets, or an honest "no, it needs new funding in year two."

## Step 2: Draft the fields

The register to imitate:

> Before: "This engagement represents a pivotal opportunity to leverage TheDAO's robust security expertise."
>
> After: "TheDAO Security Fund will pay for a third-party audit covering reentrancy, access control, and upgrade paths. Deliverable: a written report with severity ratings."

### The output format

One markdown document. Every page field and every section is a `## ` heading with an exact name from the list below, and the answer sits under it. Inside a field: bold, links, bullet lists, numbered lists. No heading of any level inside a field, and no tables. The site owns the headings, and a heading written inside a field gets flattened to bold text.

An RFP, in this order:

```
## Title
## Short summary
## Funding goal (USD)
## Expected duration (months)
## Backers already committed
## Links
## Why this matters
## In scope
## Out of scope
## Existing work
## Who we expect to do this
## Hard requirements
## Milestones
## Who is likely to fund this
## Contact
```

A grant is the same document with `## Recipient team` after the duration, `## The team` and `## Why a grant: what already exists` after "Why this matters", `## Commitments` in place of "Hard requirements", and no "Existing work" and no "Who we expect to do this": the head start covers the prior art and the team section covers the people.

Every heading, and the one question it answers:

- **Title**: up to 140 characters, no "RFP:" or "Grant:" prefix. Tell the proposer which radio button to pick, and for a top-up to tick "Work is already under way with another funder".
- **Short summary**: what gets built and why it matters, 2 to 4 sentences. This is the board card text.
- **Funding goal (USD)**: one flat number, written `$150,000`, never "up to $150,000". The form reads `150,000` and `150.000` alike and echoes back what it read, so check the echo.
- **Expected duration (months)**: one integer, months from funding until the last milestone is complete.
- **Recipient team** (grant): the short team name, for the header and the board card.
- **Backers already committed**: one line per organization that has committed money, `Organization | $amount | https://link`. Omit the heading when nobody has committed.
- **Links**: repo, site, prior write-up, one per line, nothing else on the line.
- **Why this matters**: what gap does this close, and what can people do afterwards that they cannot today? 1 to 2 short paragraphs or a bullet list.
- **The team** (grant): who does the work? Names, roles, track record links, any other funding for this work, and relationships to the codebases or firms named in the initiative.
- **Why a grant: what already exists** (grant): what is already built that gives a decisive head start, and where can a stranger check it? Links to code, reports, deployments, and why the price sits below a from-scratch build. If the head start is thin, say so, because the admin may ask for a resubmission as an RFP.
- **In scope**: what gets built or delivered? Concrete deliverables, and the money's real work named, like the coordination effort in the example.
- **Out of scope**: what is deliberately not included? Where the expensive misunderstandings get prevented.
- **Existing work** (RFP): what prior art should bidders build on? Links, and what would justify building on something else. Write "none" if there is nothing.
- **Who we expect to do this** (RFP): what does a winning team look like, and who co-drafted this initiative? Nobody is pre-selected. Name the co-authors and the proposer's own relationship to any team or codebase named above.
- **Hard requirements** (RFP): what must every proposal meet or be ignored? Numbered. Open source under an OSI license where code is delivered, acceptance a stranger can verify from public evidence, a maintenance plan, plus what the domain demands.
- **Commitments** (grant): what does the team commit to on license, maintenance after the money is spent, and pinned targets? One bullet each, and any exception stated plainly.
- **Milestones**: see Milestone rules.
- **Who is likely to fund this** (never published): the answer to question 3, one funder per line, in exactly this format:

  `Org name | why they'd pay | relationship (none / met once / know them well) | warm intro? yes/no | suggested ask $`

  Giveth fundraises from this list alongside the proposer, so honest relationships beat impressive names nobody knows. Leave out third parties' private contact details.
- **Contact** (never published): the proposer's email or Telegram.

Length: 600 to 1,800 words across every field together. The example at the end is about 1,300.

Never write the process, the proposal window, the selection steps, the milestones preamble, the applicant disclosure sentence, milestone review and acceptance, payment terms, the stalled-milestone sentence, milestone letters, the headings themselves, or a closing line. The site adds all of it, and the wording is in "What the site shows next to every initiative", below, so you can answer questions about the process without inventing an answer.

### Milestone rules

Heading per milestone: `### Name - $50,000`. No letter: the form letters the rows A, B, C in the order they arrive and re-letters them when one is removed. Put `(adoption)` after the amount on every milestone that pays only on adoption. Acceptance criteria go under the heading, one `- [ ]` line each, one criterion per line, and nothing else.

In a top-up, a milestone another funder already paid for gets `(done)` after the amount and `Delivered: https://...` on the first line under its heading. Every milestone that is not done gets `Target month: 2027-03` on the first line under its heading, in YYYY-MM.

1. Real adoption is a required deliverable. At least one milestone pays only on evidence that other people use what was built. Adoption milestones can sit anywhere in the order, and there can be several. Building for its own sake is not funded.
2. Size it. Add up every payment that depends on adoption: the sum is at least a third of the goal, and at least $100,000 once the goal reaches $300,000. The form refuses to submit when nothing is flagged for adoption or the share falls short.
3. Milestone amounts add up to the funding goal exactly. The form refuses to submit on a mismatch.
4. Adoption means public evidence a stranger can check: named users, live deployments, merged upstream pull requests, a public metrics page. A demo is not adoption. An internal pilot is not adoption.
5. Every criterion is binary, and a criterion that states a quantity uses one floor number: "at least 25". Never a range ("20-30"), never a hedge ("one or two", "a meaningful subset", "where appropriate", "as needed").
6. Every criterion names the public evidence that proves it: the live page, the published report, the passing CI check, the named party confirming.
7. Flag soft line items. A budget line with no fixed deliverable, such as a pool of money for onward funding, is not binary. Give it a floor number and named evidence, or list it in Gaps and mark the draft NOT READY.

Weak: "Frontend done." Strong: "End-to-end swap flow demonstrated on a public testnet, with the recording linked from the repository."

### Budget rules

1. Run the padding test on each milestone. The deliverable has to be obviously worth the money to a skeptical funder. The classic fail is $60,000 for one report, when $60,000 hires a full-time person for a year.
2. Giveth funds frugal proposals and skips padded ones. Grants face a stricter standard than RFPs, because no competing bid tests the number. A grant also costs less than the same scope from scratch, because nobody pays twice for finished work: a from-scratch price means the type is wrong or the budget is too high.
3. Cut any claim justifying the budget or the urgency that the proposer cannot source.

### Logos

Never draw, recreate, or approximate a logo. No CSS, no unicode, no generated image, no ASCII, not even a close copy. When an initiative names a backer, find that organization's official logo file (press kit, brand page, repository), give the proposer the link, and tell them to upload that file in the backer row on the form. A logo is never text in the document.

### Reformatting a proposal the proposer already wrote

Restructure it, do not rewrite it.

1. Move their text into the fields and keep their sentences. Their own headings that match a field name become that field, and the rest keep their words and lose the heading.
2. Add no dependencies, context, claims, or numbers they did not state, and never silently change a field you were not asked about: goal, duration, milestone amounts, backer amounts.
3. When the source omits a required field, ask for it. If you cannot ask, use the placeholder rule in Writing rules and add a matching line to Gaps.
4. When the source has no Hard requirements or Commitments, derive them only from statements already in their text, and record the derivation in Gaps.
5. Milestones written as prose become rows: one heading with the name and the amount, the rest as criteria. Never invent a milestone to make the amounts add up. Tell the proposer the sum is short and by how much.
6. Fidelity beats the criteria rules. Never write a floor number the proposer has not confirmed. When the source gives a range, propose one floor (the midpoint is a fair default), get it confirmed, and record it in Gaps. If you cannot confirm, write [PLACEHOLDER: floor number] and the draft is NOT READY.
7. When a companion initiative exists, cross-check both for scope contradictions, such as a deliverable one puts out of scope while the other funds it. Record each one in Gaps.
8. Everything you added, derived, or changed goes in Gaps. Nothing goes in silently.

### Legal wording rules (non-negotiable)

1. NEVER describe donated funds as refundable, claimable, held, reserved, or escrowed, and never suggest donors can get money back or keep any right to donated funds. Donations are completed, unconditional gifts to TheDAO, and any return is at TheDAO's sole discretion and is never promised. The site's rules panel carries the only language about reclaiming unspent funds: you never reproduce it and never write a version of your own.
2. Never promise tax deductibility. Never describe donations as anonymous.
3. "TheDAO" is one word: capital T, no space, capital DAO. Never write "the DAO" for TheDAO or TheDAO Security Fund, and never abbreviate either name.
4. All amounts in USD.
5. No em dashes anywhere. Use a comma, a colon, parentheses, or an ellipsis.
6. Before delivering, scan every field for every violation of rules 1 to 5, plus ranges and hedges in criteria. Fix every hit.

### Writing rules

Do these:

1. One idea per sentence. State it, then move on.
2. Use concrete nouns and numbers. "At least 6 firms sign the template" beats "broad industry support".
3. State facts with is and are. Do not reach for "serves as", "represents", "boasts", or "features".
4. Attribute every claim to a named organization, document, or person. Never "experts say".
5. Write sentences you would say out loud to a colleague, and vary their length. Never run more than two consecutive sentences of the same length or the same structure.
6. Speak for the Fund in the first person plural: "we expect", "we will never publish".
7. One aside per document at most, and only if it carries information, like the example's "could probably be vibe coded in a weekend". Bold a fact only when a reader must not miss it, never every list item.
8. Use bullets wherever they make the text easier to scan. Keep a paragraph only where the argument needs connected sentences.
9. Say what a thing is and what it does, then stop. No summary paragraph, no sentence about why it matters, no closer.
10. Never invent a name, number, link, or event. Write `[PLACEHOLDER: ...]` instead.

Never do these:

- "not X, but Y" and "not only X, but also Y". Write the second half alone.
- Rule of three, and stacked fragments: "Fast. Simple. Secure." Do not default to exactly three items or examples.
- Signposting glue and throat-clearing openers: Furthermore, Moreover, It's worth noting, This highlights, In today's rapidly evolving, Here's the thing.
- Tacked-on "-ing" analysis: "..., further underscoring its importance." Self-congratulation: "And that matters", "That's the part everyone misses".
- Metaphor in place of instruction: "less a hammer, more a scalpel", "it's the Excel of X".
- Hype vocabulary and its synonyms: delve, robust, seamless, leverage, pivotal, crucial, holistic, game-changer. If an adjective adds no fact a reader could check, cut it and name the fact.

## Step 3: Deliver the document plus the scorecard

Hand over the whole document in one markdown block the proposer can copy in one go, then tell them what to do with it: pick the type at https://fund.thedao.fund/submit, paste the document into "Paste your whole draft here", and the fields fill themselves. Anything landing in the Unsorted box means a heading name is wrong. Then this scorecard, filled honestly:

```
READINESS: READY | NOT READY
- All fields answered: yes / no
- Interview questions 1 to 7 answered: yes / no
- Type justified (grant head start defended, or genuinely open RFP): yes / no
- Financial demand: [stakeholders named, with why each would pay] / none named
- Milestone amounts sum to the goal: yes / no
- At least one adoption milestone, adoption-tied amounts meet the share rule, and each pays only on real public usage: yes / no
- Expected duration stated: yes / no
- Every criterion is binary; every quantity is a floor number; every criterion names its public evidence: yes / no
- No ranges and no hedges in any criterion: yes / no
- Maintainer named: yes / no
- Business or funding model stated: yes / no
- Budget passes the sanity test: yes / no
- Draft length 600 to 1,800 words across all fields: yes / no
- No headings inside fields, every field under its own ## name: yes / no
- Banned wording absent (refundable, claimable, held, reserved, escrowed, tax deductible, anonymous), no "the DAO", no em dashes: yes / no
- Fidelity to the supplied proposal: yes / no / not applicable
- No [PLACEHOLDER] left in the draft: yes / no
- Gaps: [everything you added, derived, changed, or could not answer]
```

### Do not mark READY until it is fixed

Any "no" on the scorecard means NOT READY. No partial credit. The admin rejects these fastest: a weak or missing adoption milestone, a criterion nobody can verify, a range or hedge in a criterion, no plausible funders, banned wording.

1. Keep drafting. A draft with visible gaps is more useful to the admin than no draft.
2. Tell the proposer what to change, criterion by criterion, and propose the replacement wording yourself.
3. Get the change. Ask for the missing floor number, the named user, or the evidence link. Do not accept "we will figure that out later".
4. Leave the verdict at NOT READY until it is fixed.

Never hide a gap. When the honest answer is that nobody would fund this, say so before the proposer spends more time.

## What the site shows next to every initiative (do not paste any of this)

Every initiative page carries the panel for its type, and so does the submit form. Nobody writes it and nobody edits it. It is here so you can answer the proposer's questions about how the process works. The site prints "Rules v2026-09, shown on every initiative of this type" under each panel.

### How RFPs work

1. Funding comes first. Nothing starts until the initiative is fully funded.
2. When funding completes, a 30-day proposal window opens. Any qualified team can bid.
3. This page describes the solution we want. A team with another solid way to solve the same problem is welcome to propose it, even if it departs from the draft milestones below.
4. A proposal contains the team and its track record, the technical approach, a milestone plan with a per-milestone budget (the draft on this page or a stronger version), and full disclosures. Every applicant discloses their relationships to the teams, codebases, and firms named on this page.
5. Giveth selects the team within 7 days of the window closing, weighing credibility, price, and the strength of the proposed milestones.
6. The milestones on this page are a draft. Final milestones and payments get negotiated with the selected team and fixed in the grant agreement.
7. Before work begins, an independent technical reviewer with no ties to the team is appointed and named in the grant agreement. The reviewer decides whether each milestone passes or fails. Giveth is not the reviewer unless explicitly named, and Giveth oversees the arrangement so the reviewer stays independent of the team. The reviewer's fee comes out of the milestone payment, or the reviewer works pro bono; the team coordinates that payment.
8. The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
9. Milestone deliveries are reviewed by the technical reviewer and paid within 14 days of acceptance.
10. If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund can reclaim the unspent funds and put them toward other Ethereum security initiatives.
11. In some circumstances the resulting grant may be managed by the Ethereum Foundation or another established ecosystem organization, when that is a better fit than Giveth.

### How grants work

1. Funding comes first. Nothing starts until the initiative is fully funded.
2. When funding completes, a 15-day window opens. In that window the recipient submits the formal proposal: the final milestone plan, the per-milestone budget, and full disclosures. The same window is an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
3. Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement. Until then, the milestones on this page are a draft.
4. Before work begins, an independent technical reviewer with no ties to the team is appointed and named in the grant agreement. The reviewer decides whether each milestone passes or fails. Giveth is not the reviewer unless explicitly named, and Giveth oversees the arrangement so the reviewer stays independent of the team. The reviewer's fee comes out of the milestone payment, or the reviewer works pro bono; the team coordinates that payment.
5. The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
6. Milestone deliveries are reviewed by the technical reviewer and paid within 14 days of acceptance.
7. If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund can reclaim the unspent funds and put them toward other Ethereum security initiatives.
8. In some circumstances a grant may be managed by the Ethereum Foundation or another established ecosystem organization, when that is a better fit than Giveth.

### How top-up grants work (work already under way with another funder)

1. This grant tops up work that is already under way. There is no proposal window and no challenge period.
2. The funding goal on this page is the total project budget. The amount already committed, and by whom, is shown in the header with each backer's logo; this grant raises the remainder.
3. Completed milestones are marked done with a link to the delivered work. Each remaining milestone carries a target month.
4. Payments from this grant start only once the earlier milestones have been accepted.
5. An independent technical reviewer with no ties to the team, appointed before this grant begins and named in the grant agreement, decides whether each remaining milestone passes or fails. Giveth is not the reviewer unless explicitly named, and Giveth oversees the arrangement so the reviewer stays independent of the team.
6. Milestone deliveries are reviewed by the technical reviewer and paid within 14 days of acceptance.
7. If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund can reclaim the unspent funds and put them toward other Ethereum security initiatives.
8. In some circumstances a grant may be managed by the Ethereum Foundation or another established ecosystem organization, when that is a better fit than Giveth.

## The gold-standard example, in the exact output format

A real initiative from the board, an RFP, written as the document you hand over. Nothing here is site boilerplate: every line lands in a field. About 1,300 words.

```markdown
## Title

OPSEC Ratings Coalition to Build & Maintain an "L2Beat for OPSEC"

## Short summary

One OPSEC rating the whole industry recognizes, issued by the firms that already run OPSEC audits. This RFP funds the coordinator who gets at least 6 auditing firms to agree on one scoring template and the A / AA / AAA tiers, stands up a public board of rated teams, and hands the standard to a membership body the firms own. Rated teams pay a fixed fee for their assessment, so the system pays for itself once enough teams are on the board.

## Funding goal (USD)

$150,000

## Expected duration (months)

18

## Links

https://frameworks.securityalliance.org/
https://securityalliance.org/

## Why this matters

Your keys, your devices, your multisig process, your access controls... these are just as important as your smart contracts. Every serious team already invests in OPSEC, and OPSEC audits happen all the time. But all of that work is invisible. There is no public signal that tells users, investors or partners who is actually running a tight ship.

We want to change that with a single OPSEC rating the whole industry agrees on. Think of a Moody's rating: people want one because everyone recognizes what it means. Teams that earn an A, AA or AAA get their tier on a public board. That's it, just the tier. We will never publish what a team is missing (a public list of weaknesses is a gift to attackers), and teams with unacceptable OPSEC simply don't make the board... which says something all by itself.

## In scope

This RFP pays for a coordination effort. The money buys the social work of getting the OPSEC auditing firms around one table and onto one standard. The board itself is the easy part, and could probably be vibe coded in a weekend.

Three roles, and this money funds one of them. Rated teams pay a fixed fee for their own assessment. Accredited raters get paid per rating out of the fee pool. The coordinator is what this RFP funds: the party that convenes the firms, gets them to sign one standard, builds the board and stands up the membership body.

Deliverables:

- Coordinating at least 6 OPSEC auditing companies to agree on one scoring template and the A / AA / AAA tier definitions
- Onboarding those firms as the first accredited raters, with whatever materials they need to run the template inside their existing audit flow
- A simple public board of rated teams and their tiers, with valid-until and last check-in dates... tiers only, no details, no gaps
- Standing up the membership body: the charter (one firm, one vote), how raters get certified, the verification committee, the fixed fee schedule and the pooled funding model
- The 12-month rating cycle with the six-month check-in and the event-based suspension process
- The handoff: transferring the standard, the board and the name to the membership body

Bidders are welcome to propose a different path to the same goal: a decentralized rating system that many OPSEC auditing companies co-own, with a real shot at sustaining itself long after this money is spent.

## Out of scope

- Performing the underlying OPSEC audits (the accredited firms do that)
- Publishing any team's specific weaknesses, unmet controls, or the reasons behind a tier
- A heavy platform build. The board is deliberately simple.

## Existing work

- [Security Frameworks by SEAL](https://frameworks.securityalliance.org/): the Security Alliance's open framework covering operational security, infrastructure, DevOps, incident response and more. Bidders should read it before proposing a scoring template.

## Who we expect to do this

Nobody is pre-selected. The dream candidate is a credible coordinator in the security community: someone who can bring 6+ OPSEC auditing firms to the same table and get them all to sign the same document.

Ideally the coordinator is not an OPSEC auditing firm, because whoever holds the pen on the standard walks away with an edge over the firms they convened. That is a preference, not a requirement, and it will weigh in selection. An audit firm that coordinates takes no rater role during the work and no ownership of the board. The best pitch a bidder can make is simple: here is why the other firms can trust me to run this.

Co-drafted by the submitter with TheDAO Security Fund. The submitter runs no OPSEC auditing firm and will not bid on this initiative.

## Hard requirements

1. **Six firms minimum.** At least 6 OPSEC auditing companies formally agree to the scoring template and tier definitions, and commit to issuing ratings with it.
2. **Tiers only.** The public board shows a team's tier, its valid-until date and its last check-in, and nothing else. No unmet controls, no explanations.
3. **Open and versioned.** The scoring template and tier definitions are public, open source and versioned, with changes dated and attributable, revised through a defined change process no more than once a year.
4. **Tool-agnostic.** Every tier is reachable no matter which tools or frameworks a team uses. No vendor's product is ever required.
5. **One firm, one vote.** Every founding firm gets equal governance rights in the membership body, regardless of who convened whom.
6. **Neutral name.** The standard and the board are not branded after the coordinator or any single firm.
7. **Mandatory handoff.** The standard, the board, the name and any secretariat function transfer to the membership body no later than six months after the final milestone. The coordinator keeps no veto and no unilateral control.
8. **Fixed fees, pooled.** Rated teams pay a fixed, outcome-independent fee. Fees flow to the membership body, which pays raters from the pool and funds the verification committee from it. No tier-contingent pricing.
9. **Twelve months, checked at six, suspended on events.** A rating is valid for 12 months, lapses without the six-month self-attestation and check-in, and is suspended automatically on a disclosed incident or a material change until the team is re-rated.

## Milestones

### Agreed standard - $50,000

- [ ] A public, versioned scoring template plus the A / AA / AAA tier definitions, with the change process for future revisions
- [ ] At least 6 OPSEC auditing companies formally signed on and committed to rating with it, with the signed template published
- [ ] The membership body's charter published: one firm, one vote, rater certification, the verification committee and its stipends, the fixed fee schedule, the pooled funding model, and the handoff agreement with a transfer date no later than six months after the final milestone

### Board and first ratings - $25,000

- [ ] The public board is live, showing rated teams, their tiers, valid-until dates and last check-ins, and nothing else
- [ ] At least 6 accredited firms have issued ratings inside their normal audit flow, each listed on the public board
- [ ] At least 5 teams rated end to end, with their fees paid through the membership body's pool

### Adoption evidence - $75,000 (adoption)

- [ ] At least 20 teams publicly rated on the board by accredited firms
- [ ] The six-month check-in running: every rating older than six months shows a check-in date on the board, and the event-based suspension process is live with a public change log
- [ ] The membership body running on pooled fees, with the verification committee active and its spot-check sample published, both shown on the body's public page
- [ ] A public metrics page: teams rated, tiers awarded, firms participating, check-ins completed, suspensions and renewals

## Who is likely to fund this

Ethereum Foundation | funds public goods security tooling | met once | warm intro? yes | $50,000
Safe Ecosystem Foundation | multisig OPSEC is their core risk surface | none | warm intro? no | $25,000
Security Alliance (SEAL) | published the framework this builds on | know them well | warm intro? yes | $25,000

## Contact

opsec-coalition@example.org
```

The adoption milestone carries half the goal, well above the one-third minimum, and its place at the end is a choice rather than a rule. No backer is listed, because no organization has committed money to this initiative yet. That heading comes back the moment one does.

## The three grant-only sections, illustrated

The example above is an RFP. These are short illustrative answers for the three sections only a grant has, written in the register to imitate. The team is the Giveth roster, and the numbers are made up for the illustration.

```markdown
## The team

**Giveth** does the work. Griff Green, co-founder, leads TheDAO Security Fund and holds the funder relationships. Lauren Luz runs project management, Jake Schumacher leads business development and fundraising, and Anamarija Begonja leads communications. Cotabe Moral covers business development and partnerships.

Track record: giveth.io, github.com/Giveth, and the initiatives already on this board.

No other funder pays for this scope. Giveth administers TheDAO Security Fund, so the independent reviewer for these milestones is named in the grant agreement and is not Giveth.

## Why a grant: what already exists

The scoring template already exists in draft: 40 controls, three tiers, run against 9 teams inside our own audits over the last year. Redacted samples are at example.org/opsec-tiers. Two firms have signed a letter of intent to adopt it.

That is why this costs $60,000 rather than a from-scratch $150,000. The drafting and the first firm conversations are done, and what is left is the other four firms, the board, and the membership body.

## Commitments

- Template and tier definitions published under CC BY 4.0, board code under MIT.
- We maintain the board for 12 months after the last milestone at no further cost.
- Pinned target: at least 20 rated teams within 9 months of the first payment.
- One exception requested: the raters' internal scoring worksheets stay closed for the first year, because they name the controls a team failed.
```

## Links

- The board and current initiatives: https://fund.thedao.fund
- The submission form: https://fund.thedao.fund/submit
````



---

# Part 6. FILE: docs/llms-v3-example-output.md

````markdown
## Title

OPSEC Ratings Coalition to Build & Maintain an "L2Beat for OPSEC"

## Short summary

One OPSEC rating the whole industry recognizes, issued by the firms that already run OPSEC audits. This RFP funds the coordinator who gets at least 6 auditing firms to agree on one scoring template and the A / AA / AAA tiers, stands up a public board of rated teams, and hands the standard to a membership body the firms own. Rated teams pay a fixed fee for their assessment, so the system pays for itself once enough teams are on the board.

## Funding goal (USD)

$150,000

## Expected duration (months)

18

## Links

https://frameworks.securityalliance.org/
https://securityalliance.org/

## Why this matters

Your keys, your devices, your multisig process, your access controls... these are just as important as your smart contracts. Every serious team already invests in OPSEC, and OPSEC audits happen all the time. But all of that work is invisible. There is no public signal that tells users, investors or partners who is actually running a tight ship.

We want to change that with a single OPSEC rating the whole industry agrees on. Think of a Moody's rating: people want one because everyone recognizes what it means. Teams that earn an A, AA or AAA get their tier on a public board. That's it, just the tier. We will never publish what a team is missing (a public list of weaknesses is a gift to attackers), and teams with unacceptable OPSEC simply don't make the board... which says something all by itself.

## In scope

This RFP pays for a coordination effort. The money buys the social work of getting the OPSEC auditing firms around one table and onto one standard. The board itself is the easy part, and could probably be vibe coded in a weekend.

Three roles, and this money funds one of them. Rated teams pay a fixed fee for their own assessment. Accredited raters get paid per rating out of the fee pool. The coordinator is what this RFP funds: the party that convenes the firms, gets them to sign one standard, builds the board and stands up the membership body.

Deliverables:

- Coordinating at least 6 OPSEC auditing companies to agree on one scoring template and the A / AA / AAA tier definitions
- Onboarding those firms as the first accredited raters, with whatever materials they need to run the template inside their existing audit flow
- A simple public board of rated teams and their tiers, with valid-until and last check-in dates... tiers only, no details, no gaps
- Standing up the membership body: the charter (one firm, one vote), how raters get certified, the verification committee, the fixed fee schedule and the pooled funding model
- The 12-month rating cycle with the six-month check-in and the event-based suspension process
- The handoff: transferring the standard, the board and the name to the membership body

Bidders are welcome to propose a different path to the same goal: a decentralized rating system that many OPSEC auditing companies co-own, with a real shot at sustaining itself long after this money is spent.

## Out of scope

- Performing the underlying OPSEC audits (the accredited firms do that)
- Publishing any team's specific weaknesses, unmet controls, or the reasons behind a tier
- A heavy platform build. The board is deliberately simple.

## Existing work

- [Security Frameworks by SEAL](https://frameworks.securityalliance.org/): the Security Alliance's open framework covering operational security, infrastructure, DevOps, incident response and more. Bidders should read it before proposing a scoring template.

## Who we expect to do this

Nobody is pre-selected. The dream candidate is a credible coordinator in the security community: someone who can bring 6+ OPSEC auditing firms to the same table and get them all to sign the same document.

Ideally the coordinator is not an OPSEC auditing firm, because whoever holds the pen on the standard walks away with an edge over the firms they convened. That is a preference, not a requirement, and it will weigh in selection. An audit firm that coordinates takes no rater role during the work and no ownership of the board. The best pitch a bidder can make is simple: here is why the other firms can trust me to run this.

Co-drafted by the submitter with TheDAO Security Fund. The submitter runs no OPSEC auditing firm and will not bid on this initiative.

## Hard requirements

1. **Six firms minimum.** At least 6 OPSEC auditing companies formally agree to the scoring template and tier definitions, and commit to issuing ratings with it.
2. **Tiers only.** The public board shows a team's tier, its valid-until date and its last check-in, and nothing else. No unmet controls, no explanations.
3. **Open and versioned.** The scoring template and tier definitions are public, open source and versioned, with changes dated and attributable, revised through a defined change process no more than once a year.
4. **Tool-agnostic.** Every tier is reachable no matter which tools or frameworks a team uses. No vendor's product is ever required.
5. **One firm, one vote.** Every founding firm gets equal governance rights in the membership body, regardless of who convened whom.
6. **Neutral name.** The standard and the board are not branded after the coordinator or any single firm.
7. **Mandatory handoff.** The standard, the board, the name and any secretariat function transfer to the membership body no later than six months after the final milestone. The coordinator keeps no veto and no unilateral control.
8. **Fixed fees, pooled.** Rated teams pay a fixed, outcome-independent fee. Fees flow to the membership body, which pays raters from the pool and funds the verification committee from it. No tier-contingent pricing.
9. **Twelve months, checked at six, suspended on events.** A rating is valid for 12 months, lapses without the six-month self-attestation and check-in, and is suspended automatically on a disclosed incident or a material change until the team is re-rated.

## Milestones

### Agreed standard - $50,000

- [ ] A public, versioned scoring template plus the A / AA / AAA tier definitions, with the change process for future revisions
- [ ] At least 6 OPSEC auditing companies formally signed on and committed to rating with it, with the signed template published
- [ ] The membership body's charter published: one firm, one vote, rater certification, the verification committee and its stipends, the fixed fee schedule, the pooled funding model, and the handoff agreement with a transfer date no later than six months after the final milestone

### Board and first ratings - $25,000

- [ ] The public board is live, showing rated teams, their tiers, valid-until dates and last check-ins, and nothing else
- [ ] At least 6 accredited firms have issued ratings inside their normal audit flow, each listed on the public board
- [ ] At least 5 teams rated end to end, with their fees paid through the membership body's pool

### Adoption evidence - $75,000 (adoption)

- [ ] At least 20 teams publicly rated on the board by accredited firms
- [ ] The six-month check-in running: every rating older than six months shows a check-in date on the board, and the event-based suspension process is live with a public change log
- [ ] The membership body running on pooled fees, with the verification committee active and its spot-check sample published, both shown on the body's public page
- [ ] A public metrics page: teams rated, tiers awarded, firms participating, check-ins completed, suspensions and renewals

## Who is likely to fund this

Ethereum Foundation | funds public goods security tooling | met once | warm intro? yes | $50,000
Safe Ecosystem Foundation | multisig OPSEC is their core risk surface | none | warm intro? no | $25,000
Security Alliance (SEAL) | published the framework this builds on | know them well | warm intro? yes | $25,000

## Contact

opsec-coalition@example.org
````



---

# Part 7. FILE: docs/submissions-inventory-2026-09-10.md

````markdown
# Structural inventory of fund.thedao.fund submissions

**Source:** `/Users/griff/Downloads/fund-thedao-submissions-2026-09-10.md` (29 submissions, exported 2026-09-10 19:07 UTC)
**Guide submitters were pointed at:** `/Users/griff/thedao-rfps/llms.txt` (skeleton at lines 40 to 80, Step 3 at lines 218 to 245)
**Format reasoning:** `/Users/griff/thedao-rfps/rfp-drafts/rfp-standard.md`, `/Users/griff/thedao-rfps/rfp-drafts/rfp-format-research.md`

This is evidence only. No format is proposed here.

**Population:** 29 submissions. By status: 14 pending, 7 approved, 7 rejected, 1 archived. By type: 20 grants, 9 RFPs. Five initiatives were submitted twice (four under an identical title, one retitled), so 29 submissions cover 24 distinct initiatives.

**Word counts of the Full details field:** median 1,704, range 187 (id 27) to 2,711 (id 19). 24 of 29 fall inside the guide's 800 to 2,500 word target. Four are under 800 (ids 27, 16, 8, 21) and one is over (id 19).

**A note on how headings were counted.** The export flattens some submissions: four bodies (ids 20, 15, 12, 11) carry the section names as plain paragraph lines rather than markdown headings, and one (id 29) uses `#` where everyone else uses `##`. Where a plain line exactly matches a skeleton section name it is counted as a heading below, with the flattening flagged.

---

## 1. Master table

### 1a. Facts

| id | Status | Type | Title (short) | Goal | Words | Header table | Indicative duration | Compliance |
|---|---|---|---|---|---|---|---|---|
| 29 | Pending | RFP | Client-verified ENS resolution | $150,000 | 1,691 | Partial (tab text, no Status row) | 9 months (the team sets the final timeline) | FULL |
| 28 | Pending | Grant | Account abstraction and mempool analytics | $30,000 | 1,704 | Yes | 3 months (the team sets the final timeline) | PARTIAL |
| 27 | Pending | Grant | Onchain Risk Map | $50,000 | 187 | No | none | NONE |
| 26 | Pending | RFP | Post-quantum wallet security | $250,000 | 2,354 | Yes | 12 months (proposers set their own timeline) | FULL |
| 25 | Pending | Grant | Phishing Dojo | $90,000 | 2,339 | Yes (unbolded labels) | 9 months; The Red Guild sets the final timeline | FULL |
| 24 | Pending | Grant | EVM compiler differential fuzzing | $75,000 | 2,341 | No | none | PARTIAL |
| 23 | Pending | Grant | xWatch exposure monitoring | $150,000 | 1,739 | Yes | 6 months (the recipient sets the final timeline) | FULL |
| 22 | Pending | RFP | Directory of Value | $185,000 | 2,460 | Yes | 12 months (proposers set their own timeline) | FULL |
| 21 | Pending | RFP | EIP-7730 clear signing descriptors | $10,000 | 308 | No | none | NONE |
| 20 | Pending | Grant | Unified Web3 OpSec platform | $250,000 | 1,242 | Partial (plain lines, not a table) | 12 months | PARTIAL |
| 19 | Pending | Grant | Fund Echidna through 2027 (v2) | $48,000 | 2,711 | Yes | 6 active development months during 2027 | FULL |
| 18 | Pending | Grant | ForensIQ incident response | $135,000 | 1,999 | No | none | PARTIAL |
| 17 | Pending | Grant | thatsRekt exploit alerts (v2) | $40,000 | 2,051 | No | none | PARTIAL |
| 16 | Pending | RFP | Closing the incentive circle on DeFi quality | $40,000 | 189 | No | none | NONE |
| 9 | Approved | Grant | Securing Ethereum with formal verification (v2) | $300,000 | 1,404 | Yes, but placed inside "Why this matters" | 12 months (Verity Labs sets the final timeline) | FULL |
| 7 | Approved | RFP | Community fuzzing tooling | $150,000 | 896 | No | none | PARTIAL |
| 6 | Approved | Grant | Privacy-preserving EDR | $300,000 | 1,101 | Yes | 12 months (the team sets the final timeline) | FULL |
| 4 | Approved | Grant | ethdebug in solc (v2) | $236,500 | 1,209 | Yes, plus an extra "Anchor backer" row | 6 to 9 months for the remaining milestones | PARTIAL |
| 3 | Approved | RFP | OPSEC ratings coalition | $150,000 | 2,019 | Yes | 18 months (the team sets the final timeline) | FULL |
| 2 | Approved | Grant | Automated EIP compliance checks | $20,000 | 1,517 | Yes | 6 months (the team sets the final timeline) | FULL |
| 1 | Approved | Grant | Formally verified Vyper compiler | $600,000 | 1,895 | Yes | 12 months (the team sets the final timeline) | FULL |
| 15 | Rejected | Grant | thatsRekt onchain hack alerts (v1) | $40,000 | 1,663 | No (all markdown flattened) | none | PARTIAL |
| 14 | Rejected | Grant | Fund Echidna through 2027 (v1) | $48,000 | 2,134 | Yes | 6 active development months during 2027 | FULL |
| 13 | Rejected | RFP | Scaling Colibri adoption | $300,000 | 2,174 | No | none | NONE |
| 12 | Rejected | Grant | Colibri production infrastructure (copy B) | $320,000 | 1,847 | No | none | NONE |
| 11 | Rejected | Grant | Colibri production infrastructure (copy A) | $320,000 | 1,847 | No | none | NONE |
| 10 | Rejected | Grant | Securing Ethereum with formal verification (v1) | $300,000 | 1,100 | No | none | PARTIAL |
| 8 | Rejected | RFP | Secure EEZ smart contracts | $250,000 | 227 | No | none | NONE |
| 5 | Archived | Grant | ethdebug in solc (v1) | $236,438 | 1,263 | Yes, plus an extra "Sponsor funding" row | 6 to 9 months for the remaining milestones (proposers set their own timeline) | PARTIAL |

**Compliance scoring used above.** FULL means every required skeleton section is present, named as the guide names it for that type, and in skeleton order. Required sections are Why this matters, the team section (Who we expect to do this for RFPs, The recipient for grants), Scope, Hard requirements, Milestones (draft), Milestone review and acceptance, Process. What this actually pays for and Existing work are optional, so dropping them costs nothing. PARTIAL means most required sections are present but at least one is missing, renamed, reordered, or the submitter appended non-skeleton top-level sections. NONE means the submitter used their own structure. The closing line and the header table are graded separately (sections 1a and 3), not folded into this score.

Counts: 12 FULL, 10 PARTIAL, 7 NONE.

### 1b. Exact ordered top-level headings in the body

| id | Ordered headings |
|---|---|
| 29 | Why this matters, What this actually pays for, Who we expect to do this, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 28 | *Grant: Account Abstraction and Mempool Security Analytics* (H1), Why this matters, **What this grant actually pays for**, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process, **Budget summary**, **Team** |
| 27 | (none; four numbered roadmap bullets, no headings at all) |
| 26 | *RFP: Wallet Security for Post-Quantum Ethereum* (H1), Why this matters, What this actually pays for, Who we expect to do this, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 25 | *Grant: Phishing Dojo Ethereum Security Training* (H1), Why this matters, What this actually pays for, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 24 | Why this matters, What this actually pays for, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, **Milestones** (no "(draft)"), Milestone review and acceptance, Process |
| 23 | *Grant: xWatch...* (H1), Why this matters, What this actually pays for, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 22 | *RFP: Directory of Value...* (H1), Why this matters, What this actually pays for, Who we expect to do this, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft) with a **Deliverables:** label inside each of the 6 milestones, Milestone review and acceptance, Process |
| 21 | (none; one bolded run-in line, "Scope of work for teams taking this on:") |
| 20 | Why this matters, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft). **All as plain text lines, not headings. Milestone review and acceptance and Process are absent.** |
| 19 | *Grant: Fund Echidna Development Through 2027* (H1), Why this matters, What this actually pays for, The recipient, Existing work (with a nested **Example roadmap outcomes** H3), Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 18 | Why this matters, What this actually pays for, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, **Milestones** (no "(draft)"), Milestone review and acceptance, Process |
| 17 | *Grant: thatsRekt Public Exploit Alert Network for EVM.* (H1), Why this matters, What this actually pays for, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 16 | (none; two run-in questions, "What exactly gets built?" and "Why does Ethereum security need it?") |
| 9 | Why this matters (header table sits inside it), What this actually pays for, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 7 | **Why Fuzzing?**, **Current State**, **What makes a strong applicant?**, Scope (In scope, Out of scope as H3), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 6 | Why this matters, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 4 | Why this matters, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, **Milestones** (no "(draft)"), Milestone review and acceptance, Process, **Budget summary**, **Team** |
| 3 | Why this matters, What this actually pays for, Who we expect to do this, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 2 | Why this matters, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 1 | Why this matters, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 15 | Why this matters, What this actually pays for, The recipient, Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process. **All as plain text lines, no markdown survived.** |
| 14 | *Grant: Fund Echidna Development Through 2027* (H1), Why this matters, What this actually pays for, The recipient, Existing work (with nested **Example roadmap outcomes**), Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process |
| 13 | **Why this is an RFP**, **Objective**, Scope (five numbered workstreams, no In/Out lists), Hard requirements, **Budget framework**, **Suggested milestone structure**, **Relationship to the companion Grant**, **Expected outcome** |
| 12 | **Grant objective**, **Open infrastructure and commercial extensions**, Scope (four numbered workstreams), **Milestones and budget** (each with a **Deliverables:** label), **Total funding requested**, **Why corpus.core**, **Licensing and sustainability**, **Expected impact**, **Project references** |
| 11 | Identical to 12, byte for byte |
| 10 | What this actually pays for, **Who we expect to do this** (a grant using the RFP section name), Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process. **Why this matters and Existing work are absent.** |
| 8 | (none) |
| 5 | Why this matters, **Who we expect to do this** (a grant using the RFP section name), Existing work, Scope (In scope, Out of scope), Hard requirements, Milestones (draft), Milestone review and acceptance, Process, **Budget summary**, **Team** |

### 1c. Duplicates

Five initiatives were submitted twice. Ten of the 29 rows are duplicates.

| Initiative | Copies | Relationship |
|---|---|---|
| Colibri: Production Infrastructure for Trustless Ethereum Access | id 11 (rejected), id 12 (rejected) | Byte identical, 14,609 characters each, including the summary field. A straight double submission. |
| Securing Ethereum with Formal Verification | id 10 (rejected), id 9 (approved) | Same project, rebuilt into the skeleton. v1 has no Why this matters, no Existing work, no header table; v2 adds all three and fixes the section name to The recipient. |
| Source-Level Debugging for Solidity: ethdebug in solc | id 5 (archived), id 4 (approved) | Same project. v1 opens with a note asking for feedback on the format itself, calls the recipient section "Who we expect to do this", uses a "Sponsor funding" row and $236,438; v2 renames it "Anchor backer", rounds the milestone amounts and lands on $236,500. |
| Fund Echidna Development Through 2027 | id 14 (rejected), id 19 (pending) | Same structure, resubmitted with a repriced milestone split ($16,000 x 3 becomes $15,600 / $15,600 / $16,800), a third roadmap outcome and 577 more words. Both total $48,000. |
| thatsRekt | id 15 "thatsRekt - onchain hack alerts for the public good." (rejected), id 17 "thatsRekt: EVM exploit alerts for the public good." (pending) | Same project, retitled. v1 arrived with all markdown flattened. v2 restores headings, adds the guardian handles, and repriced the milestones to $18,000 / $10,000 / $17,000. |

---

## 2. Heading frequency

### Grants (n = 20)

| Heading, normalized | Count | Variants seen |
|---|---|---|
| Scope | 19 | "Scope" x19 |
| In scope | 17 | "In scope" x17, all as the bold run-in label the guide specifies, never promoted to a heading |
| Out of scope | 17 | "Out of scope" x17 |
| Hard requirements | 17 | "Hard requirements" x17 |
| Why this matters | 16 | "Why this matters" x16 |
| Existing work | 16 | "Existing work" x16 |
| Milestone review and acceptance | 16 | "Milestone review and acceptance" x16 |
| Process | 16 | "Process" x16 |
| The recipient | 15 | "The recipient" x15 |
| Milestones (draft) | 14 | "Milestones (draft)" x14 |
| What this actually pays for | 11 | "What this actually pays for" x10, "What this grant actually pays for" x1 (id 28) |
| Milestones, no "(draft)" | 3 | "Milestones" x3 (ids 24, 18, 4) |
| Budget summary | 3 | ids 28, 4, 5 |
| Team | 3 | ids 28, 4, 5 |
| Who we expect to do this (used by a grant) | 2 | ids 10, 5 |
| What already exists | 2 | ids 12, 11 |
| Milestones and budget | 2 | ids 12, 11 |
| Grant objective | 2 | ids 12, 11 |
| Why corpus.core | 2 | ids 12, 11 |
| Open infrastructure and commercial extensions | 2 | ids 12, 11 |
| Total funding requested | 2 | ids 12, 11 |
| Licensing and sustainability | 2 | ids 12, 11 |
| Expected impact | 2 | ids 12, 11 |
| Project references | 2 | ids 12, 11 |
| Budget | 2 | ids 12, 11 |
| Deliverables: | 8 | ids 12, 11 (four each, one per milestone) |
| Example roadmap outcomes (H3 under Existing work) | 2 | ids 19, 14 |

### RFPs (n = 9)

| Heading, normalized | Count | Variants seen |
|---|---|---|
| Scope | 6 | "Scope" x6 |
| Hard requirements | 6 | "Hard requirements" x6 |
| Milestones (draft) | 5 | "Milestones (draft)" x5 |
| Milestone review and acceptance | 5 | "Milestone review and acceptance" x5 |
| Process | 5 | "Process" x5 |
| In scope / Out of scope | 5 | H2 bold in 29, 26, 22, 3; H3 in 7; absent in 13 |
| Why this matters | 4 | "Why this matters" x4 |
| What this actually pays for | 4 | "What this actually pays for" x4 |
| Who we expect to do this | 4 | "Who we expect to do this" x4 |
| Existing work | 4 | "Existing work" x4 |
| Deliverables: | 6 | id 22, one per milestone |
| Why Fuzzing? | 1 | id 7, in place of Why this matters |
| Current State | 1 | id 7, second half of Why this matters |
| What makes a strong applicant? | 1 | id 7, in place of Who we expect to do this |
| Why this is an RFP | 1 | id 13 |
| Objective | 1 | id 13 |
| Budget framework | 1 | id 13 |
| Suggested milestone structure | 1 | id 13, in place of Milestones (draft) |
| Relationship to the companion Grant | 1 | id 13 |
| Expected outcome | 1 | id 13 |

### What got dropped, renamed and added

**Most often dropped.** Counting only the 22 submissions that used the skeleton at all (excluding the seven graded NONE):

| Section | Dropped by | Notes |
|---|---|---|
| What this actually pays for | 7 of 22 (ids 20, 6, 4, 2, 1, 5, and it is absent from 7) | The guide marks this optional, and five of the seven that dropped it are approved or archived. Dropping it costs nothing. |
| Existing work | 2 of 22 (ids 10, 7) | Also optional. Everyone else kept it, including every approved grant. |
| Milestone review and acceptance | 1 of 22 (id 20) | 20 simply stops after Milestones. |
| Process | 1 of 22 (id 20) | Same. |
| Why this matters | 2 of 22 (ids 10, 7) | 10 opens straight into What this actually pays for. 7 splits it into two renamed sections. |
| Header table | 8 of 22 (absent in 24, 18, 17, 7, 15, 10; reproduced as unrendered plain text in 29, 20) | The single most-dropped element in the whole skeleton. |
| Closing line | absent in 17 of 29 | See section 3. |

**Most often renamed.**

1. **Milestones (draft) becomes Milestones.** Three grants (24, 18, 4) dropped "(draft)" from the heading, and 24 also cut the first sentence of the preamble, so the word "draft" appears nowhere near its milestones.
2. **The recipient becomes Who we expect to do this.** Two grants (10, 5) used the RFP name. Both are rejected or archived, and both were later resubmitted with "The recipient" (ids 9 and 4).
3. **What this actually pays for becomes What this grant actually pays for.** One grant (id 28).
4. **The whole opening pair renamed.** Id 7 replaced Why this matters with "Why Fuzzing?" plus "Current State", and Who we expect to do this with "What makes a strong applicant?". It is approved.

**Non-skeleton headings submitters added on their own.**

| Added heading | Submissions | What it holds |
|---|---|---|
| Team | 28, 4, 5 | Named people with roles and years of experience, plus a track record block. All three also have a recipient section, so this is additional, not a substitute. |
| Budget summary | 28, 4, 5 | A milestone-to-cost table repeating the milestone headings. |
| Deliverables: | 22, 12, 11 | A label inside every milestone, above the criteria list. |
| Example roadmap outcomes | 19, 14 | Two linked GitHub issues with their own acceptance evidence, nested under Existing work. |
| Budget framework, Suggested milestone structure, Expected outcome, Relationship to the companion Grant, Why this is an RFP, Objective | 13 | A complete alternative skeleton. |
| Grant objective, What already exists, Milestones and budget, Total funding requested, Why corpus.core, Licensing and sustainability, Expected impact, Project references | 12, 11 | A second complete alternative skeleton. |
| Budget category table (inside What this actually pays for) | 25 | Percentage split of the $90,000 across engineering, infrastructure, design, security. |

Nobody used a heading called Background, Timeline or Risks. Timeline material appeared inside Milestones or Process instead (see section 6).

---

## 3. Canned text audit

Six blocks, checked against the exact wording in `llms.txt`. Y means present verbatim or with a trivial edit. P means paraphrased or materially rewritten. Blank means absent.

| id | Status | Window row | Milestones preamble | Disclosure sentence | Review section | Process section | Closing line |
|---|---|---|---|---|---|---|---|
| 29 | Pending | Y (30 days, RFP) | Y | Y | Y | Y | |
| 28 | Pending | Y (15 days, grant) | Y | Y | Y | Y | |
| 27 | Pending | | | | | | |
| 26 | Pending | Y (15 days, RFP) | Y | Y | Y | Y | |
| 25 | Pending | Y (15 days, grant) | P | | P | P | |
| 24 | Pending | | P | Y | Y + extra bullet | Y (30 days) | |
| 23 | Pending | Y (15 days, grant) | Y | Y | Y | Y | Y |
| 22 | Pending | Y (15 days, RFP) | Y | Y | Y | Y | Y |
| 21 | Pending | | | | | | |
| 20 | Pending | Y (15 days, grant, plain text) | P | P | | | |
| 19 | Pending | P ("30 days, for finalizing the plan") | Y + extra | Y | Y | Y (30 days) | Y |
| 18 | Pending | | Y + extra | | P (third bullet missing) | Y (30 days) | |
| 17 | Pending | | Y | Y | Y | Y (30 days) | |
| 16 | Pending | | | | | | |
| 9 | Approved | P ("15 days, for finalizing the plan") | P (last sentence cut) | Y | Y | Y (30 days) | Y + telegram link |
| 7 | Approved | | P | | P | P (14-day window, 10-day selection, donor-claimable clause) | |
| 6 | Approved | Y (15 days, grant) | Y | Y | Y | Y | Y |
| 4 | Approved | P ("None, grant already in progress") | P | Y | P (named reviewers) | P (no 50% bullet, custom stall wording) | Y |
| 3 | Approved | Y (30 days, RFP) | Y | Y | Y | Y | Y |
| 2 | Approved | Y (15 days, grant) | Y | Y | Y | Y | Y |
| 1 | Approved | Y (15 days, grant) | Y | Y | Y | Y | Y |
| 15 | Rejected | | Y | Y | Y | Y (30 days) | |
| 14 | Rejected | P ("30 days, for finalizing the plan") | Y | Y | Y | Y (30 days) | Y |
| 13 | Rejected | | | | | | |
| 12 | Rejected | | | | | | |
| 11 | Rejected | | | | | | |
| 10 | Rejected | | | | Y | Y (30 days) | Y + telegram link |
| 8 | Rejected | | | | | | |
| 5 | Archived | P ("None, pure grant.") | P | | P (reviewer not yet named) | P (no 50% bullet, custom stall wording) | Y |

**Totals.** Window row present in 16 of 29 (11 verbatim, 5 reworded). Milestones preamble present in 20 (14 verbatim, 6 paraphrased). Disclosure sentence present in 17 (16 verbatim, 1 paraphrased). Review section present in 21 (16 verbatim, 5 paraphrased). Process section present in 21 (17 verbatim, 4 paraphrased). Closing line present in 12 of 29, absent in 17.

**Submissions that paraphrased rather than copied.**

- **id 25 (Phishing Dojo)** rewrote three of the six blocks in its own voice. Its milestone preamble is a budget statement, "The following delivery plan covers nine months, preferably beginning in November or December 2026." Its review section becomes prose about confidentiality. It has no disclosure sentence at all.
- **id 7 (community fuzzing, approved)** rewrote the Process bullets with different numbers and this clause: "unused funds become claimable by the donors who backed the RFP for 30 days". That is the exact wording the legal rules in `llms.txt` forbid, and it sits on a live approved RFP.
- **id 20 (Web3 OpSec)** paraphrased the disclosure into a promise: "Auditware will disclose their relationships to existing OpSec tooling and firms in their proposal." It has no review or process section.
- **id 24 (compiler fuzzing)** kept the preamble but cut its first sentence, so the milestones never say they are a draft. It also appended a fourth bullet to the review section about embargoed evidence.
- **id 4 and id 5 (ethdebug)** rewrote the preamble, the review section and the Process section, because the work is already funded and under way. Neither carries the 50% advance bullet.
- **id 9 (Verity, approved)** cut the "If you think this draft is wrong" sentence from the preamble and reworded the window row to "15 days, for finalizing the plan".
- **id 18 (ForensIQ)** copied the review section but dropped the third bullet about the reviewer's fee.

**Window value drift.** Eight submissions state a 30-day proposal window in Process where the guide sets 15 days for grants (ids 24, 19, 18, 17, 9, 15, 14, 10). Two RFPs state 15 days where the guide sets 30 (ids 26, 22). One RFP states 14 days (id 7). Three submissions replace the window with a status note (ids 19 and 14, "30 days, for finalizing the plan"; ids 4 and 5, "None"). Id 9's table says 15 days while its Process says 30 days, a contradiction inside one approved document.

---

## 4. Milestones audit

| id | Milestones | Adoption last? | $ in heading | Criteria as checkboxes | Existing work | What this pays for | Team background lives in |
|---|---|---|---|---|---|---|---|
| 29 | 4 | Yes, "4 - Adoption by wallets and dapps" | Yes | 11, written `[ ]` with no dash | Yes | Yes | Who we expect to do this |
| 28 | 3 | Yes, "3 - Open data, research, and adoption" | Yes | 13 | Yes | Yes | The recipient **and** a separate Team section |
| 27 | 0 (a four-step "roadmap" list) | n/a | No | No | No | No | Nowhere |
| 26 | 4 | Yes, "D - Adoption evidence" | Yes | 0, asterisk bullets | Yes | Yes | Who we expect to do this |
| 25 | 3 | Yes, "3 - Public adoption and evaluation" | Yes | 11 | Yes | Yes | The recipient, with named people and years of experience |
| 24 | 5 | **No.** Last is "E - Corpus management and analysis". There is no adoption milestone. | Yes | 29 | Yes | Yes | The recipient, with a four-client track record list |
| 23 | 4 | **No.** "3 - Verified adoption" then "4 - Continued operation and maintenance" | Yes | 12 | Yes | Yes | The recipient |
| 22 | 6 | Yes, "6 - Stewardship and Adoption" | Yes | 27 | Yes | Yes | Who we expect to do this, broken down per milestone |
| 21 | 0 | n/a | No | No | No | No | Nowhere |
| 20 | 3 (C splits into two tranches) | Yes, "C - Adoption and sustainability" | Yes | 0, plain lines | Yes | No | The recipient |
| 19 | 3 | Yes, "3 - Adoption and final handoff" | Yes | 18 | Yes | Yes | The recipient |
| 18 | 4 | Yes, "4 - Independent adoption and measured results" | Yes | 20 | Yes | Yes | The recipient |
| 17 | 3 | Yes, "3 - Proven adoption" | Yes | 13 | Yes | Yes | The recipient |
| 16 | 0 | n/a | No | No | No | No | Nowhere |
| 9 | 3 | Yes, "3 - $5B TVL covered by Verity-verified properties" | Yes | 10 | Yes | Yes | The recipient |
| 7 | 2 | Yes, "B - Ecosystem Adoption" | Share of budget, "50% (indicatively $75,000)" | 0, plain bullets | No | No | What makes a strong applicant? (a wish list, not a team) |
| 6 | 3 | Yes, "C - Adoption, hardening, and endorsement" | Yes | 14 | Yes | No | The recipient |
| 4 | 5 | **No.** Last is "4 - Optimized pipeline". No adoption milestone. | Yes, plus a delivery date in each heading | 10 | Yes | No | The recipient **and** a separate Team section |
| 3 | 3 | Yes, "C - Adoption evidence" | Yes | 10 | Yes | Yes | Who we expect to do this |
| 2 | 5 | Yes, "5 - Majority client adoption" | Yes | 14 | Yes | No | The recipient |
| 1 | 5 | Yes, "E - Adoption and ecosystem impact" | Yes | 25 | Yes | No | The recipient |
| 15 | 3 | Yes, "3 - Proven adoption" | Yes, in plain text | 0, markdown flattened | Yes | Yes | The recipient |
| 14 | 3 | Yes, "3 - Roadmap completion, adoption, and final handoff" | Yes | 16 | Yes | Yes | The recipient |
| 13 | 5 | **No.** "Milestone 1 - Application Adoption Program" is first; last is Developer Platform Expansion. | No, a budget range sits below each heading | 0 | No | No | Nowhere |
| 12 | 4 | Yes, "Milestone 4 - Adoption and Ecosystem Integration" | No, "Budget: $80,000" on the next line | 0 | What already exists | No | Why corpus.core, near the end |
| 11 | 4 | Same as 12 | No | 0 | What already exists | No | Why corpus.core, near the end |
| 10 | 3 | Yes, "3 - $5B TVL secured with Verity" | Yes | 10 | No | Yes | Who we expect to do this |
| 8 | 0 | n/a | No | No | No | No | Nowhere |
| 5 | 5 | **No.** Last is "4 - Optimized pipeline". | Yes, bold pseudo-headings | 11 | Yes | No | Who we expect to do this **and** a separate Team section |

**Milestone counts.** 25 submissions have milestones. Median 4, mean 3.8, range 2 (id 7) to 6 (id 22). Three milestones is the single most common answer (11 of 25). Four submissions have none at all (ids 27, 21, 16, 8).

**Adoption milestone.** 20 of 25 put an adoption milestone last. Five do not: ids 24, 4 and 5 have no adoption milestone at all, id 23 buries adoption at position 3 of 4, and id 13 puts the adoption program first of five.

**Dollar amounts in headings.** 21 of 25 carry the amount in the milestone heading. Id 7 uses a percentage plus an indicative dollar figure. Ids 12, 11 and 13 put the amount on the line below the heading. Ids 4 and 5 add a target date to the heading as well ("$33,000 (target: October 2026)").

**Checkbox criteria.** 17 of 25 use `- [ ]`. Id 29 writes `[ ]` with no bullet dash, which does not render as a task list. Seven use plain bullets or plain lines: ids 26, 20, 7, 15, 13, 12, 11.

**Arithmetic.** Milestone amounts sum to the funding goal in 24 of 25 cases. **Id 17 does not: $18,000 + $10,000 + $17,000 = $45,000 against a $40,000 goal.** Its rejected predecessor id 15 summed correctly to $40,000.

**Unresolved placeholders.** Two pending submissions ship placeholders in acceptance criteria: id 22 has ten (`[N]`, `[M]`, `[P]`, `[Q]`, `[X]`), explicitly labelled as left for the proposer; id 20 has six (`[10]`, `[25]`, `[100]`, `[5]`, `[6]`, plus a bracketed framework list).

**Where team background ended up.** The recipient in 15 grants. Who we expect to do this in 4 RFPs plus 3 grants that used the RFP name (ids 10, 5, and 5 again in its Team section). A dedicated Team section in 3 (ids 28, 4, 5), all of which also have a recipient section. A late "Why corpus.core" section in 2 (ids 12, 11). Nowhere at all in 6 (ids 27, 21, 16, 13, 8, and id 7 which describes a hypothetical bidder instead).

---

## 5. Grant versus RFP differences observed

### What grant submitters wrote that RFP submitters did not

1. **A head-start defence.** Every grant that used the skeleton opens The recipient with a justification. Id 24: "That is not a head start on paper, it is a head start with public issue numbers attached." Id 28 labels it outright: "The head start that makes a grant fit rather than an open RFP". No RFP contains this move.
2. **Named individuals with roles and years.** Ids 28, 25, 4, 5, 17 and 19 name people. Id 25: "Manu Marquez leads software architecture and engineering, drawing on 14 years of frontend and full-stack experience." RFPs describe a bidder profile instead.
3. **A Team section and a Budget summary table.** Only grants added these (ids 28, 4, 5).
4. **Pricing against a from-scratch build.** Id 24: "this grant is priced below what the same platform would cost from scratch." No RFP argues price this way, because the bidding is supposed to.
5. **Requests for exceptions to the hard requirements.** Id 25: "We request an exception to the open-source code requirement." Only a named recipient can ask for this.
6. **Existing infrastructure inventories.** Ids 20, 12, 11 and 17 list what already runs today. Id 20's Existing work runs to six paragraphs of live product features.

### What RFP submitters wrote that grant submitters did not

1. **An explicit "nobody is pre-selected" line.** Ids 29, 26, 22 and 3 all open the team section with it. Id 26: "Nobody is pre-selected. Bidding opens once the RFP is fully funded."
2. **A picture of the winning bidder.** Id 7's whole team section is a bidding brief: "The strongest bidder is a team that has run continuous fuzzing at scale before, over months rather than for the duration of an audit."
3. **Instructions to bidders inside milestones.** Id 26 puts bid instructions inside Milestone C: "Bids must specify benchmark devices, environments, transaction scenarios, and capacity assumptions". Id 22 leaves numbered placeholders for bidders to fill.
4. **Skill requirements mapped per milestone.** Id 22 breaks Who we expect to do this into which skills each milestone needs, which no grant does.

### Grants that read like a team pitch

- **id 20 (Web3 OpSec, $250,000).** The Existing work section is a product feature tour: compliance tracking, adversary reconnaissance, on-chain monitoring, compromise monitoring, training, endpoint integration. It stops after Milestones, with no review or process section, and the whole document is plain text with no headings. This is a company deck poured into a form.
- **id 12 and id 11 (Colibri, $320,000).** Own skeleton throughout, ending with "Expected impact", "Project references" and a slogan, "Don't trust. Verify." The team justification arrives near the end under "Why corpus.core", after the milestones and the budget.
- **id 27 (Onchain Risk Map, $50,000).** 187 words, four roadmap bullets, no headings. It reads like an abstract: "We plan the following roadmap:".
- **id 25 (Phishing Dojo).** Uses the skeleton faithfully, then rewrites the boilerplate into the team's own voice, including an honest anti-pitch: "Prospective organizational users have asked us to build the platform, but have not yet used it."

### Pitches forced into the RFP-shaped skeleton awkwardly

- **id 13 (Scaling Colibri, RFP, $300,000).** Opens with a section justifying the type itself, "Why this is an RFP", then gives a budget as five ranges ($100,000 to $150,000 and so on) where the guide demands one flat number, and targets "20-30 real application integrations", a range in an acceptance criterion. It also writes the fund's name as "TheDAOFund" seven times.
- **id 21 (EIP-7730 descriptors, RFP, $10,000).** A scope of work with no milestones, no criteria and no team section, ending on "the exact list/count to be scoped with the bidding team". The RFP shape asked for a milestone plan and the submitter had a work order.
- **id 16 (DeFi incentive circle, RFP, $40,000).** 189 words answering the interview questions verbatim as prose: "What exactly gets built?  The output will be a marketing report."
- **id 8 (Secure EEZ, RFP, $250,000).** 227 words, no headings, no milestones. It calls itself a grant in its own body while the Type field says RFP.
- **id 23 (xWatch, grant).** Follows the skeleton exactly, then has to admit inside it that the head start does not exist yet: "This initial submission does not claim a completed xWatch-specific prototype." A skeleton built to justify a head start had no place to say there is not one.

---

## 6. Duration

### Every place a duration appears

| Place | Submissions | Notes |
|---|---|---|
| Indicative duration table row | 16 (ids 29, 28, 26, 25, 23, 22, 20, 19, 9, 6, 4, 3, 2, 1, 14, 5) | The only place most initiatives state a duration. Id 20's row is plain text rather than a table cell. |
| Process section | 2 (ids 25, 5) | Neither states a length. Id 25 states a start month ("begin in November or December 2026"), id 5 describes milestone sequencing. |
| Milestone headings | 2 (ids 4, 5) | Target delivery months and years inside each heading: "(target: October 2026)", "(target: March 2027)", "(target: August 2027)". |
| Milestone preamble | 4 (ids 25, 23, 18, 19) | Id 23 gives per-milestone month targets. Id 18 splits six months into four development and two pilot. Id 25 maps months 1 to 3, 4 to 6, 7 to 9 onto its three milestones. |
| Milestone criteria | 5 (ids 19, 17, 23, 15, 18) | "By the end of the fourth funded month", "12 months of opex funded", "at least four weekly monitoring updates". |
| Hard requirements | 3 (ids 26, 18, 17) | Maintenance windows: 24 months after the final milestone (26), 12 months after the pilot (18), a plan past month 12 (17). |
| Prose in Why this matters or Existing work | 3 (ids 26, 3, 25) | Id 26 cites an 18-month vendor integration lag. Id 3 cites "12 to 18 months of runway". Id 25 cites a November 2024 release date. |

### Months claimed per initiative

| id | Stated duration | Stated once, or contradicted |
|---|---|---|
| 28 | 3 months | Once, table only. Its summary also says "a 3-month expansion". Consistent. |
| 23 | 6 months | Consistent across four places: the table, the milestone preamble month targets (2, 3, 5, 6), hard requirement 7 and milestone 4. The most consistently dated submission in the set. |
| 2 | 6 months | Once, table only. |
| 19 / 14 | "6 active development months during 2027" | Repeated four times, all agreeing, and explicitly non-consecutive. |
| 18 | No table row | The only statement is inside the milestone preamble: "The six-month plan allocates roughly four months to development and two to pilots". A reader has to hunt for it. |
| 29 | 9 months | Once, table only. |
| 25 | 9 months | Stated three times (table, milestone preamble, Process) and split across milestones as months 1 to 3, 4 to 6, 7 to 9. All consistent. |
| 26 | 12 months | Table says 12 months. Hard requirement 6 and milestone D both demand 24 months of maintenance after the final milestone, so the funded commitment runs to at least 36 months. Not a contradiction, but the table understates the obligation. |
| 22 | 12 months | Once, table only. |
| 20 | 12 months | Once, in a plain text line. |
| 9 | 12 months | Table says 12 months. Nothing else dates the work. |
| 6 | 12 months | Once, table only. |
| 1 | 12 months | Once, table only. |
| 3 | 18 months | Table says 18 months. The body then says "The budget is sized for 12 to 18 months of runway on purpose", a softer and different number. It also carries a separate 12-month rating validity cycle, which is a product property, not the project duration. |
| 4 | "6 to 9 months for the remaining milestones" | Contradicted by its own milestone headings, which target October 2026, March 2027 and August 2027. From a September 2026 approval that is roughly 11 to 12 months, not 6 to 9. |
| 5 | "6 to 9 months for the remaining milestones" | Same shape as id 4, without the dated headings. |
| 24, 7, 27, 21, 16, 13, 12, 11, 10, 8 | No duration anywhere | Ten submissions never state how long the work takes, including id 24 ($75,000, 2,341 words) and the approved id 7 ($150,000). |
| 17, 15 | No project duration | Both state a 12-month opex horizon inside a milestone criterion and a hard requirement, but never say how long the funded work runs. |

**Summary.** 17 of 29 state a project duration somewhere. 16 of those use the table row; id 18 is the only one that states it without a table, buried in a milestone preamble. Of the 17, two contradict themselves (ids 4 and 3). The most common value is 12 months (6 initiatives), then 6 months (4), then 9 months (2), then 3 months, 18 months and "6 to 9 months" (1 each).

---

## 7. Signals from status

**Approved (7: ids 9, 7, 6, 4, 3, 2, 1).**

- Median 1,404 words, the shortest of any group, range 896 to 2,019. None exceeds 2,100 words.
- 6 of 7 carry the closing line. 6 of 7 carry the header table (id 7 does not).
- 5 of 7 are graded FULL. The two PARTIAL cases are id 7, which renamed the first two sections, and id 4, which had already started work and rewrote Process to say so.
- 5 of 7 dropped "What this actually pays for". Approved submissions are the least likely to use it.
- Every approved grant has a recipient section with a named team, and every one of them names existing work with links.
- 6 of 7 have an adoption milestone last. The exception is id 4, whose work was already scoped and part-funded before the board existed.
- Two approved documents carry defects: id 7 contains the donor-claimable clause that the legal rules forbid, and id 9 states a 15-day window in its table and a 30-day window in its Process.

**Rejected (7: ids 15, 14, 13, 12, 11, 10, 8).**

- Four of the seven are duplicates or near-identical resubmissions: id 11 and id 12 are byte-identical to each other, id 10 was resubmitted as the approved id 9, id 14 was resubmitted as the pending id 19, and id 15 was resubmitted as the pending id 17. That accounts for five of the seven.
- The remaining two are id 13 (an RFP with its own skeleton, range budgets and no milestone criteria) and id 8 (227 words, no structure, calls itself a grant while typed as an RFP).
- Only 1 of 7 carries a header table (id 14). Only 2 of 7 carry the closing line (ids 14, 10).
- 4 of 7 are graded NONE, versus 0 of 7 among approved.
- **The text supports exactly two rejection patterns: duplicate or superseded submissions (ids 11, 12, 10, 14, 15), and off-format or under-specified submissions (ids 13, 8). Nothing in the text explains a rejection beyond those two, and no rejection reason is recorded in the export.**

**Pending (14).**

- Median 1,869 words, the widest spread of any group, from 187 (id 27) to 2,711 (id 19).
- 6 of 14 are graded FULL, 5 PARTIAL, 3 NONE.
- Only 3 of 14 carry the closing line (ids 23, 22, 19), against 6 of 7 among approved. The closing line is the clearest single discriminator between the approved batch and the incoming batch.
- 8 of 14 carry the header table in some form; 6 do not (ids 27, 24, 21, 18, 17, 16).
- Two carry unresolved placeholders (ids 22 and 20). One has milestone amounts that do not sum to the goal (id 17).

**Archived (1: id 5).** The first ethdebug draft, superseded by the approved id 4. It opens with a note asking readers for feedback on the format itself, which is the only submission that does.

---

## 8. Observations for the redesign

1. **The header table is the most-dropped element in the skeleton.** 13 of 29 submissions have no table, and two more (ids 29, 20) reproduce the rows as plain text that never renders. Every field in it (status, budget, window, duration) is data the board already knows or could ask for as a form field.
2. **The proposal window row carries no information the submitter chose.** Where it survives, 11 of 16 copy the canonical string verbatim; the five exceptions are all cases where the standard window did not apply (ids 19, 14 and 9, "for finalizing the plan"; ids 4 and 5, "None"). It is a policy constant, not proposal content, and id 9 proves it can drift out of sync with its own Process section.
3. **Duration is stated once or not at all.** 12 of 29 never state a project duration, 16 state it in the table row, and two of the initiatives that state it more than once contradict themselves (ids 4, 3). A required page-level field with one number would close this and free the table.
4. **Three submissions built a Team section the skeleton does not ask for, and all three also filled in the recipient section.** Ids 28, 4 and 5 name people, roles, years of experience and a track record. The recipient section asks "why this team", so the submitters had nowhere to put "who this team is".
5. **Prior work is close to universal and its heading is not.** 22 of 29 name existing work with links, under "Existing work" (16 grants, 4 RFPs) or "What already exists" (ids 12, 11). Six of the seven approved submissions carry it; only id 7 does not. The guide marks it optional, and in practice it is the one thing almost everybody supplies.
6. **The recipient section does double duty and breaks under strain.** Id 23 had to use it to admit the head start does not exist yet: "This initial submission does not claim a completed xWatch-specific prototype." Id 25 used it to request an exception to a hard requirement. Neither belongs in a section named for the team.
7. **Grant submitters keep re-explaining why a grant is a grant.** Ids 24, 28, 19, 17, 9 and 20 all argue the head start in prose inside The recipient. Id 13 built a whole section called "Why this is an RFP". The type justification is a fixed question with a fixed shape and reads like a form field trying to escape.
8. **"What this actually pays for" is the section most likely to be dropped by successful submitters.** 5 of 7 approved documents skip it (ids 6, 4, 2, 1, 7). Where it does appear it is usually a restatement of Scope. Id 24 is the exception and uses it well, flagging the unglamorous line item: "Reducing it to a minimal reproducer... that is slow human work".
9. **Milestone acceptance criteria are the substance and they are formatted inconsistently.** 17 of 25 use `- [ ]`. Id 29 uses `[ ]` with no dash so nothing renders. Ids 26, 20, 7 and 15 use plain bullets or plain lines. Ids 12, 11 and 13 use a "Deliverables:" list closed by a separate "Acceptance:" sentence. Ids 22, 12 and 11 add a "Deliverables:" label the skeleton never mentions.
10. **The adoption-last rule held 20 times out of 25 and failed in a consistent way.** The three submissions with no adoption milestone at all (ids 24, 4, 5) are all continuations of work already in flight, where the deliverable is a compiler feature rather than a product anyone adopts. The rule assumes an adoptable artifact.
11. **Nothing in the flow checks arithmetic.** Id 17's milestones sum to $45,000 against a $40,000 goal, and it is pending. A form that adds up milestone amounts and compares them to the funding goal would have caught it at submission.
12. **Placeholders reach the board.** Ids 22 and 20 carry 16 unresolved brackets between them in acceptance criteria, one of them explicitly labelled "left for the proposer to replace with a concrete, defensible number in their response". Both are pending.
13. **Markdown does not survive the paste.** Ids 20, 15, 12 and 11 lost every heading, every bold and every list marker. Id 15 was rejected and resubmitted as id 17 with formatting intact, which is a full round trip spent on paste fidelity. Ids 12 and 11 are byte-identical duplicates, which a submit-flow check on identical bodies would have blocked.
14. **The boilerplate blocks travel well and the closing line does not.** Milestone review and Process are reproduced verbatim in 16 and 17 submissions respectively, but the closing line appears in only 12 of 29 and in only 3 of 14 pending. It sits after a horizontal rule at the very end, which is where copies get truncated. It is board furniture, not proposal content.
15. **Under-400-word submissions are a distinct class, not bad long submissions.** Ids 27, 16, 8 and 21 are 187 to 308 words with no headings, no milestones and no team. Two of them (16, 8) answer the interview questions in the guide as plain prose. They needed a different intake, not a longer version of the same one.

---

## Appendix: files and method

- Parsing and counting scripts used to produce every number above: `/private/tmp/claude-501/-Users-griff/90c23250-d02e-407b-b5d4-4d0b6334faee/scratchpad/parse.py`, `analyze.py`, `tab.py`
- Word counts are whitespace-delimited tokens in the Full details field only, excluding the Summary, Type, Funding goal and Admin id lines.
- Canned-text matching normalized whitespace, case, curly quotes and markdown emphasis, then tested for exact substring presence of the block as written in `llms.txt`. Anything short of that was read by hand and classified as paraphrased or absent.
````



---

# Part 8. FILE: docs/prototype/parts/p4_script.html

````html

<script>
/* ============================================================================
   Suggest an initiative, v2 prototype, second pass (Griff's review of
   2026-09-10 applied).
   Plain vanilla JS, no libraries, written to be readable as a reference for
   the real implementation. Five parts:
     1. amount parsing
     2. the field dictionary (questions, helpers, rules copy, example draft)
     3. the splitter that turns one pasted draft into filled fields
     4. rendering (sections, backers, milestone rows, checks, page preview)
     5. checks, error painting, and wiring
   ============================================================================ */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- helpers */
  function $(sel) { return document.querySelector(sel); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function v(id) { var n = document.getElementById(id); return n ? n.value : ""; }
  function setV(id, val) { var n = document.getElementById(id); if (n) { n.value = val; } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function words(s) { var t = String(s || "").trim(); return t ? t.split(/\s+/).length : 0; }
  function nonEmpty(s) { return String(s || "").trim() !== ""; }
  function letter(i) { return String.fromCharCode(65 + (i % 26)); }
  function intOf(x) {
    var n = parseInt(String(x == null ? "" : x).replace(/[^0-9]/g, ""), 10);
    return isFinite(n) ? n : 0;
  }

  /* ------------------------------------------------- 1. amount parsing */
  /* One reader for every money field on this form: the funding goal, every
     milestone amount, every backer amount. The audience is global and types
     money several ways, so the last separator decides how the number is read:
       "150.000" and "150,000"  ->  150000
           a separator followed by exactly three digits at the end of the
           number is a thousands separator
       "150.00" and "150,00"    ->  150
           a separator followed by one or two digits is a decimal point
       "150.000,50"             ->  150000.5
           mixed separators: the last one is the decimal point
     Anything that is not a digit or a separator (currency symbols, spaces,
     stray words) is dropped first. A tail of four digits or more is treated
     as grouping too, which is the only sane reading left. Every amount field
     echoes the parsed number back as "$150,000", so a wrong read is visible
     before anyone submits it. */
  function parseAmount(raw) {
    var s = String(raw == null ? "" : raw).replace(/[^0-9.,]/g, "");
    if (!s) { return 0; }
    var last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    var n;
    if (last < 0) {
      n = parseFloat(s);
    } else if (/^\d{1,2}$/.test(s.slice(last + 1))) {
      n = parseFloat(s.slice(0, last).replace(/[.,]/g, "") + "." + s.slice(last + 1));
    } else {
      n = parseFloat(s.replace(/[.,]/g, ""));
    }
    return isFinite(n) ? n : 0;
  }

  function usd(n) {
    var x = Number(n) || 0;
    var cents = Math.abs(x % 1) > 0.004 ? 2 : 0;
    return "$" + x.toLocaleString("en-US",
      { minimumFractionDigits: cents, maximumFractionDigits: cents });
  }
  function money(n) {
    return n ? Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "";
  }

  /* ------------------------------------------- 2. the field dictionary */
  /* One question per section. The site owns the heading; the submitter answers
     the question. Order here is the order on the page, and it differs by type. */
  var FIELD = {
    why: {
      heading: "Why this matters", rows: 7,
      q: "What gap does this close, and what can people do afterwards that they cannot today?",
      helper: "1 to 2 short paragraphs or a bullet list."
    },
    in_scope: {
      heading: "In scope", rows: 8,
      q: "What gets built or delivered?",
      helper: "Concrete deliverables. This is also where you say what the money actually pays for."
    },
    out_scope: {
      heading: "Out of scope", rows: 5,
      q: "What is deliberately not included?",
      helper: "This is where the expensive misunderstandings get prevented."
    },
    existing: {
      heading: "Existing work", rows: 4,
      q: "What prior art should bidders build on?",
      helper: "Links. Say what would justify building on something else. Write none if there is nothing."
    },
    who: {
      heading: "Who we expect to do this", rows: 7,
      q: "What does a winning team look like, and who co-drafted this initiative?",
      helper: "Nobody is pre-selected. Name co-authors and your own relationship to any team or codebase named above."
    },
    hard_req: {
      heading: "Hard requirements", rows: 9,
      q: "What must every proposal meet or be ignored?",
      helper: "Numbered. Open source under an OSI license where code is delivered, verifiable acceptance, a maintenance plan, plus what the domain demands."
    },
    team: {
      heading: "The team", rows: 6, grantOnly: true,
      q: "Who does the work? Names, roles, track record, links.",
      helper: "Also state any other funding you have for this work, and your relationships to codebases or firms named in this initiative."
    },
    why_grant: {
      heading: "Why a grant: what already exists", rows: 7, grantOnly: true,
      q: "What have you already built or done that gives you a decisive head start, and where can a stranger check it?",
      helper: "Links to code, reports, deployments. Say why the price is below a from-scratch build. If the head start is thin, say so, the admin may ask you to resubmit as an RFP."
    },
    commitments: {
      heading: "Commitments", rows: 6, grantOnly: true,
      q: "What do you commit to on license, maintenance after the money is spent, and pinned targets? Any exception you are asking for?",
      helper: "What you commit to on license, maintenance after the money is spent, and pinned targets. State any exception you are asking for."
    }
  };

  var SECTIONS = {
    rfp: ["why", "in_scope", "out_scope", "existing", "who", "hard_req"],
    grant: ["why", "team", "why_grant", "in_scope", "out_scope", "commitments"]
  };

  /* The gold-standard example is an RFP, so the three grant-only sections get a
     short illustrative example instead. Guide v3 ships a full grant example.
     The team example is the Giveth roster, per Griff. */
  var GRANT_EX = {
    team: "**Giveth** does the work. Griff Green, co-founder, leads TheDAO Security Fund and holds the funder relationships. Lauren Luz runs project management, Jake Schumacher leads business development and fundraising, and Anamarija Begonja leads communications. Cotabe Moral covers business development and partnerships.\n\nTrack record: giveth.io, github.com/Giveth, and the 29 initiatives already on this board.\n\nNo other funder pays for this scope. Giveth administers TheDAO Security Fund, so the independent reviewer for these milestones is named in the grant agreement and is not Giveth.",
    why_grant: "The scoring template already exists in draft: 40 controls, three tiers, run against 9 teams inside our own audits over the last year. Redacted samples are at example.org/opsec-tiers. Two firms have signed a letter of intent to adopt it.\n\nThat is why this costs $60,000 rather than a from-scratch $150,000: the drafting and the first firm conversations are done. What is left is the other four firms, the board, and the membership body.",
    commitments: "- Template and tier definitions published under CC BY 4.0, board code under MIT.\n- We maintain the board for 12 months after the last milestone at no further cost.\n- Pinned target: at least 20 rated teams within 9 months of the first payment.\n- One exception requested: the raters' internal scoring worksheets stay closed for the first year, because they name the controls a team failed."
  };

  /* The rules panel, verbatim from docs/rules-panel-text-2026-09-10.md. The
     site renders this from content/boilerplate, by type. Nobody pastes it,
     nobody edits it, and it is the same on every initiative of that type. */
  var RULES = {
    rfp: {
      title: "How RFPs work",
      items: [
        "Funding comes first. Nothing starts until the initiative is fully funded.",
        "When funding completes, a 30-day proposal window opens. Any qualified team can bid.",
        "This page describes the solution we want. A team with another solid way to solve the same problem is welcome to propose it, even if it departs from the draft milestones below.",
        "A proposal contains the team and its track record, the technical approach, a milestone plan with a per-milestone budget (the draft on this page or a stronger version), and full disclosures. Every applicant discloses their relationships to the teams, codebases, and firms named on this page.",
        "Giveth selects the team within 7 days of the window closing, weighing credibility, price, and the strength of the proposed milestones.",
        "The milestones on this page are a draft. Final milestones and payments get negotiated with the selected team and fixed in the grant agreement.",
        "Before work begins, an independent technical reviewer with no ties to the team is appointed and named in the grant agreement. The reviewer decides whether each milestone passes or fails. Giveth is not the reviewer unless explicitly named, and Giveth oversees the arrangement so the reviewer stays independent of the team. The reviewer's fee comes out of the milestone payment, or the reviewer works pro bono; the team coordinates that payment.",
        "The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.",
        "Milestone deliveries are reviewed by the technical reviewer and paid within 14 days of acceptance.",
        "If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund can reclaim the unspent funds and put them toward other Ethereum security initiatives.",
        "In some circumstances the resulting grant may be managed by the Ethereum Foundation or another established ecosystem organization, when that is a better fit than Giveth."
      ]
    },
    grant: {
      title: "How grants work",
      items: [
        "Funding comes first. Nothing starts until the initiative is fully funded.",
        "When funding completes, a 15-day window opens. In that window the recipient submits the formal proposal: the final milestone plan, the per-milestone budget, and full disclosures. The same window is an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.",
        "Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement. Until then, the milestones on this page are a draft.",
        "Before work begins, an independent technical reviewer with no ties to the team is appointed and named in the grant agreement. The reviewer decides whether each milestone passes or fails. Giveth is not the reviewer unless explicitly named, and Giveth oversees the arrangement so the reviewer stays independent of the team. The reviewer's fee comes out of the milestone payment, or the reviewer works pro bono; the team coordinates that payment.",
        "The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.",
        "Milestone deliveries are reviewed by the technical reviewer and paid within 14 days of acceptance.",
        "If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund can reclaim the unspent funds and put them toward other Ethereum security initiatives.",
        "In some circumstances a grant may be managed by the Ethereum Foundation or another established ecosystem organization, when that is a better fit than Giveth."
      ]
    },
    topup: {
      title: "How top-up grants work (work already under way with another funder)",
      items: [
        "This grant tops up work that is already under way. There is no proposal window and no challenge period.",
        "The funding goal on this page is the total project budget. The amount already committed, and by whom, is shown in the header with each backer's logo; this grant raises the remainder.",
        "Completed milestones are marked done with a link to the delivered work. Each remaining milestone carries a target month.",
        "Payments from this grant start only once the earlier milestones have been accepted.",
        "An independent technical reviewer with no ties to the team, appointed before this grant begins and named in the grant agreement, decides whether each remaining milestone passes or fails. Giveth is not the reviewer unless explicitly named, and Giveth oversees the arrangement so the reviewer stays independent of the team.",
        "Milestone deliveries are reviewed by the technical reviewer and paid within 14 days of acceptance.",
        "If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund can reclaim the unspent funds and put them toward other Ethereum security initiatives.",
        "In some circumstances a grant may be managed by the Ethereum Foundation or another established ecosystem organization, when that is a better fit than Giveth."
      ]
    }
  };

  /* The example draft lives here, not in the paste box: the form starts empty.
     The banner button drops this into the paste box and runs the same code path
     a real paste runs. It is a demo control and does not ship. */
  var EXAMPLE_DRAFT = [
    "# RFP: OPSEC Ratings Coalition to Build & Maintain an \"L2Beat for OPSEC\"",
    "",
    "## Short summary",
    "",
    "One OPSEC rating the whole industry recognizes, issued by the firms that already run OPSEC audits. This RFP funds the coordinator who gets at least 6 auditing firms to agree on one scoring template and the A / AA / AAA tiers, stands up a public board of rated teams, and hands the standard to a membership body the firms own. Rated teams pay a fixed fee, so the system pays for itself once enough teams are on the board.",
    "",
    "## Funding goal",
    "",
    "$150,000 USD",
    "",
    "## Expected duration",
    "",
    "18 months",
    "",
    "## Links",
    "",
    "https://frameworks.securityalliance.org/",
    "https://securityalliance.org/",
    "",
    "## Why this matters",
    "",
    "Your keys, your devices, your multisig process, your access controls... these are just as important as your smart contracts. Every serious team already invests in OPSEC, and OPSEC audits happen all the time. But all of that work is invisible. There is no public signal that tells users, investors or partners who is actually running a tight ship.",
    "",
    "We want to change that with a single OPSEC rating the whole industry agrees on. Think of a Moody's rating: people want one because everyone recognizes what it means. Teams that earn an A, AA or AAA get their tier on a public board. That's it, just the tier. We will never publish what a team is missing (a public list of weaknesses is a gift to attackers), and teams with unacceptable OPSEC simply don't make the board... which says something all by itself.",
    "",
    "## In scope",
    "",
    "- Coordinating at least 6 OPSEC auditing companies to agree on one scoring template and the A / AA / AAA tier definitions",
    "- Onboarding those firms as the first accredited raters, with whatever materials they need to run the template inside their existing audit flow",
    "- A simple public board of rated teams and their tiers, with valid-until and last check-in dates... tiers only, no details, no gaps",
    "- Standing up the membership body: the charter (one firm, one vote), how raters get certified, the verification committee, the fixed fee schedule and the pooled funding model",
    "- The 12-month rating cycle with the six-month check-in and the event-based suspension process",
    "- The handoff: transferring the standard, the board and the name to the membership body",
    "",
    "## Out of scope",
    "",
    "- Performing the underlying OPSEC audits (the accredited firms do that)",
    "- Publishing any team's specific weaknesses, unmet controls, or the reasons behind a tier",
    "- A heavy platform build. The board is deliberately simple.",
    "",
    "## Existing work",
    "",
    "- [Security Frameworks by SEAL](https://frameworks.securityalliance.org/): the Security Alliance's open framework covering operational security, infrastructure, DevOps, incident response and more. Bidders should read it before proposing a scoring template.",
    "",
    "## Who we expect to do this",
    "",
    "Nobody is pre-selected. Once this RFP is fully funded the bidding opens to anyone. The dream candidate is a credible coordinator in the security community: someone who can bring 6+ OPSEC auditing firms to the same table and get them all to sign the same document. (If you have ever tried to get six companies to agree on anything, you know that's the real work here.)",
    "",
    "Ideally the coordinator is not an OPSEC auditing firm, because whoever holds the pen on the standard walks away with an edge over the firms they convened. That is a preference, not a requirement, and it will weigh in selection. An audit firm that coordinates takes no rater role during the grant and no ownership of the board. The best pitch a bidder can make is simple: here is why the other firms can trust me to run this.",
    "",
    "Co-drafted by the submitter with input from the SEAL frameworks working group. The submitter runs no OPSEC auditing firm and will not bid.",
    "",
    "## Hard requirements",
    "",
    "1. **Six firms minimum.** At least 6 OPSEC auditing companies formally agree to the scoring template and tier definitions, and commit to issuing ratings with it.",
    "2. **Tiers only.** The public board shows a team's tier, its valid-until date and its last check-in, and nothing more. No gaps, no unmet controls, no explanations.",
    "3. **Open and versioned.** The scoring template and tier definitions are public, open source and versioned, with changes dated and attributable, revised through a defined change process no more than once a year.",
    "4. **Tool-agnostic.** Every tier is reachable no matter which tools or frameworks a team uses. No vendor's product is ever required.",
    "5. **One firm, one vote.** Every founding firm gets equal governance rights in the membership body, regardless of who convened whom.",
    "6. **Neutral name.** The standard and the board are not branded after the coordinator or any single firm.",
    "7. **Mandatory handoff.** The standard, the board, the name and any secretariat function transfer to the membership body no later than six months after the final milestone. The coordinator keeps no veto and no unilateral control.",
    "8. **Fixed fees, pooled.** Rated teams pay a fixed, outcome-independent fee. Fees flow to the membership body, which pays raters from the pool and funds the verification committee from it. No tier-contingent pricing, no \"we'll get you to AA\" upsell.",
    "9. **Twelve months, checked at six, suspended on events.** A rating is valid for 12 months, lapses without the six-month self-attestation and check-in, and is suspended automatically on a disclosed incident or a material change until the team is re-rated.",
    "",
    "## What this actually pays for",
    "",
    "Let's be clear about what this RFP is: a coordination effort. The money pays for the social exercise of getting the OPSEC auditing firms around one table to agree on one standard. The website is the easy part.",
    "",
    "## Milestones (draft)",
    "",
    "### Agreed standard - $50,000",
    "",
    "- [ ] A public, versioned scoring template plus the A / AA / AAA tier definitions, with the change process for future revisions",
    "- [ ] At least 6 OPSEC auditing companies formally signed on and committed to rating with it, with the signed template published",
    "- [ ] The membership body's charter published: one firm, one vote, rater certification, the verification committee and its stipends, the fixed fee schedule, the pooled funding model, and the handoff agreement with a transfer date no later than six months after the final milestone",
    "",
    "### Board and first ratings - $25,000",
    "",
    "- [ ] The public board is live, showing rated teams, their tiers, valid-until dates and last check-ins (and nothing else)",
    "- [ ] At least 6 accredited firms have issued ratings inside their normal audit flow, each listed on the public board",
    "- [ ] At least 5 teams rated end to end, with their fees paid through the membership body's pool",
    "",
    "### Adoption evidence - $75,000 (adoption)",
    "",
    "- [ ] 20 teams publicly rated on the board by accredited firms",
    "- [ ] The six-month check-in running: every rating older than six months shows a check-in date on the board, and the event-based suspension process is live with a public change log",
    "- [ ] The membership body running on pooled fees, with the verification committee active and its spot-check sample published, both shown on the body's public page",
    "- [ ] A public metrics page: teams rated, tiers awarded, firms participating, check-ins completed, suspensions and renewals",
    "",
    "## Who is likely to fund this",
    "",
    "Ethereum Foundation | funds public-goods security tooling | met once at Devconnect | warm intro? yes | $50,000",
    "Safe Ecosystem Foundation | multisig OPSEC is their core risk surface | no contact yet | warm intro? no | $25,000",
    "Security Alliance (SEAL) | published the framework this builds on | co-drafted the standard question | warm intro? yes | suggested ask $25,000",
    "",
    "## Contact",
    "",
    "opsec-coalition@example.org"
  ].join("\n");

  /* ------------------------------------------------- 3. the splitter */
  /* Known headings, exact names plus a short alias list. Two aliases depend on
     the type, because the old format used one heading for two different jobs. */
  function headingKey(rawName, type) {
    var n = String(rawName).toLowerCase()
      .replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().replace(/[:.]+$/, "");

    if (n === "what already exists") { return type === "grant" ? "why_grant" : "existing"; }
    if (n === "the recipient" || n === "recipient team and why them") {
      return type === "grant" ? "team" : "who";
    }

    var map = {
      /* page fields */
      "title": "title",
      "short summary": "summary", "summary": "summary",
      "funding goal": "goal", "funding goal (usd)": "goal", "budget": "goal", "funding": "goal",
      "expected duration": "duration", "expected duration (months)": "duration",
      "duration": "duration", "indicative duration": "duration",
      "recipient team": "recipient",
      "backers": "backers", "backers already committed": "backers",
      "already committed": "backers", "already committed (usd)": "backers",
      "links": "links", "link": "links",
      "who is likely to fund this": "funders", "who is likely to fund this?": "funders",
      "funders": "funders", "contact": "contact",
      /* sections */
      "why this matters": "why",
      "in scope": "in_scope", "scope": "in_scope",
      "out of scope": "out_scope",
      "existing work": "existing", "prior art": "existing",
      "who we expect to do this": "who", "who we expect to do this work": "who",
      "hard requirements": "hard_req", "requirements": "hard_req",
      "the team": "team", "team": "team",
      "why a grant": "why_grant", "why a grant what already exists": "why_grant",
      "why a grant: what already exists": "why_grant",
      "commitments": "commitments",
      /* milestones */
      "milestones": "milestones", "milestones (draft)": "milestones",
      "draft milestones": "milestones", "milestone plan": "milestones"
    };
    return map[n] || null;
  }

  var PAGE_KEYS = ["title", "summary", "goal", "duration", "recipient", "backers",
                   "links", "funders", "contact"];

  function splitDraft(text, type) {
    var out = { page: {}, fields: {}, milestones: [], unsorted: "" };
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var buckets = {}, msLines = [], unsorted = [], cur = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);

      if (h) {
        var level = h[1].length, name = h[2];
        /* a lone top-level heading is the title, with any type prefix removed */
        if (level === 1 && !out.page.title) {
          out.page.title = name.replace(/^\s*(rfp|grant)\s*:\s*/i, "").trim();
          cur = null;
          continue;
        }
        /* inside the milestones block, deeper headings are milestone rows */
        if (cur === "milestones" && level >= 3) { msLines.push(line); continue; }

        var key = headingKey(name, type);
        if (key) { cur = key; if (!buckets[key]) { buckets[key] = []; } continue; }

        /* no heading is allowed inside a field: keep the text, drop the heading */
        if (cur && cur !== "milestones" && cur !== "unsorted" && level >= 3) {
          buckets[cur].push("**" + name + "**");
          continue;
        }
        cur = "unsorted";
        unsorted.push(line);
        continue;
      }

      if (cur === "milestones") { msLines.push(line); continue; }
      if (cur && cur !== "unsorted") { buckets[cur].push(line); continue; }
      unsorted.push(line);
    }

    Object.keys(buckets).forEach(function (k) {
      var text2 = buckets[k].join("\n").replace(/\n{3,}/g, "\n\n").trim();
      if (PAGE_KEYS.indexOf(k) >= 0) { out.page[k] = text2; } else { out.fields[k] = text2; }
    });

    out.milestones = parseMilestones(msLines, function (spill) { unsorted.push(spill); });
    out.unsorted = unsorted.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return out;
  }

  /* "### Agreed standard - $50,000 (adoption)" becomes a row, and the bullet
     lines under it become its acceptance criteria. A leading "A - " from the
     old format is accepted and thrown away: the letter is the row's position. */
  function rowFromHeading(s) {
    var row = { name: "", amount: 0, adoption: false, done: false, link: "", month: "", criteria: [] };
    var t = String(s).trim();
    if (/\(adoption\)/i.test(t)) { row.adoption = true; t = t.replace(/\(adoption\)/ig, "").trim(); }
    if (/\(done\)/i.test(t)) { row.done = true; t = t.replace(/\(done\)/ig, "").trim(); }
    t = t.replace(/[*_`]/g, "").trim();

    var parts = t.split(/\s+-\s+/);
    if (parts.length >= 3 && parts[0].trim().length <= 3) {
      row.amount = parseAmount(parts[parts.length - 1]);
      row.name = parts.slice(1, -1).join(" - ").trim();
    } else if (parts.length >= 2 && parseAmount(parts[parts.length - 1]) > 0) {
      row.amount = parseAmount(parts[parts.length - 1]);
      row.name = parts.slice(0, -1).join(" - ").trim();
    } else {
      row.name = t;
    }
    return row;
  }

  function parseMilestones(lines, spill) {
    var rows = [], cur = null, preamble = [];
    lines.forEach(function (line) {
      var h = line.match(/^#{2,6}\s+(.+?)\s*#*\s*$/);
      if (h) { cur = rowFromHeading(h[1]); rows.push(cur); return; }
      var t = line.trim();
      if (!t) { return; }
      if (!cur) { preamble.push(line); return; }
      /* guide v3 conventions for top-ups: first lines under the heading */
      var mm = t.match(/^target month:\s*(\d{4}-\d{2})\b/i);
      if (mm) { cur.month = mm[1]; return; }
      var dl = t.match(/^delivered:\s*(\S+)/i);
      if (dl) { cur.link = dl[1]; return; }
      var crit = t.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "")
                  .replace(/^\[[ xX]\]\s*/, "").trim();
      if (crit) { cur.criteria.push(crit); }
    });
    /* the old milestones preamble is not a criterion, it goes to unsorted */
    if (preamble.length && spill) { spill(preamble.join("\n").trim()); }
    return rows;
  }

  /* "Security Alliance (SEAL) | $20,000 | https://..." becomes a backer row.
     Logos are never text, so a pasted draft never carries one: the proposer
     uploads the organization's own logo file in the form. */
  function parseBackers(text) {
    return String(text || "").split("\n").map(function (line) {
      return line.replace(/^[-*+]\s+/, "").trim();
    }).filter(function (line) { return line.indexOf("|") > 0; }).map(function (line) {
      var p = line.split("|");
      return {
        org: (p[0] || "").trim(),
        amount: parseAmount(p[1] || ""),
        url: (p[2] || "").trim(),
        logoName: "", logoData: ""
      };
    });
  }

  /* ---------------------------------------------------- tiny markdown */
  function mdInline(s) {
    return esc(s)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="#" title="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
  function mdToHtml(src) {
    var out = [], para = [], list = null;
    function flushPara() { if (para.length) { out.push("<p>" + mdInline(para.join(" ")) + "</p>"); para = []; } }
    function flushList() {
      if (list) {
        out.push("<" + list.tag + ">" + list.items.map(function (x) {
          return "<li>" + mdInline(x) + "</li>";
        }).join("") + "</" + list.tag + ">");
        list = null;
      }
    }
    String(src || "").replace(/\r\n?/g, "\n").split("\n").forEach(function (line) {
      var t = line.trim();
      if (!t) { flushPara(); flushList(); return; }
      var ul = t.match(/^[-*+]\s+(.*)$/), ol = t.match(/^\d+[.)]\s+(.*)$/);
      if (ul) {
        flushPara();
        if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
        list.items.push(ul[1].replace(/^\[[ xX]\]\s*/, ""));
        return;
      }
      if (ol) {
        flushPara();
        if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
        list.items.push(ol[1]);
        return;
      }
      flushList();
      para.push(t);
    });
    flushPara(); flushList();
    return out.join("");
  }

  /* --------------------------------------------------------- 4. state */
  var state = {
    type: "rfp", topup: false, fields: {}, milestones: [], backers: [],
    previewOpen: false, submitted: false
  };
  /* the example toggles read the same parsed example, whether the form is
     filled or empty */
  var EXAMPLE_FIELDS = {};

  function emptyMilestone() {
    return { name: "", amount: 0, adoption: false, done: false, link: "", month: "", criteria: [""] };
  }
  function emptyBacker() {
    return { org: "", amount: 0, url: "", logoName: "", logoData: "" };
  }

  function rulesKey() { return state.type === "grant" ? (state.topup ? "topup" : "grant") : "rfp"; }
  function rulesTitle() { return RULES[rulesKey()].title; }
  /* the top-up title carries a parenthetical that reads badly mid-sentence */
  function panelName() { return rulesTitle().replace(/\s*\(.*\)\s*$/, ""); }
  function goal() { return parseAmount(v("f-goal")); }
  function msTotal() {
    return state.milestones.reduce(function (a, m) { return a + parseAmount(m.amount); }, 0);
  }
  function adoptionTotal() {
    return state.milestones.reduce(function (a, m) {
      return a + (m.adoption ? parseAmount(m.amount) : 0);
    }, 0);
  }
  function liveBackers() {
    return state.backers.filter(function (b) { return nonEmpty(b.org) || b.amount > 0; });
  }
  function committedTotal() {
    return liveBackers().reduce(function (a, b) { return a + parseAmount(b.amount); }, 0);
  }

  /* ------------------------------------------------------ 4. rendering */
  function renderRules() {
    var r = RULES[rulesKey()];
    $("#rules-title").textContent = r.title;
    $("#rules-body").innerHTML = "<ol>" + r.items.map(function (li) {
      return "<li>" + mdInline(li) + "</li>";
    }).join("") + "</ol>";
  }

  function exampleHtml(id) {
    var body = EXAMPLE_FIELDS[id] || GRANT_EX[id] || "";
    var note = FIELD[id].grantOnly
      ? '<i>illustrative, the gold-standard example is an RFP</i>'
      : '<i>from the gold-standard initiative</i>';
    if (!body) { return '<span class="ex-lbl">Example</span><p class="ex-body">Not written yet.</p>'; }
    return '<span class="ex-lbl">Example ' + note + '</span>' +
           '<div class="ex-body">' + mdToHtml(body) + "</div>";
  }

  function renderSections() {
    var ids = SECTIONS[state.type];
    $("#sections").innerHTML = ids.map(function (id, i) {
      var f = FIELD[id];
      return '<div class="fld">' +
        '<span class="eyebrow' + (i === 0 ? " top" : "") + '">Renders as: ' + esc(f.heading) +
          ' <em class="reqtag sm">Required</em></span>' +
        '<label class="lbl q" for="s-' + id + '">' + esc(f.q) +
          '<span class="dim">' + esc(f.helper) + "</span></label>" +
        '<textarea id="s-' + id + '" data-k="' + id + '" rows="' + f.rows + '">' +
          esc(state.fields[id] || "") + "</textarea>" +
        '<div class="fld-foot">' +
          '<button type="button" class="linklike ex-btn" data-ex="' + id + '" ' +
            'aria-expanded="false" aria-controls="ex-' + id + '">Show example</button>' +
          '<span class="wc" data-wc="' + id + '"></span>' +
        "</div>" +
        '<div class="exbox" id="ex-' + id + '" hidden>' + exampleHtml(id) + "</div>" +
      "</div>";
    }).join("");
    ids.forEach(updateWordCount);
  }

  function updateWordCount(id) {
    var span = document.querySelector('[data-wc="' + id + '"]');
    if (span) { span.textContent = words(state.fields[id]) + " words"; }
  }

  /* one backer per row: organization, amount, link, and the organization's own
     logo file. The chip under the row is the same pill the initiative page and
     the board card render. */
  function backerChip(b) {
    if (!nonEmpty(b.org) && !b.logoData) { return ""; }
    return '<div class="bk-chip"><span class="eyebrow sm">On the page it looks like this</span>' +
      '<div class="sponsors"><div class="sponsor-pill">' +
      (b.logoData ? '<img class="sponsor-logo" src="' + esc(b.logoData) + '" alt="' +
        esc(b.org || "Backer") + ' logo">' : "") +
      "<b>" + esc(b.org || "Unnamed backer") + "</b>" +
      "<span>" + usd(parseAmount(b.amount)) + "</span>" +
      '<small class="pledged">committed</small>' +
      "</div></div></div>";
  }

  function renderBackers() {
    if (!state.backers.length) {
      $("#bk-rows").innerHTML = '<p class="emptyrow">No backers listed. Add one for every ' +
        'organization that has already committed money to this work.</p>';
      return;
    }
    $("#bk-rows").innerHTML = state.backers.map(function (b, i) {
      var p = "bk-" + i + "-";
      return '<div class="bk-row" data-i="' + i + '">' +
        '<div class="row-head"><span class="row-k">Backer ' + (i + 1) + "</span>" +
          '<button type="button" class="btn ghost sm bk-del" data-del="' + i + '">Remove</button></div>' +
        '<div class="ms-grid">' +
          '<label class="ms-f grow"><span class="eyebrow sm">Organization</span>' +
            '<input type="text" id="' + p + 'org" data-bk="org" value="' + esc(b.org) +
            '" placeholder="Who committed the money"></label>' +
          '<label class="ms-f amt"><span class="eyebrow sm">Amount committed (USD)</span>' +
            '<input type="text" class="money" inputmode="decimal" id="' + p + 'amount" ' +
            'data-bk="amount" value="' + esc(money(b.amount)) + '">' +
            '<span class="amt-echo">' + (b.amount ? usd(b.amount) : "") + "</span></label>" +
        "</div>" +
        '<label class="ms-f"><span class="eyebrow sm">Link</span>' +
          '<input type="text" id="' + p + 'url" data-bk="url" placeholder="https://" value="' +
          esc(b.url) + '"></label>' +
        '<div class="ms-f"><span class="eyebrow sm">Logo file</span>' +
          '<input type="file" class="filein" id="' + p + 'logo" data-bk="logo" ' +
          'accept=".png,.jpg,.jpeg,.webp,.svg">' +
          '<p class="hint">Upload the organization\'s official logo file (from their press kit, ' +
          'brand page, or repository). Never a redrawn or AI-made version.</p>' +
          (b.logoName ? '<p class="hint bk-file">Selected: ' + esc(b.logoName) + "</p>" : "") +
        "</div>" +
        backerChip(b) +
      "</div>";
    }).join("");
  }

  function renderBackerHead() {
    var live = liveBackers(), total = committedTotal(), g = goal();
    if (!live.length || total <= 0) {
      $("#bk-head").innerHTML = '<span class="dimline">Nothing committed yet, so this line stays ' +
        "off your page and your board card.</span>";
      return;
    }
    var names = live.map(function (b) { return b.org || "an unnamed backer"; }).join(", ");
    var line = usd(total) + " already committed by " + names;
    if (state.topup && g > total) {
      line += "; this grant raises the remaining " + usd(g - total);
    }
    $("#bk-head").innerHTML = '<span class="okline">' + esc(line) + "</span>";
  }

  function renderMilestones() {
    if (!state.milestones.length) {
      $("#ms-rows").innerHTML = '<p class="emptyrow">No milestones yet. Add the first one, or ' +
        "paste a draft and we build the rows from it.</p>";
      return;
    }
    $("#ms-rows").innerHTML = state.milestones.map(function (m, i) {
      var p = "ms-" + i + "-";
      var crits = m.criteria.length ? m.criteria : [""];
      return '<div class="ms-row" data-i="' + i + '">' +
        '<div class="row-head"><span class="row-k">Milestone ' + letter(i) + "</span>" +
          '<button type="button" class="btn ghost sm ms-del" data-del="' + i + '">Remove</button></div>' +
        '<div class="ms-grid">' +
          '<label class="ms-f grow"><span class="eyebrow sm">Name' +
            ' <em class="reqtag sm">Required</em></span>' +
            '<input type="text" id="' + p + 'name" data-mk="name" value="' + esc(m.name) + '"></label>' +
          '<label class="ms-f amt"><span class="eyebrow sm">Amount (USD)' +
            ' <em class="reqtag sm">Required</em></span>' +
            '<input type="text" class="money" inputmode="decimal" id="' + p + 'amount" ' +
            'data-mk="amount" value="' + esc(money(m.amount)) + '">' +
            '<span class="amt-echo">' + (m.amount ? usd(m.amount) : "") + "</span></label>" +
        "</div>" +
        '<div class="ms-flags">' +
          '<label class="cbrow"><input type="checkbox" data-mk="adoption"' +
            (m.adoption ? " checked" : "") + "> <span>Adoption milestone</span></label>" +
          (state.topup
            ? '<label class="cbrow"><input type="checkbox" data-mk="done"' +
              (m.done ? " checked" : "") + "> <span>Already done</span></label>"
            : "") +
        "</div>" +
        (state.topup && m.done
          ? '<label class="ms-f"><span class="eyebrow sm">Link to the delivered work</span>' +
            '<input type="text" id="' + p + 'link" data-mk="link" placeholder="https://" value="' +
            esc(m.link) + '"></label>'
          : "") +
        (state.topup && !m.done
          ? '<label class="ms-f mth"><span class="eyebrow sm">Target month</span>' +
            '<input type="month" id="' + p + 'month" data-mk="month" value="' + esc(m.month) +
            '"></label>'
          : "") +
        '<div class="crit-block eb" id="' + p + 'crit">' +
          '<span class="eyebrow sm">Acceptance criteria, one per row' +
            ' <em class="reqtag sm">Required</em></span>' +
          '<div class="crit-list">' + crits.map(function (c, j) {
            return '<div class="crit"><span class="crit-box" aria-hidden="true"></span>' +
              '<input type="text" id="' + p + "c" + j + '" data-mk="crit" data-ci="' + j +
              '" value="' + esc(c) + '" placeholder="One checkable outcome">' +
              '<button type="button" class="crit-del" data-cdel="' + j +
              '" title="Remove this criterion" aria-label="Remove this criterion">&#215;</button></div>';
          }).join("") + "</div>" +
          '<button type="button" class="linklike crit-add">Add criterion</button>' +
        "</div>" +
      "</div>";
    }).join("");
  }

  function renderTotals() {
    var sum = msTotal(), g = goal(), ad = adoptionTotal();
    var pct = g > 0 ? Math.round((ad / g) * 100) : 0;
    var okSum = state.milestones.length === 0 || Math.round(sum) === Math.round(g);
    $("#tot-line").innerHTML = '<span class="' + (okSum ? "okc" : "bad") + '">Milestones total ' +
      usd(sum) + " of " + usd(g) + " goal</span>";
    var okAd = g > 0 && ad >= g / 3;
    $("#adopt-line").innerHTML = '<span class="' + (okAd ? "okc" : "bad") + '">Adoption-tied: ' +
      usd(ad) + " (" + pct + "%), minimum one third, " + usd(g / 3) + "</span>";
  }

  function updateAmountEcho(el, n) {
    var echo = el.parentNode ? el.parentNode.querySelector(".amt-echo") : null;
    if (echo) { echo.textContent = n ? usd(n) : ""; }
  }

  /* ------------------------------------------------ 5. checks */
  /* Two kinds of finding. An error has to be fixed before the submission is
     any use to a reviewer; a warning is a judgment call the submitter can
     overrule. Neither disables the button: pressing Submit paints every
     finding on the question it belongs to and scrolls to the first one.
     Every finding carries the id of the field it belongs to, which is what
     the painting uses. */
  var HEDGES = /\bas needed\b|\bwhere appropriate\b/i;

  function runChecks() {
    var errs = [], warns = [];
    function err(target, msg, text) {
      errs.push({ target: target, msg: msg, text: text || esc(msg), kind: "content" });
    }
    function need(target, label, msg) {
      errs.push({
        target: target, msg: msg, kind: "missing",
        text: "<b>" + esc(label) + "</b> is required. " + esc(msg)
      });
    }
    function warn(target, msg, text, lines) {
      warns.push({ target: target, msg: msg, text: text || esc(msg), lines: lines });
    }

    if (!nonEmpty(v("f-title"))) { need("f-title", "Title", "Write the title, up to 140 characters."); }
    if (!nonEmpty(v("f-summary"))) {
      need("f-summary", "Short summary", "Write the 2 to 4 sentences the board card shows.");
    }
    if (goal() <= 0) { need("f-goal", "Funding goal", "Enter the goal in USD, one flat number."); }
    if (intOf(v("f-duration")) <= 0) {
      need("f-duration", "Expected duration", "Enter the number of months to the last milestone.");
    }
    if (state.type === "grant" && !nonEmpty(v("f-recipient"))) {
      need("f-recipient", "Recipient team", "Name the team that receives this grant.");
    }
    SECTIONS[state.type].forEach(function (id) {
      if (!nonEmpty(state.fields[id])) {
        need("s-" + id, FIELD[id].heading, "Answer the question above.");
      }
    });
    if (!nonEmpty(v("f-funders"))) {
      need("f-funders", "Who is likely to fund this",
        "Name at least one funder, one per line. Private, never published.");
    }
    if (!nonEmpty(v("f-contact"))) {
      need("f-contact", "Contact", "An email or handle, so we can ask about this submission.");
    }

    /* backers are optional, but a half-filled row is a mistake */
    state.backers.forEach(function (b, i) {
      var p = "bk-" + i + "-";
      if (nonEmpty(b.org) && parseAmount(b.amount) <= 0) {
        err(p + "amount", "Add what " + b.org + " committed, or remove the row.");
      }
      if (!nonEmpty(b.org) && parseAmount(b.amount) > 0) {
        err(p + "org", "Name the organization that committed this amount, or remove the row.");
      }
    });
    if (state.topup && !liveBackers().length) {
      warn("bk-rows", "A top-up says the work is already funded by someone else. List that " +
        "backer so the header can show the amount and the logo.");
    }

    if (!state.milestones.length) {
      need("ms-rows", "Milestones", "Add at least one milestone.");
    }
    state.milestones.forEach(function (m, i) {
      var p = "ms-" + i + "-", L = "Milestone " + letter(i);
      if (!nonEmpty(m.name)) { need(p + "name", L + " name", "Name this milestone."); }
      if (parseAmount(m.amount) <= 0) {
        need(p + "amount", L + " amount", "Enter what this milestone pays.");
      }
      if (!m.criteria.filter(nonEmpty).length) {
        need(p + "crit", L + " criteria", "Write at least one criterion a reviewer can check.");
      }
      if (state.topup && m.done && !nonEmpty(m.link)) {
        warn(p + "link", L + " is marked done with no link to the delivered work.");
      }
      if (state.topup && !m.done && !nonEmpty(m.month)) {
        warn(p + "month", L + " has no target month. Every remaining milestone needs one.");
      }
    });

    var sum = msTotal(), g = goal();
    if (state.milestones.length && g > 0 && Math.round(sum) !== Math.round(g)) {
      err("f-goal", "Milestone amounts total " + usd(sum) + " against a " + usd(g) +
        " goal. Change the goal or a milestone amount.",
        "Milestone amounts total <b>" + usd(sum) + "</b>, the funding goal is <b>" + usd(g) +
        "</b>. Change one of them before you submit.");
    }

    /* Item 10: the adoption rule blocks. At least one adoption milestone, and
       adoption-tied amounts worth at least a third of the goal, which is at
       least $100,000 once the goal reaches $300,000. A top-up is exempt only
       when every milestone it lists is already flagged done, because then
       there is no remaining work left to tie to adoption. */
    var exempt = state.topup && state.milestones.length > 0 &&
      state.milestones.every(function (m) { return m.done; });
    var ad = adoptionTotal(), need3 = g / 3;
    if (g > 0 && state.milestones.length && !exempt) {
      if (ad === 0) {
        err("ms-rows", "No milestone is an adoption milestone. Flag at least one, worth " +
          usd(need3) + " or more, a third of the goal.");
      } else if (ad < need3) {
        err("ms-rows", "Adoption milestones carry " + usd(ad) + ", which is " +
          Math.round((ad / g) * 100) + "% of the goal. Raise them to at least " + usd(need3) +
          ", a third.");
      }
    }

    state.milestones.forEach(function (m, i) {
      m.criteria.forEach(function (c, j) {
        var t = String(c).trim();
        if (!t) { return; }
        var reasons = [];
        if (t.indexOf("[") >= 0) { reasons.push("an unresolved bracket"); }
        if (/\bTBD\b/i.test(t)) { reasons.push("TBD"); }
        if (/PLACEHOLDER/i.test(t)) { reasons.push("PLACEHOLDER"); }
        if (/\d+\s*-\s*\d+/.test(t)) { reasons.push("a range, pick the floor"); }
        if (HEDGES.test(t)) { reasons.push("a hedge"); }
        if (reasons.length) {
          warns.push({
            target: "ms-" + i + "-c" + j, msg: "Not checkable yet: " + reasons.join(", ") + ".",
            text: "<b>Milestone " + letter(i) + "</b> " + esc(t) +
                  " <i>(" + esc(reasons.join(", ")) + ")</i>", group: "criteria"
          });
        }
      });
    });

    return { errs: errs, warns: warns };
  }

  function renderChecks(res) {
    var show = state.submitted;
    var errs = show ? res.errs : res.errs.filter(function (e) { return e.kind !== "missing"; });
    var crit = res.warns.filter(function (w) { return w.group === "criteria"; });
    var other = res.warns.filter(function (w) { return w.group !== "criteria"; });

    var html = errs.map(function (e) {
      return '<div class="check err"><span class="k">Error</span><span class="t">' + e.text +
        "</span></div>";
    }).join("") + other.map(function (w) {
      return '<div class="check warn"><span class="k">Warning</span><span class="t">' + w.text +
        "</span></div>";
    }).join("");
    if (crit.length) {
      html += '<div class="check warn"><span class="k">Warning</span><span class="t">' +
        "These acceptance criteria are not checkable yet:<ul><li>" +
        crit.map(function (w) { return w.text; }).join("</li><li>") + "</li></ul></span></div>";
    }
    if (!errs.length) {
      html = '<div class="check ok"><span class="k">Clear</span><span class="t">' +
        (show ? "Nothing blocks this submission" : "Nothing is wrong with what is filled in so far") +
        (res.warns.length ? ". You can submit past warnings, the reviewer sees them too." : ".") +
        "</span></div>" + html;
    }
    if (!show) {
      html += '<div class="check note"><span class="k">Note</span><span class="t">Required ' +
        "questions carry a Required marker. Press Submit for review and anything still missing " +
        "shows up here and on the question itself.</span></div>";
    }
    $("#checks-list").innerHTML = html;

    $("#blockmsg").textContent = show && res.errs.length
      ? (res.errs.length === 1 ? "One thing needs fixing, marked above."
                               : res.errs.length + " things need fixing, marked above.")
      : "";
  }

  /* red edge, one line of plain instruction under the field, and nothing until
     the person has pressed Submit once. After that the marks come and go as
     the fields get fixed. */
  function paintFindings(res) {
    all(".has-error,.has-warn").forEach(function (el) {
      el.classList.remove("has-error");
      el.classList.remove("has-warn");
    });
    all(".fld-msg").forEach(function (el) { el.parentNode.removeChild(el); });
    if (!state.submitted) { return null; }

    var first = null;
    res.errs.forEach(function (e) { if (mark(e, "has-error", "fld-err") && !first) { first = e.target; } });
    res.warns.forEach(function (w) { mark(w, "has-warn", "fld-warn"); });
    return first;
  }

  /* scroll something on screen and make sure it really got there: not every
     browser honours a smooth scroll request, so check once and jump if the
     element is still off screen. */
  function bringIntoView(el) {
    if (!el) { return; }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(function () {
      var r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > (window.innerHeight || 0)) {
        el.scrollIntoView({ block: "center" });
      }
    }, 700);
  }

  function mark(item, cls, msgCls) {
    if (!item.target || !item.msg) { return false; }
    var el = document.getElementById(item.target);
    if (!el || el.offsetParent === null) { return false; }
    el.classList.add(cls);
    var p = document.createElement("p");
    p.className = "fld-msg " + msgCls;
    p.textContent = item.msg;
    if (el.nextSibling) { el.parentNode.insertBefore(p, el.nextSibling); }
    else { el.parentNode.appendChild(p); }
    return true;
  }

  /* --------------------------------------------- the page preview */
  function rulesPanelHtml() {
    var r = RULES[rulesKey()];
    return '<details class="rules" open><summary><span>' + esc(r.title) + "</span>" +
      '<span class="rules-tag">Added by the site</span></summary><ol>' +
      r.items.map(function (li) { return "<li>" + mdInline(li) + "</li>"; }).join("") +
      '</ol><p class="rules-ver">Rules v2026-09, shown on every initiative of this type.</p></details>';
  }

  function backerPillsHtml() {
    return '<div class="sponsors">' + liveBackers().map(function (b) {
      return '<div class="sponsor-pill">' +
        (b.logoData ? '<img class="sponsor-logo" src="' + esc(b.logoData) + '" alt="' +
          esc(b.org) + ' logo">' : "") +
        "<b>" + (nonEmpty(b.url)
          ? '<a href="#" title="' + esc(b.url) + '">' + esc(b.org) + "</a>"
          : esc(b.org)) + "</b>" +
        "<span>" + usd(parseAmount(b.amount)) + "</span>" +
        '<small class="pledged">committed</small></div>';
    }).join("") + "</div>";
  }

  function cardMockHtml() {
    var g = goal(), total = committedTotal();
    var pct = g > 0 ? Math.min(100, Math.round((total / g) * 100)) : 0;
    var live = liveBackers(), logos = live.filter(function (b) { return !!b.logoData; });
    var sum = v("f-summary").trim();
    return '<div class="card-mock"><div class="rfp-card">' +
      '<span class="type-badge t-' + state.type + '">' +
        (state.type === "grant" ? "Grant" : "RFP") + "</span>" +
      '<a class="card-title" href="#">' + esc(v("f-title") || "Untitled initiative") + "</a>" +
      '<p class="card-sum">' + esc(sum.slice(0, 210)) + (sum.length > 210 ? "&#8230;" : "") + "</p>" +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="card-nums' + (total ? "" : " zero") + '"><span><b>' + usd(total) + "</b> of " +
        usd(g) + (live.length ? ' <span class="sponsor-count">&#183; ' + live.length +
          " backer" + (live.length === 1 ? "" : "s") + "</span>" : "") + "</span>" +
        '<span class="pct">' + pct + "%</span></div>" +
      (logos.length
        ? '<div class="card-logos"><span class="sponsor-lbl">Backed by</span>' +
          logos.map(function (b) {
            return '<img src="' + esc(b.logoData) + '" alt="' + esc(b.org) + '" title="' +
              esc(b.org) + '">';
          }).join("") + "</div>"
        : "") +
      '<div class="card-actions"><a class="btn ghost sm" href="#">Details</a></div>' +
      "</div></div>";
  }

  function renderPreview() {
    var isGrant = state.type === "grant";
    var g = goal(), months = intOf(v("f-duration")), total = committedTotal();
    var live = liveBackers();
    var h = '<div class="preview-flag"><span>Preview</span>' +
            "<span>This is what the site publishes</span></div>";
    h += '<p class="crumb"><a href="#">&#8592; All initiatives</a></p>';
    h += '<h1 class="rfp-title">' + esc(v("f-title") || "Untitled initiative") + "</h1>";
    h += '<p class="meta-line"><span class="type-badge inline t-' + state.type + '">' +
         (isGrant ? "Grant" : "RFP") + "</span>";
    if (isGrant && nonEmpty(v("f-recipient"))) {
      h += '<span class="dim">Grant to <b>' + esc(v("f-recipient")) + "</b></span>";
    }
    h += '<span class="dim">Goal <b class="mono">' + usd(g) + "</b></span>";
    h += '<span class="dim">About ' + months + " month" + (months === 1 ? "" : "s") + "</span></p>";
    if (live.length && total > 0) {
      var names = live.map(function (b) { return b.org || "an unnamed backer"; }).join(", ");
      h += '<p class="body-text small">' + usd(total) + " already committed by " + esc(names) +
        (state.topup && g > total
          ? "; this grant raises the remaining " + usd(g - total) + "."
          : ".") + "</p>";
    }
    h += "<h2>Summary</h2>";
    h += '<p class="body-text">' + esc(v("f-summary")) + "</p>";

    SECTIONS[state.type].forEach(function (id) {
      h += "<h2>" + esc(FIELD[id].heading) + "</h2>";
      h += '<div class="body-text md">' + mdToHtml(state.fields[id] || "") + "</div>";
    });

    h += "<h2>" + (isGrant ? "Milestones" : "Milestones (draft)") + "</h2>";
    h += '<div class="body-text md">';
    state.milestones.forEach(function (m, i) {
      h += "<h3>" + esc(letter(i) + " - " + (m.name || "Unnamed") + " - " +
        usd(parseAmount(m.amount))) +
        (m.adoption ? ' <span class="ms-flagtag">adoption milestone</span>' : "") +
        (state.topup && m.done ? ' <span class="ms-flagtag done">done</span>' : "") + "</h3>";
      if (state.topup && !m.done && nonEmpty(m.month)) {
        h += '<p class="small dim">Target month: ' + esc(m.month) + "</p>";
      }
      var crit = m.criteria.filter(nonEmpty);
      h += '<ul class="task">' + crit.map(function (c) {
        return "<li>" + mdInline(c) + "</li>";
      }).join("") + "</ul>";
      if (state.topup && m.done && nonEmpty(m.link)) {
        h += '<p class="small"><a href="#" title="' + esc(m.link) + '">Delivered work: ' +
          esc(m.link) + "</a></p>";
      }
    });
    h += "</div>";

    var links = v("f-links").split("\n").filter(nonEmpty);
    if (links.length) {
      h += '<h2>Links</h2><div class="body-text md"><ul>' + links.map(function (l) {
        return '<li><a href="#" title="' + esc(l.trim()) + '">' + esc(l.trim()) + "</a></li>";
      }).join("") + "</ul></div>";
    }

    if (live.length) {
      h += '<h2>Backers <span class="n">' + live.length + "</span></h2>" + backerPillsHtml();
    }

    h += rulesPanelHtml();
    h += '<div class="preview-flag mid"><span>On the board</span>' +
         "<span>The card people click</span></div>";
    h += cardMockHtml();
    $("#preview").innerHTML = h;
  }

  /* ---------------------------------------------------- 5. wiring */
  function updateAll() {
    renderTotals();
    renderBackerHead();
    var res = runChecks();
    renderChecks(res);
    paintFindings(res);
    if (state.previewOpen) { renderPreview(); }
  }

  function applySplit(silent) {
    var res = splitDraft(v("f-paste"), state.type);
    var filled = 0;

    if (res.page.title) { setV("f-title", res.page.title); filled++; }
    if (res.page.summary) { setV("f-summary", res.page.summary); filled++; }
    if (res.page.goal) { setV("f-goal", money(parseAmount(res.page.goal))); filled++; }
    if (res.page.duration) { setV("f-duration", String(intOf(res.page.duration))); filled++; }
    if (res.page.links) { setV("f-links", res.page.links); filled++; }
    if (res.page.recipient) { setV("f-recipient", res.page.recipient); filled++; }
    if (res.page.funders) { setV("f-funders", res.page.funders); }
    if (res.page.contact) { setV("f-contact", res.page.contact); }

    var backers = res.page.backers ? parseBackers(res.page.backers) : [];
    if (backers.length) { state.backers = backers; filled++; }

    var sections = 0;
    Object.keys(res.fields).forEach(function (k) {
      if (FIELD[k]) { state.fields[k] = res.fields[k]; sections++; }
    });
    if (res.milestones.length) { state.milestones = res.milestones; }

    setV("f-unsorted", res.unsorted);
    $("#unsorted").hidden = !nonEmpty(res.unsorted);

    renderSections();
    renderBackers();
    renderMilestones();
    updateAmountEchoes();
    updateAll();

    if (!silent) {
      $("#sort-note").innerHTML = '<span class="sorted-ok">Sorted:</span> ' + sections +
        " sections, " + res.milestones.length + " milestones, " + filled + " page fields" +
        (nonEmpty(res.unsorted) ? ", plus text nothing matched." : ".");
    }
  }

  /* the goal echo is outside a row, so it gets its own line */
  function updateAmountEchoes() {
    var g = goal();
    $("#echo-goal").textContent = g ? usd(g) : "";
  }

  /* one code path for a real paste and for the demo button */
  function sortFromPaste() {
    applySplit(false);
    $("#paste-block").hidden = true;
    $("#paste-again").hidden = false;
  }

  function setType(type, topup) {
    state.type = type;
    state.topup = type === "grant" ? !!topup : false;
    $("#subopt").hidden = type !== "grant";
    $("#grant-only").hidden = type !== "grant";
    renderRules();
    renderSections();
    renderMilestones();
    updateAll();
  }

  function boot() {
    EXAMPLE_FIELDS = splitDraft(EXAMPLE_DRAFT, "rfp").fields;
    state.fields = {};
    state.milestones = [emptyMilestone()];
    state.backers = [emptyBacker()];
    renderRules();
    renderSections();
    renderBackers();
    renderMilestones();
    updateAmountEchoes();
    updateAll();
  }

  /* type radios and the top-up checkbox */
  document.getElementById("t-rfp").addEventListener("change", function () { setType("rfp", false); });
  document.getElementById("t-grant").addEventListener("change", function () {
    setType("grant", document.getElementById("f-topup").checked);
  });
  document.getElementById("f-topup").addEventListener("change", function () {
    setType("grant", this.checked);
  });

  /* page fields */
  ["f-title", "f-summary", "f-goal", "f-duration", "f-recipient",
   "f-links", "f-funders", "f-contact"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", function () {
      if (id === "f-goal") { updateAmountEchoes(); }
      updateAll();
    });
  });
  document.getElementById("f-goal").addEventListener("change", function () {
    var n = parseAmount(this.value);
    if (n) { this.value = money(n); }
    updateAmountEchoes();
    updateAll();
  });

  /* section fields, example toggles */
  $("#sections").addEventListener("input", function (e) {
    var k = e.target.getAttribute("data-k");
    if (!k) { return; }
    state.fields[k] = e.target.value;
    updateWordCount(k);
    updateAll();
  });
  $("#sections").addEventListener("click", function (e) {
    var btn = e.target.closest(".ex-btn");
    if (!btn) { return; }
    var box = document.getElementById("ex-" + btn.getAttribute("data-ex"));
    var open = box.hidden;
    box.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.textContent = open ? "Hide example" : "Show example";
  });

  /* ------------------------------------------------------ backer rows */
  function readBk(e) {
    var row = e.target.closest(".bk-row");
    if (!row) { return null; }
    var b = state.backers[parseInt(row.getAttribute("data-i"), 10)];
    var k = e.target.getAttribute("data-bk");
    if (!b || !k) { return null; }
    return { b: b, k: k, el: e.target };
  }
  $("#bk-rows").addEventListener("input", function (e) {
    var r = readBk(e);
    if (!r) { return; }
    if (r.k === "amount") {
      r.b.amount = parseAmount(r.el.value);
      updateAmountEcho(r.el, r.b.amount);
    } else if (r.k !== "logo") {
      r.b[r.k] = r.el.value;
    }
    refreshBkChip(r.el);
    updateAll();
  });
  $("#bk-rows").addEventListener("change", function (e) {
    var r = readBk(e);
    if (!r) { return; }
    if (r.k === "amount" && r.b.amount) { r.el.value = money(r.b.amount); }
    if (r.k === "logo") {
      var f = r.el.files && r.el.files[0];
      if (!f) { r.b.logoName = ""; r.b.logoData = ""; refreshBkChip(r.el); updateAll(); return; }
      var reader = new FileReader();
      reader.onload = function () {
        r.b.logoName = f.name;
        r.b.logoData = String(reader.result);
        refreshBkChip(r.el);
        updateAll();
      };
      reader.readAsDataURL(f);
      return;
    }
    updateAll();
  });
  /* the chip redraws in place, so choosing a file does not wipe the row */
  function refreshBkChip(el) {
    var row = el.closest(".bk-row");
    if (!row) { return; }
    var i = parseInt(row.getAttribute("data-i"), 10);
    var b = state.backers[i];
    var old = row.querySelector(".bk-chip");
    if (old) { old.parentNode.removeChild(old); }
    var file = row.querySelector(".bk-file");
    if (file) { file.parentNode.removeChild(file); }
    if (b.logoName) {
      var p = document.createElement("p");
      p.className = "hint bk-file";
      p.textContent = "Selected: " + b.logoName;
      row.querySelector('input[data-bk="logo"]').parentNode.appendChild(p);
    }
    var chip = backerChip(b);
    if (chip) { row.insertAdjacentHTML("beforeend", chip); }
  }
  $("#bk-rows").addEventListener("click", function (e) {
    var btn = e.target.closest(".bk-del");
    if (!btn) { return; }
    state.backers.splice(parseInt(btn.getAttribute("data-del"), 10), 1);
    renderBackers();
    updateAll();
  });
  $("#btn-add-bk").addEventListener("click", function () {
    state.backers.push(emptyBacker());
    renderBackers();
    updateAll();
    var rows = document.querySelectorAll('.bk-row input[data-bk="org"]');
    if (rows.length) { rows[rows.length - 1].focus(); }
  });

  /* ------------------------------------------------- milestone rows */
  function readRow(e) {
    var row = e.target.closest(".ms-row");
    if (!row) { return null; }
    var m = state.milestones[parseInt(row.getAttribute("data-i"), 10)];
    var k = e.target.getAttribute("data-mk");
    if (!m || !k) { return null; }
    return { m: m, k: k, el: e.target, i: parseInt(row.getAttribute("data-i"), 10) };
  }
  $("#ms-rows").addEventListener("input", function (e) {
    var r = readRow(e);
    if (!r) { return; }
    if (r.k === "crit") {
      r.m.criteria[parseInt(r.el.getAttribute("data-ci"), 10)] = r.el.value;
    } else if (r.k === "amount") {
      r.m.amount = parseAmount(r.el.value);
      updateAmountEcho(r.el, r.m.amount);
    } else if (r.k !== "adoption" && r.k !== "done") {
      r.m[r.k] = r.el.value;
    }
    updateAll();
  });
  $("#ms-rows").addEventListener("change", function (e) {
    var r = readRow(e);
    if (!r) { return; }
    if (r.k === "adoption") { r.m.adoption = r.el.checked; }
    if (r.k === "done") { r.m.done = r.el.checked; renderMilestones(); }
    if (r.k === "amount" && r.m.amount) { r.el.value = money(r.m.amount); }
    updateAll();
  });
  $("#ms-rows").addEventListener("click", function (e) {
    var del = e.target.closest(".ms-del");
    if (del) {
      state.milestones.splice(parseInt(del.getAttribute("data-del"), 10), 1);
      renderMilestones();
      updateAll();
      return;
    }
    var cdel = e.target.closest(".crit-del");
    if (cdel) {
      var r1 = readRowFromEl(cdel);
      if (r1) {
        r1.m.criteria.splice(parseInt(cdel.getAttribute("data-cdel"), 10), 1);
        renderMilestones();
        updateAll();
      }
      return;
    }
    var add = e.target.closest(".crit-add");
    if (add) {
      var r2 = readRowFromEl(add);
      if (r2) {
        r2.m.criteria.push("");
        renderMilestones();
        updateAll();
        focusCrit(r2.i, r2.m.criteria.length - 1);
      }
    }
  });
  /* Enter inside a criterion opens the next one, the way a list should behave.
     Enter anywhere else in the form does nothing: an accidental Enter should
     not fire the submit checks. */
  $("#form").addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.target.tagName !== "INPUT") { return; }
    if (e.target.getAttribute("data-mk") === "crit") {
      e.preventDefault();
      var r = readRowFromEl(e.target);
      if (!r) { return; }
      var at = parseInt(e.target.getAttribute("data-ci"), 10) + 1;
      r.m.criteria.splice(at, 0, "");
      renderMilestones();
      updateAll();
      focusCrit(r.i, at);
      return;
    }
    if (e.target.type !== "submit") { e.preventDefault(); }
  });
  function readRowFromEl(el) {
    var row = el.closest(".ms-row");
    if (!row) { return null; }
    var i = parseInt(row.getAttribute("data-i"), 10);
    return { m: state.milestones[i], i: i };
  }
  function focusCrit(i, j) {
    var el = document.getElementById("ms-" + i + "-c" + j);
    if (el) { el.focus(); }
  }
  $("#btn-add-ms").addEventListener("click", function () {
    state.milestones.push(emptyMilestone());
    renderMilestones();
    updateAll();
    var rows = document.querySelectorAll(".ms-row input[data-mk='name']");
    if (rows.length) { rows[rows.length - 1].focus(); }
  });

  /* -------------------------------------- paste, demo controls, submit */
  /* The splitter runs on the paste itself. The value arrives after the event,
     so read it on the next tick. */
  $("#f-paste").addEventListener("paste", function () {
    setTimeout(sortFromPaste, 0);
  });
  $("#btn-paste-again").addEventListener("click", function () {
    $("#paste-block").hidden = false;
    $("#paste-again").hidden = true;
    document.getElementById("f-paste").focus();
  });

  $("#btn-example").addEventListener("click", function () {
    setV("f-paste", EXAMPLE_DRAFT);
    sortFromPaste();
    $("#conf").hidden = true;
  });

  $("#btn-clear").addEventListener("click", function () {
    ["f-paste", "f-title", "f-summary", "f-goal", "f-duration", "f-recipient", "f-links",
     "f-funders", "f-contact", "f-unsorted"].forEach(function (id) { setV(id, ""); });
    state.fields = {};
    state.milestones = [emptyMilestone()];
    state.backers = [emptyBacker()];
    state.submitted = false;
    document.getElementById("f-topup").checked = false;
    document.getElementById("t-rfp").checked = true;
    $("#unsorted").hidden = true;
    $("#paste-block").hidden = false;
    $("#paste-again").hidden = true;
    $("#sort-note").innerHTML = "";
    $("#conf").hidden = true;
    setType("rfp", false);
    renderBackers();
    updateAmountEchoes();
    updateAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("#btn-preview").addEventListener("click", function () {
    state.previewOpen = !state.previewOpen;
    $("#preview").hidden = !state.previewOpen;
    this.setAttribute("aria-expanded", state.previewOpen ? "true" : "false");
    this.textContent = state.previewOpen ? "Hide the page view" : "See it as a page";
    if (state.previewOpen) { renderPreview(); }
  });

  $("#copy-guide").addEventListener("click", function () {
    var btn = this, original = "Copy the guide";
    btn.textContent = "Copied!";
    setTimeout(function () { btn.textContent = original; }, 2000);
  });

  /* Submit is always clickable. Pressing it runs the checks, marks every
     problem on the field it belongs to, and scrolls to the first one. */
  $("#form").addEventListener("submit", function (e) {
    e.preventDefault();
    state.submitted = true;
    var res = runChecks();
    renderTotals();
    renderBackerHead();
    renderChecks(res);
    var first = paintFindings(res);
    if (res.errs.length) {
      $("#conf").hidden = true;
      var el = first ? document.getElementById(first) : null;
      if (el) {
        /* focus first: focus() cancels a smooth scroll that is already running */
        try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
        bringIntoView(el);
      } else {
        bringIntoView($("#checks"));
      }
      return;
    }
    var conf = $("#conf");
    conf.innerHTML = "<b>Submitted for review.</b> The site adds the " + esc(panelName()) +
      " panel to your page. Nothing was actually sent, this is a prototype." +
      (res.warns.length
        ? "<p>You submitted past " + res.warns.length + (res.warns.length === 1 ? " warning" : " warnings") +
          ". The reviewer sees the same list.</p>"
        : "");
    conf.hidden = false;
    bringIntoView(conf);
  });

  boot();
})();
</script>
````



---

# Part 9. FILE: docs/prototype/parts/p3_body.html

````html

<header class="topbar">
  <a href="#" class="brand">
    <img src="LOGO_SRC" alt="TheDAO">
    <span>TheDAO <b>Security Fund</b></span>
  </a>
  <nav class="topnav">
    <a href="#">Initiatives</a>
    <a href="#" class="navcta">Suggest an initiative</a>
    <button id="nav-connect" class="btn wallet" type="button">Connect wallet</button>
  </nav>
</header>

<main class="detail narrow">
  <h1>Suggest an initiative</h1>
  <p class="tag left">Submissions are reviewed before they appear on the site.</p>

  <hr class="shimmer soft">

  <div class="ai-steps">
    <div class="ai-step"><span class="ai-num">1</span>
      <div>Give this guide to your AI<br>
      <button type="button" class="btn ghost sm" id="copy-guide">Copy the guide</button></div></div>
    <div class="ai-step"><span class="ai-num">2</span>
      <div>Answer the questions the AI asks</div></div>
    <div class="ai-step"><span class="ai-num">3</span>
      <div>Paste the whole draft below, we sort it into the sections</div></div>
  </div>

  <div class="proto-banner" role="note">
    <span class="pb-dot" aria-hidden="true"></span>
    <span><b>Prototype of the proposed flow.</b> The form starts empty, the way a person meets it.
    Nothing is submitted. To watch a draft sort itself into the fields, use the button: it drops the
    OPSEC Ratings Coalition example into the paste box and runs the same code a real paste runs.
    That button is here for the demo and does not ship.
    <span class="pb-btns">
      <button type="button" class="btn ghost sm" id="btn-example">Try it with an example draft</button>
      <button type="button" class="btn ghost sm" id="btn-clear">Clear the form</button>
    </span></span>
  </div>

  <form class="form" id="form" novalidate>
    <input type="text" name="website" value="" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">

    <span class="lbl">Type <em class="reqtag">Required</em></span>
    <div class="type-choice">
      <label class="type-opt"><input type="radio" name="type" value="rfp" id="t-rfp" checked>
        <span><b>RFP</b><small>An open request: any qualified team can bid to do the work.</small></span></label>
      <label class="type-opt"><input type="radio" name="type" value="grant" id="t-grant">
        <span><b>Grant</b><small>Your team presents the idea and does the work.</small></span></label>
    </div>

    <div class="subopt" id="subopt" hidden>
      <label class="cbrow" for="f-topup"><input type="checkbox" id="f-topup">
        <span>Work is already under way with another funder</span></label>
      <p class="hint">This makes it a top-up. No proposal window, no challenge period. Completed
      milestones get a link to the delivered work, and every remaining one carries a target month.</p>
    </div>

    <details class="rules" id="rules" open>
      <summary><span id="rules-title">How RFPs work</span>
        <span class="rules-tag">The site writes this</span></summary>
      <div id="rules-body"></div>
    </details>
    <p class="rules-ver">Rules v2026-09, shown on every initiative of this type.</p>

    <div class="grp">
      <span class="grp-k">Paste your whole draft</span>
      <span class="grp-h">One paste, no button. The moment a draft lands in the box we split it on
      the section headings and fill every field below. Edit anything afterwards, the fields are what
      gets submitted.</span>
    </div>

    <div id="paste-block">
      <label class="lbl" for="f-paste">Paste your whole draft here</label>
      <textarea id="f-paste" rows="10" spellcheck="false"
        placeholder="Paste the draft your AI wrote. Sorting starts as soon as it lands."></textarea>
      <p class="hint" id="paste-help">Milestone headings look like
      <code>### Agreed standard - $50,000</code>, in order: the site letters them A, B, C. Add
      <code>(adoption)</code> to a milestone that pays only on evidence of adoption, and
      <code>(done)</code> to a top-up milestone that is already finished. Bullet lines under a
      milestone become its acceptance criteria, one per line. Under
      <code>## Backers already committed</code>, one backer per line as
      <code>Organization | amount | link</code>. Headings inside a section become bold text: the
      site owns the headings.</p>
    </div>
    <p class="hint" id="sort-note"></p>
    <p class="paste-again" id="paste-again" hidden>
      <button type="button" class="linklike" id="btn-paste-again">Sort again from the paste box</button>
    </p>

    <div class="unsorted" id="unsorted" hidden>
      <span class="eyebrow top">Unsorted text</span>
      <p class="hint">These lines matched no section. Copy what you need into a field above, then
      clear this box. Nothing here is submitted.</p>
      <textarea id="f-unsorted" rows="5"></textarea>
    </div>

    <div class="grp">
      <span class="grp-k">The page fields</span>
      <span class="grp-h">These render in the header of your initiative page, next to the type
      badge. They are never part of a body section.</span>
    </div>

    <label class="lbl" for="f-title">Title <em class="reqtag">Required</em>
      <span class="dim">Up to 140 characters. No "RFP:" or "Grant:" prefix, the badge says it.</span></label>
    <input type="text" id="f-title" maxlength="140" value="">

    <label class="lbl" for="f-summary">Short summary <em class="reqtag">Required</em>
      <span class="dim">2 to 4 sentences. This is the text on the board card.</span></label>
    <textarea id="f-summary" rows="5" maxlength="4000"></textarea>

    <label class="lbl" for="f-goal">Funding goal (USD) <em class="reqtag">Required</em>
      <span class="dim">One flat number.</span></label>
    <input type="text" id="f-goal" class="mono" inputmode="decimal" placeholder="250,000" value="">
    <span class="amt-echo" id="echo-goal"></span>

    <label class="lbl" for="f-duration">Expected duration (months) <em class="reqtag">Required</em>
      <span class="dim">Months from funding until the last milestone is complete.</span></label>
    <input type="text" id="f-duration" class="mono" inputmode="numeric" placeholder="12" value="">

    <div id="grant-only" hidden>
      <label class="lbl" for="f-recipient">Recipient team <em class="reqtag">Required</em>
        <span class="dim">Short name for the header and the board card, as in "Grant to Verity Labs".</span></label>
      <input type="text" id="f-recipient" maxlength="120" value="">
    </div>

    <label class="lbl" for="f-links">Links
      <span class="dim">Optional. Repo, site, prior write-up. One per line.</span></label>
    <textarea id="f-links" rows="3" spellcheck="false"></textarea>

    <div class="grp">
      <span class="grp-k">Backers already committed</span>
      <span class="grp-h">Optional, and open to every type. Anyone who has already committed money
      to this work, with their logo. The header of your page and your board card show the total and
      the logos, the way backer logos show on every initiative today.</span>
    </div>

    <div id="bk-rows"></div>
    <div class="pasterow">
      <button type="button" class="btn ghost sm" id="btn-add-bk">Add a backer</button>
    </div>
    <div class="bk-head" id="bk-head"></div>

    <div class="grp">
      <span class="grp-k">The sections</span>
      <span class="grp-h">The site renders the heading, you answer the question. Fixed order, no
      renaming, no dropping. Bold, links and lists are welcome inside a field.</span>
    </div>

    <div id="sections"></div>

    <div class="grp">
      <span class="grp-k">Milestones</span>
      <span class="grp-h">Each row renders as a heading with a checklist under it. The site letters
      them A, B, C in the order they sit here. The amounts add up against your funding goal.</span>
    </div>

    <div id="ms-rows" class="eb"></div>
    <div class="pasterow">
      <button type="button" class="btn ghost sm" id="btn-add-ms">Add milestone</button>
    </div>
    <div class="tot">
      <span id="tot-line"></span>
      <span id="adopt-line"></span>
    </div>

    <div class="grp">
      <span class="grp-k">Checks</span>
      <span class="grp-h">Warnings are yours to judge, you can submit past them. Errors do not
      block the button: press Submit and every problem is marked on the question it belongs
      to.</span>
    </div>

    <div class="checks" id="checks">
      <h4>What the form found</h4>
      <div id="checks-list"></div>
    </div>

    <div class="grp">
      <span class="grp-k">Preview</span>
      <span class="grp-h">Exactly what the site publishes, including the panel the site adds for
      you and the card the board shows. If your markdown died in the paste, you see it here.</span>
    </div>

    <div class="pasterow">
      <button type="button" class="btn ghost" id="btn-preview" aria-expanded="false"
        aria-controls="preview">See it as a page</button>
    </div>
    <div class="preview-wrap" id="preview" hidden></div>

    <div class="grp">
      <span class="grp-k">Private, never published</span>
      <span class="grp-h">Only the review team reads these two fields. They never appear on the
      page, the board, or the API.</span>
    </div>

    <label class="lbl" for="f-funders">Who is likely to fund this? <em class="reqtag">Required</em>
      <span class="priv">&#128274; Private, never published</span>
      <span class="dim">One funder per line: name | why they care | your relationship | warm intro? | likely amount.</span></label>
    <textarea id="f-funders" rows="6"></textarea>

    <label class="lbl" for="f-contact">Contact <em class="reqtag">Required</em>
      <span class="priv">&#128274; Private, never published</span>
      <span class="dim">Email or handle. We use it only to ask about this submission.</span></label>
    <input type="text" id="f-contact" maxlength="200" value="">

    <div class="subrow">
      <button class="btn primary" type="submit" id="btn-submit">Submit for review</button>
      <span class="blockmsg" id="blockmsg"></span>
    </div>
    <div class="conf" id="conf" hidden></div>
  </form>
</main>

<footer>
  <p>TheDAO Security Fund &#183; coordinating ecosystem funding for Ethereum security.</p>
  <p>To back an initiative, email <a href="#">info@thedao.fund</a>
    &#183; <a class="dim" href="#">Admin</a></p>
</footer>

<div class="footer-bar">
  <p>&#169; 2025&#8211;2026 TheDAO LLC. All rights reserved.</p>
</div>
````



---

# Part 10. FILE: docs/prototype/parts/p2_add.css

````css

/* ============================================================
   Part 2: prototype additions, same token vocabulary as above.
   Only what the live stylesheet does not already have:
   rules panel, paste box, section fields, backer rows,
   milestone rows, criteria rows, checks, page preview,
   board-card mock, confirmation card.
   ============================================================ */

:root{color-scheme:dark}
body{background:var(--bg);color:var(--text);
  background-image:linear-gradient(142.716deg,var(--bg) 31.46%,var(--bg2) 90.4%);
  background-attachment:fixed;background-repeat:no-repeat}
h1,h2,h3,h4,.rfp-title,.lbl.q{text-wrap:balance}
:focus-visible{outline:2px solid var(--green);outline-offset:2px}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;
  scroll-behavior:auto!important}}

/* the form column stays readable: about 70 characters of running text */
.form{max-width:640px}
.hint{margin:6px 0 0;font:300 12.5px/1.65 var(--sans);color:var(--muted);max-width:66ch}
.hint code,.check code,.rules code{font-family:var(--mono);font-size:11.5px;
  background:rgba(0,0,0,.28);border-radius:5px;padding:1px 5px}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}

/* month and file inputs are not in the site stylesheet yet */
input[type=month]{background:var(--card);border:1px solid var(--edge2);color:var(--text);
  padding:10px 12px;font:400 13.5px var(--sans);border-radius:11px;outline:none;width:100%}
input[type=month]:focus{border-color:rgba(92,183,90,.6)}
input[type=file].filein{width:100%;padding:9px 12px;border:1px dashed var(--edge2);
  border-radius:11px;background:rgba(0,0,0,.14);color:var(--soft);font:400 12.5px var(--sans)}
input[type=file].filein::file-selector-button{margin-right:12px;border:1px solid var(--edge2);
  background:rgba(255,255,255,.06);color:var(--soft);border-radius:9px;padding:6px 12px;
  font:400 12.5px var(--sans);cursor:pointer}
input[type=file].filein::file-selector-button:hover{border-color:rgba(92,183,90,.6)}

/* prototype banner */
.proto-banner{display:flex;gap:11px;align-items:flex-start;margin:0 0 4px;
  border:1px solid rgba(240,180,41,.45);background:rgba(240,180,41,.10);
  border-radius:14px;padding:13px 16px;color:#ffe9b8;font-size:13.5px;line-height:1.6}
.proto-banner b{color:#ffd98a}
.pb-dot{flex:none;width:9px;height:9px;border-radius:50%;margin-top:6px;
  background:#f0b429;box-shadow:0 0 10px rgba(240,180,41,.6)}
.pb-btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
.pb-btns .btn{margin-top:0}

/* group headers inside the form */
.grp{margin-top:30px;padding-top:18px;border-top:1px solid var(--edge)}
.grp-k{display:block;font:600 14px var(--tight);color:var(--text)}
.grp-h{display:block;margin-top:4px;color:var(--muted);font-size:12.5px;line-height:1.6;max-width:64ch}

/* type sub-option (top-up) */
.subopt{margin-top:10px;border:1px solid var(--edge);border-radius:14px;
  background:rgba(255,255,255,.03);padding:12px 16px}
.cbrow{display:flex;align-items:flex-start;gap:10px;cursor:pointer;
  font:400 13.5px/1.5 var(--sans);color:var(--soft)}
.cbrow input{width:16px;height:16px;margin:1px 0 0;flex:none;accent-color:#00ff88}

/* the "Required" marker that sits in an eyebrow or label row */
.reqtag{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;
  font:600 9.5px/1.6 var(--tight);letter-spacing:.12em;text-transform:uppercase;font-style:normal;
  color:#7dd57e;background:rgba(92,183,90,.14);border:1px solid rgba(92,183,90,.45);
  vertical-align:1px}
.reqtag.sm{margin-left:6px;padding:1px 6px;font-size:9px}

/* rules panel: what the site writes, not the submitter */
.rules{margin-top:14px;border:1px solid var(--edge2);background:rgba(0,0,0,.16);
  border-radius:16px;padding:2px 20px 16px}
.rules>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;
  padding:14px 0 8px;font:600 15px var(--tight);color:var(--text)}
.rules>summary::-webkit-details-marker{display:none}
.rules>summary::before{content:"\25B8";color:var(--green);font-size:13px;line-height:1;flex:none}
.rules[open]>summary::before{content:"\25BE"}
.rules-tag{margin-left:auto;font:400 10px var(--tight);letter-spacing:.14em;
  text-transform:uppercase;color:var(--green);white-space:nowrap}
.rules ol,.rules ul{margin:4px 0 0;padding-left:22px}
.rules li{margin:0 0 10px;font:300 13.5px/1.7 var(--sans);color:var(--soft);max-width:62ch}
.rules li::marker{color:var(--green)}
.rules li:last-child{margin-bottom:0}
.rules-ver{margin:8px 0 0;font-size:11.5px;color:var(--muted)}

/* paste to fill */
.pasterow{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:10px}
.pasterow .btn{margin-top:0}
.pasterow .hint{margin:0}
.sorted-ok{color:var(--green)}
.paste-again{margin:10px 0 0;font-size:12.5px;color:var(--muted)}
.unsorted{margin-top:12px;border:1px solid rgba(240,180,41,.45);
  background:rgba(240,180,41,.07);border-radius:16px;padding:14px 16px}
.unsorted .eyebrow{margin-top:0;color:#f0b429}
.unsorted textarea{margin-top:8px}

/* one question per section */
.fld{margin-top:22px;padding-top:16px;border-top:1px solid rgba(255,255,255,.07)}
.fld:first-child{border-top:0;padding-top:0}
.eyebrow{display:block;margin-top:14px;font:400 10.5px var(--tight);letter-spacing:.16em;
  text-transform:uppercase;color:var(--green)}
.eyebrow.top{margin-top:0}
.eyebrow.sm{margin:0 0 4px;font-size:10px;letter-spacing:.12em;color:var(--muted)}
.lbl.q{margin-top:7px;text-transform:none;letter-spacing:0;color:var(--text);
  font:500 15px/1.45 var(--tight);max-width:62ch}
.fld-foot{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:7px}
.wc{font-family:var(--mono);font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;
  white-space:nowrap}
.exbox{margin-top:10px;border:1px dashed rgba(255,255,255,.20);border-radius:14px;
  background:rgba(0,0,0,.16);padding:14px 16px}
.ex-lbl{display:block;margin-bottom:8px;font:400 10.5px var(--tight);letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted)}
.ex-lbl i{font-style:normal;text-transform:none;letter-spacing:0;color:rgba(255,255,255,.4);
  margin-left:8px;font-size:11px}
.ex-body{font:300 13.5px/1.7 var(--sans);color:rgba(255,255,255,.7);max-width:64ch}
.ex-body>:first-child{margin-top:0}
.ex-body p{margin:0 0 10px}
.ex-body ul,.ex-body ol{margin:0 0 10px;padding-left:20px}
.ex-body li{margin:4px 0}
.ex-body b{color:rgba(255,255,255,.85)}

/* inline error and warning states, painted after a submit attempt */
input.has-error,textarea.has-error,select.has-error{border-color:var(--red);
  box-shadow:0 0 0 1px rgba(255,60,56,.35)}
input.has-warn,textarea.has-warn{border-color:rgba(240,180,41,.7)}
.eb.has-error{border-left:2px solid var(--red);padding-left:12px}
.eb.has-warn{border-left:2px solid rgba(240,180,41,.7);padding-left:12px}
.fld-msg{margin:6px 0 0;font:400 12.5px/1.55 var(--sans);max-width:60ch}
.fld-err{color:#ffb3b1}
.fld-warn{color:#ffd98a}

/* backers already committed */
.bk-row,.ms-row{margin-top:12px;border:1px solid var(--edge2);background:var(--card);
  border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:11px}
.row-head{display:flex;align-items:center;gap:12px}
.row-k{font:600 13.5px var(--tight);color:var(--text)}
.row-head .btn{margin:0 0 0 auto}
.bk-head{margin-top:14px;font-family:var(--mono);font-size:12.5px;
  font-variant-numeric:tabular-nums;color:var(--soft)}
.bk-head .dimline{color:var(--muted);font-family:var(--sans);font-size:12.5px}
.bk-head .okline{color:var(--green)}
.bk-chip{margin-top:2px}
.bk-chip .sponsors{margin-top:4px}
.bk-file{margin-top:6px;color:var(--soft)}

/* milestone rows */
.ms-grid{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.ms-f{display:flex;flex-direction:column;min-width:0}
.ms-f.grow{flex:1;min-width:190px}
.ms-f.amt{width:170px;flex:none}
.ms-f.mth{width:190px;flex:none}
.ms-f input,.ms-f textarea{padding:10px 12px;border-radius:11px;font-size:13.5px}
.ms-f input.money{font-family:var(--mono);font-variant-numeric:tabular-nums}
.amt-echo{margin-top:5px;font-family:var(--mono);font-size:11px;color:var(--muted);
  font-variant-numeric:tabular-nums}
.ms-flags{display:flex;gap:18px;flex-wrap:wrap}
.tot{display:flex;flex-direction:column;gap:5px;margin-top:14px;
  font-family:var(--mono);font-size:12.5px;font-variant-numeric:tabular-nums;color:var(--soft)}
.tot .bad{color:#ff8582}
.tot .warnc{color:#f0b429}
.tot .okc{color:var(--green)}
.ms-flagtag{display:inline-block;margin-left:8px;padding:2px 9px;border-radius:999px;
  font:600 10px var(--tight);letter-spacing:.08em;text-transform:uppercase;
  color:var(--green);border:1px solid rgba(92,183,90,.45);background:rgba(92,183,90,.12);
  vertical-align:2px}
.ms-flagtag.done{color:#7eb3ff;border-color:rgba(126,179,255,.45);background:rgba(44,94,134,.3)}
.emptyrow{margin:12px 0 0;font-size:12.5px;color:var(--muted)}

/* acceptance criteria: one input per criterion, one line each */
.crit-list{display:flex;flex-direction:column;gap:7px;margin-top:2px}
.crit{display:flex;align-items:center;gap:8px;flex-wrap:nowrap}
.crit-box{flex:none;width:14px;height:14px;border:1px solid rgba(255,255,255,.38);
  border-radius:4px}
.crit input{flex:1;min-width:0;padding:9px 11px;border-radius:10px;font-size:13.5px}
.crit-del{flex:none;width:26px;height:26px;padding:0;border-radius:8px;cursor:pointer;
  border:1px solid var(--edge2);background:rgba(255,255,255,.05);color:var(--muted);
  font:400 15px/1 var(--sans)}
.crit-del:hover{border-color:rgba(255,60,56,.6);color:#ffb3b1}
.crit-add{margin-top:9px;font-size:12.5px}

/* checks */
.checks{margin-top:16px;border:1px solid var(--edge);background:rgba(0,0,0,.16);
  border-radius:16px;padding:16px 18px}
.checks h4{margin:0 0 10px;font:400 10.5px var(--tight);letter-spacing:.16em;
  text-transform:uppercase;color:var(--green)}
.check{display:flex;gap:11px;align-items:flex-start;margin:9px 0;font-size:13px;line-height:1.6}
.check .k{flex:none;margin-top:1px;padding:3px 9px;border-radius:999px;border:1px solid currentColor;
  font:700 9.5px var(--tight);letter-spacing:.1em;text-transform:uppercase}
.check.err{color:#ffb3b1}
.check.warn{color:#ffd98a}
.check.ok{color:var(--green)}
.check.note{color:rgba(255,255,255,.5)}
.check .t{color:var(--soft);max-width:60ch}
.check .t b{color:inherit}
.check ul{margin:7px 0 0;padding-left:18px;color:var(--muted)}
.check li{margin:3px 0}

/* private block */
.privnote{margin-top:6px}

/* submit */
.subrow{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:22px}
.blockmsg{color:#ffb3b1;font-size:12.5px;line-height:1.6;max-width:44ch}
.conf{margin-top:14px;border:1px solid rgba(92,183,90,.5);background:rgba(92,183,90,.10);
  border-radius:16px;padding:16px 18px;color:var(--soft);font-size:13.5px;line-height:1.65}
.conf b{color:var(--green)}
.conf p{margin:8px 0 0}

/* "see it as a page" preview */
.preview-wrap{max-width:none;margin-top:16px;border:1px solid rgba(92,183,90,.35);
  border-radius:20px;background:rgba(0,0,0,.18);padding:0 22px 26px}
.preview-flag{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;
  padding:13px 0;border-bottom:1px solid var(--edge);
  font:400 10.5px var(--tight);letter-spacing:.14em;text-transform:uppercase;color:var(--green)}
.preview-flag span:last-child{color:var(--muted)}
.preview-flag.mid{margin-top:30px;border-top:1px solid var(--edge)}
.preview-wrap .crumb{margin-top:16px}
.preview-wrap h2{margin-top:34px}
.preview-wrap .meta-line{margin-bottom:6px}
.preview-wrap .meta-line .dim{font-size:13px}
.preview-wrap .body-text,.preview-wrap .rules li{max-width:64ch}
.preview-wrap .rules{background:rgba(92,183,90,.07);border-color:rgba(92,183,90,.4);margin-top:20px}
.task{list-style:none;margin:0 0 16px;padding-left:2px}
.task li{position:relative;margin:7px 0;padding-left:27px}
.task li::before{content:"";position:absolute;left:0;top:5px;width:14px;height:14px;
  border:1px solid rgba(255,255,255,.38);border-radius:4px}

/* the board card, as the same fields render on the front page */
.card-mock{max-width:380px;margin-top:18px}

@media(max-width:620px){
  .ms-f.amt,.ms-f.mth{width:100%}
  .row-head .btn{height:32px;padding:0 12px;font-size:12px}
}
</style>
````



---

# Part 11. FILE: docs/prototype/build.py

````python
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
````
