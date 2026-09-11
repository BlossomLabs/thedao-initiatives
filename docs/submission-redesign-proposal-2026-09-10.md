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
