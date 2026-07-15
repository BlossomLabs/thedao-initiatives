# RFP: Multisig Transaction Coordination Tooling

| | |
|---|---|
| **Status** | Draft |
| **Lifecycle** | Draft → Fundraising → Funded → Open for proposals → Reviewing proposals → In progress → Complete |
| **Budget** | [PROPOSED: up to $350,000 USD], placeholder to be validated |
| **Proposal window** | 15 days, opening once the RFP is fully funded |
| **Indicative duration** | 12 months (proposers set their own timeline) |
| **Contact / questions** | [FORUM LINK] |

> **Scoping note:** The problem and shape are clear; the budget and the exact trust-minimization approach need a scoping session before this publishes. Numbers are placeholders.

## Why this matters

Multisig coordination is where some of the largest losses in crypto happen. Bybit showed the failure mode: signers approved a transaction that looked legitimate on their screens and wasn't. Today's defense is brute redundancy: multiple people, on multiple devices, across multiple channels, each independently simulating and eye-checking the same transaction. It is slow, it fatigues teams, and it still fails when several signers see the same spoofed view.

This RFP funds tooling that replaces redundancy-by-headcount with verifiable assurance: signers can trust that what they approve is what will execute, and that the information in front of them was never tampered with.

## Who we expect to do this

In the interest of full transparency:

- There is no pre-selected recipient. This is an open call.
- Strong candidates know the Safe ecosystem, transaction simulation, and signer workflows deeply.
- Applicants must disclose any commercial multisig or wallet product they maintain.

## Existing work

- **Safe** as the dominant multisig platform to integrate with
- Transaction simulation tooling (Tenderly and similar) that signers use today, one at a time
- Early experiments adding an AI agent as an extra signer that checks transactions before signing; the ones seen so far are closed source and paid
- The Bybit post-mortems as the canonical description of the threat

## Scope

**In scope**

- A coordination flow where signers verify a transaction's true effect, beyond its on-screen presentation
- Trust-minimized verification: one party's simulation can be relied on by the others (attested or proven outcomes) instead of every signer repeating the whole check blind
- Tamper-evidence: transaction details and simulation results provably unaltered in transit and display
- Integration with existing multisig infrastructure, Safe first

**Out of scope**

- Replacing Safe or writing a new multisig contract standard
- Custody or key management; this is the coordination and verification layer above signing

## Hard requirements

1. **Open source** under an OSI-approved license.
2. **Integrates with Safe** so teams keep their existing setup.
3. **Trust-minimized verification.** A written security argument for why a signer can rely on the tool instead of full independent re-simulation.
4. **Tamper-evident by design**, with the guarantee stated precisely and reviewed.
5. **Independent security review** published before the adoption milestone.

## Milestones (draft)

Draft only. Final milestones and payments are negotiated with the selected team and fixed in the grant agreement. Strengthening this draft, especially the verification approach, is part of a winning proposal.

### A - Failure-mode analysis and protocol design - $50,000

- [ ] Published analysis of multisig coordination failure modes, Bybit-class attacks included
- [ ] A designed verification approach with a written security argument for its trust-minimization
- [ ] Threat model naming what is defended and what stays the operator's responsibility

### B - Reference tool - $150,000

- [ ] A working coordination tool integrated with Safe, implementing the Milestone A verification and tamper-evidence
- [ ] All code open source with reproducible deployment
- [ ] Published independent security review, findings addressed

### C - Adoption - $150,000

- [ ] At least [N] treasuries or DAOs using the tool for real signing, confirmed publicly
- [ ] Published case studies and a public metrics page: organizations, transactions coordinated, incidents averted where reportable
- [ ] Published adoption-feedback report covering at least [N] deployments, with the resulting fixes shipped

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
