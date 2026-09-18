---
title: ForensIQ: Faster Ethereum Incident Response Through Evidence Reconstruction
type: grant
goal: 135000
summary: ForensIQ is building an open-source module that connects off-chain
  incident evidence (logs, files, transaction hashes) with Ethereum activity to
  reconstruct attack timelines, trace fund flows, and flag transfers to attributed
  exchange addresses. It replaces the manual handoffs between logs, block
  explorers, and attribution tools with one evidence-linked workflow that produces
  a verified response package faster. The grant funds the missing connective
  layer on top of ForensIQ's existing MVP (case management, Crystal and Etherscan
  integrations), not a rebuild of the platform. Success is measured through
  pilots with protocol, exchange, and law-enforcement investigators, tracking
  time to a verified timeline and correctness rather than a promised percentage
  improvement.
duration: 6
recipient: ForensIQ team
---
## Why this matters

During an Ethereum security incident, time is a critical resource. Responders need to establish what happened, identify the affected assets, follow the funds, and prepare the evidence needed for their next action. Every manual handoff between logs, transaction views, attribution results, and investigation notes consumes part of that response window. Funds can move again while the team is still assembling its first coherent account.

This initiative funds an open-source module that reduces the work between receiving incident evidence and producing a verified response package. It connects off-chain evidence with Ethereum activity, reconstructs the attack timeline, maps supported fund movements, and flags transfers to attributed exchange addresses. The intended users are protocol and exchange security teams, incident-response firms, and law-enforcement investigators.

**Less time assembling evidence. More time to act on it.**

## The team

The proposed recipient is the ForensIQ team, backed by HackenProof. The proposer reports an existing MVP with user and role management, case creation, file uploads, AI file analysis, and integrations with Crystal and Etherscan. These components provide a head start; the grant pays for the additional investigation module and its validation, not rebuilding the SaaS foundation.

The head start combines working ingestion and analysis components with existing blockchain integrations and access to prospective pilot users through HackenProof. Reuse should let the team spend the grant on cross-source reconstruction, response exports, and field validation. Before the agreement is finalized, a baseline demonstration and reuse inventory will make those savings checkable. The module is at MVP stage; measured investigation outcomes will come from the pilots.

HackenProof's existing relationships provide a route to pilot users. The proposer identifies law-enforcement partners in Ukraine and the Netherlands as intended first testers and plans to invite Hacken and other cybersecurity partners.

## Why a grant: what already exists

