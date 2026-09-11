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
