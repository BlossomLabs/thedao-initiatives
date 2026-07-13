# RFP: Decentralized, Privacy-Preserving EDR

| | |
|---|---|
| **Status** | Draft |
| **Lifecycle** | Draft → Fundraising → Funded → Open for proposals → Reviewing proposals → In progress → Complete |
| **Budget** | Up to $300,000 USD, paid per accepted milestone |
| **Proposal window** | 15 days, opening once the RFP is fully funded |
| **Indicative duration** | 12 months (proposers set their own timeline) |
| **Contact / questions** | [FORUM LINK] |

## Why this matters

Endpoint Detection and Response is one of the highest-value security controls a team can run, and almost nobody in crypto runs it. Mainstream EDR (CrowdStrike, SentinelOne) sits in the operating system kernel and streams telemetry to a central vendor, so even security engineers refuse to install it on their own machines. That leaves a blind spot on the exact laptops that hold keys and approve transactions.

This RFP funds an EDR crypto teams will actually adopt: user-space, self-hostable, privacy-preserving by construction, tuned for Web3 threats, and endorsed as safe to roll out across a team.

## Who we expect to do this

In the interest of full transparency:

- The concept was developed with **Auditware**, who already built an internal user-space EDR prototype on open-source tooling and have said they would take this on. We believe they are well positioned to receive the grant.
- The proposal window is still real. If another team can deliver something safer, cheaper, or more adoptable, we want that proposal.
- Every applicant must disclose their relationship to existing OPSEC tooling and firms.

## Existing work

- Auditware's internal user-space EDR prototype, built on open-source endpoint tooling in a few weeks
- Mature open-source endpoint instrumentation (osquery and similar) to build on
- Zero-knowledge tooling for the privacy layer, so telemetry can be checked against detection rules without ever being readable by a human

## Scope

**In scope**

- A user-space endpoint agent: self-hostable, no kernel privileges, no mandatory central vendor
- Telemetry encrypted so nobody can inspect it unless the data provably matches a detection rule
- A tamper-evident audit trail of detections and responses
- Web3-specific detectors: in-browser wallet invocation, outgoing crypto transactions, malicious dependency signatures, and more
- An endorsement path with an Ethereum security body confirming the agent is safe to install

**Out of scope**

- Kernel-level instrumentation. It gives deeper assurance but needs OS-vendor approval and puts attack surface inside the user's kernel. Fine as future work.
- Replacing enterprise EDR in regulated environments. This is for crypto teams who run nothing today.

## Hard requirements

1. **Open source.** Agent, detectors, and server components under an OSI-approved license, no closed-source dependency for core function.
2. **Self-hostable.** A team can run the full stack without handing plaintext telemetry to anyone.
3. **Privacy by construction.** A documented cryptographic guarantee that raw telemetry stays unreadable unless a rule match is proven, plus the process for what gets revealed after a match.
4. **Security review.** A public third-party review of the agent itself, since installing it grants deep access.
5. **Reproducible install** that a non-expert can run.

## Milestones (draft)

These milestones are a draft, developed with Auditware. Final milestones and payments are negotiated with the selected team and fixed in the grant agreement. Strengthening this draft is part of a winning proposal.

- A and B are the build; C is adoption and pays last.

### A - Architecture, threat model, and privacy design - $40,000

- [ ] Published threat model: the endpoint attacks in scope and the residual risks left out
- [ ] Documented user-space architecture and cryptographic privacy design, with the guarantee stated precisely
- [ ] Detection-rule specification and the format new detectors are written in
- [ ] Public design write-up an outside engineer can evaluate the trust model from

### B - Working MVP - $110,000

- [ ] Self-hostable user-space agent on [macOS, Windows, and Linux, as fixed in Milestone A], installable from a documented, reproducible process
- [ ] Encrypted telemetry pipeline implementing the Milestone A privacy guarantee, with tamper-evident audit trail
- [ ] Initial Web3 detectors, each with a test showing it fires on the intended behavior and stays quiet otherwise
- [ ] All code open source; public third-party security review published, findings addressed

### C - Adoption, hardening, and endorsement - $150,000

Paid in two tranches: launch work and adoption evidence.

**Tranche 1: Launch and endorsement - $50,000**

- [ ] Detector library expanded to at least [20-30] Web3 detectors, each with a firing test
- [ ] A recognized Ethereum security organization, or a named panel of recognized security engineers, publicly reviews the agent and states it is safe to install across a team
- [ ] Public website, install guide, and a recorded walkthrough a non-expert admin can follow

**Tranche 2: Adoption evidence - $100,000**

- [ ] At least [N] crypto organizations running the agent in production, confirmed publicly by those teams
- [ ] Published adoption-feedback report covering at least [N] evaluations, with the resulting fixes and detectors shipped
- [ ] Published case studies and a public metrics page: deployments, detectors shipped, detections in the field

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
