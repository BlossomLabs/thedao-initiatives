# RFP: PRSpec in Client CI — Automated EIP Compliance Checks for Ethereum Client Teams

| | |
|---|---|
| **Status** | Draft |
| **Lifecycle** | Draft → Fundraising → Funded → Open for proposals → Reviewing proposals → In progress → Complete |
| **Budget** | Up to $12,500 USD, paid per accepted milestone |
| **Proposal window** | 15 days, opening once the RFP is fully funded |
| **Indicative duration** | 6 months (proposers set their own timeline) |
| **Contact / questions** | [FORUM LINK] |

## Why this matters

Ethereum's client teams implement EIPs by reading specification text and writing code. Conformance test suites like [execution-spec-tests](https://github.com/ethereum/execution-spec-tests) catch behavioral divergence on the cases the tests cover — but they can't catch what nobody wrote a test for, and they can't tell a team that their implementation quietly diverges from the spec's intent. PRSpec attacks that gap from the other side: it uses LLM analysis to compare EIP specification text directly against client source code and flag semantic mismatches. It has already surfaced a real cross-client inconsistency in how EIP-1559's base-fee burn is implemented, leading to a [spec-clarification issue](https://github.com/ethereum/EIPs/issues/11313).

This RFP funds turning PRSpec from a working research tool into something client teams actually run: packaged for local deployment (keeping code and compute inside each team's own environment) and integrated as a pre-release check in the staging pipelines of at least two major execution clients. The end state:

- A **plug-and-play integration kit** (CLI + Docker) any client team can deploy locally in under an hour
- **PRSpec running continuously** in the staging/testing pipelines of at least two major execution-layer clients, confirmed publicly by those teams
- A **triage workflow** teams trust: findings are ranked, false positives are tracked, and the check adds signal rather than noise

## Who we expect to do this

In the interest of full transparency:

- This RFP was drafted from a proposal by **Safi El-Hassanine**, the sole author of [PRSpec](https://github.com/Fosurero/PRSpec). We believe they are well positioned to receive the grant — nobody else knows the codebase, and the first milestone builds directly on work already largely complete.
- The proposal window is still real. A challenger wins by credibly delivering this scope for less or proposing materially stronger milestones — but given the budget size and the incumbent's head start, this is effectively a direct grant with an open challenge window, and we say so plainly.
- Every applicant, including the expected recipient, must disclose their relationship to PRSpec and to any client team named in their proposal.

## Existing work

- **[PRSpec](https://github.com/Fosurero/PRSpec)** — LLM-based differential analysis of EIP specs against client source; currently covers go-ethereum, Nethermind, Besu, and Reth across 10 EIPs, with 149 passing tests
- **[execution-spec-tests](https://github.com/ethereum/execution-spec-tests)** and **[ethereum/tests](https://github.com/ethereum/tests)** — the conformance test suites client teams already run; PRSpec complements these, it does not replace them
- **[execution-specs](https://github.com/ethereum/execution-specs)** — the executable Python spec whose fork-to-fork diffs PRSpec builds on

## Scope

**In scope**

- Production packaging of the PRSpec CLI and Docker image for local, self-hosted deployment
- Integration documentation good enough that a client-team engineer can go from clean checkout to a first run without talking to the author
- Hands-on integration with at least two execution-layer client teams, tailored to their pipelines
- A documented triage workflow: finding severity, false-positive tracking, and how a team silences a known-noisy check
- Clear documentation of LLM inference options and costs (local models vs. API keys), since each team runs the tool on its own infrastructure

**Out of scope**

- Guaranteeing spec compliance. PRSpec is an LLM-assisted review layer that flags likely mismatches for human review — it does not prove alignment, and no RFP deliverable may claim it does.
- Replacing or duplicating execution-spec-tests or ethereum/tests
- Consensus-layer clients (execution layer only, matching PRSpec's current coverage)
- Perpetual maintenance beyond the grant period; the maintenance plan (hard requirement 5) covers how new EIPs and forks get added, but ongoing operation is each client team's choice

## Hard requirements

1. **Open source.** All code and documentation under an OSI-approved license, with no closed-source dependencies required to run the tool.
2. **Self-hosted by default.** Client teams run the tool entirely in their own environment; no client source code leaves their infrastructure unless they choose an external LLM API and that choice is documented.
3. **Public evidence of adoption.** Client-team integrations count only when confirmed publicly by that team (a merged PR in their repo, a public statement, or a public CI run).
4. **Noise accountability.** A published false-positive/triage report per integrated client, because a CI check that cries wolf gets deleted.
5. **Maintenance plan.** A credible, documented process for adding new EIPs and forks to the tool's coverage after the grant.

## Milestones (draft)

These milestones are a draft of what we expect, adapted from the tool author's proposal. Final milestones and payments are negotiated with the selected team and fixed in the grant agreement. Strengthening this draft is part of a winning proposal.

Milestones are numbered because the order is fixed: packaging precedes onboarding, and adoption pays last.

### 1 — Production-ready packaging and docs — $3,500

The author reports this milestone is already ~80% complete; the payment covers finishing and hardening it, and the grant agreement may treat part of it as the advance on signing.

- [ ] PRSpec CLI and Docker image published with pinned, reproducible builds; a reviewer goes from clean checkout to a completed analysis run with one documented command
- [ ] Integration documentation published, including LLM inference options (local model and API-key paths) with realistic cost estimates per run
- [ ] Public CI on the PRSpec repo runs the tool's own test suite green

### 2 — First client onboarding — $2,750

- [ ] A named execution-layer client team (e.g. Besu or Nethermind) publicly confirms they are trialing PRSpec — a merged PR, public issue, or public statement from that team
- [ ] PRSpec deployed in that team's environment and completing runs against their staging branch, with a run report shared publicly (redacted as the team requires)
- [ ] Initial findings triaged with the client team; at least one written-up finding (real mismatch, spec ambiguity, or documented false positive) published

### 3 — Live pipeline integration and continuous checking — $2,750

- [ ] PRSpec running as an automated recurring check in the first client's staging/testing pipeline, confirmed by a public CI configuration or public statement from that team
- [ ] Published triage/false-positive report covering at least one month of automated runs
- [ ] Integration bugs and automation fixes from live operation merged and released

### 4 — Multi-client adoption — $3,500

- [ ] At least one additional major execution-layer client team running PRSpec as a recurring pre-release check, publicly confirmed by that team (two clients total, minimum)
- [ ] A public adoption page listing which clients run PRSpec, which EIPs are covered, and links to each public confirmation
- [ ] Published maintenance plan and a recorded walkthrough or workshop for client teams that want to self-onboard
- [ ] At least one new EIP or fork added to coverage during the grant, demonstrating the extension process end to end

## Milestone review and acceptance

- Machine-checkable criteria (public CI green, published reports, public confirmations linkable by URL) are accepted automatically when the public evidence exists.
- Judgment-based criteria (whether documentation is sufficient, whether a triage report is credible) are signed off by an independent technical reviewer with no affiliation to the selected team or the client teams involved, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment or is pro bono; the winning team coordinates their payment.

## Process

- The proposal window opens once the RFP is fully funded and stays open for 15 days
- Proposals include: team and track record; technical approach; a milestone plan with per-milestone budget — the draft above, or a stronger version; and full disclosures
- Giveth selects the team within 7 days of the proposal window closing, weighing credibility, price, and strength of the proposed milestones
- Milestone deliveries are reviewed against the acceptance criteria within 14 days; payment follows acceptance. If a milestone stalls, remaining tranches are renegotiated or cancelled
- The first milestone can be paid up to 50% in advance to ensure the team has funding to start. If more funds are needed to complete a milestone, the team is expected to reach out to the ecosystem for a stop-gap loan
- If a milestone is not completed in a reasonable amount of time, the team is given a 21-day deadline; if they fail to meet it, unused funds become claimable by the donors who supported the RFP for 30 days, after which unclaimed funds go to TheDAO Security Fund for other initiatives
