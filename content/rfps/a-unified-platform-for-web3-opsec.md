---
title: A Unified Platform for Web3 OpSec
type: grant
goal: 250000
summary: Web3 OpSec tooling is fragmented. Frameworks, trainings, scanners and
  breach monitoring all exist, but they live in separate places and nobody has a
  single view of where they stand. This grant funds one platform that pulls them
  together into a task list with owners and statuses, so a team can see its
  posture and what to fix next. Auditware is the recipient: they've already built
  the foundation, and this opens it up to the ecosystem as a public good and
  funds its development into an impactful and full-featured platform.
duration: 12
recipient: Auditware
---
## Why this matters

Ask a Web3 team how their OpSec posture looks and most won’t have a good answer. It's not that the knowledge is missing - the frameworks exist (W3OS, SEAL’s guides and certs, SOC2, etc.), the trainings exist, the scanners exist, breach monitoring exists. The problem is that it all lives in multiple different places, waiting for someone with the proper expertise and thoroughness to implement and measure everything. Compliance is a spreadsheet someone updates twice a year, training is a link in an onboarding doc, scanning is three vendor dashboards nobody really checks. None of it tells a founder or a security lead the one thing they actually need to know: here is your posture, and here are the next tasks to improve it.

This grant funds a single platform for managing all things OpSec: training, framework compliance, automated scanning and compromise monitoring, tools for securely performing sensitive actions, unified into one task-based tracker of your security posture, for individuals and organizations. Complete tasks, watch your posture improve, assign owners, and measure completeness.

## The team

This is a grant, and Auditware is the recipient. Full transparency on why: Auditware has already been building exactly this platform, Sentry, using their own resources, and this grant concept has grown out of that work. Rather than fund a from-scratch duplicate of something that already exists in large part, this grant funds further developing it, hardening it, and opening it up to the whole ecosystem as a public good.

The platform's foundation — the compliance tracking, the scanning and monitoring engines, the training system — was built with Auditware's own resources. The grant pays for advancing development of tools and monitors, opening the platform up, and pushing for adoption.

Auditware will disclose their relationships to existing OpSec tooling and firms in their proposal, and the work funded here is delivered in the open, so the community can hold it to account.

## Why a grant: what already exists

Sentry is live and under active development. It already includes:

- Compliance tracking for four frameworks: W3OS, SEAL, SOC 2 and NIST CSF, with requirement-level status, evidence, comments and attestations at the organization level. W3OS and SEAL content syncs from the upstream repositories, so framework revisions flow into the product instead of going stale.
- Adversary reconnaissance: an attacker's-eye view of the organization, covering domains and automatically discovered subdomains, DNS, TLS certificates, certificate-transparency logs, security headers, CORS, subdomain takeover fingerprints, look-alike phishing domains, GitHub repositories and dependency risk, compiled into a dossier with kill-chain analysis and a prioritized remediation playbook.
- On-chain monitoring: multisig, governance and transaction review monitoring, with deep contract analysis of upgradeability and admin/owner keys.
- Continuous compromise monitoring: checks run automatically, results feed per-domain dashboards with health ratings and history, and changes raise alerts in-app, by email and in Slack. Includes credential-breach detection with alerting, plus a weekly posture report.
- Training and guidance: detailed, SOC2-compliant OpSec training with per-user progress tracking and nudges, and a knowledge base of actionable security guides.
- Endpoint protection integration (FleetDM / the user-space EDR from the companion grant).

## In scope

- One task-based posture tracker: every framework requirement, scan finding, breach alert, and training module links to a task with an owner and a status
- One-click setup, easy integration with other services and platforms for automated compliance tracking and breach monitoring, with simple team onboarding
- Operationalizing existing frameworks (W3OS, SEAL Certs, DARC, SOC2 and others): requirements mapped to concrete tasks with guidance
- Continuous scanning and compromise monitoring that push alerts to the team in real time as incidents happen
- Interactive war rooms and incident response playbooks
- Self-serve onboarding and usage, designed to be extended when working with an auditor

## Out of scope

- Performing OpSec audits or consulting (the platform tracks the work and automates; humans still do the audits)
- Authoring new security standards — this platform adopts and operationalizes what the community already uses rather than seeking to build anything new
- The endpoint agent itself. That's the companion Decentralized, Privacy-Preserving EDR grant; this platform integrates with it rather than building it.

## Commitments

1. Task-based. Everything the platform knows (requirements, findings, alerts, trainings) surfaces as tasks with owners and statuses, at both the individual and organization level. Tasks are actionable, straightforward, and as automated as possible.
2. Framework-neutral. W3OS, SEAL, and future frameworks are all options for the users. No framework lock-in, and adding a new framework does not require rebuilding the platform.
3. Open. Platform code open source under an OSI-approved license and self-hostable / core platform open with a hosted offering.
4. Private by default. The platform holds a map of every team's security. Each team's gaps are visible only to that team. Posture ratings can be published or kept private.
5. Security review. A public third-party review of the platform itself, with periodic refreshes with every major release.

## Milestones (draft)

### A - The unified posture model - $40,000

- [ ] A published posture model: how framework requirements, scan findings, breach alerts and trainings all reduce to tasks with owners and statuses, and how individual and organization posture roll up into a single report/rating
- [ ] Framework mappings published for W3OS, SEAL, and SOC 2, every requirement mapped to concrete tasks with guidance, reviewable by the framework maintainers
- [ ] A published integration plan: which services and platforms feed automated compliance evidence and breach monitoring, and what each integration automates
- [ ] A public roadmap for the remaining work an outside engineer can evaluate
- [ ] Early access to the existing platform, with scaffolding for new features to allow teams to explore it from day one
- [ ] A polished, professional website that details the project and roadmap

### B - The complete platform - $125,000

- [ ] The full task-based tracker live: framework requirements, scan findings, breach alerts, and training all flowing into one posture view, per user and per organization
- [ ] At least 10 one-click integrations live, feeding compliance evidence and breach monitoring into the tracker automatically
- [ ] Continuous scanning and compromise monitoring running for onboarded organizations, with real-time alerts that create tasks rather than emails that get ignored
- [ ] War rooms and incident response playbooks live: a team can run an incident end to end in the platform, including guided flows for securely performing sensitive actions
- [ ] Self-serve onboarding: a team goes from signup to a populated task list in under 30 minutes, with the hand-off points for working with an auditor documented
- [ ] The code opened per Hard Requirement 3, with the public third-party security review published and its findings addressed

### C - Adoption and sustainability - $85,000 (adoption milestone)

- [ ] Tranche 1: Adoption evidence - $50,000
- [ ] At least 25 organizations actively using the platform, 10 of them confirming it publicly — a public statement from that organization or a case study they have approved, linkable by URL
- [ ] At least 100 individuals through the OpSec training
- [ ] At least 5 organizations publishing their posture rating publicly
- [ ] Published case studies and a public metrics page: organizations onboarded, tasks completed, trainings finished, findings resolved
- [ ] Tranche 2: Sustainability - $30,000
- [ ] A published sustainability model (hosted offering, support, or membership — proposer's call) with real revenue or committed funding covering ongoing operation
- [ ] One full framework-update cycle absorbed (e.g. a W3OS revision) proving the platform tracks living standards, not a snapshot
- [ ] An adoption-feedback report covering at least 6 teams, with the resulting fixes shipped
