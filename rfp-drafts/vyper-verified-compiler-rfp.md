# RFP: End-to-End Verified Vyper Compiler

| | |
|---|---|
| **Status** | Draft |
| **Lifecycle** | Draft → Fundraising → Funded → Open for proposals → Reviewing proposals → In progress → Complete |
| **Budget** | Up to $600,000 USD, paid per accepted milestone |
| **Proposal window** | 15 days, opening once the RFP is fully funded |
| **Indicative duration** | 12 months (proposers set their own timeline) |
| **Contact / questions** | [FORUM LINK] |

## Why this matters

Developers, auditors, and verification tools reason about Vyper source code; Ethereum executes EVM bytecode. Everything in between is the compiler, and today its correctness rests on testing and auditing alone. In July 2023, miscompiled reentrancy locks let attackers drain tens of millions of dollars from Curve pools whose source code was correct.

This RFP funds a machine-checked proof that Vyper compilation preserves the meaning of source programs, plus the infrastructure to re-verify every future production release. An executable formal semantics lets developers prove properties about Vyper source that carry through to deployed bytecode. The end state:

- A **verified compilation mode** in the official Vyper toolchain, bytecode compiled with it provably matches the source semantics
- **Source-level proofs that reach the chain**, properties proven about Vyper source carry over to the deployed bytecode
- **Continuous verification**, each supported compiler release can be re-verified using the existing proof infrastructure

## Who we expect to do this

In the interest of full transparency:

- This RFP was drafted together with the **Vyper core team**, builds directly on their open-source groundwork, and we believe they are well positioned to receive the grant.
- The proposal window is still real. If another team can credibly deliver this scope for less, or propose materially stronger milestones, we want that proposal. That is exactly how a challenger wins.
- We believe the price is fair: published estimates for comparable end-to-end compiler verification run well above this budget. The open window is how we test that belief.
- Every applicant, including the expected recipient, must disclose their relationship to the existing codebases and teams.

## Existing work

- **[vyper-hol](https://github.com/verifereum/vyper-hol)** - executable formal semantics of a large Vyper subset in HOL4, passing the codegen section of the official Vyper test suite, plus in-progress proofs for the Vyper → Venom → bytecode pipeline (GPL-3.0)
- **[Verifereum](https://github.com/verifereum/verifereum)** - formal EVM semantics in HOL4, validated against the Ethereum Execution Spec Tests
- Proposers may build on this work or justify an alternative foundation in a mature proof assistant with a small trusted kernel (HOL4, Rocq, Isabelle/HOL, Lean)

## Scope

**In scope**

- Executable formal semantics of Vyper, maintained against current releases
- Machine-checked proofs for the full pipeline: Vyper source → Venom IR → EVM bytecode, including optimization passes and ABI encoding/decoding
- A user-facing **verified compilation mode** (a distinguished set of verified optimization passes), with a distribution path agreed with the Vyper maintainers
- Continuous verification in CI against pinned upstream compiler revisions
- Public releases, documentation, and adoption work

**Out of scope**

- Gas semantics (bytecode may be proven correct yet differ in gas behavior; gas modeling is a welcome stretch goal)
- Correctness of user-written contracts. The proof guarantees the bytecode matches the source; source-level safety remains the author's job.
- Verification of the Python compiler implementation itself; the expected architecture is a verified reference compiler cross-checked against production output
- Perpetual re-verification after the grant period. That folds into normal compiler maintenance, which this infrastructure makes inexpensive.

## Hard requirements

1. **Open source.** All code, proofs, and documentation under an OSI-approved license, with no closed-source dependencies.
2. **Kernel-checked, no gaps.** Headline theorems check with zero admitted/cheated lemmas in their dependency graph, enforced by an automated check in public CI. Milestone payment depends on this check passing.
3. **Pinned targets.** Each verified release names the exact upstream Vyper commit, optimization settings, and EVM fork it covers.
4. **Assurance statement.** Each release ships a plain-language document: supported language subset, exclusions, covered passes, and the complete trusted computing base.
5. **Maintenance plan.** A credible plan for keeping proofs current across Vyper releases and EVM hard forks.

## Milestones (draft)

These milestones are a draft of what we expect, scoped with the Vyper core team. Final milestones and payments are negotiated with the selected team and fixed in the grant agreement. Strengthening this draft is part of a winning proposal.

- Milestones are lettered because A-D may be delivered in any order, or in parallel; each pays on acceptance.
- Milestone E always pays last, once the Milestone D release is public.
- The grant agreement may include an advance at signing, counted against the first delivered milestone.

### A - Formal semantics and frontend - $50,000

...

### B - Verified frontend lowering - $125,000

...

### C - Verified optimization pipeline - $100,000

Prove correct the optimization passes in the production optimization pipeline of the pinned release, and wire continuous verification into CI.

...

### D - End-to-end theorem and public release - $125,000

Close the backend proofs (Venom → assembly → bytecode, including stack scheduling) and connect everything into one end-to-end theorem against the formal EVM semantics.

- [ ] A single end-to-end theorem, published in both machine-checked and human-readable form, verified in CI
- [ ] A public release outside users can run, with installation and usage instructions and a distribution plan agreed with the Vyper maintainers (upstream integration, official bundle, or companion tool); the release documents how the verified compiler is executed and what that adds to the trusted base
- [ ] Full assurance statement published: supported subset, exclusions, covered passes, complete trusted computing base, proof assumptions
- [ ] The verified pipeline demonstrated on at least five representative real-world Vyper contracts, results published

### E - Adoption and ecosystem impact - $200,000

Paid in two tranches: launch work and adoption evidence are different things.

**Tranche 1: Launch — $100,000**

- [ ] Public project website explaining the verified compiler and its guarantees in language a non-specialist developer can follow

- [ ] User documentation plus at least one step-by-step tutorial from a Vyper contract to a verified-compilation artifact

- [ ] A recorded technical workshop or webinar for developers and auditors, publicly available

- [ ] A talk accepted or delivered at a major Ethereum or formal-methods event, and at least two published technical blog posts

- [ ] Public roadmap for verifying future Vyper releases, including expected lag behind Vyper stable and hard-fork policy

**Tranche 2: Adoption evidence — $100,000**

- [ ] At least one independent external integration — a protocol team, audit firm, or tooling project using the verified pipeline, confirmed publicly by that party

- [ ] A published case study of a production contract, deployed on Ethereum mainnet or a major L2, whose bytecode is covered by the verified pipeline

- [ ] A public metrics page reporting, at minimum: downloads, on-chain deployments compiled with the verified mode, supported compiler versions, and downstream integrations

- [ ] Continuous verification demonstrated across at least one new production Vyper release after the Milestone D release: proofs repaired, re-checked in CI, new assurance statement published

## Process

- The proposal window opens once the RFP is fully funded and stays open for 15 days

- Proposals include: team and track record in mechanized verification; technical approach (proof assistant, relationship to existing work, frontend strategy, how users run the verified compiler); a milestone plan with per-milestone budget — the draft above, or a stronger version; and full disclosures

- Giveth selects the team within 7 days of the proposal window closing, weighing credibility of the proof plan, price, and strength of the proposed milestones

- Milestone deliveries are reviewed against the acceptance criteria within 14 days; payment follows acceptance. If a milestone stalls, remaining tranches are renegotiated or cancelled

- If any of the milestones are not completed in a reasonable amount of time, the team selected will be given a 21-day deadline to complete the milestone and if they fail to do so, unused funds will be made claimable by the donors that supported the RFP. If the donors do not claim in those 30 days, the unclaimed funds will be sent to TheDAO Security Fund to be used on other initiatives. 

