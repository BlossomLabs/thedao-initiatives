---
title: Decentralized, Privacy-Preserving EDR
goal: 300000
type: grant
status: approved
summary: Endpoint Detection and Response is one of the highest-value security
  controls a team can run, and almost nobody in crypto runs it, because
  mainstream EDR sits in your kernel and streams telemetry to a central
  vendor. This grant funds an EDR crypto teams will actually adopt,
  user-space, self-hostable, privacy-preserving by construction, tuned for
  Web3 threats. Auditware is the recipient.
---
| | |
|---|---|
| **Status** | Draft |
| **Budget** | $300,000 USD |
| **Proposal window** | 15 days, opening once the grant is fully funded |
| **Indicative duration** | 12 months |

## Why this matters

Endpoint Detection and Response is one of the highest-value security controls a team can run, and almost nobody in crypto runs it. Why? Mainstream EDR (CrowdStrike, SentinelOne) sits in your operating system kernel and streams your telemetry to a central vendor. Users worry about the privacy of their data and device usage. Even security engineers refuse to install that on their own machines, and honestly, who can blame them? The result is a blind spot on the exact laptops that hold keys and approve transactions.

This grant funds an EDR that crypto teams will actually adopt: user-space, self-hostable, privacy-preserving by construction, tuned for Web3 threats, and endorsed as safe to roll out across a team.

## The recipient

This is a grant, and Auditware is the recipient. Full transparency on why: the concept was developed with them, they already built an internal user-space EDR prototype on open-source tooling in a few weeks, and they have committed to taking this on. We think they are the right team for it.

Auditware will disclose their relationships to existing OpSec tooling and firms in their proposal, and everything they build here is open source, so the community can hold the work to account.

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
- Configurable and extensible detectors: teams can easily implement and add private custom detectors for their team, or contribute to the open-source set
- An endorsement path, with an Ethereum security body confirming the agent is safe to install

**Out of scope**

- Kernel-level instrumentation. It gives deeper assurance, and it also needs OS-vendor approval and puts attack surface inside the user's kernel. Fine as future work.
- Replacing enterprise EDR in regulated environments. This is for crypto teams who run nothing today.

## Hard requirements

1. **Open source.** Agent, detectors and server components under an OSI-approved license, with no closed-source dependency for core function.
2. **Self-hostable.** A team can run the full stack without handing plaintext telemetry to anyone.
3. **Privacy by construction.** A documented cryptographic guarantee that raw telemetry stays unreadable unless a rule match is proven, plus the process for what gets revealed after a match.
4. **Security review.** A public third-party review of the agent itself. Installing it grants deep access, so the agent has to earn that trust.
5. **Reproducible install** that a non-expert can run.

## Milestones (draft)

These milestones are a draft, developed with Auditware. The final milestones and payments get negotiated with Auditware and fixed in the grant agreement.

**A - Architecture, threat model, and privacy design - $40,000**

- A published threat model: the endpoint attacks in scope and the residual risks left out
- The documented user-space architecture and cryptographic privacy design, with the guarantee stated precisely
- The detection-rule specification and the format new detectors are written in
- A public design write-up an outside engineer can evaluate the trust model from

**B - Working MVP - $110,000**

- A self-hostable user-space agent on [macOS, Windows, and Linux, as fixed in Milestone A], installable from a documented, reproducible process
- The encrypted telemetry pipeline implementing the Milestone A privacy guarantee, with its tamper-evident audit trail
- The initial Web3 detectors, each with a test showing it fires on the intended behavior and stays quiet otherwise
- All code open source, with the public third-party security review published and its findings addressed

**C - Adoption, hardening, and endorsement - $150,000**

Paid in two tranches: launch work first, then adoption evidence.

*Tranche 1: Launch and endorsement - $50,000*

- The detector library expanded to at least [20-30] Web3 detectors, each with a firing test
- A recognized Ethereum security organization, or a named panel of recognized security engineers, publicly reviews the agent and states it is safe to install across a team
- A public website, install guide, and a recorded walkthrough a non-expert admin can follow

*Tranche 2: Adoption evidence - $100,000*

- At least 15 crypto organizations running the agent in production, confirmed publicly by those teams
- A published adoption-feedback report covering at least [N] evaluations, with the resulting fixes and detectors shipped
- Published case studies and a public metrics page: deployments, detectors shipped, detections in the field

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report or review, a named organization confirming use) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to Auditware, agreed between Giveth and Auditware before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. Auditware coordinates their payment.

## Process

- The proposal window opens once the grant is fully funded and stays open for 30 days. In that window, Auditware submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures.
- Giveth reviews the proposal within 7 days and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives or can choose to refund to donors.
