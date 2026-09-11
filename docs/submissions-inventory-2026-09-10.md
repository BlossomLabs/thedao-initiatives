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
