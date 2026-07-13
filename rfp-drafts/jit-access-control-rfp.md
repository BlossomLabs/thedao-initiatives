# RFP: Just-in-Time Access Control for Web3 Startups

| | |
|---|---|
| **Status** | Draft (early) |
| **Lifecycle** | Draft → Fundraising → Funded → Open for proposals → Reviewing proposals → In progress → Complete |
| **Budget** | [PROPOSED: up to $180,000 USD], placeholder to be validated |
| **Proposal window** | 15 days, opening once the RFP is fully funded |
| **Indicative duration** | 12 months (proposers set their own timeline) |
| **Contact / questions** | [FORUM LINK] |

> **Scoping note:** Named by practitioners as a real, recurring gap. Budget and scope need a validation pass before publishing.

## Why this matters

A core OPSEC rule says no human keeps standing access to production; changes flow through automated, reviewed pipelines. But sometimes a person needs to go into AWS and fix something now. The safe pattern is just-in-time access: file exactly what you need to do, the exact permissions, and the exact time window; get it reviewed; receive a scoped role that expires on its own; leave a full log.

Tools for this exist, and they are enterprise-grade, heavy, and corporate. Nothing is scrappy enough for a Web3 startup to adopt in a day. OPSEC auditors name this gap as one of the most common blockers when teams try to level up.

## Who we expect to do this

In the interest of full transparency:

- No pre-selected recipient. Open call.
- Applicants must disclose any commercial access-management product they maintain.

## Existing work

- Enterprise privileged-access and JIT tools, which prove the pattern at a weight startups won't carry
- Cloud-native IAM primitives (AWS, GCP) for the tool to orchestrate

## Scope

**In scope**

- A lightweight JIT flow: request (task, exact permissions, time window) → multi-party approval → automated grant of a scoped, time-boxed role → automatic expiry
- A complete, tamper-evident audit trail of who accessed what, when, and why
- First-class support for the clouds startups actually use, AWS and GCP first
- A setup path a small team completes in a day

**Out of scope**

- Rebuilding cloud IAM; this orchestrates existing provider primitives
- Full enterprise PAM scope; the point is the lightweight subset startups will actually use

## Hard requirements

1. **Open source** under an OSI-approved license.
2. **Startup-adoptable.** Documented setup a small team completes quickly, with sane defaults.
3. **Scoped and time-boxed by construction.** Grants are minimal and expire automatically; no lingering standing access.
4. **Auditable.** Every grant and use logged in a tamper-evident trail.
5. **Independent security review** published before the adoption milestone, given the access this brokers.

## Milestones (draft)

Early draft. Final milestones and payments are negotiated with the selected team and fixed in the grant agreement.

### A - Design and threat model - $35,000

- [ ] Documented JIT model: request, approval, grant, expiry, audit
- [ ] Threat model covering approval bypass, privilege escalation, and audit tampering
- [ ] Startup adoption design: defaults, setup flow, supported providers

### B - Reference tool - $95,000

- [ ] Working tool for AWS and GCP implementing the full request-to-expiry flow with multi-party approval
- [ ] Tamper-evident audit trail
- [ ] All code open source; published independent security review, findings addressed

### C - Adoption - $50,000

- [ ] At least [N] startups using the tool in production, confirmed publicly
- [ ] Published case studies and a public metrics page: teams, grants brokered, standing-access reduction
- [ ] At least [N] improvements or new provider integrations shipped from adoption feedback, documented publicly

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report or review, a named organization confirming use) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the RFP is fully funded and stays open for 15 days.
- Proposals include: team and track record, technical approach, a milestone plan with per-milestone budget (the draft above, or a stronger version), and full disclosures.
- Giveth selects the team within 7 days of the window closing, weighing credibility, price, and strength of the proposed milestones.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, unused funds become claimable by the donors who backed the RFP for 30 days; unclaimed funds go to TheDAO Security Fund for other initiatives.
