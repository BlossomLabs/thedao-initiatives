---
title: Source-Level Debugging for Solidity: ethdebug in solc
type: grant
goal: 236500
summary: solc does not emit the debug information debuggers need, so every tool
  reverse-engineers compiler behavior and breaks when the compiler changes. This
  funds implementing the ethdebug format directly in solc, with debug data that
  survives the full optimizer pipeline so it works on production builds.
topup: true
reviewer: Nicholas D'Andrea (ethdebug) and Nikola Matic (Solidity)
---
## Why this matters

Debugging Solidity is a longstanding pain point, and the root cause is structural. The compiler (solc) does not emit the rich debug information debuggers need: variable types, scopes, and runtime locations. Without a standard for that data, every debugging tool reverse-engineers compiler behavior, which breaks whenever the compiler changes.

The 2025 Solidity Developer Survey (925 responses) re-confirmed this. The three most requested improvements, step-through debugging, variable and state inspection, and transaction replay, map directly to what a standard debug format enables. The need is sharpest in production, where deployed contracts are immutable and the cost of not understanding behavior is highest.

This grant funds implementing the [ethdebug format](https://ethdebug.github.io/format/) directly in solc. The end state:

- solc emits standardized debug data covering storage variables, local variables, memory, calldata, and per-instruction context
- That data survives the full compilation pipeline, including all optimizer passes, so it works on production builds
- Debuggers, frameworks, monitoring tools, explorers, and agents can read one shared standard instead of reconstructing compiler internals

## The recipient

In the interest of full transparency:

- This grant is a co-funding opportunity brought by **Argot Collective** and **Walnut**. The ethdebug format is developed by Argot engineer Nicholas D'Andrea. The solc implementation is done by Walnut. We expect them to do this work.
- This is not a competitive tender. The project is already in progress with the first milestones funded and underway, so there is no open challenge window. A challenger just doesn't make sense in this case.
- **Argot Collective is the anchor backer.** A public goods nonprofit, Argot has committed $151,000 of the $236,500 project budget. This grant raises the remaining $85,500 to finish the project.

## Existing work

- [ethdebug/format](https://github.com/ethdebug/format) is the open specification for EVM debug information, comparable in intent to DWARF for C and C++. It defines schemas for types, variable locations, runtime context, and compiler metadata.
- The implementation is underway at Walnut, with the first milestones below funded by Argot.

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

## Milestones

The total project budget is $236,500. Argot Collective has committed $151,000 as anchor backer, and this grant raises the remaining $85,500 to finish the project.

### 0 - Testing and validation infrastructure - $13,000 (delivered end of June)

- [x] Automated test and validation infrastructure for ethdebug output in place, running in public CI. Completed: [PR #16727](https://github.com/argotorg/solidity/pull/16727)

### 1 - Internal debug data specification - $19,500 (in progress)

- [ ] Internal specification for how solc represents and propagates debug data, published for review. In progress: [PR #16780](https://github.com/argotorg/solidity/pull/16780)

### 2 - Yul serialization - $33,000 (target: October 2026)

- [ ] Debug info survives compilation round-trips through Yul, demonstrated by automated tests in public CI

### 3 - Full unoptimized pipeline - $85,500 (target: March 2027)

- [ ] solc emits ethdebug-format debug data for unoptimized builds, covering storage variables, local variables, memory, calldata, and per-instruction context
- [ ] Output validates against the ethdebug schemas in an automated public CI check
- [ ] Implementation is merged into solc, or is an open pull request under active review by the Solidity team, linkable by URL
- [ ] A published walkthrough showing a debugger or test harness consuming the emitted data on a sample contract

### 4 - Optimized pipeline - $85,500 (target: August 2027)

- [ ] Debug data extended through all optimizer passes, correct on optimized production builds
- [ ] Public test suite demonstrates debug data accuracy on optimized builds, with results published
- [ ] Implementation merged into solc, or an open pull request under active review, linkable by URL
- [ ] Published maintenance plan for keeping ethdebug output current across future solc and optimizer changes

## Budget summary

| Milestone | Cost |
|---|---|
| 0. Testing and validation infrastructure | $13,000 |
| 1. Internal debug data specification | $19,500 |
| 2. Yul serialization | $33,000 |
| 3. Full unoptimized pipeline | $85,500 |
| 4. Optimized pipeline | $85,500 |
| **Total** | **$236,500** |

Argot Collective has committed $151,000. This grant raises the remaining $85,500.

## Team

- **Djordje Todorovic**, Walnut compiler and systems engineer. 10+ years of LLVM contributions
- **Roman Mazur**, Walnut founder and product lead. 10+ years experience, ex-Argent, ex-Microsoft
- ethdebug format: <https://ethdebug.github.io/format/>
- ethdebug GitHub: <https://github.com/ethdebug/format>
- Walnut: <https://walnut.dev/>
- Argot Collective: <https://argot.org>
