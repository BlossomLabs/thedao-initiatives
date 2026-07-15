# RFP: Continuous Phishing Simulation for Web3 Teams

| | |
|---|---|
| **Status** | Draft (early) |
| **Lifecycle** | Draft → Fundraising → Funded → Open for proposals → Reviewing proposals → In progress → Complete |
| **Budget** | [PROPOSED: up to $120,000 USD], placeholder to be validated |
| **Proposal window** | 15 days, opening once the RFP is fully funded |
| **Indicative duration** | 9 months (proposers set their own timeline) |
| **Contact / questions** | [FORUM LINK] |

> **Scoping note:** The least developed of the batch; it needs a scoping session before publishing. Expert input says static phishing training has weak ROI. The value is continuous, measured simulation plus controls that limit the damage of any one mistake. Treat this as a starting point.

## Why this matters

Social engineering is a leading cause of crypto compromise, and one-off phishing training does little: interest fades and people revert. What works in traditional security is continuous, realistic simulation. Teams get hit with custom, targeted lures on an ongoing basis (cheap to produce now with AI), and only the people who fall for one get pulled into training, right when it is relevant.

This RFP funds that model for Web3 teams: ongoing simulated phishing with per-team measurement, so resistance to social engineering becomes a tracked, improving number.

## Who we expect to do this

In the interest of full transparency:

- No pre-selected recipient. Open call.
- The Red Guild and others active in phishing education are natural candidates; applicants should disclose related work.

## Existing work

- The Red Guild's phishing dojo and education work in the Ethereum space
- Established Web2 practice (targeted campaigns, per-team scoring, training triggered on failure) as the model to adapt

## Scope

**In scope**

- Ongoing simulated phishing campaigns with realistic, custom lures, against consenting teams
- Per-team measurement: who clicked, who submitted credentials, trend over time
- Training triggered on failure, at the moment it happens
- Paired recommendations for controls that shrink the blast radius of any single mistake

**Out of scope**

- A generic always-on training course with no measurement
- Real credential capture; simulations stay safe and clearly bounded

## Hard requirements

1. **Opt-in and consent-based**, with clear boundaries so simulations are never confused with real attacks.
2. **Privacy-respecting.** Individual results are handled carefully; the goal is team improvement, beyond any surveillance of individuals.
3. **Open source** under an OSI-approved license where feasible.
4. **Measurable.** Every deployment produces trend data a team can act on.

## Milestones (draft)

Early draft. Final milestones and payments are negotiated with the selected team and fixed in the grant agreement.

### A - Design - $25,000

- [ ] Campaign framework, per-team scoring model, opt-in and privacy model
- [ ] The set of blast-radius controls the program will recommend

### B - Build and pilot - $55,000

- [ ] Working simulation tooling with reporting and failure-triggered micro-training
- [ ] A pilot across at least one real organization

### C - Adoption - $40,000

- [ ] At least [N] organizations running continuous simulation, confirmed publicly where possible
- [ ] Public metrics page: organizations, campaigns run, measured improvement over time

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
