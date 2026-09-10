---
title: OPSEC Ratings Coalition to Build & Maintain an "L2Beat for OPSEC"
type: rfp
goal: 150000
summary: Fund a single coordinator to bring at least six OPSEC auditing firms
  together around one industry-agreed rating standard: an A / AA / AAA tier a
  team earns and renews yearly, with a six-month check-in and automatic
  suspension when its security posture changes. The firms already running OPSEC
  audits become the accredited raters, apply one shared scoring template inside
  their existing flow and publish tiers only, never a team's report or score.
  Rated teams pay a fixed fee into a membership body that owns the standard and
  the board once the coordinator hands off. A simple public board shows who is
  rated; teams with unacceptable OPSEC simply don't appear.
---
| | |
|---|---|
| **Status** | Draft |
| **Budget** | $150,000 USD |
| **Proposal window** | 30 days, opening once the RFP is fully funded |
| **Indicative duration** | 18 months (the team sets the final timeline) |

## Why this matters

Your keys, your devices, your multisig process, your access controls... these are just as important as your smart contracts. Every serious team already invests in OPSEC, and OPSEC audits happen all the time. But all of that work is invisible. There is no public signal that tells users, investors or partners who is actually running a tight ship.

We want to change that with a single OPSEC rating the whole industry agrees on. Think of a Moody's rating: people want one because everyone recognizes what it means. Teams that earn an A, AA or AAA get their tier on a public board. That's it, just the tier. We will never publish what a team is missing (a public list of weaknesses is a gift to attackers), and teams with unacceptable OPSEC simply don't make the board... which says something all by itself.

## What this actually pays for

Let's be clear about what this RFP is: **a coordination effort.** The money here pays for a social exercise, getting the community of OPSEC auditing firms around one table to agree on one standard. The website is the easy part.

Three roles, and only one of them gets this money:

| Role | Who | Funded by this RFP? |
|---|---|---|
| Rated teams | Protocol, L2 and infra teams whose OPSEC gets scored and who appear on the board with their tier | No, they pay a fixed fee for their own assessment |
| Accredited raters | The 6+ existing OPSEC auditing firms that agree the scoring template and issue tiers inside their existing audit flow | No, the membership body pays them per rating from the fee pool |
| Coordinator | The single party that convenes the firms, gets them to sign one standard, builds the board and stands up the membership body | Yes, this is the recipient |

What we expect to come out of it:

- One scoring template and tier definitions (A / AA / AAA), agreed on by **at least 6 OPSEC auditing companies**. Roughly speaking, an A team follows best practices and we don't expect them to have incidents. AAA is wild: secure beyond what's reasonable.
- The firms already doing OPSEC audits become the raters. They add exactly one step to the audits they already run: apply the scoring template, issue the tier. The first batch of accredited raters is the same group that built the standard, so they have skin in the game from day one.
- A simple public board of rated teams, their tiers, a valid-until date and a last check-in date. Honestly, this part could probably be vibe coded in a weekend. The value is the standard and the names on it.
- A membership body that ends up owning all of it. The accredited firms form a cooperative professional body, one firm, one vote. It maintains the standard, certifies new raters, runs a small verification committee (paid something modest like $2,000 per member per cycle) that spot-checks a share of ratings, and takes over the standard, the board and the name from the coordinator no later than six months after this grant ends.
- A funding model that outlives the grant: issuer-pays, the same model the Moody's analogy comes from. Rated teams pay a fixed fee for their assessment (think $2,000 to $5,000 on top of an audit they were buying anyway), and the fee is the same whether they get a AAA or nothing. Fees go to the membership body, not to the rater. The body pays raters from the pool and funds the verification committee from it. Rough math: 30 teams a year at $3,000 is $90,000 a year, enough for the committee and a lean secretariat. The budget is sized for 12 to 18 months of runway on purpose, because fee revenue is thin until enough teams are on the board that being absent is conspicuous.
- Ratings that go stale on events, not on a calendar. A rating is valid for 12 months. At the six-month mark the team files a short self-attestation and its rater does a check-in (not a full audit), or the rating lapses. A disclosed incident or a material change (signer set, leadership, treasury or infrastructure migration) suspends the rating automatically until the team is re-rated. The scoring template itself changes through a defined process no more than once a year, so nobody is chasing a moving target.

Bidders are welcome to propose a different path to get there. The goal is what's fixed: a decentralized rating system that many OPSEC auditing companies co-own, with a real shot at sustaining itself long after this money is spent.

## Who we expect to do this