[Crystal](https://crystalintelligence.com/crystal-expert-for-law-enforcement/) provides blockchain investigation capabilities, including fund tracing and case organization. These are substantial existing capabilities; neither timeline visualization nor transaction tracing alone is the novelty proposed here.

The proposed advance is an independently deployable, evidence-linked workflow connecting selected incident logs to Ethereum transfers and response preparation, evaluated against investigators' existing processes. The first milestone will document feature overlap, identify components worth reusing, and fix the specific workflow improvement to be tested.

## In scope

- Ethereum mainnet, native ETH movements, and ERC-20 transfers; support for relevant execution traces must be documented against the selected data provider.
- Two or three log formats chosen with pilot users during the first month, plus supporting file evidence with stable source references.
- A shared timeline with normalized timestamps, original timestamps retained, and explicit handling of unknown time zones or uncertain ordering.
- Fund-flow views linking transfers to transaction hashes and addresses, with documented tracing assumptions.
- Crystal attribution integration and Etherscan transaction-data integration, with documented access requirements.
- Incremental case updates and configurable polling alerts for supported transfers to addresses attributed to exchanges, including source, retrieval time, and uncertainty. Provider delays and polling intervals are visible.
- Evidence-linked attack hypotheses, human-reviewed containment recommendations for agreed scenarios, and an exportable investigation package. Exchange action remains at the recipient exchange's discretion.
- Standalone deployment, public documentation, reproducible test fixtures, and independent pilot evaluation.

## What this pays for:

Consider an illustrative investigation: a team provides access logs, incident files, and suspicious transaction hashes. The module places relevant events on one timeline, links each finding to its source, traces supported transfers, and checks available address attribution. If funds reach an address attributed to an exchange, the investigator gets an alert and an evidence package to review for an escalation request. The team can start reviewing supported findings while the broader investigation continues.

The funded contribution is the connection between those steps: evidence normalization, traceable correlations, incremental updates, and a consistent response export. Existing blockchain intelligence supplies attribution. AI helps organize evidence and propose explanations; an investigator verifies conclusions and chooses actions. Recommendations will cover a small set of incident scenarios agreed with pilot users, rather than promise a reliable diagnosis for every attack.

Success means shorter time to a verified timeline and a usable escalation package, with correctness measured alongside speed. Pilot results will establish whether and where the module saves time; no improvement percentage is claimed in advance.

The open-source core will ingest supported logs and supplied Ethereum data, produce timelines and fund-flow views, and export evidence without a ForensIQ account. Commercial attribution is an optional enrichment using the operator's own credentials. Without it, exchange identity can remain unknown. Public fixtures allow the complete workflow to be evaluated without purchasing third-party access.

**On the milestone plan:**

The six-month plan allocates roughly four months to development and two to pilots and refinement. Pilot recruitment and data-access arrangements start in month one. The proposed cost basis is $120,000 for team work ($20,000 per month), $10,000 for infrastructure and external services, and $5,000 for independent review, all included in the milestone amounts. Team work covers backend and data integration, AI/evidence analysis, investigator-led validation, and pilot delivery. Staffing allocations will be fixed in the final plan; these figures do not imply four full-time hires. Service costs and reviewer fees must be validated before contracting. Payments are tied to acceptance, not monthly payroll.

## Out of scope

- Other chains and L2s, cross-chain bridge tracing, and claims to resolve movement through mixers.
- A proprietary address-labeling database or redistribution of third-party data without permission.
- Universal log ingestion, autonomous remediation, automatic freeze-request submission, or guaranteed recovery.

## Commitments

1. **Open source and independently usable.** All code developed for the funded module is released under an OSI-approved license. The license is fixed in the agreement. No paid ForensIQ account is required, and necessary reused dependencies must permit standalone distribution.
2. **Evidence before conclusions.** Findings include source references. Observations, hypotheses, and attribution are distinguishable. Missing evidence and unresolved paths remain visible.
3. **Safe handling of case material.** Deployment documentation explains where data is processed, external-provider access, and retention settings. External AI processing requires explicit configuration. Untrusted file contents cannot trigger external actions.
4. **Reproducible acceptance.** Public fixtures, commands, expected outputs, and evaluation reports let an independent reviewer reproduce the core workflow. Sensitive investigation materials are not published.
5. **Independent adoption.** At least three external teams use the module on investigation material and publicly confirm use, or authorize a named independent reviewer to confirm use publicly with identifying details omitted. Attendance at a demo does not count.
6. **Maintenance.** ForensIQ maintains the module for at least 12 months after completion of the pilot phase, covering bug fixes, security updates, and integration compatibility. HackenProof's own budget backs this commitment. Future grants may support expansion but are not a condition of maintenance.

**Note on the adoption milestone**

Public confirmations disclose no sensitive evidence. Participation and publication arrangements must be agreed with pilot teams. Private cases can use the independent attestation route; other qualified teams can also satisfy the criteria. The independent reviewer must be able to verify that the three teams are distinct and external to the recipient. The final milestone accounts for approximately 37% of the budget.

## Milestones (draft)

### A - Evidence foundation and evaluation plan - $20,000

- [ ] A public scope document fixes the supported log formats, transfer types, provider dependencies, and known limitations.
- [ ] A baseline demonstration and public reuse inventory distinguish existing MVP functionality from grant-funded work, with an effort estimate for reused components and a comparison with relevant existing tools.
- [ ] A public repository contains a runnable evidence-ingestion pipeline, provenance records, and sanitized or synthetic fixtures.
- [ ] A public evaluation protocol defines correct event ordering, source-reference accuracy, fund-flow correctness, unsupported findings, time to a verified timeline, and time to an investigator-approved escalation package. The comparison uses equivalent inputs and predefined tasks and records external API waiting time separately.
- [ ] At least two prospective pilot teams confirm participation, with permission to publish their participation or a confirmation from an independent reviewer that recruitment is complete.

### B - Timeline and fund-flow reconstruction - $35,000

- [ ] A tagged release produces a timeline and fund-flow view from the selected log formats and Ethereum data.
- [ ] Public fixtures cover at least five scenarios, including an ETH transfer, an ERC-20 transfer, a contract-mediated transfer, uncertain log timing, and an unresolved route.
- [ ] A published test report compares outputs with expected results and lists every discrepancy and known limitation.
- [ ] Attribution output identifies the provider and lookup time; unavailable attribution is shown as unknown. A public fixture verifies that new transaction data updates a case and triggers the configured alert, with measured detection delay.
- [ ] An independent reviewer publishes a signed assessment against the agreed technical acceptance criteria.

### C - Response workflow and standalone release - $30,000

- [ ] A tagged standalone release can be installed using public instructions without a ForensIQ subscription.
- [ ] A public fixture demonstrates an exchange-attribution alert and evidence export containing transaction hashes, addresses, asset amounts, timestamps, and attribution sources.
- [ ] The release separates evidence-supported observations from AI hypotheses and includes human-reviewed response recommendations.
- [ ] A published evaluation includes misleading file instructions, missing evidence, and incorrect attribution inputs, with observed behavior and corrective actions.
- [ ] The repository publishes the license, dependency and service-cost documentation, security reporting process, and maintenance plan.

### D - Independent adoption and measured results - $50,000 (adoption milestone)

- [ ] At least three independent external teams use the module on investigation material, including at least two using real historical or active case material. Each use has a public team confirmation or a named independent reviewer's public attestation based on private verification.
- [ ] At least five investigation exercises are completed across those teams. Public summaries identify the module version, workflow used, and whether each exercise used real or synthetic material.
- [ ] At least two teams confirm a second use on a separate case or dataset after initial onboarding, directly or through the same independent attestation process.
- [ ] A public evaluation compares time to a verified timeline and an investigator-approved escalation package with each team's documented comparison workflow. It reports case-level and median results, correctness, unsupported findings, external-service delays, sample size, and limitations. Any claimed time savings must be reproducible from the disclosed measurement method.
- [ ] A final release addresses pilot findings, with remaining issues publicly tracked and the 12-month maintenance period dated.
