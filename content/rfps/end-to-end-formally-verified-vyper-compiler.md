---
title: End-to-End Formally Verified Vyper Compiler
type: grant
recipient: Vyper core team
recipient_url: https://vyperlang.org/
goal: 600000
summary: Vyper is the second most widely used EVM language, securing billions of
  dollars in production protocols like Curve, Yearn, and Lido, yet the
  correctness of its compiler rests on testing and auditing alone. This grant
  funds a machine-checked proof that Vyper compilation preserves the meaning of
  source programs, plus the infrastructure to re-verify every future release. No
  other serious smart-contract language, Solidity included, has an effort like
  this underway.
duration: 12
---
## Why this matters

- **Adoption.** Vyper is the second most widely used EVM language, securing billions of dollars in production protocols such as Curve, Yearn, and Lido. A verified Vyper compiler protects real value and increases public assurance in smart contract deployments.
- **Nobody else is doing this.** No other serious smart-contract language (Solidity included) has an effort underway toward formally verified compilation. This grant makes Vyper the only EVM language whose deployed bytecode carries machine-checked guarantees.
- **The compiler is built for it.** Venom, Vyper's LLVM-style SSA intermediate representation, gives the pipeline a clean, stage-by-stage structure that proofs can follow, while running a modern optimization pipeline more advanced than those covered by landmark verified compilers like CompCert. Verifying it means both a safer Vyper and an advance on the state of the art in compiler verification.

Developers, auditors, and verification tools reason about Vyper source code; Ethereum executes EVM bytecode. Everything in between is the compiler, and today its correctness rests on testing and auditing alone. In July 2023, miscompiled reentrancy locks let attackers drain tens of millions of dollars from Curve pools whose source code was correct.

This grant funds a machine-checked proof that Vyper compilation preserves the meaning of source programs, plus the infrastructure to re-verify every future production release.

In addition, an executable formal semantics lets developers prove end-to-end properties about Vyper source that carry through to deployed bytecode(!), which are not limited in expressivity as bounded model checkers are.

The end state:

- A **verified compilation mode** bundled with the official Vyper compiler and available as a --verified option; bytecode compiled with it provably matches the source semantics
- **Source-level proofs that reach the chain**: properties proven about Vyper source carry over to the deployed bytecode
- **Continuous verification**: each supported compiler release can be re-verified using the existing proof infrastructure

## The recipient

In the interest of full transparency:

- This grant was drafted together with the **Vyper core team**, builds directly on their open-source groundwork, and the Vyper core team is the recipient. The head start is real: an executable HOL4 semantics of a large Vyper subset that already passes the codegen section of the official test suite, in-progress proofs for the Vyper to Venom to bytecode pipeline, and a formal EVM semantics validated against the Execution Spec Tests (see Existing work).

- We believe the price is fair: published estimates for comparable end-to-end compiler verification run well above this budget.
- The proposal should show a track record in mechanized verification and spell out the technical approach: proof assistant, relationship to the existing work, frontend strategy, and how users run the verified compiler.

## Why a grant: what already exists

- **vyper-hol**: executable formal semantics of a large Vyper subset in HOL4, passing the codegen section of the official Vyper test suite, plus in-progress proofs for the Vyper to Venom to bytecode pipeline (GPL-3.0)
- **Verifereum**: formal EVM semantics in HOL4, validated against the Ethereum Execution Spec Tests
- Proposers may build on this work or justify an alternative foundation in a mature proof assistant with a small trusted kernel (HOL4, Rocq, Isabelle/HOL, Lean)

## In scope


- Executable formal semantics of Vyper, maintained against current releases. Supported coverage should be full coverage of the Vyper language semantics with any exclusions documented.
- Machine-checked proofs for the full pipeline: Vyper source to Venom IR to EVM bytecode, including optimization passes and ABI encoding/decoding
- A user-facing **verified compilation mode** (a distinguished set of verified optimization passes), bundled with the Python compiler and available as a --verified option, on terms agreed with the Vyper maintainers
- Continuous verification in CI against pinned upstream compiler revisions
- Gas modeling: the source semantics quantifies over gas rather than fixing a cost model; tying this to the formal EVM gas model through the verified compiler makes concrete bounds (e.g. "this function executes within Y gas") provable about the compiled bytecode
- Public releases, documentation, and adoption work

## Out of scope