Nobody is pre-selected. Once the RFP is fully funded there will be an open bidding process, and the winner gets picked through the process below. The dream candidate is a credible coordinator in the security community: someone who can bring 6+ OPSEC auditing firms to the same table and get them all to sign the same document. (If you have ever tried to get six companies to agree on anything, you know that's the real work here.)

Ideally the coordinator is not an OPSEC auditing firm, because whoever holds the pen on the standard walks away with an edge over the firms they convened. That is a preference, not a requirement, and it will weigh in selection. An audit firm that coordinates takes no rater role during the grant and no ownership of the board. The best pitch a bidder can make is simple: here is why the other firms can trust me to run this.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

## Existing work

- [Security Frameworks by SEAL](https://frameworks.securityalliance.org/): the Security Alliance's open framework covering operational security, infrastructure, DevOps, incident response and more. Bidders should read it before proposing a scoring template.

## Scope

**In scope**

- Coordinating at least 6 OPSEC auditing companies to agree on one scoring template and the A / AA / AAA tier definitions
- Onboarding those firms as the first accredited raters, with whatever materials they need to run the template inside their existing audit flow
- A simple public board of rated teams and their tiers, with valid-until and last check-in dates... tiers only, no details, no gaps
- Standing up the membership body: the charter (one firm, one vote), how raters get certified, the verification committee, the fixed fee schedule and the pooled funding model
- The 12-month rating cycle with the six-month check-in and the event-based suspension process
- The handoff: transferring the standard, the board and the name to the membership body

**Out of scope**

- Performing the underlying OPSEC audits (the accredited firms do that)
- Publishing any team's specific weaknesses, unmet controls, or the reasons behind a tier
- A heavy platform build. The board is deliberately simple.

## Hard requirements

1. **Six firms minimum.** At least 6 OPSEC auditing companies formally agree to the scoring template and tier definitions, and commit to issuing ratings with it.
2. **Tiers only.** The public board shows a team's tier, its valid-until date and its last check-in, and nothing more. No gaps, no unmet controls, no explanations.
3. **Open and versioned.** The scoring template and tier definitions are public, open source and versioned, with changes dated and attributable, revised through a defined change process no more than once a year.
4. **Tool-agnostic.** Every tier is reachable no matter which tools or frameworks a team uses. No vendor's product is ever required.
5. **One firm, one vote.** Every founding firm gets equal governance rights in the membership body, regardless of who convened whom.
6. **Neutral name.** The standard and the board are not branded after the coordinator or any single firm.
7. **Mandatory handoff.** The standard, the board, the name and any secretariat function transfer to the membership body no later than six months after the final milestone. The coordinator keeps no veto and no unilateral control.
8. **Fixed fees, pooled.** Rated teams pay a fixed, outcome-independent fee. Fees flow to the membership body, which pays raters from the pool and funds the verification committee from it. No tier-contingent pricing, no "we'll get you to AA" upsell.
9. **Twelve months, checked at six, suspended on events.** A rating is valid for 12 months, lapses without the six-month self-attestation and check-in, and is suspended automatically on a disclosed incident or a material change until the team is re-rated.

## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

### A - Agreed standard - $50,000

- [ ] A public, versioned scoring template plus the A / AA / AAA tier definitions, with the change process for future revisions
- [ ] At least 6 OPSEC auditing companies formally signed on and committed to rating with it, with the signed template published
- [ ] The membership body's charter published: one firm, one vote, rater certification, the verification committee and its stipends, the fixed fee schedule, the pooled funding model, and the handoff agreement with a transfer date no later than six months after the final milestone

### B - Board and first ratings - $25,000

- [ ] The public board is live, showing rated teams, their tiers, valid-until dates and last check-ins (and nothing else)
- [ ] At least 6 accredited firms have issued ratings inside their normal audit flow, each listed on the public board
- [ ] At least 5 teams rated end to end, with their fees paid through the membership body's pool

### C - Adoption evidence - $75,000

- [ ] At least 20 teams publicly rated on the board by accredited firms
- [ ] The six-month check-in running: every rating older than six months shows a check-in date on the board, and the event-based suspension process is live with a public change log
- [ ] The membership body running on pooled fees, with the verification committee active and its spot-check sample published, both shown on the body's public page
- [ ] A public metrics page: teams rated, tiers awarded, firms participating, check-ins completed, suspensions and renewals

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the RFP is fully funded and stays open for 30 days.
- Proposals include: team and track record, technical approach, a milestone plan with per-milestone budget (the draft above, or a stronger version), and full disclosures.
- Giveth selects the team within 7 days of the window closing, weighing credibility, price, and strength of the proposed milestones.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

Questions, pushback, better ideas? Post them below.
