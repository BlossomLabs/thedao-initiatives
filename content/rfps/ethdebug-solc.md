---
title: Source-Level Debugging for Solidity: ethdebug in solc
goal: 236438
type: grant
summary: solc does not emit the debug information debuggers need, so every
  tool reverse-engineers compiler behavior and breaks when the compiler
  changes. This funds implementing the ethdebug format directly in solc,
  with debug data that survives the full optimizer pipeline so it works on
  production builds.
---
> **NOTE: This is a real RFP we are working on but the final formatting is still open for discussion. We would love your feedback on the format presented here and are open to suggested improvements.**

| | |
|:--|:--|
| **Status** | Draft |
| **Budget** | $236,438 |
| **Sponsor funding** | $150,938 committed by Argot Collective |
| **Proposal window** | None, pure grant. |
| **Indicative duration** | 6 to 9 months for the remaining milestones (proposers set their own timeline) |
| **Contact / questions** | [FORUM LINK] |

## Why this matters

Debugging Solidity is a longstanding pain point, and the root cause is structural. The compiler (solc) does not emit the rich debug information debuggers need: variable types, scopes, and runtime locations. Without a standard for that data, every debugging tool reverse-engineers compiler behavior, which breaks whenever the compiler changes.

The 2025 Solidity Developer Survey (925 responses) re-confirmed this. The three most requested improvements, step-through debugging, variable and state inspection, and transaction replay, map directly to what a standard debug format enables. The need is sharpest in production, where deployed contracts are immutable and the cost of not understanding behavior is highest.

This RFP funds implementing the [ethdebug format](https://ethdebug.github.io/format/) directly in solc. The end state:

- solc emits standardized debug data covering storage variables, local variables, memory, calldata, and per-instruction context
- That data survives the full compilation pipeline, including all optimizer passes, so it works on production builds
- Debuggers, frameworks, monitoring tools, explorers, and agents can read one shared standard instead of reconstructing compiler internals

## Who we expect to do this

In the interest of full transparency:

- This RFP is a co-sponsorship opportunity brought by **Argot Collective** and **Walnut**. The ethdebug format is developed by Argot engineer Nicholas D'Andrea. The solc implementation is done by Walnut. We expect them to do this work.
- This is not a competitive tender in the usual sense. The project is already in progress with the first three milestones funded and underway, so there is no open challenge window. A challenger just doesn't make sense in this case.
- **Argot Collective is the anchor sponsor.** A public goods nonprofit, Argot has committed $150,938 of the $236,438 project budget. This RFP raises the remaining $85,500 to finish the project.

## Existing work

- [ethdebug/format](https://github.com/ethdebug/format) is the open specification for EVM debug information, comparable in intent to DWARF for C and C++. It defines schemas for types, variable locations, runtime context, and compiler metadata.
- The implementation is underway at Walnut, with the first three milestones below funded by Argot.

## Scope

**In scope**

- The full five-milestone implementation of ethdebug in solc, from test infrastructure through the optimized production pipeline
- Complete debug data covering storage variables, local variables, memory, calldata, and per-instruction context
- Upstreaming the implementation into solc and documenting how tools consume the emitted data

**Out of scope**

- Building end-user debugger UIs. This funds the compiler-level data, not the tools that read it.
- The ethdebug format specification itself, which Argot maintains separately.
- Ongoing maintenance beyond the grant period, beyond the maintenance plan required below.

## Hard requirements

1. **Open source.** All work merged under solc's existing license, no closed-source dependencies.
2. **Upstream, not a fork.** Deliverables land in the official solc repository, or are open pull requests under active review by the Solidity team. A private fork does not count.
3. **Machine-checkable acceptance.** Debug data output is validated by an automated test suite in public CI against the ethdebug format schemas.
4. **Production coverage proven.** Final acceptance requires debug data demonstrated correct on optimized builds, not just unoptimized ones.
5. **Maintenance plan.** A documented plan for keeping ethdebug output current as solc and the optimizer evolve.

## Milestones (draft)

These milestones are the full project plan, scoped with Argot and Walnut. Final milestones and payments for the co-funded portion are negotiated with the selected team and fixed in the grant agreement. Strengthening this draft is part of a winning proposal.

The total project budget is $236,438. Argot Collective has committed $150,938 as anchor sponsor, and this RFP raises the remaining $85,500 to finish the project.

**0 - Testing and validation infrastructure - $13,125**

- [ ] Automated test and validation infrastructure for ethdebug output in place, running in public CI

**1 - Internal debug data specification - $19,688**

- [ ] Internal specification for how solc represents and propagates debug data, published for review

**2 - Yul serialization - $32,813**

- [ ] Debug info survives compilation round-trips through Yul, demonstrated by automated tests in public CI

**3 - Full unoptimized pipeline - $85,312**

- [ ] solc emits ethdebug-format debug data for unoptimized builds, covering storage variables, local variables, memory, calldata, and per-instruction context
- [ ] Output validates against the ethdebug schemas in an automated public CI check
- [ ] Implementation is merged into solc, or is an open pull request under active review by the Solidity team, linkable by URL
- [ ] A published walkthrough showing a debugger or test harness consuming the emitted data on a sample contract

**4 - Optimized pipeline - $85,500**

- [ ] Debug data extended through all optimizer passes, correct on optimized production builds
- [ ] Public test suite demonstrates debug data accuracy on optimized builds, with results published
- [ ] Implementation merged into solc, or an open pull request under active review, linkable by URL
- [ ] Published maintenance plan for keeping ethdebug output current across future solc and optimizer changes

## Milestone review and acceptance

- Milestones 0 through 2 are already underway and reviewed under Argot's existing arrangement with Walnut. Their completion status is reported publicly, and payments from this RFP begin only once milestones 0 through 2 are accepted.
- For the remaining milestones, machine-checkable criteria (CI green, merged or open upstream pull requests, published test results) are accepted automatically once the public evidence exists.
- Judgment-based criteria (whether coverage is complete, whether the walkthrough is credible) are signed off by an independent technical reviewer who has not been named yet but will be agreed to between Giveth and the Argot team before work begins and named in the official grant agreement.
- The reviewer's fee comes out of the milestone payment or is pro bono. The winning team coordinates their payment.

## Process

- Once this grant is fully funded, Argot engineer Nicholas D'Andrea and Walnut ("the team") need to give expected deadlines to complete all five milestones.
- Once the first 3 milestones are complete, the team will continue their work completing the last 2 milestones.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- If a milestone stalls, and is delayed past the expected deadline, eventually the team will get a 21-day deadline to complete it. If they still miss it, unused funds become claimable by the donors who supported the RFP for 30 days, after which unclaimed funds go to TheDAO Security Fund for other initiatives.

## Budget summary

| Milestone | Cost |
|:--|:--|
| 0. Testing and validation infrastructure | $13,125 |
| 1. Internal debug data specification | $19,688 |
| 2. Yul serialization | $32,813 |
| 3. Full unoptimized pipeline | $85,312 |
| 4. Optimized pipeline | $85,500 |
| **Total** | **$236,438** |

Argot Collective has committed $150,938. This RFP raises the remaining $85,500.

## Team

- **Djordje Todorovic**, compiler and systems engineer. 10+ years of LLVM contributions
- **Roman Mazur**, Walnut founder & product lead. 10+ years experience, ex-Argent, ex-Microsoft
- ethdebug format: <https://ethdebug.github.io/format/>
- ethdebug GitHub: <https://github.com/ethdebug/format>
- Walnut: <https://walnut.dev/>
- Argot Collective: <https://argot.org>

Questions, pushback, better ideas? Post them in the forum thread: [FORUM LINK]
