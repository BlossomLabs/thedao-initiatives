# RFP: Free Self-Service OPSEC Self-Audit

| | |
|---|---|
| **Status** | Draft |
| **Lifecycle** | Draft → Fundraising → Funded → Open for proposals → Reviewing proposals → In progress → Complete |
| **Budget** | [PROPOSED: up to $120,000 USD], placeholder to be validated |
| **Proposal window** | 15 days, opening once the RFP is fully funded |
| **Indicative duration** | 9 months (proposers set their own timeline) |
| **Contact / questions** | [FORUM LINK] |

> **Scoping note:** Direction is clear from the source conversation; budget and platform scope need a short validation pass.

## Why this matters

The best time to get OPSEC right is at the start, when a team is forming habits and nothing has to be undone. It is also when teams have the least money, so paying for an audit is a hard sell. Open checklists exist, but they leave a founder staring at "you need just-in-time access control" with no idea how to do that on their stack.

This RFP funds a self-service tool that walks a team through an OPSEC self-audit and tells them exactly how to close each gap on their actual infrastructure. A charge on the order of a dollar is fine: it covers AI inference, and people care more about what they paid for. This becomes the on-ramp to the public OPSEC rating system.

## Who we expect to do this

In the interest of full transparency:

- **Auditware** has been building toward this with their platform and may apply. There is no locked recipient.
- Applicants must disclose any paid OPSEC product they sell, since this deliverable stays genuinely free to use and open.

## Existing work

- **SEAL Certs**, **W3OS**, and other open standards teams can self-audit against today, which expose the "I don't know how to implement this control" gap this tool closes
- Austin Griffith's $1 AI-audit concept as the model for near-free, self-service, AI-assisted tooling
- The public OPSEC rating system (separate RFP) as the natural next step after a self-audit

## Scope

**In scope**

- A guided self-audit built on open standards, tool-agnostic
- Infrastructure-specific remediation: for each gap, concrete steps for the team's actual stack (AWS, GCP, DigitalOcean, and so on), with runnable scripts where possible
- An AI-guided flow, surfacing the "how do I do this on my setup" knowledge that already exists
- A closing hand-off: a neutral directory of OPSEC audit vendors for teams ready to pay for verification

**Out of scope**

- Issuing any rating or certificate; grading belongs to the rating system RFP. This tool prepares a team for it.
- Replacing a human OPSEC audit for teams that need one

## Hard requirements

1. **Free or near-free**, with any charge limited to covering inference costs.
2. **Open source** under an OSI-approved license, so the community can extend the playbooks.
3. **Actionable output.** Every identified gap comes with concrete, stack-specific remediation.
4. **No dark patterns.** No upsell of a specific paid product; the vendor directory is neutral and inclusive.

## Milestones (draft)

Draft only. Final milestones and payments are negotiated with the selected team and fixed in the grant agreement.

### A - Content and framework - $30,000

- [ ] A guided self-audit mapped onto open standards
- [ ] Infrastructure-specific remediation playbooks for at least the major cloud providers, with runnable scripts where feasible
- [ ] The AI-agent knowledge and prompt design, documented

### B - Platform - $50,000

- [ ] A working self-service tool: questionnaire, per-infrastructure guidance, and the neutral vendor directory
- [ ] Near-free access model implemented
- [ ] All code and playbooks open source

### C - Adoption - $40,000

- [ ] At least [N] teams complete a self-audit through the tool, confirmed publicly where possible
- [ ] At least [N] playbook improvements published from real user feedback
- [ ] A working hand-off into the public OPSEC rating system
- [ ] Public metrics page: self-audits completed, playbooks covered, vendors listed

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the RFP is fully funded and stays open for 15 days.
- Proposals include: team and track record, technical approach, a milestone plan with per-milestone budget (the draft above, or a stronger version), and full disclosures.
- Giveth selects the team within 7 days of the window closing, weighing credibility, price, and strength of the proposed milestones.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, unused funds become claimable by the donors who backed the RFP for 30 days; unclaimed funds go to TheDAO Security Fund for other initiatives.
