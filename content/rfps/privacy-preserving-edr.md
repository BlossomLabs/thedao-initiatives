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
duration: 12
---
## Why this matters

Endpoint Detection and Response is one of the highest-value security controls a team can run, and almost nobody in crypto runs it. Why? Mainstream EDR (CrowdStrike, SentinelOne) sits in your operating system kernel and streams your telemetry to a central vendor. Users worry about the privacy of their data and device usage. Even security engineers refuse to install that on their own machines, and honestly, who can blame them? The result is a blind spot on the exact laptops that hold keys and approve transactions.

This grant funds an EDR that crypto teams will actually adopt: user-space, self-hostable, privacy-preserving by construction, tuned for Web3 threats, and endorsed as safe to roll out across a team.

## The recipient

This is a grant, and Auditware is the recipient. Full transparency on why: the concept was developed with them, they already built an internal user-space EDR prototype on open-source tooling in a few weeks, and they have committed to taking this on. We think they are the right team for it.

## Existing work

- Auditware's internal user-space EDR prototype, built on open-source endpoint tooling in a few weeks
- Mature open-source endpoint instrumentation (osquery and similar) to build on

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

### A - Architecture, threat model, and privacy design - $40,000

- [ ] A published threat model: the endpoint attacks in scope and the residual risks left out
- [ ] The documented user-space architecture and cryptographic privacy design, with the guarantee stated precisely
- [ ] The detection-rule specification and the format new detectors are written in
- [ ] A public design write-up an outside engineer can evaluate the trust model from

### B - Working MVP - $110,000

- [ ] A self-hostable user-space agent on macOS, Windows, and Linux, installable from a documented, reproducible process
- [ ] The encrypted telemetry pipeline implementing the Milestone A privacy guarantee, with its tamper-evident audit trail
- [ ] The initial Web3 detectors, each with a test showing it fires on the intended behavior and stays quiet otherwise
- [ ] All code open source, with the public third-party security review published and its findings addressed

### C - Adoption, hardening, and endorsement - $150,000

**Tranche 1: Launch and endorsement - $50,000**

- [ ] The detector library expanded to at least 25 Web3 detectors, each with a firing test
- [ ] A recognized Ethereum security organization, or a named panel of recognized security engineers, publicly reviews the agent and states it is safe to install across a team
- [ ] A public website, install guide, and a recorded walkthrough a non-expert admin can follow

**Tranche 2: Adoption evidence - $100,000**

- [ ] At least 15 crypto organizations running the agent in production, confirmed publicly by those teams
- [ ] A published adoption-feedback report covering at least 10 evaluations, with the resulting fixes and detectors shipped
- [ ] Published case studies and a public metrics page: deployments, detectors shipped, detections in the field
