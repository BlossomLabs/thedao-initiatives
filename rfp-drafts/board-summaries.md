# Board-ready copy for the RFP dapp

One block per RFP: title, card summary (for the board's summary field), and funding goal. The full RFP text goes in the details field. Placeholder budgets are marked; Griff sets final numbers in the admin form.

---

**Vyper compiler formal verification** - goal: $600,000 *(board updated, shows $600,000)*

> Formally verify the Vyper compiler end to end, so bytecode compiled in verified mode provably matches the source code. Drafted with the Vyper core team, who are well positioned to do the work, with a real proposal window for challengers. A third of the budget pays out only on adoption and ecosystem impact.

---

**PRSpec in client CI — automated EIP compliance checks** - goal: $12,500

> Package PRSpec — an LLM-powered tool that compares EIP spec text against client source code and flags mismatches — so Ethereum client teams can run it locally, then get it embedded as a recurring pre-release check in the staging pipelines of at least two major execution clients. It complements the official conformance test suites by catching spec drift no one wrote a test for; it already surfaced a real EIP-1559 cross-client inconsistency. Adoption is only counted when the client teams confirm it publicly.

---

**Source-level debugging for Solidity (ethdebug in solc)** - goal: $85,500

> Co-fund putting the ethdebug debug format directly into the Solidity compiler, so solc emits standardized data on variables, memory, and per-instruction context that survives optimization. The 2025 Solidity Developer Survey ranked debugging a top pain point. Argot Collective (public goods nonprofit) matches donor funding dollar for dollar up to $85,500 and Walnut does the implementation. This co-funds Phases 3 and 4, the phases that deliver production-ready debug data.

---

**Decentralized privacy-preserving EDR** - goal: $300,000

> An endpoint security agent crypto teams will actually run: user-space instead of kernel-level, self-hostable, with telemetry encrypted so nobody can read it unless it provably matches a detection rule. Ships with Web3-specific detectors for the laptops of the people who hold keys. Half the budget pays out only on real adoption.

---

**OPSEC rating agency, an "L2Beat for OPSEC"** - goal: $300,000 *(already on the board; summary below is the refreshed version)*

> A public, tool-agnostic scoreboard of who does operational security well: A/AA/AAA tiers, a rotating committee, and ratings that expire without a check-up. It only ever publishes achievements, never gaps, so it can't become a target list for attackers.

---

**Multisig transaction coordination tooling** - goal: [$350,000 placeholder]

> Tooling that lets multisig signers trust what they're signing: one verified, tamper-evident simulation everyone can rely on, replacing the brute redundancy of every signer re-checking on separate devices and channels. Aimed squarely at the Bybit failure mode. Integrates with Safe.

---

**Free self-service OPSEC self-audit** - goal: [$120,000 placeholder]

> A free, AI-guided OPSEC self-audit that tells a team exactly how to fix each gap on their actual stack, with runnable steps for AWS, GCP and friends. Costs about a dollar, enough to cover inference and make people care. The on-ramp to the public OPSEC rating.

---

**Continuous phishing simulation for Web3 teams** - goal: [$120,000 placeholder]

> Ongoing, realistic simulated phishing against consenting Web3 teams, with per-team scores and training triggered only when someone actually falls for one. Continuous measurement where one-off phishing training fades fast.

---

**Just-in-time access control for startups** - goal: [$180,000 placeholder]

> A lightweight just-in-time access tool: request exact permissions for an exact time window, get multi-party approval, receive an auto-expiring role, leave a tamper-evident trail. The scrappy version of what only enterprises have today.
