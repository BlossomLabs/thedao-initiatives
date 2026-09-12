---
title: Securing Ethereum with Formal Verification
type: grant
goal: 300000
summary: AI is making it faster to attack software, giving attackers a meaningful
  edge. Formal verification is widely considered the strongest security
  guarantee in software correctness. This grant aims to increase formal
  verification adoption across the Ethereum ecosystem with TVL secured as its
  main success metric.
forum: https://t.me/+PHZekKhdjPAxOWU0
duration: 12
recipient: Verity Labs
backers:
  Ethereum Foundation | $100,000 | https://ethereum.foundation/
---
## Why this matters

AI is making it faster to attack software, giving attackers a meaningful edge. The answer is to put AI on the defending side too: AI that writes machine-checked proofs that a contract's stated properties hold, with humans only checking the theorems. Formal verification is widely considered the strongest guarantee of software correctness, and it is the one place where AI output can be checked mechanically rather than trusted.

This grant creates an open-source framework for Solidity verification (Verity, built on Lean 4, with an AI proof-writing skill) and increases formal verification adoption across the Ethereum ecosystem. Success is measured by the TVL covered by formally verified properties.

The Ethereum Foundation has already pledged $100,000 USD of the $300,000 USD budget for the Verity product foundation. The remaining $200,000 USD finishes the product and pays for adoption, so every dollar donated here builds on money already committed.

## The team

The recipient is Verity Labs. This is a grant rather than an RFP because its team has spent the past few months doing unbounded formal-verification work with leading Ethereum protocols. Its public work covers 40+ protocols, among them popular names like Lido, Morpho, and Safe (see Existing work below).

This experience shows where real protocols need unbounded proofs, where modeling gaps block use, and what needs to become repeatable for developers and audit firms. The Ethereum Foundation has already funded part of Verity's product roadmap and everything is public.

## Why a grant: what already exists

- Verity Labs: https://veritylabs.dev and the Verity product page https://veritylabs.dev/projects/verity
- Verity compiler, MIT licensed: https://github.com/lfglabs-dev/verity
- verity-benchmark, the AI proof-generation benchmark built with the Ethereum Foundation and ecosystem protocols: https://github.com/lfglabs-dev/verity-benchmark
- Technical docs, including the Solidity-to-Verity porting guide: https://veritylang.com
- Public verification case studies (Lido V3 vault solvency, Safe owner list invariants, Morpho, Balancer, 1inch, Pendle and others): https://veritylabs.dev/research
- Paper, "A Formally Verified Smart Contract Compiler in Lean 4", accepted at ETHReS 2026: https://veritylabs.dev/research/verity

## In scope

- Product work on Verity's compiler, Solidity coverage, reusable proof infrastructure, benchmark, documentation, developer onboarding, AI proof-writing skill, and a deterministic Solidity-to-Verity transpiler that reduces modeling gaps.
- Public releases that document supported workflows, trust assumptions, version pins, known limitations, and how teams and formal audit firms can use the tooling.
- Adoption through protocol teams using Verity in-house and formal audit firms using it in their own work.
- Measuring adoption primarily through the TVL of contracts whose stated properties are formally verified.

## What this pays for:

This is not a program to select public contracts and publish formal verifications of them. It pays for two connected things:

- **Product work:** continue the open-source Verity tooling, benchmark, documentation, developer onboarding, AI proof-writing skill, and deterministic Solidity-to-Verity transpilation work already defined in the Ethereum Foundation funded grant.
- **Adoption work:** make Verity usable by protocol teams in-house and formal audit firms in their own work. Success is led by the value covered by the verified properties.

The total program budget is $300,000 USD. It combines the $100,000 USD Ethereum Foundation pledge for the Verity product foundation with $200,000 USD raised through TheDAO Security Fund's Second Round.

## Out of scope

- Verifying the Solidity compiler itself.
- A proprietary product, hosted-only workflow, or exclusive access for a single provider.
- Counting users or github stars as the main measure of adoption. We consider real impact in TVL.

## Commitments

1. **Open to everyone.** Verity product code, benchmark artifacts, documentation, and CI are public under an OSI-approved license. No proprietary runtime, hosted service, account, or paid provider is needed to use the tooling or reproduce a proof.
2. **Reproducible.** A stranger can reproduce each headline product claim from a clean checkout, documented command, public CI, and version pins, without admitted proof gaps.
3. **TVL-led adoption.** Adoption evidence names the participating protocol team or formal audit firm, provides public confirmation of use, and gives the public TVL source and snapshot date for each value included in the aggregate.
4. **Clear scope on verified TVL.** Each reported verification states the code revision, properties proved, trust assumptions, and known limits in plain language.

## Milestones (draft)

### A - Building the Verity product - $150,000

- [ ] A public, versioned Verity release records the delivered compiler stabilization and bug fixes, Solidity feature coverage, reusable EVM proof infrastructure, and exact source revisions.
- [ ] A deterministic Solidity-to-Verity transpiler is public. For its supported Solidity subset, it produces reproducible Verity output without an LLM in the translation path, documents unsupported patterns, and has public regression tests.
- [ ] A public verity-benchmark release contains fixed implementations, formal specifications, editable Lean proof files, and target theorems, with checks that reject incomplete or admitted proofs.
- [ ] Public developer material covers beginner onboarding, supported workflows, trust assumptions, version pins, known limitations, an AI proof-writing skill, and use by in-house teams and formal audit firms.
- [ ] Public compiler and benchmark research materials are published, and developer onboarding includes a workshop or talk at EthCC, Devcon, or a similar venue.
- [ ] A public maintenance plan names the maintainer, release process, and post-grant sustainability path.

### B - $1B TVL covered by Verity-verified properties - $50,000

- [ ] At least $1 billion in TVL total (from at least 3 different protocols) is counted on a stated public snapshot date across contracts whose selected properties are formally verified with Verity, whether protocol teams use it in-house or formal audit firms use it in their own work.
- [ ] The protocol team or formal audit firm publicly confirms its use of Verity for the stated contract revision and properties.
- [ ] A public metrics page lists the counted systems, snapshot dates, TVL sources, aggregate covered TVL, and the limits of the measurement.

### C - $5B TVL covered by Verity-verified properties - $100,000 (adoption milestone)

- [ ] At least $5 billion in TVL (from at least 10 different protocols) is counted on a public snapshot date across contracts formally verified with Verity, whether used in-house by protocol teams or by formal audit firms.
