---
title: Community Fuzzing Tooling for Ethereum Ecosystem Projects
type: rfp
goal: 150000
summary: The Ethereum ecosystem is lacking a solution for scalable, continuous, and
  compute-intensive fuzzing campaigns for projects. For each project to subscribe
  to their own solution would be costly and could have diminishing returns over
  time to make it a worthwhile investment of time, money, and human capital. We
  are requesting proposals from applicants who have developed or can develop
  tools to orchestrate fuzzing at scale, assign compute resources efficiently,
  and flex these resources up and down in an agile manner so that any team can
  orchestrate their own fuzzing campaign for themselves. A self-serve model. This
  RFP would fund the construction and maintenance of such a tool.
duration: 12
---
## Why this matters

Security review has shifted a great deal of effort onto LLM-assisted tooling over the last eighteen months. That shift has been productive and remains accessible to teams through frontier models and private tools, but it is also incomplete. They are weakest precisely where fuzzing is strongest, particularly on regression detection and avoidance as developers ship new or harden existing code.

**Current state:**

Many teams know the above, but very few run fuzzing continuously. The reasons are mostly operational:

- Compute: Meaningful fuzzing is measured in sustained core hours. Most teams cannot justify that as a standing line item for a single codebase, so it never gets budgeted.
- Time: Someone has to write harnesses that generate inputs structured enough to reach deep code rather than bouncing off input validation.
- Software: Teams that do try usually run a fuzzer in GitHub Actions or a similarly time-boxed CI runner, yielding a few minutes of fuzzing per commit. That is only enough to replay an existing corpus and generate suitable code coverage.

## In scope

- A documented CLI or front-end UI
- Running continuous fuzzing campaigns across multiple tenants in a secure manner
- Ability to allocate compute across multiple projects and scale it up and down efficiently and on demand
- Capability to hand off harnesses, corpora, and knowledge to users
- Documentation so teams can maximally self-serve

**On the milestone plan:**

Amounts below are shown as a share of the awarded budget, with an indicative figure at a $150,000 award.

## Out of scope

- Manual audits and code review. This program funds fuzzing infrastructure.
- Authorship of harnesses and tests
- Publishing exploit detail or proof-of-concept code for anything still unpatched
- A guaranteed bug count. Fuzzing finds what it finds; the commitment is to compute and process.
- Triage of findings
- Incident response
- Any other professional services

## Existing work

None named.

## Who we expect to do this

The strongest bidder is a team that has run continuous fuzzing at scale before, over months rather than for the duration of an audit, and can show the following evidence: campaigns sustained, coverage figures, bugs found and disclosed. Proposals should be explicit about:

- Coverage of languages and frameworks
- Compute: State the sustained core hours you can field and where they come from
- User Experience: How does the user access the tool? Is it via service request only? A CLI? A dedicated User Interface? Briefly describe the user flow as it will exist should the grant be awarded.

The proposal will likely be best served by a single grant recipient, but the RFP can certainly be considered for multiple participants if that best serves the needs of the ecosystem.

## Hard requirements

1. Aggregated results measured and published: Aggregate and abstracted statistics for coverage, findings, etc., updated at least quarterly on a public page. Bug counts alone are not an acceptable measure of a fuzzing program.
2. Siloed User Experience: Users may only see their own findings for security purposes. This must be available to be considered for the grant.
3. No user lock-in: Harnesses must build and run on standard open source fuzzing tooling. Every project keeps its harnesses, corpus, and documentation under an open license at no further cost, and must be able to keep running them without paying the grantee anything.

## Milestones (draft)

### A - Program stood up - $75,000

- [ ] Specs and timeline provided for tool to go live
- [ ] Intake form for grantor and grantee to gauge interest and sequencing is live
- [ ] Ability for first project/users to potentially onboard

### B - Ecosystem Adoption - $75,000 (adoption milestone)

- [ ] Onboarding flows are available and open
- [ ] 7+ projects have self-onboarded and begun a campaign
- [ ] Publication of first aggregated and anonymized report to show baseline statistics for future QoQ reference