- Correctness of user-written contracts. The proof guarantees the bytecode matches the source; source-level safety remains the author's job.
- Verification of the Python compiler implementation itself; the expected architecture is a verified compiler bundled with the Python compiler and available as a --verified option
- Perpetual re-verification after the grant period. That folds into normal compiler maintenance, which this infrastructure makes inexpensive.

## Commitments

1. **Open source.** All code, proofs, and documentation under an OSI-approved license, with no closed-source dependencies.
2. **Kernel-checked, no gaps.** Headline theorems check with zero admitted/cheated lemmas in their dependency graph, enforced by an automated check in public CI. Milestone payment depends on this check passing.
3. **Pinned targets.** Each verified release names the exact upstream Vyper commit, optimization settings, and EVM fork it covers.
4. **Assurance statement.** Each release ships a plain-language document: supported language subset (or complete coverage, if applicable), exclusions, covered passes, and the complete trusted computing base.
5. **Maintenance plan.** A credible plan for keeping proofs current across Vyper releases and EVM hard forks.
6. **Independent reviewer.** The technical reviewer for judgment calls has no affiliation with the selected team or with the existing codebases.

## Milestones (draft)

### A - Formal semantics and frontend - $50,000

- [ ] All semantics definitions and proofs check from a clean checkout with a single documented command, in public CI
- [ ] Published test-parity report: the semantics passes the functional/codegen section of the official Vyper test suite at the pinned commit, every exclusion listed and justified
- [ ] Published frontend decision: a formalized parser/typechecker, or an explicit statement that the production frontend remains in the trusted base, with mitigations
- [ ] Public documentation of the semantics, sufficient for an outside researcher to state and prove properties of Vyper programs

### B - Verified frontend lowering - $125,000

- [ ] Named lowering-correctness theorems (statements, expressions, builtins, external-call dispatch) machine-checked with zero admitted lemmas, verified by the automated CI check
- [ ] ABI encode/decode correctness proven against the published ABI specification, covering static and dynamic types
- [ ] Updated assurance statement for the supported subset at this stage
- [ ] Expanded regression suite comparing verified-pipeline output with production-compiler output at the pinned commit, divergences reported publicly

### C - Verified optimization pipeline - $100,000

- [ ] Published list of every pass in the production pipeline, each marked verified or excluded; every verified pass has a machine-checked correctness theorem with zero admitted lemmas
- [ ] The composed verified pass set has a single machine-checked correctness theorem and is packaged as a distinct, documented compilation mode users can select
- [ ] CI automatically re-checks all proofs and output-parity against the pinned upstream revision, with a public status page or badge
- [ ] Soundness bugs found in the production optimizer are responsibly disclosed to the Vyper team, with each disclosure linked publicly once fixed

### D - End-to-end theorem and public release - $125,000

- [ ] A single end-to-end theorem, published in both machine-checked and human-readable form, verified in CI
- [ ] A public release outside users can run, with installation and usage instructions, distributed as agreed with the Vyper maintainers. The expected form is the verified compiler bundled with the Python compiler and available as a --verified option; the release documents how the verified compiler is executed and what that adds to the trusted base.
- [ ] Full assurance statement published: supported subset (if applicable), exclusions, covered passes, complete trusted computing base, proof assumptions
- [ ] The verified pipeline demonstrated on at least five representative real-world Vyper contracts, results published

### E - Adoption and ecosystem impact - $200,000 (adoption)

**Tranche 1: Launch - $75,000**

- [ ] Public project website explaining the verified compiler and its guarantees in language a non-specialist developer can follow
- [ ] User documentation plus at least one step-by-step tutorial from a Vyper contract to a verified-compilation artifact
- [ ] A recorded technical workshop or webinar for developers and auditors, publicly available
- [ ] A talk delivered at a major Ethereum or formal-methods event, and at least two published technical blog posts
- [ ] Public roadmap for verifying future Vyper releases (verification is expected to accompany each real Vyper release, not lag behind it), including hard-fork policy

**Tranche 2: Adoption - $25,000**

- [ ] At least one independent external integration: a new protocol team, audit firm, or tooling project using the verified pipeline, confirmed publicly by that party
- [ ] A published case study of a production contract, deployed on Ethereum mainnet or a major L2, whose bytecode is covered by the verified pipeline
- [ ] A public metrics page reporting, at minimum: downloads, on-chain deployments compiled with the verified mode, supported compiler versions, and downstream integrations

**Tranche 3: Continuous verification - $100,000**

- [ ] Continuous verification demonstrated across at least one new production Vyper release after the Milestone D release: proofs repaired, re-checked in CI, new assurance statement published
