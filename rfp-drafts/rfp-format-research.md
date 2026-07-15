# What makes a good RFP — research notes (July 2026)

Basis for the Vyper RFP rewrite and for a future RFP template. Sources: Ethereum Foundation ESP + classic RFPs, Web3 Foundation, Optimism Foundation Missions, Stellar Community Fund, Arbitrum Foundation, Uniswap Foundation, Gitcoin mechanism library.

## The common skeleton (in order)

1. Title + key-facts table (budget cap, submission deadline, decision date, contact)
2. Ecosystem need — one or two paragraphs on why the funder cares
3. Prior art / existing work — named openly so every bidder can build on it
4. Scope — in scope / out of scope
5. Hard requirements (instant self-screen) vs. soft requirements
6. Milestones with per-milestone acceptance criteria
7. What proposals must include
8. Selection criteria — weighted percentages if possible
9. Process: submission channel, Q&A cutoff, decision date, review turnaround

Length target: 1–2 pages. EF and Optimism RFPs run 800–2,500 words. Long procurement-style docs (Arbitrum treasury RFP) suit financial-services engagements only.

## Principles

- **Fix the outcome and budget envelope; let applicants propose the milestone plan; finalize in the grant agreement.** This is the dominant pattern (W3F, Optimism, EF classic, Uniswap, Stellar). Fully prescribed milestones appear only in tiny fixed-price RFPs or audits.
- **Every deliverable states its verification method.** W3F's milestone tables (`Number | Deliverable | Specification`) are the gold standard, with standard rows in every milestone: license, docs, testing guide, Dockerfile ("a reviewer runs one command from clean checkout"), final public article. https://github.com/w3f/Grants-Program/blob/master/applications/application-template.md
- **Acceptance criteria are binary events with public evidence.** Stellar's contrast: weak = "frontend done"; strong = "end-to-end swap flow demo recorded on testnet". Optimism: "Launch of the application by October 14th"; "Release all code under MIT license".
- **Back-weight payment toward launch/adoption.** Stellar holds 40% until mainnet; Optimism uses 1-year lockup + clawback for missed critical milestones. https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines
- **Name the frontrunner's work in the RFP; keep the process neutral.** EF does this repeatedly (SIWE RFP pointed at Eauth and Spruce won; did:ethr RFP scopes stewardship of the incumbent codebase; RFP-Hub RFP described an existing product and the incumbent applied publicly). W3F marks RFPs 🟡 "one or more teams are working on this". Require disclosure of relationships instead of pretending no incumbent exists.
- **Commit to dates on both sides** — submission deadline AND decision date AND review turnaround for milestone deliveries (Gitcoin warns reviewer delay is the top grantee complaint).
- **Publish weighted selection criteria** (Arbitrum: 25/25/20/15/15).
- **Offer a support channel** — named sponsor (Optimism), office hours (ESP), or Q&A cutoff (Arbitrum).

## Milestones when there is / isn't a known vendor

Fund policy Griff settled on (July 2026), refined from the researched recommendation:

- Every RFP fixes: outcomes, acceptance criteria, budget cap, hard requirements.
- **Milestones are always published as a draft** — they set the vibe for what the fund expects; final milestones and payments are negotiated with the selected team and fixed in the grant agreement. Strengthening the draft milestones is explicitly part of how a proposal wins.
- **Frontrunners are disclosed head-on, in their own section near the top** ("Who we expect to do this"): who co-drafted the RFP, that they're expected to win, why the price is believed fair, and that a challenger wins by credibly doing it for less or proposing stronger milestones. Integrity over theater — skip formal weighted scoring when the process is really an open-challenge window.
- **Process = 15-day proposal window that opens once the RFP is fully funded**, then a decision within [N] days.

## RFP lifecycle statuses (for the board and the doc header)

Draft → Fundraising → Funded → Open for proposals → Reviewing proposals → In progress → Complete

Each RFP doc shows the full lifecycle in its key-facts table with the current status marked. Note: the board app's `status` column (pending/approved/rejected/archived) is a moderation axis — the lifecycle above is a separate field the app doesn't have yet.

## Vyper-specific technical anchors (for milestone review later)

- Existing work: https://github.com/verifereum/vyper-hol (semantics done, passes codegen test suite; end-to-end proof NOT closed — core theorems admitted as of 2026-06-24 status doc) and https://github.com/verifereum/verifereum (HOL4 EVM semantics, EEST-validated, v1.0.0 June 2026). Lead: Ramana Kumar (CakeML); Vyper lead dev Charles Cooper is the #2 contributor.
- Team's own full-project estimate (their funding repo): $774k–$1.58M. The $650k ask sits at the bottom of their range, defensible because ~3,200 commits of groundwork exist.
- Difficulty ordering the original draft got wrong: the backend (Venom→asm→bytecode, stack scheduling) is the hardest part (the analog of register allocation in CompCert/CakeML) and one prior top-level theorem statement was found false; the original priced it cheapest. Final pricing after Griff's June 30 call with Charles Cooper (Fireflies: "Vyper Funding Strategizing with TheDAO"): total $600k as A/B/C/D/E = 50/125/100/125/200, milestones lettered because the team will close them in parallel, adoption milestone (E) pays last.
- From that call: end deliverable is a verified compilation mode merged upstream / bundled with the official compiler (verified pass set as a user-selectable mode; experimental passes stay outside it); KPIs Charles endorsed: downloads + on-chain deployments compiled with verified mode; upfront disbursement matters to the team (sunk cost, cash-flow) — grant agreement may pay an advance counted against the first milestone; ongoing re-verification folds into normal compiler maintenance (~proportional to change size), so the RFP scopes perpetual re-verification out.
- The killer acceptance criterion: headline theorems check with ZERO admitted/cheated lemmas in the dependency graph, enforced by an automated CI check — machine-auditable by a non-expert.
- Caveats a funder must force into the docs: full trusted-computing-base statement (EVM model, frontend, execution path), pinned upstream commit + EVM fork per release, gas semantics out of scope, "verified production optimizer" actually means a verified reference implementation cross-checked against production output.
