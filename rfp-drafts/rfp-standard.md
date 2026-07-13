# TheDAO RFP Standard

**Version 0.1 — July 2026. This is an evolving standard, not a finished one.** It will change as more RFPs go out, more proposers ask questions, and the community gives feedback. When the standard and an already-published RFP disagree, the standard wins for all future RFPs; existing RFPs get updated when practical. The Vyper verified-compiler RFP is the reference example of this standard.

Every TheDAO RFP follows the structure and boilerplate below. Sections marked **[standard text]** should be copied nearly verbatim; sections marked **[per-RFP]** are written fresh each time.

---

## Ground rules that apply to every RFP

1. **All amounts are in US dollars.** Budgets, milestone payments, and funding goals are stated in USD, never in ETH or any other token. If a source document prices work in ETH, convert it to USD at drafting time and state only the USD figure.
2. **Every RFP lives in a forum thread as well as on the board.** The forum is where the community asks questions and where the RFP evolves. The key-facts table links to it. (The forum home hasn't been chosen yet — until it is, use the placeholder `[FORUM LINK]`.)
3. **Every RFP discloses who co-wrote it.** If the RFP was drafted with an outside team or expert, name them in the "Who we expect to do this" section. Integrity over theater.
4. **Milestones are always published, and always as a draft.** They set expectations for scope and price; the final milestone plan is negotiated with the selected team and fixed in the grant agreement. Strengthening the draft milestones is explicitly one way a proposal wins.
5. **Acceptance criteria are binary events with public evidence.** "Frontend done" is weak; "end-to-end demo recorded on testnet" is strong. Wherever possible, criteria should be checkable by a non-expert (a CI badge, a published report, a public confirmation from a third party).
6. **Length target: 1–2 pages** (roughly 800–2,500 words). An RFP is an invitation, not a procurement contract.

---

## Required sections, in order

### 1. Title + key-facts table — [standard format]

The table at the top is identical in shape for every RFP:

```markdown
| | |
|---|---|
| **Status** | Draft |
| **Lifecycle** | Draft → Fundraising → Funded → Open for proposals → Reviewing proposals → In progress → Complete |
| **Budget** | Up to $X USD, paid per accepted milestone |
| **Proposal window** | 15 days, opening once the RFP is fully funded |
| **Indicative duration** | X months (proposers set their own timeline) |
| **Contact / questions** | [FORUM LINK] |
```

- **Status** is bolded to the current stage of the lifecycle shown in the row below it.
- **Budget** is always a USD cap ("Up to $X USD"), always paid per accepted milestone.

### 2. Why this matters — [per-RFP]

One or two paragraphs on why the fund cares: the ecosystem need, ideally anchored to a real incident or a concrete gap, followed by a short bullet list of the end state the money buys.

### 3. Who we expect to do this — [per-RFP, section always present]

This section appears in **every** RFP, near the top, whether or not there is a frontrunner. It opens with "In the interest of full transparency:" and covers:

- **If there is an expected team:** who co-drafted the RFP, that we believe they are well positioned to win, why we believe the price is fair, and that the proposal window is still real — a challenger wins by credibly doing it for less or proposing stronger milestones.
- **If there is no clear vendor:** say so plainly — the field is open, and here is the kind of team we imagine succeeding.
- **Always:** every applicant, including any expected recipient, must disclose their relationship to the existing codebases and teams named in the RFP.

### 4. Existing work — [per-RFP]

Name the prior art openly, with links, so every bidder can build on it. If proposers may build on an alternative foundation, say what would justify that.

### 5. Scope — [per-RFP]

Two lists: **In scope** and **Out of scope**. The out-of-scope list is where you head off the expensive misunderstandings (perpetual maintenance, adjacent problems, things that remain the user's responsibility).

### 6. Hard requirements — [per-RFP, follow the pattern]

A short numbered list of instant self-screens — conditions a proposal must meet or it will not be considered. Recurring ones:

1. **Open source.** All code and documentation under an OSI-approved license.
2. **Machine-checkable acceptance** wherever the domain allows it (public CI, published reports).
3. **Pinned targets** — exact versions/commits/forks the work covers, where applicable.
4. **A plain-language assurance or limitations statement** for anything with a trust story.
5. **A credible maintenance plan** for keeping the work alive after the grant.

### 7. Milestones (draft) — [per-RFP, standard preamble]

Open with this standard preamble, adapted as needed:

> These milestones are a draft of what we expect[, scoped with NAME]. Final milestones and payments are negotiated with the selected team and fixed in the grant agreement. Strengthening this draft is part of a winning proposal.

Then:

- Each milestone has a **name, a USD amount, and a checklist of binary acceptance criteria**.
- Letter the milestones (A, B, C…) when they can be delivered in any order or in parallel; number them when the order is fixed.
- **Back-weight payment toward launch and adoption.** A meaningful share of the budget (the Vyper RFP uses a third) pays only on public release and evidence of real adoption — external integrations, deployments, a public metrics page.
- The adoption milestone always pays last.

### 8. Milestone review and acceptance — [standard text, adapt names]

- Machine-checkable criteria are accepted automatically when their public check passes.
- Judgment-based criteria are signed off by an **independent technical reviewer** with no affiliation to the selected team or the codebases involved, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment or is pro bono; the winning team coordinates their payment.

### 9. Process — [standard text]

This boilerplate is the same in every RFP:

- The proposal window opens once the RFP is fully funded and stays open for **15 days**.
- Proposals include: team and track record; technical approach; a milestone plan with per-milestone budget — the draft above, or a stronger version; and full disclosures.
- Giveth selects the team within **7 days** of the proposal window closing, weighing credibility, price, and strength of the proposed milestones.
- Milestone deliveries are reviewed against the acceptance criteria within **14 days**; payment follows acceptance. If a milestone stalls, remaining tranches are renegotiated or cancelled.
- **The first milestone can be paid up to 50% in advance** so the team has funding to start. If more funds are needed to complete a milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone is not completed in a reasonable amount of time, the team is given a **21-day deadline**; if they fail to meet it, unused funds become claimable by the donors who supported the RFP for **30 days**, after which unclaimed funds go to TheDAO Security Fund for other initiatives.

---

## Companion artifacts for every RFP

- **Board card summary** — a 2–4 sentence plain-language summary plus the USD funding goal, kept in `board-summaries.md`. This is what goes in the RFP dapp's summary field; the full RFP text goes in the details field.
- **Forum thread** — the living home of the RFP once the forum exists.

## Changing this standard

Anyone can propose changes via the forum. Griff approves changes. When the standard changes, bump the version number at the top and note what changed here:

- **0.1 (July 2026)** — first draft, extracted from the Vyper verified-compiler RFP and the July 2026 RFP format research.
