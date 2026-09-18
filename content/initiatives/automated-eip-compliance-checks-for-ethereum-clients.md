---
title: Automated EIP Compliance Checks for Ethereum Clients
type: grant
recipient: Safi El-Hassanine (PRSpec)
recipient_url: https://github.com/Fosurero/PRSpec
goal: 20000
summary: Ethereum's client teams implement EIPs by reading specification text
  and writing code, and conformance test suites only catch the divergences
  somebody thought to write a test for. PRSpec uses LLM analysis to compare EIP
  specification text directly against client source code and flag semantic
  mismatches, and it has already surfaced a real cross-client inconsistency in
  how EIP-1559's base-fee burn is implemented. This grant funds turning it from a
  research tool into a self-hosted pre-release check running in the staging
  pipelines of the major execution clients.
duration: 6
---
## Why this matters

Ethereum's client teams implement EIPs by reading specification text and writing code. Conformance test suites like execution-spec catch behavioral divergence on the cases the tests cover, but they can't catch what nobody wrote a test for, and they can't tell a team that their implementation quietly diverges from the spec's intent. PRSpec uses LLM analysis to compare EIP specification text directly against client source code and flag semantic mismatches. It has already surfaced a real cross-client inconsistency in how EIP-1559's base-fee burn is implemented, leading to a spec-clarification issue.

This grant funds turning PRSpec from a working research tool into something client teams actually run: packaged for local deployment (keeping code and compute inside each team's own environment) and integrated as a pre-release check in the staging pipelines of at least two major execution clients. The end state:

- A plug-and-play integration kit (CLI + Docker) any client team can deploy locally in under an hour
- PRSpec running continuously in the staging/testing pipelines of at least the two major execution-layer clients and one other, confirmed publicly by those teams
- A triage workflow: findings are ranked and false positives are tracked

**Reference deployment model.** The production deployment runs PRSpec as a pinned OCI container on a client-owned self-hosted runner against the exact checked-out client commit. A local model endpoint keeps source code and full reports inside the client's environment. Completed runs are reproducible, and only disputed or high-severity findings are selectively escalated to an additional model before entering the human triage queue. Milestone 1 delivers the reproducible container and local-model runtime, milestone 2 validates it inside the first client environment, and milestone 3 adds recurring triggers, selective model escalation, and persistent triage.

## The recipient

In the interest of full transparency:

- This grant was drafted from a proposal by Safi El-Hassanine, the author of PRSpec, and Safi is the recipient. The head start is the tool itself: PRSpec already covers four execution clients across 10 EIPs, and milestone 1 is about 80% complete. The milestone 1 payment covers finishing and hardening it, and the grant agreement may treat part of it as the advance on signing.

## Why a grant: what already exists

- [PRSpec](https://github.com/Fosurero/PRSpec): LLM-based differential analysis of EIP specs against client source; currently covers go-ethereum, Nethermind, Besu, and Reth across 10 EIPs, with 149 passing tests
- [execution-spec-tests (archived)](https://github.com/ethereum/execution-spec-tests) and [ethereum/tests](https://github.com/ethereum/tests): the conformance test suites client teams already run; PRSpec complements these, it does not replace them
- [execution-specs (live repo)](https://github.com/ethereum/execution-specs): the executable Python spec whose fork-to-fork diffs PRSpec builds on

## In scope


- Production packaging of the PRSpec CLI and Docker image for local, self-hosted deployment
- Integration documentation good enough that a client-team engineer can go from clean checkout to a first run without talking to the author
- Hands-on integration with at least two execution-layer client teams, tailored to their pipelines
- A documented triage workflow: finding severity, false-positive tracking, and how a team silences a known-noisy check
- Clear documentation of LLM inference options and costs (local models vs. API keys), since each team runs the tool on its own infrastructure

## Out of scope

- Guaranteeing spec compliance. PRSpec is an LLM-assisted review layer that flags likely mismatches for human review.
- Replacing or duplicating execution-spec-tests or ethereum/tests
- Consensus-layer clients (execution layer only, matching PRSpec's current coverage)
- Perpetual maintenance beyond the grant period; the maintenance plan (hard requirement) covers how new EIPs and forks get added, but ongoing operation is each client team's choice

## Commitments

1. **Open source.** All code and documentation under an OSI-approved license, with no closed-source dependencies required to run the tool.
2. **Self-hosted by default.** Client teams run the tool entirely in their own environment; no client source code leaves their infrastructure unless they choose an external LLM API and that choice is documented. Support for local, open-weight models is explicitly highlighted to guarantee zero code leakage.
3. **Public evidence of adoption.** Client-team integrations count only when confirmed publicly by that team (a merged PR in their repo, a public statement, or a public CI run).
4. **Noise accountability.** A published false-positive/triage report per integrated client, because a CI check that cries wolf gets deleted.
5. **Maintenance plan.** A credible, documented process for adding new EIPs and forks to the tool's coverage after the grant.
6. **Reviewer from a client team.** Judgment calls are signed off by an engineer from an execution-layer client team with no ties to the recipient, named in the grant agreement before work begins.

## Milestones (draft)

### 1 - Production-ready packaging and docs - $4,000

- [ ] PRSpec CLI and Docker image published with pinned, reproducible builds; a reviewer goes from clean checkout to a completed analysis run with one documented command
- [ ] Integration documentation published, including LLM inference options (local model and API-key paths) with realistic cost estimates per run
- [ ] Public CI on the PRSpec repo runs the tool's own test suite green

### 2 - First client onboarding - $3,000

- [ ] A named execution-layer client team publicly confirms they are trialing PRSpec via a merged PR, public issue, or public statement from that team
- [ ] PRSpec deployed in that team's environment and completing runs against their staging branch, with a run report shared publicly (redacted as the team requires)
- [ ] Initial findings triaged with the client team; at least one written-up finding (real mismatch, spec ambiguity, or documented false positive) published

### 3 - Live pipeline integration and continuous checking - $3,000

- [ ] PRSpec running as an automated recurring check in the first client's staging/testing pipeline, confirmed by a public CI configuration or public statement from that team (any of the major clients: Nethermind, Geth, Besu, or Reth)
- [ ] Published triage/false-positive report covering at least one month of automated runs
- [ ] Integration bugs and automation fixes from live operation merged and released

### 4 - Multi-client adoption - $4,000 (adoption)

- [ ] At least one additional major execution-layer client team running PRSpec as a recurring pre-release check, publicly confirmed by that team (any of the major clients: Nethermind, Geth, Besu, or Reth)
- [ ] A public adoption page listing which clients run PRSpec, which EIPs are covered, and links to each public confirmation
- [ ] At least one new EIP or fork added to coverage during the grant, demonstrating the extension process end to end
- [ ] Published maintenance plan and a recorded walkthrough or workshop for client teams to reference

### 5 - Majority client adoption - $6,000 (adoption)

- [ ] At least three execution-layer client teams running PRSpec as a recurring pre-release check, publicly confirmed by those teams (must include Nethermind and Geth)
