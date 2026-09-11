# fund.thedao.fund, all initiatives (exported 2026-09-10 19:07 UTC)

Every submission in the Round 2 board database, all statuses. Contact and funders fields are private and left out.

---

## [PENDING] Provider-Independent, Client-Verified ENS Resolution

- Type: RFP
- Funding goal: $150,000 USD
- Admin id: 29

### Summary

Today a wallet or gateway resolves an ENS name with one call to one RPC provider and trusts the answer; the correct record is on the chain and nothing checks it. This RFP suggests a library that asks two independent sources, verifies against a block header, and flags disagreement, plus a public test suite that any .eth gateway operator can run to prove they resolve and serve names correctly, so more than one company can serve .eth sites. It is anchored on the April 2026 eth.limo registrar hijack, where one operator's DNSSEC setup was the only thing between 2 million .eth sites and phishing pages. Half the budget pays only on adoption by named wallets, dapps, and gateway operators.

### Full details

Budget	$150,000 USD
Proposal window	30 days, opening once the RFP is fully funded
Indicative duration	9 months (the team sets the final timeline)

# Why this matters
Today, when a user types alice.eth, the wallet or gateway sends one eth_call to one RPC provider and shows whatever comes back. The correct record is on the chain. Nothing between the user and the chain checks it.

Wallet path: user types a name, wallet asks one provider (usually Infura), provider answers, wallet trusts it.
Browser path: user types alice.eth.limo, the request passes through eth.limo's registrar, DNS, servers, RPC, and CDN, each trusted alone.

With this RFP, the wallet or gateway uses a library that asks two independent sources, checks the onchain answer against a block header, and refuses or warns when the sources disagree. A hijacked or lying provider gets caught instead of trusted. A second gateway operator, passing the same public tests as the first, means the browser path no longer depends on one company.

Everything else built on names assumes this step is right: private lookups, curated registries, contract provenance. If one hijacked account can fake it, nothing on top of it holds.

What it looks like when the one company fails:

On 17 April 2026 an attacker impersonated an eth.limo team member, talked the registrar EasyDNS into an account recovery, and held eth.limo's DNS for about five hours. eth.limo is the gateway through which around 2 million .eth websites reach ordinary browsers. DNSSEC validation rejected the attacker's answers and eth.limo reports no user impact. Post-mortem: https://discuss.ens.domains/t/eth-limo-dns-hijack-post-mortem/22079
On 14 April 2026 attackers took over the cow.fi registration itself and served a counterfeit CoW Swap interface. The contracts were untouched; users signed malicious transactions anyway. Post-mortem: https://x.com/CoWSwap/status/2044925168892735985
In November 2025 a compromise at the registrar NameSilo stripped DNSSEC from the Aerodrome and Velodrome domains before redirecting them. The Block reports user losses above $700,000.

DNSSEC saved eth.limo because one operator had turned it on, kept the signing key off the registrar, and the attacker did not remove the DS record in time. Aerodrome shows what happens when the attacker does. Two million names inherit one company's DNS configuration as their last line of defence.

The onchain binding from name to content was correct in all three incidents. No wallet or dapp we know of checks it against a second source.

This RFP covers the binding from name to content commitment or address. Verifying that the frontend bytes a browser loads match that commitment is separate work (WEBCAT, Sigsum, and related transparency-log approaches) and is a handoff, not part of this scope. Until that piece exists, the first page load through a gateway stays unprotected even when resolution is verified.

# What this actually pays for
A resolution library wallets, dapps, and gateways can adopt as a drop-in: at least two independent paths, verification against a block header or light-client proof, and defined behaviour when paths disagree.
A written threat model covering registrar, DNS, CDN, gateway, and RPC-provider failure, stating which chokepoints the library removes and which it leaves in place.
A public test suite that any .eth gateway operator can run to prove they resolve and serve names correctly, plus a hardening playbook (DNSSEC, registry lock, key handling), so operators become interchangeable and no user is tied to one.
Adoption by named wallets, dapps, and gateway operators, with public evidence.

The browser-native path, in which a browser treats ENS as a resolution root without any gateway, is owned by browser vendors. Bidders should say how their work makes that path easier; building it is out of scope.

# Who we expect to do this
Nobody is pre-selected. Once the RFP is fully funded there will be an open bidding process, and the winner gets picked through the process below.

A strong bidder has shipped resolution or light-client code that wallets already run, and can name the wallet or dapp teams that will integrate the result. Bidders who operate a gateway or an RPC service are welcome, and must say how the library stays independent of their own service.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

# Existing work
- ENS resolution specifications and CCIP-Read (ENSIP-10): https://docs.ens.domains
eth.limo, the gateway whose post-mortem anchors this RFP, and comparable .eth gateways
- Helios and other Ethereum light clients that produce verifiable state proofs. We expect bidders to build on one of these, not to build chain verification themselves.
- WEBCAT and Sigsum, for the frontend-integrity handoff (out of scope here)

# Scope

## In scope
- A multi-path ENS resolution library with quorum or disagreement handling, usable from at least a JavaScript/TypeScript environment
- Client-side verification of forward resolution (name to address, name to contenthash) against a block header or light-client proof
- A public threat model for the full resolution path: registrar, DNS, CDN, gateway operator, RPC provider
- A public gateway test suite and hardening playbook for .eth gateway operators
- A documented handoff to frontend verification: what the library outputs, and how a frontend-integrity tool consumes it
Integration support for the first adopters, and a maintenance plan for after the grant

## Out of scope
- Building a browser-native ENS resolution root (browser vendors own this)
- Verifying that loaded frontend bytes match a content commitment
- Operating a gateway, an RPC service, or a registrar
- Private name resolution (PIR or homomorphic-encryption based lookups)


# Hard requirements
- Open source. All delivered code is released under an OSI-approved licence, in a public repository, from the first milestone onward.
- No single provider required. The library works with any RPC provider, any gateway, and any light client that implements the documented interface. No vendor's service is required, and the default configuration names at least two unaffiliated paths.
- Verification, not trust. Forward resolution is checked against a block header or light-client proof. A resolver answer alone is never treated as authentic.
- Defined disagreement behaviour. The specification states what the library does when independent paths return different results: what it returns, what it logs, and what the calling application sees.
- Published threat model. The threat model names each chokepoint on the resolution path and states, for each, whether the delivered work removes it or leaves it in place.
- Handoff documented. The library's output format and the interface to frontend-integrity tooling are specified in a public document.
- Public acceptance evidence. Every milestone criterion is provable from a public page, repository, CI run, or a named party confirming in writing.
- Maintenance plan. The final milestone includes a named maintainer and their reason to continue, published in the repository.


# Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

## 1 - Threat model and specification - $25,000
[ ] The threat model is published in the public repository, covering registrar, DNS, CDN, gateway operator, and RPC provider failure, with the eth.limo, CoW Swap, and Aerodrome incidents mapped to it
[ ] The library specification is published, including the multi-path interface, the verification method, the disagreement behaviour, and the handoff interface to frontend verification
[ ] At least 3 wallet, dapp, or gateway teams have reviewed the specification, each named in the repository with a link to their review

## 2 - Verified resolution library - $50,000
[ ] The library is released under an OSI-approved licence with forward resolution (address and contenthash) verified against a block header or light-client proof
[ ] Two unaffiliated resolution paths are supported and disagreement handling is implemented, shown by a passing public CI run that injects a wrong answer on one path
[ ] An independent security review of the library is published, with every finding rated high or critical fixed and the fix linked

## 3 - Gateway tests and a second operator - $25,000
[ ] The gateway test suite and hardening playbook are published in the repository
[ ] At least 2 independent .eth gateway operators pass the test suite, each listed on a public page with the passing run

## 4 - Adoption by wallets and dapps - $50,000
[ ] At least 2 wallets or dapps with public users resolve ENS names through the library in a shipped release, each listed on a public page with the release notes or merged pull request
[ ] A public metrics page is live showing integrations, gateway operators passing the test suite, and library versions in use
[ ] The maintainer and maintenance plan are published in the repository, and the final report on adoption and remaining chokepoints is public


# Milestone review and acceptance
- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.


# Process
- The proposal window opens once the RFP is fully funded and stays open for 30 days.
- Proposals include: team and track record, technical approach, a milestone plan with per-milestone budget (the draft above, or a stronger version), and full disclosures.
- Giveth selects the team within 7 days of the window closing, weighing credibility, price, and strength of the proposed milestones.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

## [PENDING] Account Abstraction & Mempool Data Analytics

- Type: Grant
- Funding goal: $30,000 USD
- Admin id: 28

### Summary

This $30,000 grant funds a 3-month expansion of EIPsInsight to deliver open security and network analytics, centered on account abstraction with targeted mempool and MEV intelligence.

Account-abstraction focus (EIP-4337, EIP-7702, EIP-8141): cross-chain indexing, EntryPoint and set-code usage metrics, typed-transaction migration trends, gas economics, and threat watchlists for malicious sweeper contracts post-Pectra.

Mempool and MEV: post-Dencun analytics tracking sandwich attacks, extracted value in USD, block-level sandwiching rate, and customizable threat alerts.

Delivered by EIPsInsight, a project by Avarch LLC, as open, reproducible security analytics from public chain data, extending a live public platform rather than starting from scratch.

### Full details

# Grant: Account Abstraction and Mempool Security Analytics

| | |
|---|---|
| **Status** | Draft |
| **Budget** | $30,000 USD |
| **Proposal window** | 15 days, opening once the grant is fully funded |
| **Indicative duration** | 3 months (the team sets the final timeline) |

## Why this matters

Since Pectra activated EIP-7702, attackers have used malicious delegations to drain compromised wallets, sometimes in a single transaction. As account abstraction evolves through ERC-4337 and EIP-8141, wallet teams and security researchers need better visibility into active delegations and changes in delegation code, and today no neutral public source tracks which contracts an account delegates to or when that delegation changes.

At the same time, public mempools expose transactions to frontrunning and sandwich attacks, contributing to billions of dollars in MEV. Proposals such as EIP-8184 (Lucid) aim to reduce this, but there is still no common public place to track and understand these risks.

This grant expands EIPsInsight into an open security-visibility layer. It provides free, reproducible data on account-abstraction and mempool activity, so developers and auditors can identify risks earlier and build safer systems.

## What this grant actually pays for

This grant funds open visibility and analytics, not security enforcement or active defense tools. The $30,000 budget supports the engineering, cross-chain indexing, and public data infrastructure required to extend EIPsInsight into a security-visibility layer for Ethereum.

Specifically, it pays for:

- **Open indexing and dashboards.** Public tracking for EIP-7702 delegation-target contracts, ERC-4337 EntryPoint activity, EIP-8141 frame transactions, and EIP-8184 mempool exposure, across Ethereum mainnet and top L2s.
- **Threat and anomaly detection.** Reproducible anomaly models, sweeper-contract watchlists, and threshold alert feeds for wallet teams, auditors, and researchers.
- **Public data feeds.** Free, un-siloed data feeds and analytics consoles, with no token gating and no proprietary paywall.

The result is a shared, verifiable evidence base to identify emerging account-abstraction vectors and pre-inclusion mempool risks early.

## The recipient

This grant is awarded to EIPsInsight, a public-goods project by [Avarch](https://avarch.org/). The head start that makes a grant fit rather than an open RFP: EIPsInsight already runs the underlying account-abstraction and mempool dashboards, and the team holds the indexing and standards expertise, so this work extends a live public platform into security coverage rather than building from scratch, and costs less than a from-scratch bid.

Avarch operates with full neutrality: no commercial ties to any searcher, builder, relay, or wallet provider tracked in this project, no venture backing, and no token. Every number is derived from public chain data, and all code, analytics, and dashboards are open source. Its public-goods track record includes the [Ethereum Foundation ESP (Q2 2025)](https://blog.ethereum.org/2025/07/23/allocation-q2-25), Gitcoin Grants (GG18, GG21, GG23), and the [Giveth Security Round](https://qf.giveth.io/project/eipsinsight). Avarch is also a core member of the [Encrypt the Mempool](https://encryptedmempool.org/) Coalition, actively supporting EIP-8184 development, which brings direct domain expertise to public mempool security analytics.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

## Existing work

- **[PR board and Office Hours](https://eipsinsight.com/officehours):** weekly infrastructure used by EIP editors for proposal triage, tracking, and review.
- **[Protocol calls artifacts](https://eipsinsight.com/calls):** an archive of recordings, transcripts, AI summaries, and sourced decision ledgers for AllCoreDevs (ACD, ACDE, ACDC), EIP Editing Office Hours, EIPIP meetings, and breakout sessions.
- **[Upgrade directory and devnet readiness](https://eipsinsight.com/upgrade/eips):** live tracking for every EIP, ERC, and RIP by fork stage, with per-client devnet support.
- **Open-source codebases:** continuous, transparent development on [GitHub](https://github.com/AvarchLLC/EIPsInsight).

## Scope

**In scope**

- **Account-abstraction analytics (EIP-4337, EIP-7702, EIP-8141):** cross-chain indexing of UserOperation and bundler activity, EIP-7702 delegation patterns, EIP-8141 frame transactions, and EOA account migration.
- **Security and anomaly visibility:** real-time visibility of unexpected delegation-target changes, delegations to unaudited or known-malicious sweeper contracts, and malformed UserOperations.
- **Mempool and MEV insights (EIP-8184):** public dashboards measuring attackable order flow, MEV surfaces, and pre-inclusion frontrunning and sandwiching risk.

**Out of scope**

- **Active defense tools.** Building wallets, relays, or encrypted mempools. This grant funds visibility and threat intelligence, not enforcement.
- **Security services.** Manual code audits, active incident response, or exploit mitigation.
- **Long-term operational overhead.** Beyond the maintenance plan below, this grant does not fund general infrastructure past the delivery window.

## Hard requirements

1. **Open source.** All code under an OSI-approved license, in public repositories under Avarch LLC.
2. **Reproducible from public data.** Every published metric can be re-derived from public Ethereum chain data using a documented method, with no trusted, unverifiable feed.
3. **Free and no lock-in.** Every dashboard and data feed is free to read, with no paywall on the security data.
4. **Tool-agnostic.** The data is consumable without adopting any specific vendor product.
5. **Machine-checkable acceptance.** Each milestone is a live public page or published artifact, verifiable by a non-expert from a URL.
6. **Maintenance plan.** A documented plan for keeping the security analytics current as EIP-7702, ERC-4337, and mempool activity evolve.

## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

### 1 - Account-abstraction security and core indexing - $12,000

- [ ] Cross-chain indexing live for EIP-7702 delegation patterns, ERC-4337 UserOperation and bundler activity, EIP-8141 frame transactions, and EOA account migration, across Ethereum mainnet and at least 3 top L2s, linkable by URL.
- [ ] Public account-abstraction usage dashboards live: ERC-4337 EntryPoint activity, EIP-7702 set-code (type 4) monthly counts and cumulative adoption since Pectra, distinct delegating EOAs, and the contracts they interact with, linkable by URL.
- [ ] Ecosystem transaction-mix dashboards live: monthly market share across types 0 to 4, EIP-2718 typed-transaction migration, L1 composition (contract calls, transfers, blobs, set-code), and per-type economics (USD fees, failure rates, EIP-4844 blob demand), linkable by URL.
- [ ] Real-time anomaly detection live for at least 3 categories: unexpected EIP-7702 delegation changes, delegation to unaudited or known-malicious sweeper contracts, and malformed ERC-4337 operations, with a public watchlist, linkable by URL.
- [ ] A public coverage page listing indexed chains, operation types, and data schemas, and all AA indexers and parsers published under an OSI-approved license in a public repository, linkable by URL.

### 2 - Mempool and MEV risk visibility - $8,000

- [ ] A live post-Dencun MEV console showing total sandwich attacks, unique victim transactions, gross extracted value in USD, and block-level sandwiching rate, linkable by URL.
- [ ] Weekly historical trends over at least the trailing 26 weeks for sandwich volume, extracted bot profit in USD, exploited victim volume in USD, and active searcher-bot count, linkable by URL.
- [ ] EIP-8184 working-group progress tracking: meeting logs, recorded decisions, and latest meeting date, linkable by URL.

### 3 - Open data, research, and adoption - $10,000

- [ ] Free, documented public data access (downloadable feeds and an API) for all account-abstraction, mempool, and MEV surfaces, consumable without any specific vendor product, linkable by URL.
- [ ] A subscribe option so a team can be notified when a watched delegation target or mempool risk metric crosses a threshold, extending the existing per-proposal notifications, live and linkable by URL.
- [ ] A published, reproducible security analysis of EIP-7702 adoption and mempool exposure, with the documented method to re-derive its headline numbers from public chain data, linkable by URL.
- [ ] At least 3 external wallet, security, or research teams publicly using or citing the data, each confirmable from a public reference or a named party.
- [ ] A public metrics page: accounts and delegations covered, live anomaly categories, chains indexed, and external references or data consumers, linkable by URL.

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the grant is fully funded and stays open for 15 days. In that window, EIPsInsight submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

## Budget summary

| Milestone | Cost |
|---|---|
| 1. Account-abstraction security and core indexing | $12,000 |
| 2. Mempool and MEV risk visibility | $8,000 |
| 3. Open data, research, and adoption | $10,000 |
| Total | $30,000 |

## Team

All Avarch LLC, the team behind building and running [EIPsInsight](https://eipsinsight.com).

* **Manish Ranjan, System Architect:** System architecture, data design, and technical direction for EIPsInsight.
* **Dhanush Naik, Lead Engineer:** Development of real-time chain indexers, backend data pipelines, and analytical dashboard interfaces.
* **Yashkamal Chaturvedi, Operations & Content Lead:** EIP explainers, review reports, and ecosystem developer relations.
* **Pooja Ranjan, Founder:** Founder of Avarch LLC and Herder in Chief at ECH Institute, bringing extensive expertise in Ethereum community coordination and protocol standards tracking.

**Track Record & Resources:**
* **Proven Delivery:** Backed by prior public-goods grants from the [Ethereum Foundation ESP (Q2 2025)](https://blog.ethereum.org/2025/07/23/allocation-q2-25) and Gitcoin Grants (GG18, GG21, GG23).
* **Live Dashboards:** [Account Abstraction Dashboards](https://eipsinsight.com/aa) | [Mempool & MEV Console](https://eipsinsight.com/lucid)
* **Open Source:** Continuous public development on [GitHub](https://github.com/AvarchLLC/EIPsInsight).

---

## [PENDING] Onchain Risk Map: An Open Operational Incident Graph for Ethereum Security

- Type: Grant
- Funding goal: $50,000 USD
- Admin id: 27

### Summary

Onchain Risk Map converts documented security incidents into reusable evidence for Ethereum builders. It maps failures across software delivery, wallets, signing, account authorization, infrastructure, and execution using a shared graph with typed relationships and explicit evidence confidence. Building on our initial work previewed at https://map.okcontract.com, we will release and considerably improve an open dataset under the CC-BY-SA license. This initiative will deliver a versioned Ethereum-focused dataset, stronger claim-level provenance, independently reviewed incident mappings, and open tools for comparing failures and assessing defensive coverage. Auditors, projects, wallet developers, and incident responders will be able to use the outputs directly in their workflows and we will make efforts to enable integration with AI agents for blue teams.

### Full details

Ethereum applications depend on interacting technical and operational systems. A security failure can begin in a software dependency or operator session, alter transaction construction, pass through legitimate signing, and reach onchain execution. Understanding those relationships is necessary to design effective protections.

Historical incident reports contain valuable evidence, but comparing them requires repeated interpretation of terminology, system boundaries, causes, and consequences. Onchain Risk Map will provide a maintained reference model and reproducible dataset that allow this work to be shared across the ecosystem.

The initiative aligns with the Ethereum Foundation's Trillion Dollar Security work on wallet experience, smart contract security, infrastructure, and incident response. Its intended contribution is a reusable evidence base for investigating these problems and evaluating proposed defenses. 

The existing implementation provides the foundation: typed topology definitions, incident annotations, source snapshots, explicit merge and exclusion decisions, catalog validation, and deterministic generators.

We plan the following roadmap:

1. Publish a stable operational graph specification and data (CC-BY-SA)
2. Strengthen evidence provenance and incident identity
3. Develop an independently reviewed Ethereum reference corpus, and involve multiple vetted contributors from the whole ecosystem
4. Make the outputs independently usable

---

## [PENDING] Wallet Security for Post-Quantum Ethereum

- Type: RFP
- Funding goal: $250,000 USD
- Admin id: 26

### Summary

Post-quantum Ethereum needs wallet support and signer safety alongside protocol upgrades. This RFP funds independent security-proof research, a shared signer safety profile, and public signer and verifier tests. It covers hardware and browser compatibility, frame transactions, scalability, hash functions, and builder and user guidance on signature budgets. Adoption requires public tests and a vendor's conformance statement or gap list.

### Full details

# RFP: Wallet Security for Post-Quantum Ethereum  

|||
|-|-|
|**Status**|Draft|
|**Budget**|$250,000 USD|
|**Proposal window**|15 days, opening once the RFP is fully funded|
|**Indicative duration**|12 months (proposers set their own timeline)|

## Why this matters

Wallet security is a prerequisite for safe adoption of new signature schemes. Major failures show us why: a [Coldcard build error](https://blog.coinkite.com/adding-to-public-record/) exposed weak seeds, and the Ethereum address generator [Profanity](https://1inch.com/blog/post/a-vulnerability-disclosed-in-profanity-an-ethereum-vanity-address-tool) derived 256-bit private keys from a 32-bit seed. [Bybit's compromised signing interface](https://www.bybit.com/en/learn/this-week-in-bybit/bybit-security-incident-timeline) and the [Ledger Connect Kit supply chain attack](https://www.ledger.com/blog/security-incident-report) tricked signers into authorizing theft. These failures reached users through wallet software and signing workflows without breaking the underlying signature algorithms. In other words, while the chain was perfectly secure, the wallets were not.   

The [Ethereum Foundation's roadmap](https://pq.ethereum.org/) supplies a protocol path to post-quantum accounts, but wallet support and signer safety need their own funded work on firmware, browser integrations, and recovery. This RFP funds shared wallet safeguards and independent assurance across vendors. IonQ is now [projecting a cryptographically relevant quantum computer in 2028](https://www.ionq.com/blog/the-first-full-stack-blueprint-for-breaking-256-bit-elliptic-curve-signatures), and vendors will require at least 18 months to integrate and release hardware. **Post-quantum Ethereum needs wallets that support the schemes and protect users.**  

## What this actually pays for

Protocol upgrades and individual vendor audits leave shared wallet-security work unfinished. This RFP funds the requirements, tests, and guidance that wallet developers need, and the benefits will be shared by all vendors and will provide a safe path to adoption of hash-based signatures across hardware, browser, and software wallets.  

*   **The rules.** A signer safety profile for wallets, hardware signers, and custody systems. It specifies how to protect against common issues like one-time-key reuse issues. It also maps device limits and protocol integration requirements.

*   **The test suite.** A public corpus modeled on Project Wycheproof. Verifier vectors test malformed or forged signatures. A public board reports which implementations pass each applicable test. Compatibility and throughput measurements show whether existing schemes fit wallet targets and faster transaction processing.  
    
*   **The independent verdict.** Cryptographers assess each modified construction and parameter set, defining a common set of implementations for vendors to implement. They publish concrete security bounds and define explicit gaps which vendors must handle. Changing a standardized construction does not automatically preserve its proof and this work will fill that gap.   
    

Builder and user guides explain the signature budget: how many signatures a key can produce within a stated security bound. They also cover recovery and the strengths and limits of NIST-approved signature schemes.  

A sound construction is a useful result. Payment depends on the deliverables, including when the analysis finds no defects. Bidders may propose a different route to those outcomes.

## Who we expect to do this

Nobody is pre-selected. Bidding opens once the RFP is fully funded.

We expect an implementation team paired with an independent security practice. The bid must cover wallet engineering and cryptographers who can defend security bounds. Joint bids are welcome.

Implementation authors may bid and contribute tooling. Independent analysts must assess their constructions.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

Giveth manages conflicts and acceptance disputes, documents how disclosed employment, funding, advisory, and commercial relationships are handled, and requires recusals or a replacement independent technical reviewer where needed. Publish bid evaluation criteria before bidding opens and apply the same evidence requirements to all applicants.  

## Existing work

Bids should build on these sources:

*   **Protocol work:** [leanEthereum](https://pq.ethereum.org/) and [Hash-Based Multi-Signatures for Post-Quantum Ethereum](https://cic.iacr.org/p/2/1/13).
*   **Cryptographic baselines:** [FIPS 204](https://csrc.nist.gov/pubs/fips/204/final), [FIPS 205](https://csrc.nist.gov/pubs/fips/205/final), [RFC 8391](https://www.rfc-editor.org/rfc/rfc8391), [SPHINCS+C (ePrint 2022/778)](https://eprint.iacr.org/2022/778), [ePrint 2025/2203](https://eprint.iacr.org/2025/2203), and [A Note on SPHINCS+ Parameter Sets](https://csrc.nist.gov/csrc/media/Events/2024/fifth-pqc-standardization-conference/documents/papers/a-note-on-sphincs-plus-parameter-sets.pdf).
*   **Proof precedent:** [Machine-Checked Security for XMSS and SPHINCS+ (ePrint 2023/408)](https://eprint.iacr.org/2023/408).
*   **Testing and signer research:** [Project Wycheproof](https://github.com/C2SP/wycheproof) and [Dark Skippy](https://darkskippy.com/).
*   **Ethereum integration:** [ERC-7913](https://eips.ethereum.org/EIPS/eip-7913), [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337), and [EIP-7932](https://eips.ethereum.org/EIPS/eip-7932), plus draft [EIP-8141 frame transactions](https://eips.ethereum.org/EIPS/eip-8141).

Candidate implementations and comparison work:

*   **Quip Network:** [`hashsigs-solidity`](https://gitlab.com/quip.network/hashsigs-solidity), `hashsigs-rs`, and [`quip-solidity`](https://github.com/quipnetwork/quip-solidity). These provide testnet verifiers, a reference signer, wallet contracts, and test vectors across implementations. Quip's SHRINCS adds a stateless SPHINCS+C recovery fallback to its bounded stateful path.
*   **Riva Labs:** the [Ephemeral Keys Protocol](https://github.com/RivaLabs-Core/Ephemeral-Keys-Protocol), which uses FORS+C. Both Quip and Riva keep constant account addresses and rotate authorizing key material on every transaction. The shared address and rotation behavior gives one signer profile relevance to both designs.
*   **[poqeth (ePrint 2025/091)](https://eprint.iacr.org/2025/091.pdf):** Solidity verifiers for XMSS, SPHINCS+, and MAYO. Its hash-based verifiers are candidates for the corpus.
*   **[QRL](https://docs.theqrl.org/):** operational experience with XMSS wallets and one-time-signature state.
*   **[ZKNox](https://github.com/ZKNoxHQ/ETHFALCON)** and [EIP-8052](https://eips.ethereum.org/EIPS/eip-8052): lattice-based verifier work for comparison. It does not count toward hash-based implementation adoption.

## Scope

**In scope**

*   Signer rules for counter persistence, crashes, backup restoration, use across devices, and refusal to sign when unused-key status is uncertain for stateful constructions
*   Compatibility requirements for limited hardware signers, browser wallets, software wallets, and custody systems. Include persistent-state needs and resource limits  
    
*   Wallet integration with account abstraction and proposed frame transactions, including validation, execution, retries, and signing-state updates  
    
*   Independent analysis of target-sum Winternitz chains, FORS grinding, implicit leaf indexing, non-FIPS-205 hypertree indexing, truncated 128-bit profiles, and the generalized-XMSS encoding in leanSig, or other approaches
*   Hash-function assumptions, security bounds, and parameter recommendations with signature limits per key. Compare the covered hash functions against Ethereum's execution and proving requirements  
    
*   Verifier and signer test vectors, reproducible tooling, and a public results board
*   Signing and verification benchmarks, plus capacity analysis for stated future transaction-rate and block-time scenarios  
    
*   Builder and user guidance on signature budgets, key exhaustion, recovery, and the strengths and limits of NIST-approved signature schemes  
    
*   Integration into public testing workflows and evidence of wallet adoption

**Out of scope**

*   Designing, building, or optimizing a signature scheme or verifier
*   Private audits of a single vendor's wallet
*   Verification economics: single-parameter verifiers versus multi-parameter verification with variable gas costs.  
    
*   Consensus aggregation, zkVM proving, and leanVM development  
    
*   Formal verification of implementation code in a proof assistant  
    
*   Lattice-scheme implementation or proof research. Comparisons for wallet guidance remain in scope  
    
*   Bug bounties or exploit payments  
    

## Hard requirements  

1.  **Open and reproducible.** Publish the analysis in a public venue such as IACR ePrint using a permissive license. Release the profile, corpus, tooling, and board under an OSI-approved license. Publish vector generators and automated test runs.  
    
2.  **Checkable rules.** Give each profile rule a test vector or a written reason why testing cannot establish compliance. State the expected result and link each board entry to public evidence.
3.  **Publish all results.** Report sound constructions and unresolved gaps. Payment must not depend on finding a break.
4.  **Independent assessment.** Cryptographers who sign an assessment must not have authored the construction they assess.
5.  **Coordinated disclosure.** Report vulnerabilities in live implementations to affected teams first. Proposals must state a fixed disclosure timeline. Publish findings and test results when that period ends.
6.  **Maintenance.** Name a maintainer, repository, and maintenance plan covering at least 24 months after the final milestone.

Bids must provide a dependency schedule covering research, review, integration, disclosure, and adoption, plus a separately costed maintenance plan covering at least 24 months after the final milestone. Maintenance must fit within the $250,000 budget and cover CI, test updates, board hosting, vulnerability intake, and maintainer handover.  

## Milestones (draft)  

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.  

### A - Signer safety profile - $50,000

*   Publish a versioned signer safety profile. Cover counter persistence, power loss, crashes, backup restoration, use across devices, and uncertain key state
*   State the loss scenario for each violated rule
*   Publish a threat model separating failures the chain can detect from failures only the signer can prevent. The threat model must state whether entropy generation, transaction display,  
    malicious hosts, firmware updates, side channels, and secret deletion are covered, delegated to existing controls, or excluded.  
    
*   State-safety rules must cover concurrent signing, retries, chain reorganizations, cross-chain use, device cloning, and key exhaustion.  
    
*   Document and test recovery flows for device loss, old backup restoration, interrupted signing, and key exhaustion for each selected wallet target; justify any inapplicable scenarios. State required backups and trust assumptions, when signing must stop, and how access to funds can be restored or why it cannot.  
    
*   Publish a compatibility matrix for hardware, browser, software-wallet, and custody targets. Identify supported profiles, resource limits, and missing capabilities
*   Map signing-state updates across validation, execution, and retries for account abstraction and draft EIP-8141. State the specification versions
*   At least 2 wallet or custody vendors publish reviews of the profile, including agreement or objections

### B - Independent security proofs and analysis - $70,000

*   Each assessment must document its assumptions, analysis performed, and practical  
    consequences of unresolved claims. The existing independent technical reviewer  
    confirms completeness against the agreed targets.  
    
*   Publish an analysis covering target-sum Winternitz chains, FORS grinding, implicit leaf indexing, non-FIPS-205 hypertree indexing, truncated 128-bit profiles, and generalized-XMSS encoding in leanSig, or other approach
*   Give each construction concrete security bounds in a stated model, or an explicit gap explaining which claims remain unsupported
*   Publish a parameter-set table with hash-function assumptions and bit-security bounds. State each key's signature limit. Mark unresolved entries. Recommend only parameter sets with supported bounds
*   Compare the covered hash functions for security assumptions, Ethereum support, and execution and proving costs. Link measurements from Milestone C  
    
*   At least 2 cryptographers sign the analysis, with an authorship disclosure confirming neither authored any construction they assessed
*   Post the analysis on ethresear.ch. Invite each implementation team to respond publicly. Link any responses

### C - Break-it corpus and public board - $45,000  

Bids must specify benchmark devices, environments, transaction scenarios, and capacity assumptions, finalized in the grant agreement.

*   Define the signer test interface and run applicable signer safety and recovery tests on at least one physical hardware signer. Distinguish simulated from physical-device results and limit conformance claims to tested properties.  
    
*   Cost measurements cover the agreed constructions and parameter sets; comparing single-parameter with multi-parameter verifier economics remains out of scope.  
    
*   Report signing latency, durable state-update time, signature transport overhead, and verification cost separately; label future throughput projections as scenarios.  
    
*   Include valid-signature and boundary tests, map tests to failure classes, and  
    demonstrate detection of representative injected faults.  
    
*   Release at least 200 negative verifier vectors under an OSI-approved license. Name each vector's expected result and the mistake it catches
*   Cover cross-path domain separation collisions, grind counter malleability, target-sum bypass, authentication path length ambiguity, and parameter-set confusion
*   Publish signer vectors for one-time-key reuse and unsafe state sequences. Map them to every testable rule from Milestone A
*   Publish generators, test commands, and a results board. Include per-vector results for at least 3 independently developed hash-based implementations
*   Identify each tested version and applicable profile. Explain inapplicable vectors. Link all results to reproducible runs
*   Publish signing time, verification time, signature size, and memory use for the agreed wallet targets. Include hardware, software versions, settings, and reproduction commands
*   Compare measured capacity with stated transaction-rate and block-time scenarios. Identify bottlenecks and the assumptions behind each projection

### D - Adoption evidence - $85,000

If a participating vendor or implementation withdraws, the team may propose a replacement for approval by the existing independent technical reviewer. Replacements must meet the same applicable eligibility and milestone requirements.  

*   At least 3 independently developed hash-based implementations run the corpus in public continuous integration (CI), with links to completed runs  
    
*   At least 1 wallet, hardware signer, or custodian publishes conformance to the signer safety profile or a public gap list  
    
*   At least 1 implementation publishes a fix for a defect found by this work, linked to the finding. If analysis and testing find no defects, publish an independent review confirming that result. The review must state the tested scope
*   At least 1 implementation pins its parameter set to supported bounds from Milestone B and publicly cites the analysis. If no assessed parameter set has supported bounds, at least 1 implementation instead publishes a restriction or migration plan citing the analysis, approved by the existing independent technical reviewer. Fix this alternative acceptance path in the grant agreement before work begins.
*   Submit the profile as an ERC, or add a formal reference in an existing ERC. Link the public discussion
*   Publish builder and user guides covering signature budgets, exhaustion, recovery, and NIST-approved scheme comparisons. Link recommendations to the analysis and compatibility results
*   Publish metrics: implementations tested, vectors published, defects found and fixed, and vendors participating
*   Publish the maintainer's commitment, repository, and funding plan. Cover at least 24 months of maintenance after this milestone  
    

## Milestone review and acceptance

*   Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
*   Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
*   The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

*   The proposal window opens once the RFP is fully funded and stays open for 15 days.
*   Proposals include: team and track record, technical approach, a milestone plan with per-milestone budget (the draft above, or a stronger version), and full disclosures.
*   Giveth selects the team within 7 days of the window closing, weighing credibility, price, and strength of the proposed milestones.
*   Milestone deliveries are reviewed within 14 days; payment follows acceptance.
*   The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
*   If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

## [PENDING] Phishing Dojo — Hands-on Ethereum Security Training

- Type: Grant
- Funding goal: $90,000 USD
- Admin id: 25

### Summary

A convincing scam can turn an everyday wallet interaction into an irreversible loss. Phishing Dojo lets Ethereum users and teams rehearse those attacks safely, build defensive habits, and learn from mistakes before real funds are at risk. The Red Guild has already bootstrapped a working beta; $90,000 will keep the team building for nine months, deliver at least six free public trainings, and expand realistic simulations with measurable learning outcomes. Your support helps an existing security public good reach the people who need it and gives the team the runway to build a sustainable service.

### Full details

# Grant: Phishing Dojo Ethereum Security Training

| | |
|---|---|
| Status | Draft |
| Budget | $90,000 USD |
| Proposal window | 15 days, opening once the grant is fully funded |
| Indicative duration | 9 months; The Red Guild sets the final timeline in the grant agreement |

## Why this matters

Ethereum users, developers, treasury signers, and operations teams make security decisions through wallets, signing requests, block explorers, websites, repositories, and messaging applications. Attackers manipulate these familiar interfaces to obtain approvals, redirect transfers, steal credentials, or persuade someone to run malicious code. Knowing the warning signs does not establish whether a person can recognize and respond to an attack during the actual workflow.

The Red Guild requests a total of $90,000 USD through TheDAO Security Fund to expand Phishing Dojo, our browser-based platform for practicing these decisions safely. Learners investigate realistic scenarios, make decisions, see the consequences, and retry without connecting a real wallet or exposing production credentials. The grant supports nine months of development, measurement, and adoption, including new simulators, new and refreshed scenarios, and at least six publicly available trainings with free access for individuals and members of the Ethereum ecosystem.

Our preferred grant start is November or December 2026. Funding in that window would help preserve the existing team before our remaining runway is exhausted. The $90,000 USD total reflects the operating need described below, with the contribution split to be established through co-fundraising.

## What this actually pays for

Funding supports work that builds on an existing beta: new simulators and new or refreshed Ethereum threat scenarios, improved assignments and retakes, privacy-conscious measurement, platform reliability, and deployment support. Organizations will be able to run repeatable training exercises and evaluate completion, retries, and changes in unsafe decisions over time.

The budget preserves the small team already delivering the product. Phishing Dojo has been bootstrapped through The Red Guild's savings and the founder's personal contributions, with below-market compensation and pro bono work. This request funds the next development and adoption phase; it does not seek reimbursement for completed development.

| Budget category | Share | Amount in USD |
|---|---|---|
| Engineering and training development | 70% | $63,000 |
| Infrastructure and operations | 15% | $13,500 |
| Training experience, design, and deployment support | 10% | $9,000 |
| Security review and remediation | 5% | $4,500 |
| Total | 100% | $90,000 |

Engineering covers simulations, training workflows, instrumentation, and product reliability. Operations covers hosting, databases, monitoring, development and testing infrastructure, and model or API usage. Design and deployment support covers simulation interfaces, educational content, onboarding, and pilots. Security work covers testing and remediation affecting the platform, training environments, user isolation, and infrastructure.

The $90,000 USD also includes assessing and addressing applicable deployment prerequisites: SCORM 1.2 export, terms of service, privacy notices, and incident-response planning. We will first establish which requirements apply to the platform and intended deployments, then prioritize the relevant implementation within the existing engineering, deployment-support, and security workstreams. This work is included within the total budget.

Plausible co-funders include protocols and treasury-operating organizations whose staff approve transactions; wallets, custody providers, and exchanges whose teams handle signing and account security; and infrastructure providers and security firms whose employees face developer-targeted attacks. They benefit from having staff practice these decisions, including through the free tier. Supporting development also preserves their opportunity to adopt a maintained product later. This is a rationale for approaching these stakeholders, not a claim that any has committed funding or purchased an enterprise tier.

## The recipient

Phishing Dojo is a creation of The Red Guild, its parent organization and proposed grant recipient. Matta is the submitter on behalf of The Red Guild. The delivery team is described below. We have already researched the training model, built the application and simulated environments, developed scenarios, and gathered feedback through public demonstrations, workshops, and organizational conversations. That existing work gives us a direct implementation head start: the grant extends the product we already develop.

Matta leads product direction, threat research, scenario design, and grant execution. Manu Marquez leads software architecture and engineering, drawing on 14 years of frontend and full-stack experience. Dante Martinez contributes across the application, simulations, testing, and documentation. Agustin Diez contributes frontend architecture and AI-assisted engineering, with more than 11 years of experience. Coti leads visual direction, simulation design, and product UX, with more than 11 years of design experience.

## Existing work

The [Phishing Dojo website](https://phishingdojo.com/) is the public project entry point. The product has progressed from its initial public release in November 2024 into a substantially developed beta.

**We request an exception to the open-source code requirement.** The production codebase will remain private. We are not committing to a later source release and do not plan to open-source it in the foreseeable future. Our public-good commitment is to make the trainings publicly available through a meaningful free tier, including at least six public trainings under this grant.

The team has financed the research, threat modeling, training methodology, simulation design, and implementation that brought the product to this stage. Publishing the complete implementation before establishing a sustainable business would expose that investment to rapid replication while leaving us responsible for maintaining the service and updating its training. AI-assisted development intensifies this concern for a small, bootstrapped team. Keeping the implementation private preserves our path to financing those continuing costs through organizational subscriptions. The grant's public benefit is access to practical training and published evidence of its use; the exception concerns software ownership and distribution.

The [current visual reference folder](https://drive.google.com/drive/folders/1xna4vTGJMoZDGEyfE2ICjRTwgW_3Q7EC) shows the aesthetic on which the upcoming release builds. The [latest platform recording](https://drive.google.com/file/d/1q_n6O29yKLbWJQOBNALuOKagVnYb7OEN/view?usp=drive_link), within that folder, is the most recent recording of how the platform currently looks and works. We have been moving quickly. The release scheduled for next week improves on this particular aesthetic and training experience.

Earlier materials, including the [2025 public-beta presentation](https://www.youtube.com/watch?v=Jyh8gxl8Dt8), [earlier simulation demonstration](https://www.youtube.com/watch?v=s0jMUiknLkQ), and [The Red Guild's public work archive](https://blog.theredguild.org/archive), primarily document historical public recognition, visibility, and delivery history. They show earlier stages of the project and should be read separately from the current platform recording. Historical demonstrations do not establish current adoption or training effectiveness.

Prospective organizational users have asked us to build the platform, but have not yet used it. Their requests include terms of service, privacy notices, SOC 2 or ISO assurance, security audits of our own systems, incident-response plans, and SCORM 1.2 and xAPI export or interoperability. These conversations show both demand and the work involved in organizational adoption. They are not completed pilots, sales, certifications, or evidence of training effectiveness. Free public use gives us an adoption path while organizational procurement and assurance requirements are addressed.

Our early adoption ambition is roughly 100 to 300 external learners completing training. An ideal organizational outcome would be three organizations with approximately 50 participants each. These are planning aspirations, not guaranteed deliverables or payment thresholds. We currently have no dedicated marketing capacity, and uptake will depend on the outreach we can support alongside product delivery. We will report actual public and organizational use separately, including completions and retries, so progress is visible without overstating demand.

## Scope

**In scope**

- New simulators and new or refreshed scenarios covering malicious signatures and approvals, address poisoning, impersonation, cloned websites and applications, and developer-targeted social engineering.
- Browser-contained wallet, block explorer, website, email, and messaging environments, with documented safety and isolation assumptions.
- Assignment, due-date, notification, and retake workflows for repeatable training.
- Account and organization deletion, plus the administration controls needed to deploy training safely.
- Privacy-conscious event measurement for completions, errors, retries, and failure-to-success progression.
- Scenario-authoring workflows and documentation, plus a documented xAPI integration path for learning systems.
- Assessment and implementation of applicable SCORM 1.2 export, terms of service, privacy notices, and incident-response planning requirements within the existing workstreams and budget.
- Public user onboarding, adoption measurement, and evaluation, with organizational onboarding supported as deployment requirements are resolved.
- At least six publicly available trainings accessible through the free tier, plus maintenance documentation. Trainings may contain multiple scenarios and use reusable simulators.

**Out of scope**

- Commercial billing, sales, legal formation, enterprise legal work beyond the terms of service and privacy notices included above, and formal SOC 2 or ISO assurance programs.
- SSO, proprietary customer-specific customization, and private enterprise analytics.
- Exercises requiring real seed phrases, private keys, production wallets, or access to private infrastructure.

## Hard requirements

1. Learners can complete simulations without connecting a real wallet, installing a wallet extension, obtaining test funds, or entering real secrets. The security model and isolation test results will be documented in a public release report.
2. Individual users and members of the Ethereum ecosystem retain free access to the core training experience through the public service.
3. Grant reporting distinguishes released functionality, historical demonstrations, organizational interest, and actual external usage. Public adoption reporting uses aggregate measurements that protect learner privacy and confidential organizational relationships.
4. Training outcomes are measured through completion, retry, and unsafe-decision data. We will establish a baseline before reporting changes in behavior; we do not claim an unmeasured reduction in losses or attacks.
5. The Red Guild maintains the platform and documents the process for incorporating newly observed threat patterns into training.
6. The grant agreement explicitly records the requested source-code exception. Public access to trainings does not imply a commitment to publish the production codebase.

## Milestones (draft)

The following delivery plan covers nine months, preferably beginning in November or December 2026. We propose three payments of $30,000 USD, totaling $90,000 USD. The allocation is flexible during negotiation. The final $30,000 USD, one-third of the total, depends on demonstrated external use of the publicly available trainings. Final milestone payments and acceptance terms will be fixed in the grant agreement.

### 1 - Platform hardening and measurement - $30,000

Months 1 to 3 focus on the existing simulation framework, training workflows, and reliable measurement.

- [ ] A public release report documents the safety model and isolation test results for the browser-contained training environments.
- [ ] Release notes and a linked demonstration show assignment, due-date, notification, retake, and account-deletion workflows in the updated platform.
- [ ] A public measurement specification defines completion, error, retry, and failure-to-success events, their aggregation, and the approach to learner privacy.
- [ ] Refreshed Ethereum threat simulations are available through the training service and listed in the public release notes.

### 2 - Public trainings and interoperability - $30,000

Months 4 to 6 focus on new simulators, new and refreshed scenarios, public training access, and documented authoring and integration workflows.

- [ ] At least six public trainings are accessible through the free tier and listed in a public catalogue with their threat categories.
- [ ] Public release notes and linked demonstrations identify the new simulators and new or refreshed scenarios delivered under the grant.
- [ ] Published documentation describes scenario-authoring workflows and the xAPI integration path, with a worked integration example.

### 3 - Public adoption and evaluation - $30,000

Months 7 to 9 focus on stabilizing the release, evaluating actual use, and documenting continued maintenance. We propose acceptance based on evidence of actual external usage and the published deliverables, without a guaranteed learner or organization count. The adoption aspirations described above are not contractual minimums.

- [ ] The free public training tier is live and linked from the project website, with release notes describing the grant-funded improvements.
- [ ] A public impact report provides evidence that external learners have completed publicly available trainings, with aggregate learner, completion, and retry counts. Team testing, demonstrations, and waitlist registrations are excluded from adoption counts. Individual use qualifies without an enterprise purchase or an organizational deployment.
- [ ] The report publishes completion rates and measured changes in repeated unsafe decisions, alongside the baseline, cohort sizes, measurement period, and limitations.
- [ ] A public maintenance document names The Red Guild as maintainer and describes scenario updates, contribution workflows, and ongoing operational responsibilities.

## Milestone review and acceptance

We will publish release notes, documentation, and aggregate impact evidence so reviewers can check delivery and use. Confidential organization names and individual training results will remain out of public reports. Any independent validation involving confidential information will require an agreed disclosure process and appropriate permission.

Objective public evidence supports acceptance of released functionality and published outputs. Technical judgment calls will be reviewed by an independent technical reviewer agreed with Giveth before work begins. The reviewer will have no ties to The Red Guild, and the fee will come from the milestone payment or be provided pro bono.

## Process

The grant proposal window opens once the grant is fully funded and remains open for 15 days. During that window, The Red Guild submits the final milestone plan, per-milestone budget, requested source-code exception, and disclosures. The window also permits credible challenges from teams able to deliver the same scope for the same amount or less. Giveth reviews within seven days of the window closing and fixes the final plan in the grant agreement. We seek agreement and funding in time to begin in November or December 2026.

Milestone deliveries are reviewed within 14 days; payment follows acceptance. The first milestone can be paid up to 50% in advance so the team has funding to start. If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

The Red Guild will continue maintaining Phishing Dojo after the grant. Our planned funding model pairs free public training with paid organizational tiers for larger deployments, administration, advanced analytics, integrations, and customization. Organizational revenue is intended to finance continued development, operations, and scenario updates. Paid-only enterprise features and sales remain outside the funded scope. The shared training workflows and documented xAPI integration path described above are included. The grant provides a transition period toward this model, and organizational interest is not represented as secured revenue.

---

## [PENDING] Open EVM Compiler Differential Fuzzing Platform

- Type: Grant
- Funding goal: $75,000 USD
- Admin id: 24

### Summary

Every EVM contract is only as correct as the compiler that built it, and compilers have bugs that no amount of contract auditing will catch. This grant turns a working prototype differential fuzzer, one that has already found and filed real miscompilation and crash bugs in solx, Sonatina and Plank, into a maintained open source platform that anyone can run against any EVM compiler. Success is measured in confirmed bugs accepted by compiler maintainers and in at least one compiler team running the fuzzer in their own CI.

### Full details

## Why this matters

EVM applications depend on compilers to translate source code into executable bytecode. Optimizer passes, intermediate representations and backend code generators determine the deployed program. A compiler defect can therefore alter return values, reverts, events or persistent state even when the source program is correct. Every audit reads the source. Almost nobody checks the thing that turns that source into what runs on chain.

Multiple EVM languages, compiler implementations and compilation modes create an oracle problem: the expected behavior of a generated program is not always known. Differential fuzzing addresses this by compiling equivalent programs through multiple pipelines, executing identical probes and comparing observable results. The existing prototype has already produced concrete findings:

- **CREATE2 return-data miscompilation.** In solx, CREATE2 invalidated return data, causing optimized output to revert while the reference build succeeded. See [solx issue #555](https://github.com/NomicFoundation/solx/issues/555).
- **Signed-division compiler crash.** Sonatina's SCCP pass folded signed division into an internal negative-zero value and crashed. See [Sonatina issue #300](https://github.com/fe-lang/sonatina/issues/300).
- **SCCP runtime and worklist defects.** An alternative backend produced a runtime miscompilation and a compiler panic during worklist propagation. See [Plank issue #256](https://github.com/plankevm/plank-monorepo/issues/256) and [Plank issue #257](https://github.com/plankevm/plank-monorepo/issues/257).

Three separate compiler projects, found by one prototype, in a space that used to have one production compiler and now has half a dozen plus new languages and backends shipping every quarter. The methodology reaches optimizer and backend defects that conventional unit tests miss. This project turns that validated approach into a maintainable, extensible, publicly available platform. One line: the EVM has more compilers than it has ever had and nobody is fuzzing them, so we are paying for the fuzzer and for someone to keep pointing it at things.

## What this actually pays for

The prototype exists and it already finds bugs. So let's be honest: this is not "build a fuzzer." It buys the unglamorous work that turns a research artifact into infrastructure other people can use. Prototypes die when their author moves on, and that is what we are insuring against. The project will deliver:

- **Semantic model.** A versioned meta-language for deployments, contract interactions, transaction sequences, inputs and outputs.
- **Deterministic generation.** A generator that records everything required to reproduce each case.
- **Source renderers.** Production renderers for multiple EVM languages, with sidecars that vary implementation without changing semantics.
- **Compiler adapters.** Distinct implementations, optimization levels, intermediate representations and backend configurations.
- **Execution oracle.** A REVM-based engine that runs identical probes and compares normalized behavior across pipelines.
- **Reduction and deduplication.** Mismatches, crashes and timeouts converted into concise deterministic reproducers.
- **Corpus explorer.** A public interface for cases, rendered programs, compiler configurations and non-embargoed results.
- **Campaign and handoff.** A documented fuzzing campaign, coordinated disclosure, stable release and maintainer handoff.

The largest line item is semantics, because a differential fuzzer is only as good as the programs it can generate. Widening that slice (inheritance, composition, multi-contract deployments, stateful probe sequences, several source-level renderings of identical semantics) is where new defects come from.

The part worth flagging is campaign and disclosure work. Finding a discrepancy is maybe a third of the job. Reducing it to a minimal reproducer, working out which pipeline is wrong, writing it up so a maintainer can act on it, then following it through triage... that is slow human work, and it is the only part that produces evidence a stranger can verify.

## The recipient

Perimeter built the prototype and would receive this grant. Perimeter is a security research firm specializing in invariant, coverage-guided and differential fuzzing for EVM protocols and execution infrastructure. We combine experienced researchers with purpose-built scaffolding, libraries and testing methods for complex systems.

The head start is why this is a grant and not an RFP. A team starting from scratch would have to build the semantic meta-language, the deterministic generator, the source renderers, the compiler adapters, the REVM-based execution oracle and the reduction pipeline before finding a single bug. Perimeter has all of it running and has already filed four issues against three separate compiler projects with it. That is not a head start on paper, it is a head start with public issue numbers attached.

The track record is compiler and execution layer work, not just protocol fuzzing:

- **[Monad](https://www.monad.xyz/).** Across three engagements, Perimeter tested RPC and execution behavior, built monitoring and transaction-fuzzing infrastructure, and developed native harnesses for multi-block execution, cross-implementation differential testing and compiler type inference. The latest campaign exceeded 815 million iterations. See the [public report](https://github.com/perimetersec/resources/blob/main/reports/Monad%20Fuzzing%20Part%203%20Report%20Public.pdf).
- **[Berachain](https://www.berachain.com/).** Across eight engagements, Perimeter tested consensus, stablecoin, liquidity and reward infrastructure through stateful fuzzing. Campaigns executed billions of calls and identified critical, high, medium and low-severity defects.
- **[Origin Protocol](https://docs.originprotocol.com/).** Stateful invariant testing for production DeFi systems.
- **[Immutable](https://www.immutable.com/).** Fuzzing of bridge infrastructure and cross-domain protocol behavior.

Because the head start is real, this grant is priced below what the same platform would cost from scratch. $75,000 for nine months of specialist compiler fuzzing would not be credible for a team that had to build the oracle first. The challenge window applies as normal: if someone can credibly deliver this scope for this money or less, we want to hear it.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

## Existing work

- The prototype and its confirmed findings: [solx issue #555](https://github.com/NomicFoundation/solx/issues/555), [Sonatina issue #300](https://github.com/fe-lang/sonatina/issues/300), [Plank issue #256](https://github.com/plankevm/plank-monorepo/issues/256), [Plank issue #257](https://github.com/plankevm/plank-monorepo/issues/257).
- Perimeter's site and public portfolio: [perimetersec.io](https://perimetersec.io) and the [Perimeter portfolio](https://github.com/perimetersec/resources/blob/main/portfolio/Portfolio%20-%20Perimeter.md).
- The latest public Monad engagement, where Perimeter extended native fuzzing infrastructure for compiler and execution pipelines, performed cross-implementation differential testing and targeted compiler type inference: [Monad Fuzzing Part 3 report](https://github.com/perimetersec/resources/blob/main/reports/Monad%20Fuzzing%20Part%203%20Report%20Public.pdf).
- Prior art this builds on rather than duplicates: Solidity's own fuzzing infrastructure, existing EVM implementation differential fuzzers, and Csmith-style program generation from the C compiler world, where the methodology originates.

## Scope

**In scope**

- **Prototype readiness.** Review, document and refactor the existing prototype for public release.
- **Semantic specification.** Define the semantic subset, case format, capability model and normalized observation model.
- **Case generation.** Single-contract and multi-contract cases, deployments and stateful probe sequences.
- **Pipeline integrations.** Harden source renderers, compiler adapters and language-specific sidecars.
- **Compilation modes.** Test optimized, unoptimized, intermediate-representation and alternative backend paths where available.
- **Execution comparison.** Run generated bytecode in REVM and compare deployment outcomes, reverts, return data, logs and normalized state.
- **Result classification.** Distinguish unsupported features, compile rejections, crashes, timeouts and runtime mismatches.
- **Failure processing.** Deterministic replay, corpus persistence, deduplication, reduction and standalone reproducers.
- **Public delivery.** A corpus explorer, CI workflows, campaign metrics, documentation and release engineering.
- **Responsible disclosure.** Report confirmed defects to the relevant compiler maintainers through coordinated disclosure.

**Out of scope**

- **Formal verification.** A proof of compiler correctness.
- **Upstream remediation.** Ongoing maintenance of compiler code after report acceptance, unless separately agreed.
- **Exact gas equality.** Gas will be recorded, but valid optimization strategies may produce different costs.
- **Client differential testing.** Testing EVM clients, consensus rules or RPC behavior beyond validation of the execution harness.
- **Commercial hosting.** User accounts, billing, private projects or access controls for a hosted platform.
- **Historical support.** Indefinite coverage of old compiler releases. Milestone A will define the supported-version policy.
- **Unsupported semantics.** Comparing features outside the agreed subset without an approved pairwise or capability-aware model.

## Hard requirements

1. **Open and versioned.** Publish the code, case format, semantic specification, target matrix and documentation under an OSI approved permissive license. Version, date and attribute releases and material semantic changes.
2. **Semantics first.** Define behavior independently of any source language. Renderers may vary implementation, but must preserve case semantics or classify the case as unsupported.
3. **Target coverage.** Maintain the baseline languages and compiler pipelines released in Milestone A, then add Fe and any other suitable languages delivered in Milestone D. Record the compiler version, compilation mode and backend for every supported pipeline.
4. **Observable equivalence.** Compare deployment outcomes, probe success or reverts, return data, logs and normalized state for touched accounts. Document normalization and cover it with regression tests.
5. **Deterministic and reproducible.** Record the seed, case, renderer, sidecar, compiler version, flags, EVM revision and environment. Published reproducers must run without private infrastructure, and someone who has never met the team must be able to reproduce a published finding from the public repository alone.
6. **Actionable reduction.** Preserve each discrepancy while reducing its case to a minimal or near-minimal standalone reproducer suitable for an upstream report.
7. **Responsible disclosure.** Disclose potential vulnerabilities and consensus-relevant defects privately under a written policy. Embargoed evidence may be reviewed privately for acceptance.
8. **Capability-based acceptance.** Assess delivered functionality, reproducibility and campaign execution, not a minimum defect count. Report every confirmed unique defect.
9. **Named maintainer.** A named maintainer, a documented contribution workflow, and a public statement of who keeps CI green after this grant is spent.

## Milestones

Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

### A - Public release readiness - $15,000

- [ ] **Codebase refactor.** The prototype rewritten and reorganized to reduce maintenance risk, improve correctness and make external contributions safer, published as a tagged release under a permissive open-source license
- [ ] **Public documentation.** Setup, architecture, operation and contribution workflows, sufficient for outsiders to adopt the platform independently
- [ ] **Saturation campaign.** The system run to practical saturation, with published limits, coverage progression and improvement priorities
- [ ] **Corpus preparation.** A seed corpus built, minimized and replayed across every baseline backend
- [ ] **Public baseline.** Code, docs, corpus and reproducible local and CI workflows published, with a supported-version policy naming every baseline language, compiler and mode

### B - Performance improvements - $10,000

- [ ] **Performance baseline.** Published benchmarks for generation, compilation and execution that expose throughput constraints
- [ ] **Generator efficiency.** Throughput and memory use optimized without weakening determinism or semantic validity
- [ ] **Coverage research.** A published analysis of which code structures benefit from coverage guidance
- [ ] **Compilation strategy.** Relevant compiler paths and optimization settings compared, with the selected configurations documented
- [ ] **Measured improvement.** Repeatable before-and-after benchmarks quantifying gains and naming remaining bottlenecks

### C - Semantic improvements - $30,000

- [ ] **Behavior inventory.** A published, prioritized inventory of language-independent contract behaviors
- [ ] **Semantic specification.** The versioned case format encodes agreed behaviors, inputs, interactions, state transitions and observations
- [ ] **Behavior implementation.** Simple and complex behaviors added, broadening the defects, optimizer paths and execution states reachable
- [ ] **Renderer support.** Every baseline renderer expresses each supported behavior as valid source, preserving observable meaning
- [ ] **Rendering strategies.** High-level language sidecars that express equivalent behavior differently, to expose implementation-sensitive compiler defects
- [ ] **Implementation diversity.** Reusable modules, inheritance, composition and direct implementations generated where supported
- [ ] **Oracle integration.** New behaviors executed through the comparison pipeline, with unsupported capabilities classified explicitly
- [ ] **Semantic validation.** Regression fixtures proving every rendering strategy preserves requested behavior and normalized observations
- [ ] **Extensibility guidance.** Public docs on adding behaviors and rendering strategies without coupling the semantic model to one language

### D - Language expansion - $5,000

- [ ] **Fe renderer.** [Fe](https://github.com/fe-lang) added as a production renderer, expanding compiler coverage beyond the baseline languages
- [ ] **Additional languages.** Other suitable EVM languages evaluated, and either added or publicly documented as unsuitable with a concise technical explanation
- [ ] **Pipeline integration.** Each new renderer connected to supported compiler configurations, with every output traceable by version and flags
- [ ] **Capability handling.** Unsupported language features detected before execution, so invalid comparisons never reach the oracle
- [ ] **Contributor workflow.** Another language integration documented and demonstrated publicly

### E - Corpus management and analysis - $15,000

- [ ] **Entry inspection.** Each semantic request, generated source, compiler configuration and normalized result visible
- [ ] **Deterministic replay.** Selected entries replayable through one or more pipelines
- [ ] **Analysis controls.** Coverage and performance measured per entry, revealing valuable seeds, slow cases and unexplored behavior
- [ ] **Web-based explorer.** A public interface to browse, sort and group the corpus by behavior, language, pipeline and result
- [ ] **Cross-language comparison.** One requested behavior comparable across languages and rendering strategies

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.
- Perimeter may present compiler findings privately without requiring public disclosure before the coordinated-disclosure deadline. Embargoed evidence may be reviewed privately for acceptance.

## Process

- The proposal window opens once the grant is fully funded and stays open for 30 days. In that window, Perimeter submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

## [PENDING] xWatch: Private External Exposure Monitoring for Ethereum Projects

- Type: Grant
- Funding goal: $150,000 USD
- Admin id: 23

### Summary

xWatch will give Ethereum projects a private view of their external exposure across their people, domains, and public infrastructure. The nonprofit service will combine open-source intelligence, information supplied by participating teams, and licensed breach data to deliver weekly monitoring, alerts, and prioritized cleanup guidance. This grant funds an open-source platform and six months of development and operation, with adoption by at least 25 organizations as a paid milestone.

### Full details

# Grant: xWatch: Private External Exposure Monitoring for Ethereum Projects

| | |
|---|---|
| **Status** | Draft |
| **Budget** | $150,000 USD |
| **Proposal window** | 15 days, opening once the grant is fully funded |
| **Indicative duration** | 6 months (the recipient sets the final timeline) |

## Why this matters

code2142 identifies a gap in Ethereum projects' operational security: information about an organization, its people, and its public infrastructure is scattered across separate sources. Teams need a way to see that exposure together, identify information they should remove or secure, and learn when relevant accounts appear in breach data.

We propose funding xWatch, an opt-in nonprofit service that maps this exposure and gives verified organizations a private workspace with reports, weekly updates, and cleanup guidance. The platform will be open source, and access will be subsidized through ecosystem funding. No funding commitments have been reported: $0 is committed against the $150,000 goal.

## What this actually pays for

The six-month program funds production development after an initial prototype, licensed data integrations, verified onboarding, and operation for participating Ethereum projects. It includes a developer and part-time operations support alongside code2142's leadership, an independent security assessment and retest, infrastructure, organization-verification services, nonprofit setup and administration, and independent milestone review.

The funded release must integrate IntelX Identity Portal, including the Search API and Leaks API. The initial unpaid prototype will exclude IntelX and other paid subscriptions. The budget includes the full annual data-license purchase rather than assuming a six-month subscription. Supplier pricing, query allowances, and permission for multi-organization use will be confirmed before purchase. Budget allocations are planning estimates, not signed supplier quotes.

## The recipient

The proposed recipient is xWatch, a nonprofit to be established, led publicly by code2142. code2142 developed the concept and will lead implementation, onboarding, findings review, and maintenance, supported by the funded developer and operations role. Initial participants will be recruited through code2142's existing contacts and security-partner referrals.

code2142 plans to build a small initial prototype using free and open-source inputs and demonstrate sensitive workflows with synthetic records. This initial submission does not claim a completed xWatch-specific prototype. The basis for selecting xWatch as a named grant recipient remains subject to Giveth's review. Work completed before the funded phase will not be charged to this grant. There are no co-authors or companion initiatives identified.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

## Existing work

The proposed service will build on existing OSINT tooling rather than develop every collection method from scratch. Candidate inputs include subfinder, Have I Been Pwned, public professional profiles, job listings, and information supplied by participating organizations. These third-party tools are existing work by their respective maintainers, not completed xWatch integrations. IntelX is a required licensed input for the funded release. Public platform code will exclude provider credentials and restricted source data.

## Scope

**In scope**

- Opt-in participation by registered organizations, DAOs, and unincorporated Ethereum teams, with verification of both the project and the requester's authority.
- Mapping entities and relationships across domains, subdomains, public infrastructure, founders, employees, and regular contractors.
- Work email addresses and public professional information. Personal addresses and accounts are included only with the employee's explicit consent.
- Private exposure reports combining public information, organization-supplied records, and authorized breach-monitoring sources, including the required IntelX integration.
- Weekly monitoring updates, breach alerts, source and verification labels, priorities, and cleanup guidance. High-risk or uncertain findings receive human review; routine findings can be delivered automatically with their verification status marked.
- Recruitment and operation for at least 25 external Ethereum organizations. There is no fixed enrollment cap; capacity beyond the adoption target will depend on operating resources.

**Out of scope**

- Publishing organizational findings or assessments without the organization's explicit approval. A public OPSEC rating system is not part of this grant.
- Monitoring personal accounts without explicit employee consent.
- Performing remediation, incident response, smart contract audits, penetration testing, or exploitation for participating organizations.
- Promising exhaustive discovery, perfect identity verification, or unlimited service capacity at fixed cost.
- Charging for work already completed in the unpaid prototype.

## Hard requirements

1. **Verified access.** Every organization requires manual approval. Registered organizations undergo company verification, proof of control of an official domain, and independent confirmation of the requester's authority. DAOs and unincorporated teams use documented verification of project governance or established leadership. Findings are withheld while identity or authority remains unresolved.
2. **Private findings.** Only authorized recipients can access an organization's findings. Personal-account inclusion requires explicit employee consent. Public demonstrations use synthetic records; public service and assessment reports exclude participant findings.
3. **Open-source platform.** Newly developed platform code is published under an OSI-approved license with deployment instructions. Participant records, provider credentials, and restricted licensed data stay outside the public repository.
4. **Weekly coverage.** The funded service provides exposure mapping, private reports, weekly monitoring updates, and IntelX Search API and Leaks API integration. Findings identify their sources and verification status, with a documented human-review workflow.
5. **Independent security assessment.** The portal and organization-specific access controls undergo an independent assessment and retest. Public evidence records the scope, findings status, and remediation without exposing participant information.
6. **Verified adoption.** At least 25 external Ethereum organizations must access the portal, receive an initial report, and each receive at least four weekly monitoring updates. An independent reviewer verifies production evidence privately and publishes the aggregate count and counting method. Names are published only with explicit approval. This evidence method will be agreed with Giveth in the grant agreement.
7. **Maintenance and funding.** code2142 and xWatch maintain the service. Sponsorships, donations, and further grants are the preferred funding sources. Continued operation after month 6 depends on further funding. If external funding cannot cover costs, organizations with more than 20 founders, employees, and regular contractors receive a free month, retain their report, and pay for subsequent monitoring. The fee and funding-shortfall trigger must be published before charges begin.

## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

The indicative targets are the end of month 2 for milestone 1, month 3 for milestone 2, month 5 for milestone 3, and month 6 for milestone 4. Months run from the start of the funded phase. The $60,000 adoption payment is 40% of the total budget.

### 1 - Production portal - $35,000

- [ ] A public repository contains the production portal under an OSI-approved license, deployment instructions, and a runnable synthetic-data demonstration. Release notes distinguish funded improvements from pre-grant work.
- [ ] A public test report demonstrates manual approval, both organization-verification routes, rejection of unapproved access, and rejection of cross-organization access using synthetic records.
- [ ] A published data-handling policy specifies consent, access permissions, retention, and deletion. Public test results demonstrate the implemented access and consent controls.

### 2 - Monitoring and security review - $35,000

- [ ] A public integration report confirms production integration of IntelX Search API and Leaks API under the selected Identity Portal license, documenting permitted use and source coverage without exposing licensed records or credentials.
- [ ] A recorded synthetic-data demonstration shows domain and subdomain discovery, organizational people and relationships, source attribution, verification labels, priorities, and cleanup guidance in a private report.
- [ ] A public test report demonstrates weekly rechecks, a changed test record generating a private alert, automated delivery with verification labels, and the human-review workflow for high-risk or uncertain findings.
- [ ] A public independent assessment and retest report covers the portal and organization-access separation, documenting findings and remediation status without disclosing participant information or sensitive exploit details.

### 3 - Verified adoption - $60,000

- [ ] A public independent attestation confirms that at least 25 verified external Ethereum organizations have accessed their portals, received an initial report, and each received at least four weekly monitoring updates. Verification uses private production records. Demonstrations and internal pilots do not count.
- [ ] A public adoption page publishes the verified count, counting method, and independent attestation. Participant identities appear only with explicit approval; findings are excluded entirely.

### 4 - Continued operation and maintenance - $20,000

- [ ] A public end-of-phase report documents weekly monitoring delivered through month 6, source coverage, limitations, and release history, excluding participant identities and findings.
- [ ] A published maintenance plan names code2142 and xWatch, assigns ongoing responsibilities, and states recurring operating costs and the funding needed after month 6.
- [ ] A public access policy specifies free service when externally funded, the more-than-20-person threshold, the free month and retained report for larger organizations, the membership price for subsequent monitoring, and the funding-shortfall condition that activates charges.

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the grant is fully funded and stays open for 15 days. In that window, xWatch submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

Questions, pushback, better ideas? Post them below.

---

## [PENDING] Directory of Value

- Type: RFP
- Funding goal: $185,000 USD
- Admin id: 22

### Summary

Before a security researcher can analyze a protocol, they have to find it, and today there is no neutral way to enumerate the contracts that actually hold value. Directory of Value is a permissionless registry where anyone can identify a contract as valuable, plus an open indexing layer that exposes every entry as data a researcher or an automated agent can query in full. It records identification without imposing judgment, and no single gatekeeper decides who appears. This RFP funds the specification, implementation, audit, deployment, and adoption of that directory.

### Full details

# RFP: Directory of Value, a permissionless registry of contracts worth securing

| | |
|---|---|
| **Status** | Draft |
| **Budget** | $185,000 USD |
| **Proposal window** | 15 days, opening once the RFP is fully funded |
| **Indicative duration** | 12 months (proposers set their own timeline) |

## Why this matters

Before a security researcher can analyze a protocol, the researcher has to find it: know it is deployed, know it is live, know it actually holds or moves value. That sounds like the trivial part. It is not, and it has no good answer today.

We hit this ourselves. With funding from the [last QF security round](https://qf.giveth.io/project/tool-against-price-manipulation-attacks-in-defi-on-evm) we [modernized FlashSyn](https://github.com/quantstamp/flashsyn), an academic tool that synthesizes price-manipulation and flash-loan exploits so whitehats find them before attackers do. We made it faster, protocolized how it runs, and secured the compute to scan protocols en masse. Then we did not know what to scan. We wrote our own discovery pipeline that pattern-matched on-chain bytecode and chased contract-to-contract references... a hack for something that deserves to be a project on its own, and clearly imperfect. We fell back to ranking DeFi Llama by total value locked and scraping their adapters repo for addresses.

The same wall shows up every time the ecosystem talks about automated security at scale. The ideal is to run an advanced tool over every deployed contract; that is out of reach, because there are too many and the compute does not exist. It came up in TheDAO badgeholder security group and was agreed to be an obstacle. But the set of contracts that somebody has identified as valuable is a strict subset, and it is plausibly small enough to scan in full. Nobody can enumerate that subset today.

A neutral, machine-readable directory where anyone can identify a contract as valuable, so no researcher has to ask where to look.

## What this actually pays for

This RFP pays for Directory of Value running in production:

* Milestone 1: Research and Specification. A public specification: data model (how an entry identifies a mainnet contract), write protocol, read interface, required properties, and delivery plan. Reads matter most; one use case must work end to end: Alice, a security researcher, sends her agent to find valuable protocols in scope for her tool, with enough information to act on. Design partners validate the data model and read use cases.
* Milestone 2: Protocol Writes. Every write path from Milestone 1 implemented, covering at minimum the MVP: anyone can identify a contract as valuable.
* Milestone 3: Protocol Reads and Indexing. Everything needed to read and browse the directory, including the agent-facing interface from Milestone 1.
* Milestone 4: Audit. A security-focused initiative deserves real scrutiny: at least the protocol logic (for example, spam resistance) and write paths, by a reviewer independent of the implementers.
* Milestone 5: Code Finalization and Deployment. The implementers bring the code fully to spec, fix audit findings, and deploy to production, after which the protocol can fully survive under CROPS.
* Milestone 6: Stewardship and Adoption. Once deployed, someone has to drive adoption including evangelism, tooling integration on the write path (Foundry and Hardhat plugins), and the read path (an MCP server and agent-framework and security-tool adapters). 

The MVP bar is deliberately tiny: Alice marks a mainnet contract as valuable; when Bob queries the directory, it is on the list, enumerable in full. Proposals should go deeper and expand the project to the right scope.

## Who we expect to do this

Nobody is pre-selected. Once the RFP is fully funded there is an open bidding process, and the winner gets picked through the process below.

The skills required differ from milestone to milestone. The RFP can be answered by a team from a single organization or by teams from multiple organizations. Both are fine. The reviewers will select the proposal whose team has the highest chance of succeeding.

* **Milestones 1, 2, 3, and 5 (specification, writes, reads and indexing, finalization and deployment):** a team with protocol research and implementation experience, such as a research group, an auditing company, or another project that has shipped comparable systems. Milestones 2, 3, and 5 are ideally handled by the same group, the implementers. Milestone 1 can be delivered by a different, independent team.
* **Milestone 4 (audit):** an independent auditor, ideally not affiliated with the team that wrote the code.
* **Milestone 6 (stewardship and adoption):** can take many forms. It can be a dedicated, single-handed effort, or it can be bundled with other public-good and evangelism work for another existing project. 

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

## Existing work

The winning team is expected to reuse existing standards unless it has a good argument against it; some candidates are as follows:

- [**Ethereum Attestation Service (EAS)**](https://attest.org): a permissionless, tokenless attestation primitive with expiry, revocation, and chaining. 
- [**Open Labels Initiative (OLI)**](https://github.com/openlabelsinitiative/OLI): a permissionless, EAS-based pool of address labels co-driven by Grow the Pie. 
- [**ERC-8257**](https://eips.ethereum.org/EIPS/eip-8257) and [**ERC-8004**](https://eips.ethereum.org/EIPS/eip-8004): permissionless registries where anyone publishes a self-attested record (creator address bound at registration, metadata URI, content hash). 
- [**ERC-7484**](https://eips.ethereum.org/EIPS/eip-7484) and [**ERC-7512**](https://eips.ethereum.org/EIPS/eip-7512): security attestations consumers query before acting, and an on-chain audit representation authored by security firms themselves.
- [**ERC-7930**](https://eips.ethereum.org/EIPS/eip-7930) and [**CAIP-10**](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-10.md): canonical chain-qualified addresses, which let the directory live on one chain while unambiguously pointing at contracts on another.
- [**EIP-1820**](https://eips.ethereum.org/EIPS/eip-1820) and [**ERC-6224**](https://eips.ethereum.org/EIPS/eip-6224) show the registry-about-contracts pattern, but neither is a neutral global directory of contracts that hold value.

Existing tools do not solve this problem, though they may appear similar. [DeFi Llama](https://defillama.com) tracks the protocols its own team chooses, behind an API, with total value locked as the unit rather than "worth securing". [L2Beat](https://l2beat.com) judges whole layer-2 systems, and judgment cannot be produced accurately at this scale. [CoinGecko](https://www.coingecko.com) and [CoinMarketCap](https://coinmarketcap.com) are token directories, and tokens are a subset. [Etherscan](https://etherscan.io) and [Blockscout](https://www.blockscout.com) are applications, better as a front end than as the record. [Sourcify](https://sourcify.dev) verifies source code, which should never be a precondition for calling a contract valuable.

## Scope

**In scope**

- A public, versioned protocol specification
- A registry (on-chain preferred, otherwise infrastructure meeting the hard requirements below) where anyone identifies a contract or account on Ethereum mainnet as valuable, with a short self-declared description and a canonical chain-qualified address
- An open indexing layer exposing every entry as machine-readable data, with no gatekept API. Anyone can run the indexer
- A spam-deterrence and sustainability mechanism, including expiry, reassessment, or decay, so the directory does not rot
- An optional expandability layer letting third parties attach their own data or signed attestations without altering the neutral base
- Write-path and read-path integrations that put the directory where people already work
- A path to covering other EVM chains beyond mainnet

**Out of scope**

- Judging, scoring, ranking, or blessing contracts
- A polished human dashboard. A minimal reference reader is fine; the product is the machine-readable directory
- Curating the "correct" list of valuable contracts on anyone's behalf
- Backfilling the full history of the chain

## Hard requirements

1. **Permissionless registration.** Anyone can identify a contract as valuable without approval from any operator.
2. **Complete, neutral enumeration.** The full entry set is queryable by anyone, with no privileged API.
3. **No judgment at the base.** The directory never asserts that an entry is good or legitimate.
4. **Decentralized and always-on.** Registration and enumeration depend on no single operator, server, or key.
5. **CROPS by construction.** Censorship-resistant, open-source, and capture-resistant by design.
6. **Abuse-resistant.** A concrete, analyzed mechanism deters spam without gatekeeping who may register.
7. **Explicit freshness policy.** Every identification carries a defined validity period with a decay rule.
8. **Mainnet at the minimum.** Entries describe contracts on Ethereum mainnet and ideally other EVM chains too.
9. **Open source under an OSI-approved license.** All code, schemas, and specifications are in public repositories.
10. **Passes the walk-away test.** If every contributor stops working on the project the day after Milestone 6 is accepted, registration and enumeration keep working indefinitely with no key rotation, server upkeep, or code change required from anyone.


## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

### 1 - Research and Specification - $29,000

Deliverables:

- [ ] A public, versioned specification covering the data model, how an entry identifies a contract on Ethereum mainnet (chain-qualified addressing), the write (submission) protocol, and the read (indexing and query) interface, including the agent-driven read use case
- [ ] A definition of what can be identified as valuable. Smart contracts are the minimum. The specification must also consider delegated externally owned accounts (EIP-7702) and any other notion of a value-bearing entity in the Ethereum ecosystem, and state which are in scope and how each is addressed
- [ ] A proposed end-to-end architecture that is a superset of the MVP bar, with the host and infrastructure choice justified against the open properties (the hard requirements above)
- [ ] Within the specification, an explicit treatment of: how entries are submitted (writes); how the directory is read and queried; where the system is hosted and what serves as the data layer; AI, LLM, and agent integration; extensibility for third-party data and opinions; spam deterrence and abuse protection; security considerations; target use cases; and whether a design-partner evaluation is warranted
- [ ] An assessment of which existing standards (EAS, ERC-8257/8004, ERC-7512, ERC-7930/CAIP-10) are reused or built upon, and how each is reused or built upon
- [ ] Documented consultations with design partners on the data model and the read use cases
- [ ] The versioned specification is published publicly, addresses each topic above, and the design-partner consultations and their outcomes are documented

### 2 - Protocol Writes - $25,000

Deliverables:

- [ ] Every write path from the specification implemented. The MVP write path (anyone can identify a mainnet contract as valuable under the defined protocol, permissionlessly) is the floor, not the target: if the specification stipulates more write paths, all of them are delivered
- [ ] Demonstrably functional code, adhering to the Milestone 1 specification, ready for audit and production deployment
- [ ] The code is open-source with a passing test suite, and an independent party can submit an identification on a public deployment and see it recorded

### 3 - Protocol Reads and Indexing - $29,000

Deliverables:

- [ ] An open indexer plus the agent-facing read interface (for example, an MCP server or SDK) that exposes the full set of entries as data a researcher or an agent can enumerate and query, with no gatekept API
- [ ] Two end-to-end demonstrations: a user lists the directory and finds valuable contracts, and an agent browses the directory through the read interface, finds valuable in-scope contracts, and returns the full list
- [ ] Demonstrably functional code, adhering to the Milestone 1 specification, ready for audit and production deployment

### 4 - Audit - $30,000

Deliverables:

- [ ] An audit covering at least the protocol logic (for example, spam resistance) and the write paths, by a reviewer independent of the implementers
- [ ] A public audit report which is available, covers at least the protocol logic and write paths

### 5 - Finalization and Deployment - $10,000

Deliverables:

- [ ] Audit findings resolved and the code brought fully in line with the Milestone 1 specification
- [ ] The protocol deployed in production, able to survive under CROPS with no single point of control
- [ ] Documentation and tooling for a third party to stand up their own indexer
- [ ] Any other educational materials for users and integrators published
- [ ] Each audit finding has a documented resolution, the protocol is live at a public address or endpoint

### 6 - Stewardship and Adoption - $62,000

Deliverables:

Placeholders below (marked [N], [M], [P], [Q], and [X]) are left for the proposer to replace with a concrete, defensible number in their response.

- [ ] A documented plan for stewardship is published (with appropriate governance or handoff if necessary) for its ongoing upkeep beyond the grant
- [ ] Directory of Value is presented or discussed at [N] public Ethereum-ecosystem venues (conferences, community calls, meetups, or podcasts) during the grant period, each with public evidence (a recording, published slides, or a program listing)
- [ ] At least [M] third-party integrations shipped (for example, Foundry and Hardhat plugins, MCP server, agent-framework adapters, block explorer or other frontend integrations, wallet plugins)
- [ ] The optional expandability layer live: third parties attach their own data or attestations to an entry, without touching the neutral base
- [ ] At least [P] parties are running a publicly accessible indexer and read interface
- [ ] At least [Q] distinct contracts have been identified in the directory, verifiable by counting entries in the public entry set
- [ ] At least $[X] in aggregate TVL (or another defined value metric) is captured by contracts identified in the directory, verifiable by cross-referencing entries against public on-chain data or a TVL aggregator


## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the RFP is fully funded and stays open for 15 days.
- Proposals include: team and track record, technical approach, a milestone plan with per-milestone budget (the draft above, or a stronger version), and full disclosures.
- Giveth selects the team within 7 days of the window closing, weighing credibility, price, and strength of the proposed milestones.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

Questions, pushback, better ideas? Post them below.

---

## [PENDING] Create EIP-7730 Clear Signing descriptors for top contracts not covered

- Type: RFP
- Funding goal: $10,000 USD
- Admin id: 21

### Summary

Fund teams to author and submit new EIP-7730 Clear Signing descriptors (clearsigning.org) for top Ethereum contracts that still aren't covered in the registry, so more wallets can show users clear, human-readable transaction details instead of raw calldata.

### Full details

Clear Signing (EIP-7730, https://clearsigning.org) is the emerging Ethereum standard for showing users a human-readable summary of what they're about to sign, instead of raw calldata or a hex blob. It works by having "descriptors"  (structured JSON metadata) for a given contract or EIP-712 message type.
Descriptors are published to the open community registry at github.com/ethereum/clear-signing-erc7730-registry. Wallets and signing devices can read from this registry to clearly display transaction details, which is one of the most effective defenses against blind-signing phishing and malicious approvals.

The problem: descriptor coverage lags far behind real usage. Some of the highest-volume, highest-value contracts on Ethereum (top DEXs, lending markets, bridges, staking/restaking protocols, NFT marketplaces) still have no ERC-7730 descriptor, so users interacting with them still see opaque calldata in supporting wallets. Every uncovered top contract is a live blind-signing risk.

Scope of work for teams taking this on:
- Identify high-volume/high-TVL contracts (by tx count, unique signers, or TVL) that currently have no entry in the registry's index files
- Author the descriptor(s): calldata- and/or eip712- prefixed JSON files per contract, conforming to the v2 schema (specs/erc7730-v2.schema.json), plus the required test cases.
- Validate locally with the erc7730 Python CLI (erc7730 lint, erc7730 format) before submitting.
- Open a PR against the registry (one entity/protocol per PR, per contribution guidelines) and work with reviewers/auditors through the governance review process described at clearsigning.org.

Deliverable: a defined batch of new, merged, CI-passing descriptors for specific named top contracts that are currently uncovered (the exact list/count to be scoped with the bidding team). Success is measured by PRs merged into the registry and, ideally, confirmed rendering in at least one major wallet.

This is proposed as an RFP so any qualified team (security researchers, wallet teams, or contract teams themselves) can bid to pick a slice of the uncovered top-contract list and deliver descriptors for it.

---

## [PENDING] A Unified Platform for Web3 OpSec

- Type: Grant
- Funding goal: $250,000 USD
- Admin id: 20

### Summary

Web3 OpSec tooling is fragmented. Frameworks, trainings, scanners and breach monitoring all exist, but they live in separate places and nobody has a single view of where they stand. This grant funds one platform that pulls them together into a task list with owners and statuses, so a team can see its posture and what to fix next. Auditware is the recipient: they've already built the foundation, and this opens it up to the ecosystem as a public good and funds its development into an impactful and full-featured platform.

### Full details

A Unified Platform for Web3 OpSec

Status: Draft
Budget: $250,000 USD
Proposal window: 15 days, opening once the grant is fully funded
Indicative duration: 12 months

Why this matters
Ask a Web3 team how their OpSec posture looks and most won’t have a good answer. It's not that the knowledge is missing - the frameworks exist (W3OS, SEAL’s guides and certs, SOC2, etc.), the trainings exist, the scanners exist, breach monitoring exists. The problem is that it all lives in multiple different places, waiting for someone with the proper expertise and thoroughness to implement and measure everything. Compliance is a spreadsheet someone updates twice a year, training is a link in an onboarding doc, scanning is three vendor dashboards nobody really checks. None of it tells a founder or a security lead the one thing they actually need to know: here is your posture, and here are the next tasks to improve it.
This grant funds a single platform for managing all things OpSec: training, framework compliance, automated scanning and compromise monitoring, tools for securely performing sensitive actions, unified into one task-based tracker of your security posture, for individuals and organizations. Complete tasks, watch your posture improve, assign owners, and measure completeness.

The recipient
This is a grant, and Auditware is the recipient. Full transparency on why: Auditware has already been building exactly this platform, Sentry, using their own resources, and this grant concept has grown out of that work. Rather than fund a from-scratch duplicate of something that already exists in large part, this grant funds further developing it, hardening it, and opening it up to the whole ecosystem as a public good.
Auditware will disclose their relationships to existing OpSec tooling and firms in their proposal, and the work funded here is delivered in the open, so the community can hold it to account.
The platform's foundation — the compliance tracking, the scanning and monitoring engines, the training system — was built with Auditware's own resources. The grant pays for advancing development of tools and monitors, opening the platform up, and pushing for adoption.

Existing work
Sentry is live and under active development. It already includes:
Compliance tracking for four frameworks: W3OS, SEAL, SOC 2 and NIST CSF, with requirement-level status, evidence, comments and attestations at the organization level. W3OS and SEAL content syncs from the upstream repositories, so framework revisions flow into the product instead of going stale.
Adversary reconnaissance: an attacker's-eye view of the organization, covering domains and automatically discovered subdomains, DNS, TLS certificates, certificate-transparency logs, security headers, CORS, subdomain takeover fingerprints, look-alike phishing domains, GitHub repositories and dependency risk, compiled into a dossier with kill-chain analysis and a prioritized remediation playbook.
On-chain monitoring: multisig, governance and transaction review monitoring, with deep contract analysis of upgradeability and admin/owner keys.
Continuous compromise monitoring: checks run automatically, results feed per-domain dashboards with health ratings and history, and changes raise alerts in-app, by email and in Slack. Includes credential-breach detection with alerting, plus a weekly posture report.
Training and guidance: detailed, SOC2-compliant OpSec training with per-user progress tracking and nudges, and a knowledge base of actionable security guides.
Endpoint protection integration (FleetDM / the user-space EDR from the companion grant).

Scope
In scope
One task-based posture tracker: every framework requirement, scan finding, breach alert, and training module links to a task with an owner and a status
One-click setup, easy integration with other services and platforms for automated compliance tracking and breach monitoring, with simple team onboarding
Operationalizing existing frameworks (W3OS, SEAL Certs, DARC, SOC2 and others): requirements mapped to concrete tasks with guidance
Continuous scanning and compromise monitoring that push alerts to the team in real time as incidents happen
Interactive war rooms and incident response playbooks
Self-serve onboarding and usage, designed to be extended when working with an auditor

Out of scope
Performing OpSec audits or consulting (the platform tracks the work and automates; humans still do the audits)
Authoring new security standards — this platform adopts and operationalizes what the community already uses rather than seeking to build anything new
The endpoint agent itself. That's the companion Decentralized, Privacy-Preserving EDR grant; this platform integrates with it rather than building it.

Hard requirements
Task-based. Everything the platform knows (requirements, findings, alerts, trainings) surfaces as tasks with owners and statuses, at both the individual and organization level. Tasks are actionable, straightforward, and as automated as possible.
Framework-neutral. W3OS, SEAL, and future frameworks are all options for the users. No framework lock-in, and adding a new framework does not require rebuilding the platform.
Open. Platform code open source under an OSI-approved license and self-hostable / core platform open with a hosted offering.
Private by default. The platform holds a map of every team's security. Each team's gaps are visible only to that team. Posture ratings can be published or kept private.
Security review. A public third-party review of the platform itself, with periodic refreshes with every major release.

Milestones (draft)
These milestones are a draft, developed with Auditware. The final milestones and payments get negotiated with Auditware and fixed in the grant agreement.

A - The unified posture model - $40,000
A published posture model: how framework requirements, scan findings, breach alerts and trainings all reduce to tasks with owners and statuses, and how individual and organization posture roll up into a single report/rating
Framework mappings published for [W3OS, SEAL, and SOC 2], every requirement mapped to concrete tasks with guidance, reviewable by the framework maintainers
A published integration plan: which services and platforms feed automated compliance evidence and breach monitoring, and what each integration automates
A public roadmap for the remaining work an outside engineer can evaluate
Early access to the existing platform, with scaffolding for new features to allow teams to explore it from day one
A polished, professional website that details the project and roadmap

B - The complete platform - $130,000
The full task-based tracker live: framework requirements, scan findings, breach alerts, and training all flowing into one posture view, per user and per organization
At least [10] one-click integrations live, feeding compliance evidence and breach monitoring into the tracker automatically
Continuous scanning and compromise monitoring running for onboarded organizations, with real-time alerts that create tasks rather than emails that get ignored
War rooms and incident response playbooks live: a team can run an incident end to end in the platform, including guided flows for securely performing sensitive actions
Self-serve onboarding: a team goes from signup to a populated task list in under 30 minutes, with the hand-off points for working with an auditor documented
The code opened per Hard Requirement 3, with the public third-party security review published and its findings addressed

C - Adoption and sustainability - $80,000
Tranche 1: Adoption evidence - $50,000
At least [25] organizations actively using the platform, [10] of them confirming it publicly — a public statement from that organization or a case study they have approved, linkable by URL
At least [100] individuals through the OpSec training
At least [5] organizations publishing their posture rating publicly
Published case studies and a public metrics page: organizations onboarded, tasks completed, trainings finished, findings resolved
Tranche 2: Sustainability - $30,000
A published sustainability model (hosted offering, support, or membership — proposer's call) with real revenue or committed funding covering ongoing operation
One full framework-update cycle absorbed (e.g. a W3OS revision) proving the platform tracks living standards, not a snapshot
An adoption-feedback report covering at least [6] teams, with the resulting fixes shipped

---

## [PENDING] Fund Echidna Development Through 2027

- Type: Grant
- Funding goal: $48,000 USD
- Admin id: 19

### Summary

Fund Gustavo Grieco for six active development months of Echidna research and development during 2027 at $8,000 per month. The months may be non-consecutive so work can align with finalized EVM upgrade specifications, client implementations, and test vectors. The work follows Echidna's 2026–2027 roadmap: keep EVM execution current, improve campaign and worker architecture, strengthen symbolic verification, turn agent control into a dependable workflow and optimize execution performance. At minimum, the period should produce three tagged maintenance or minor releases, at least two substantial roadmap outcomes delivered in tagged funded releases (see **Example roadmap outcomes** below), and three technical posts.

### Full details

# Grant: Fund Echidna Development Through 2027

| | |
|---|---|
| **Status** | Draft |
| **Budget** | $48,000 USD |
| **Proposal window** | 30 days, for finalizing the plan |
| **Indicative duration** | 6 active development months during 2027 |

## Why this matters

Smart contracts can pass large unit test suites and still fail after an unexpected sequence of calls, actors, prices, timestamps, upgrades, or token behaviors. Echidna attacks that gap with stateless/stateful property-based testing. It generates transaction sequences from a contract ABI and searches for inputs that falsify user-defined properties or Solidity assertions.

Echidna already combines state-of-the-art coverage guidance, corpus mutation, source integration, automatic test minimization, Foundry reproducers, hevm cheatcodes, and optional symbolic execution. Its next challenge is reliability at the seams: EVM behavior changes, campaign and worker coordination, symbolic-execution edge cases, agent control and improved performance. Those are the areas that determine whether auditors can trust a long-running campaign and reproduce what it found.

The budget assumes $8,000 for each dedicated development month. That rate covers maintainer time, dedicated VPS capacity for large campaigns, and access to frontier LLM agents for MCP experiments. Six months therefore costs $48,000.
## What this actually pays for

This grant pays for focused maintainer time, not a rewrite and not a protocol audit. The work includes:

- EVM, Solidity, Foundry, crytic-compile, hevm, Slither, SMT solver configuration, scfuzzbench localized changes, packaging, and operating-system compatibility
- Correctness fixes, crash fixes, regressions, performance work, and better reproducers
- Continued development of the MCP integration so agents can inspect and direct live fuzzing campaigns
- Improvements to optional symbolic execution for verification, exploration, and counterexample generation
- Create or contribute to a SKILL prompt for making sure agents are fully using Echidna's capabilities. 
- Dedicated VPS and frontier-model access used for large-scale fuzzing and agent experiments
- Tagged releases, changelogs, examples, and technical posts that make the work usable outside the maintainer's machine

The six-month budget is deliberately simple: six dedicated months at $8,000 each. We expect steady public releases and technical write-ups, but acceptance is based on roadmap outcomes and public evidence. At minimum, the period should produce three tagged maintenance or minor releases, at least two substantial roadmap outcomes delivered in tagged funded releases (see **Example roadmap outcomes** below), and three technical posts.

## The recipient

The recipient is Gustavo Grieco, an Echidna maintainer, working in the public [Echidna repository](https://github.com/crytic/echidna).

A grant is justified because the recipient has the decisive head start. The work touches Echidna's Haskell engine, release process, hevm and Slither integrations, symbolic execution, Foundry compatibility, and the existing MCP preview. A new vendor would first have to learn years of implementation details and EVM edge cases before doing useful work. That would cost more than extending the existing codebase.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.
## Existing work

The [2026–2027 roadmap discussion](https://github.com/crytic/echidna/issues/1612) is the maintainer's current planning thread for the next phase of Echidna, as well for users to provide feedback and prioritization of the goals. The surrounding open issues make the pressure points concrete: campaign handling and worker interactions, work distribution, symbolic-mode memory behavior, EVM precompile support. The [Echidna releases](https://github.com/crytic/echidna/releases) show an active maintenance cadence across compatibility fixes, EVM behavior, Foundry workflows, symbolic execution, and agent integration.

The [Echidna repository](https://github.com/crytic/echidna) already provides ABI-guided property fuzzing, corpus and coverage guidance, source-aware output, automatic minimization, CI integration, optimization mode, on-chain state fetching, Foundry test generation, hevm cheatcode support, and optional symbolic execution. Recent 2.3 releases added optional symbolic verification, symbolic assistance for fuzzing, multiple SMT solvers, Foundry reproducers, and an experimental MCP interface that can report campaign state, coverage, target metadata, corpus operations, and guidance commands.

The [public fuzzing campaigns list](https://github.com/perimetersec/public-fuzzing-campaigns-list) provides adoption evidence from real testing work. Recon Invariant Testing Extension and scfuzzbench are also relevant external users or integration targets for the 2027 releases.

### Example roadmap outcomes

The following items illustrate the expected scope of substantial roadmap work.

- [Issue #1623](https://github.com/crytic/echidna/issues/1623): support the execution-layer changes selected for the relevant Ethereum fork in hevm and Echidna, including the selected opcode and execution-semantics changes, with fork-specific execution tests and Ethereum execution-spec conformance tests in hevm. **Acceptance evidence:** a public fork-specific or execution-spec conformance test plus a small public reproducer exercising at least one newly supported execution-layer behavior. The reproducer must show that the baseline release fails, is unsupported, or produces incorrect behavior, while the funded release produces the expected result.
- [Issue #1625](https://github.com/crytic/echidna/issues/1625): improve proving of difficult properties through hevm by combining fuzzing and symbolic execution more effectively, including areas such as starting symbolic exploration from fuzz-discovered states, solver scheduling and resource limits, compatibility across property, Foundry and verification modes, and stable replayable and minimizable counterexamples. **Acceptance evidence:** a public property or workflow reproducer showing a material improvement in difficult-property proving, with the exact command or configuration, symbolic mode, solver and resource limits, and observed result. Where a counterexample is produced, it must be replayable and minimizable.

Substantial roadmap items that were planned for 2026 but delayed, blocked, or not completed may also be delivered during the 2027 funded period and count as roadmap outcomes, provided the grant-funded work is performed in 2027, was not already paid for elsewhere, and is of comparable scope and importance. Any substitute roadmap item must define similarly concrete public acceptance evidence before it can count toward a milestone.

This grant covers six active development months during 2027. The months may be non-consecutive so work can align with finalized EVM upgrade specifications, client implementations, and test vectors. Each funded month is identified in the public work log. Work already completed or funded for an earlier period does not count toward these milestones.

## Scope

**In scope**

- Six active development months of Echidna research and development during 2027; the months may be non-consecutive to align with finalized EVM upgrades and related implementation work
- EVM and toolchain compatibility, including required updates in hevm, Slither, new Foundry cheatcodes, and build integration
- At least three tagged maintenance or minor releases with public changelogs and regression tests, covering roadmap reliability and compatibility work
- At least two substantial roadmap outcomes of the scope illustrated above, delivered in tagged funded releases with public reproducible evidence
- Symbolic-execution work for verification, exploration, or counterexample discovery, including memory and timeout robustness, with bounds and unsupported cases reported plainly
- Dedicated VPS and frontier-model usage for reproducible fuzzing and agent experiments
- At least three public technical posts, examples, or deep dives
- Contributions in a public SKILL prompt to explain Echidna features to agents.
- Dedicated support for users that use the tool for long and complex fuzzing campaigns or verifications, using telegram/discord/github issues.

**Out of scope**

- Rewriting Echidna in another language
- Building a general autonomous auditor or claiming that an LLM replaces a security engineer
- Writing a complete fuzzing harness or invariant suite for one protocol
- Performing an audit or formal-verification engagement for a specific protocol
- Supporting non-EVM chains except through the normal EVM-compatible stack

## Hard requirements

1. **Open source.** All grant-funded code, tests, documentation, and examples are published under AGPLv3 or another OSI-approved license compatible with the repository.
2. **Public development.** Work lands through public issues, pull requests, tagged releases, changelogs, and technical posts.
3. **Six funded months.** The grant funds six active development months during 2027. The months may be non-consecutive so work can align with finalized EVM upgrade specifications, client implementations, and test vectors. Each funded month is identified in the public work log. The recipient discloses any other funding for the same period and deliverables, and earlier work (e.g. from 2026) cannot be counted again. If an expected EVM upgrade is not finalized during the grant period, that development time is applied to other in-scope roadmap, compatibility, testing, symbolic execution, agent integration, performance, or maintenance work. No milestone depends on an Ethereum upgrade shipping on a specific date.
4. **Roadmap delivery.** The grant produces at least three tagged maintenance or minor releases, at least two substantial roadmap outcomes of the scope illustrated by the example roadmap items, and three technical posts. Each roadmap outcome is delivered in a tagged funded release with public release notes explaining the user-visible improvement and linking to a test, reproducer, benchmark, demonstration, conformance test, or documented workflow that supports it. Closing a ticket is supporting evidence, not an acceptance criterion by itself. Roadmap work originally planned for 2026 but delayed, blocked, or not completed may count if the grant-funded work is actually performed in 2027, was not already funded elsewhere, and is of comparable scope and importance. **Roadmap substitution rule:** the named roadmap items are the preferred targets. If one becomes fundamentally blocked by an upstream dependency, an unfinalized Ethereum specification, an external integration constraint, or a technical limitation that makes delivery impractical within the grant period, it may be replaced by another Echidna roadmap item of equal or greater security value and engineering scope. The substitution must be documented publicly with the reason for the change, the replacement item, and the acceptance evidence for the replacement.
5. **Current EVM support.** Relevant finalized EVM and toolchain changes during the work period are covered by public regression tests.
6. **Honest agent and verification output.** Agent controls are documented. Symbolic results state the mode, solver, bounds, timeout status, unsupported operations, and caveats. Incomplete analysis is never reported as verified.
7. **Reproducible releases.** Release artifacts are tied to public source tags, and supported installation paths are tested in CI.
8. **Post-grant maintenance.** The recipient commits to continue maintaining Echidna after the funded period, including release ownership, issue triage, security-report handling, and user support through the project's public channels. This maintenance continues even without follow-on funding, but the pace may be slower because the maintainer may need to prioritize other paid or professional work. Before final acceptance, the recipient publishes a short public note documenting this maintenance commitment and the expected support and release model after the grant ends.

## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

If a named roadmap item becomes fundamentally blocked, the recipient may substitute another roadmap item of equal or greater importance, provided the reason, replacement item, and replacement acceptance criteria are documented publicly before the substitution is counted toward a milestone.
### 1 - EVM fidelity and campaign reliability - $15,600

- [ ] Two funded development months are identified in the public work log, with links to the releases, pull requests, tests, documentation, and other public work produced during those months
- [ ] At least one tagged minor or maintenance release ships with a changelog and supported installation artifacts
- [ ] The release notes contain a plain-language summary of the EVM, toolchain, performance, or campaign-reliability improvements delivered, with public links to the tests, reproducer, benchmark, or demonstration that supports each material claim
- [ ] At least one public reproducible example demonstrates a compatibility or reliability improvement delivered under the milestone, such as a previously failing contract, workflow, campaign, or EVM behavior working with the funded release
- [ ] One technical post explains a maintenance, compatibility, performance, or reproducer improvement delivered under the milestone

### 2 - Campaign architecture, verification, and machine interface - $15,600

- [ ] By the end of the fourth funded month, at least one substantial roadmap outcome from #1623, #1625, or a documented equal-or-greater substitute is delivered in a tagged funded release and satisfies the corresponding public acceptance evidence defined in **Example roadmap outcomes**
- [ ] The release delivers improvements in at least two of these areas: campaign or worker architecture, symbolic verification, agent or MCP workflows, or execution performance. Each claimed improvement has a public test, reproducer, benchmark, demonstration, or documented workflow that a reviewer can inspect
- [ ] At least one public reproducible example demonstrates a symbolic-verification, campaign-control, or agent-guided workflow that was not practical or reliable before the funded work, including the command or configuration used and the observed result
- [ ] A second tagged minor or maintenance release ships by the end of the fourth funded month
- [ ] At least two technical posts have been published by the end of the fourth funded month

### 3 - Adoption and final handoff - $16,800

- [ ] By the end of the sixth funded month, the funded release set includes the required third tagged minor or maintenance release and at least a second substantial roadmap outcome of comparable scope, and that outcome satisfies its corresponding public acceptance evidence in **Example roadmap outcomes** or the pre-declared evidence for an approved substitute
- [ ] At least three named protocols or audit firms publicly confirm that they used a 2027 funded Echidna release in a real fuzzing or verification campaign, naming the release version and the project or campaign where it was used. At least one confirmation is visible through a new or updated entry in the public fuzzing campaigns list or an equivalent public campaign record
- [ ] At least three technical posts are published across the full grant period, including one practical example of agent-guided fuzzing or symbolic verification and one post explaining a reliability or architecture improvement
- [ ] Recon Invariant Testing Extension or scfuzzbench publicly confirms integration of a 2027 funded Echidna release, with a public integration, compatibility record, benchmark configuration, or reproducible example that names the release version
- [ ] At least one public technical post documents the use of Echidna for fuzzing and/or symbolic verification on a well-known open-source project, including the properties or harness used, the approach taken, results, limitations, the funded Echidna release version, and links needed to reproduce the work
- [ ] The same case study results in a merged upstream pull request to that project, and Echidna runs in that project's CI or another recurring automated test workflow using a 2027 funded release. The merged code and CI configuration are public
- [ ] A public, versioned SKILL prompt for Echidna exists, either created under this grant or materially improved from existing public sources. It documents how an agent should use Echidna's main capabilities, including property design, stateful fuzzing, corpus and reproducers, symbolic verification, and agent or MCP workflows, with at least one end-to-end usage example

- [ ] A public adoption metrics page lists the qualifying real campaigns, named confirmations, upstream CI integration, Recon or scfuzzbench integration, and available per-release usage metrics such as release downloads or other publicly measurable install/use signals

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the grant is fully funded and stays open for 30 days. In that window, Gustavo Grieco submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

Questions, pushback, better ideas? Post them below.

---

## [PENDING] ForensIQ: Faster Ethereum Incident Response Through Evidence Reconstruction

- Type: Grant
- Funding goal: $135,000 USD
- Admin id: 18

### Summary

ForensIQ is building an open-source module that connects off-chain incident evidence (logs, files, transaction hashes) with Ethereum activity to reconstruct attack timelines, trace fund flows, and flag transfers to attributed exchange addresses. It replaces the manual handoffs between logs, block explorers, and attribution tools with one evidence-linked workflow that produces a verified response package faster. The grant funds the missing connective layer on top of ForensIQ's existing MVP (case management, Crystal and Etherscan integrations), not a rebuild of the platform. Success is measured through pilots with protocol, exchange, and law-enforcement investigators, tracking time to a verified timeline and correctness rather than a promised percentage improvement.

### Full details

## Why this matters

During an Ethereum security incident, time is a critical resource. Responders need to establish what happened, identify the affected assets, follow the funds, and prepare the evidence needed for their next action. Every manual handoff between logs, transaction views, attribution results, and investigation notes consumes part of that response window. Funds can move again while the team is still assembling its first coherent account.

This initiative funds an open-source module that reduces the work between receiving incident evidence and producing a verified response package. It connects off-chain evidence with Ethereum activity, reconstructs the attack timeline, maps supported fund movements, and flags transfers to attributed exchange addresses. The intended users are protocol and exchange security teams, incident-response firms, and law-enforcement investigators.

**Less time assembling evidence. More time to act on it.**

## What this actually pays for

Consider an illustrative investigation: a team provides access logs, incident files, and suspicious transaction hashes. The module places relevant events on one timeline, links each finding to its source, traces supported transfers, and checks available address attribution. If funds reach an address attributed to an exchange, the investigator gets an alert and an evidence package to review for an escalation request. The team can start reviewing supported findings while the broader investigation continues.

The funded contribution is the connection between those steps: evidence normalization, traceable correlations, incremental updates, and a consistent response export. Existing blockchain intelligence supplies attribution. AI helps organize evidence and propose explanations; an investigator verifies conclusions and chooses actions. Recommendations will cover a small set of incident scenarios agreed with pilot users, rather than promise a reliable diagnosis for every attack.

Success means shorter time to a verified timeline and a usable escalation package, with correctness measured alongside speed. Pilot results will establish whether and where the module saves time; no improvement percentage is claimed in advance.

The open-source core will ingest supported logs and supplied Ethereum data, produce timelines and fund-flow views, and export evidence without a ForensIQ account. Commercial attribution is an optional enrichment using the operator's own credentials. Without it, exchange identity can remain unknown. Public fixtures allow the complete workflow to be evaluated without purchasing third-party access.

## The recipient

The proposed recipient is the ForensIQ team, backed by HackenProof. The proposer reports an existing MVP with user and role management, case creation, file uploads, AI file analysis, and integrations with Crystal and Etherscan. These components provide a head start; the grant pays for the additional investigation module and its validation, not rebuilding the SaaS foundation.

The head start combines working ingestion and analysis components with existing blockchain integrations and access to prospective pilot users through HackenProof. Reuse should let the team spend the grant on cross-source reconstruction, response exports, and field validation. Before the agreement is finalized, a baseline demonstration and reuse inventory will make those savings checkable. The module is at MVP stage; measured investigation outcomes will come from the pilots.

HackenProof's existing relationships provide a route to pilot users. The proposer identifies law-enforcement partners in Ukraine and the Netherlands as intended first testers and plans to invite Hacken and other cybersecurity partners. 

## Existing work

[Crystal](https://crystalintelligence.com/crystal-expert-for-law-enforcement/) provides blockchain investigation capabilities, including fund tracing and case organization. These are substantial existing capabilities; neither timeline visualization nor transaction tracing alone is the novelty proposed here.

The proposed advance is an independently deployable, evidence-linked workflow connecting selected incident logs to Ethereum transfers and response preparation, evaluated against investigators' existing processes. The first milestone will document feature overlap, identify components worth reusing, and fix the specific workflow improvement to be tested. 

## Scope

**In scope**

- Ethereum mainnet, native ETH movements, and ERC-20 transfers; support for relevant execution traces must be documented against the selected data provider.
- Two or three log formats chosen with pilot users during the first month, plus supporting file evidence with stable source references.
- A shared timeline with normalized timestamps, original timestamps retained, and explicit handling of unknown time zones or uncertain ordering.
- Fund-flow views linking transfers to transaction hashes and addresses, with documented tracing assumptions.
- Crystal attribution integration and Etherscan transaction-data integration, with documented access requirements.
- Incremental case updates and configurable polling alerts for supported transfers to addresses attributed to exchanges, including source, retrieval time, and uncertainty. Provider delays and polling intervals are visible.
- Evidence-linked attack hypotheses, human-reviewed containment recommendations for agreed scenarios, and an exportable investigation package. Exchange action remains at the recipient exchange's discretion.
- Standalone deployment, public documentation, reproducible test fixtures, and independent pilot evaluation.

**Out of scope**

- Other chains and L2s, cross-chain bridge tracing, and claims to resolve movement through mixers.
- A proprietary address-labeling database or redistribution of third-party data without permission.
- Universal log ingestion, autonomous remediation, automatic freeze-request submission, or guaranteed recovery.

## Hard requirements

1. **Open source and independently usable.** All code developed for the funded module is released under an OSI-approved license. The license is fixed in the agreement. No paid ForensIQ account is required, and necessary reused dependencies must permit standalone distribution.
2. **Evidence before conclusions.** Findings include source references. Observations, hypotheses, and attribution are distinguishable. Missing evidence and unresolved paths remain visible.
3. **Safe handling of case material.** Deployment documentation explains where data is processed, external-provider access, and retention settings. External AI processing requires explicit configuration. Untrusted file contents cannot trigger external actions.
4. **Reproducible acceptance.** Public fixtures, commands, expected outputs, and evaluation reports let an independent reviewer reproduce the core workflow. Sensitive investigation materials are not published.
5. **Independent adoption.** At least three external teams use the module on investigation material and publicly confirm use, or authorize a named independent reviewer to confirm use publicly with identifying details omitted. Attendance at a demo does not count.
6. **Maintenance.** ForensIQ maintains the module for at least 12 months after completion of the pilot phase, covering bug fixes, security updates, and integration compatibility. HackenProof's own budget backs this commitment. Future grants may support expansion but are not a condition of maintenance.

## Milestones 

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

The six-month plan allocates roughly four months to development and two to pilots and refinement. Pilot recruitment and data-access arrangements start in month one. The proposed cost basis is $120,000 for team work ($20,000 per month), $10,000 for infrastructure and external services, and $5,000 for independent review, all included in the milestone amounts. Team work covers backend and data integration, AI/evidence analysis, investigator-led validation, and pilot delivery. Staffing allocations will be fixed in the final plan; these figures do not imply four full-time hires. Service costs and reviewer fees must be validated before contracting. Payments are tied to acceptance, not monthly payroll.

### 1 - Evidence foundation and evaluation plan - $20,000

- [ ] A public scope document fixes the supported log formats, transfer types, provider dependencies, and known limitations.
- [ ] A baseline demonstration and public reuse inventory distinguish existing MVP functionality from grant-funded work, with an effort estimate for reused components and a comparison with relevant existing tools.
- [ ] A public repository contains a runnable evidence-ingestion pipeline, provenance records, and sanitized or synthetic fixtures.
- [ ] A public evaluation protocol defines correct event ordering, source-reference accuracy, fund-flow correctness, unsupported findings, time to a verified timeline, and time to an investigator-approved escalation package. The comparison uses equivalent inputs and predefined tasks and records external API waiting time separately.
- [ ] At least two prospective pilot teams confirm participation, with permission to publish their participation or a confirmation from an independent reviewer that recruitment is complete.

### 2 - Timeline and fund-flow reconstruction - $35,000

- [ ] A tagged release produces a timeline and fund-flow view from the selected log formats and Ethereum data.
- [ ] Public fixtures cover at least five scenarios, including an ETH transfer, an ERC-20 transfer, a contract-mediated transfer, uncertain log timing, and an unresolved route.
- [ ] A published test report compares outputs with expected results and lists every discrepancy and known limitation.
- [ ] Attribution output identifies the provider and lookup time; unavailable attribution is shown as unknown. A public fixture verifies that new transaction data updates a case and triggers the configured alert, with measured detection delay.
- [ ] An independent reviewer publishes a signed assessment against the agreed technical acceptance criteria.

### 3 - Response workflow and standalone release - $30,000

- [ ] A tagged standalone release can be installed using public instructions without a ForensIQ subscription.
- [ ] A public fixture demonstrates an exchange-attribution alert and evidence export containing transaction hashes, addresses, asset amounts, timestamps, and attribution sources.
- [ ] The release separates evidence-supported observations from AI hypotheses and includes human-reviewed response recommendations.
- [ ] A published evaluation includes misleading file instructions, missing evidence, and incorrect attribution inputs, with observed behavior and corrective actions.
- [ ] The repository publishes the license, dependency and service-cost documentation, security reporting process, and maintenance plan.

### 4 - Independent adoption and measured results - $50,000

- [ ] At least three independent external teams use the module on investigation material, including at least two using real historical or active case material. Each use has a public team confirmation or a named independent reviewer's public attestation based on private verification.
- [ ] At least five investigation exercises are completed across those teams. Public summaries identify the module version, workflow used, and whether each exercise used real or synthetic material.
- [ ] At least two teams confirm a second use on a separate case or dataset after initial onboarding, directly or through the same independent attestation process.
- [ ] A public evaluation compares time to a verified timeline and an investigator-approved escalation package with each team's documented comparison workflow. It reports case-level and median results, correctness, unsupported findings, external-service delays, sample size, and limitations. Any claimed time savings must be reproducible from the disclosed measurement method.
- [ ] A final release addresses pilot findings, with remaining issues publicly tracked and the 12-month maintenance period dated.

Public confirmations disclose no sensitive evidence. Participation and publication arrangements must be agreed with pilot teams. Private cases can use the independent attestation route; other qualified teams can also satisfy the criteria. The independent reviewer must be able to verify that the three teams are distinct and external to the recipient. The final milestone accounts for approximately 37% of the budget.

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.

## Process

- The proposal window opens once the grant is fully funded and stays open for 30 days. In that window, ForensIQ submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

## [PENDING] thatsRekt: EVM exploit alerts for the public good.

- Type: Grant
- Funding goal: $40,000 USD
- Admin id: 17

### Summary

## Short summary

thatsRekt aggregates and reads trusted security accounts on X, uses AI to work out which posts are actually about a live exploit, and turns the good ones into structured, on-chain alerts that anyone can read for free. 

This grant pays for a better AI/ML detection pipeline, build an open API and automated X posting so the feed actually reaches third party integrators and other tools, plus two more guardian teams running their own detectors so the network isn't dependent on one team.

### Full details

# Grant: thatsRekt Public Exploit Alert Network for EVM.


## Why this matters

When Kelp DAO's rsETH bridge got hit, **@officer_secret** flagged it on X 1 hour 15 minutes after the on-chain event. **@peckshield** had it under 2 hours. **@certikAlert** passed 2 hours. **Hypernative**, one of the expensive proprietary detection platforms teams pay real money for, was later than all three.

The fastest, most reliable signal wasn't a machine learning model running in a vendor's black box. It was people and algorithms watching on-chain activity in real time and posting straight to X the moment something looks wrong, in public, for free. That combination, human and automated eyes reading the chain and posting openly, turns out to be the quickest and most reliable source of true positives there is.

Hypernative and Blockaid are complex, private, and expensive, and even with all that machine learning they still throw a lot of false positives, without ever publishing what that rate actually is. Meanwhile the fastest real signal is already public and free, it is just scattered across dozens of X accounts with no structure, no on-chain record, and no transparency about accuracy.

**thatsRekt exists to close that gap:** it watches the trusted accounts, uses AI to decide whether a post is really about an exploit worth warning people about, and turns that into a structured, public, on-chain alert with its own accuracy tracked in the open.

It is named after rekt.news on purpose, we like them a lot, but rekt.news writes the obituary after the fact. thatsRekt is trying to catch the exploit while it is still happening.

> thatsRekt is an exploit detection aggregator that reads trusted X accounts and uses AI to decide whether they're describing a hack the public should be warned about, and it publishes its own accuracy instead of hiding it.

## What this actually pays for

thatsRekt already runs. The contracts are live at the same address across six EVM chains, the indexers and GraphQL gateway and frontend are built, and the team has been covering the roughly $1,500 to $2,000 a year it costs to keep it running out of their own pocket, with all spending reported publicly.

**This grant does not fund a rebuild.** It funds three things the current budget doesn't stretch to:

- **A published, decentralized detection pipeline.** Turning the AI classification step from something the core team eyeballs on its own into a published, versioned scoring methodology and reference pipeline that any guardian can run as part of their own detection stack, plus a tracked and published false-positive rate. Posting stays fully decentralized: any whitelisted guardian runs their own detection logic and posts directly on-chain themselves, nobody drafts an alert for someone else to confirm.
- **A feed that's actually reachable.** An open, documented API that any third party, including existing detection platforms like Hypernative or Blockaid, can pull structured incident data from, automated posting of confirmed alerts to thatsRekt's own X account so the signal reaches people where they already are, and a stable per-incident ID scheme so a developing story updates in place instead of duplicating or overwriting a prior post.
- **Two more guardians.** Onboarding two more guardian teams running their own detectors, which roughly doubles the network's current annual operating cost, from about $1,500-$2,000/year to about $3,000-$4,000/year, but means the feed no longer depends on one team's uptime and judgment.

We'll say the honest part plainly: right now about 200 people are subscribed to the [Telegram alert channel](https://t.me/thatsrekt_alerts), and nobody is executing anything on-chain off the back of an alert yet, and guardians aren't really using the up/down-vote true-positive flagging either.

This grant is what gets thatsRekt from "a good idea that runs on one team's spare change" to a small, transparent, multi-team network. **Without funding, the team has timelined a shutdown within the next year.**

## The recipient

This grant goes to the **thatsRekt core team (thatsRekt.eth)**, the people who designed and have been running the project since launch (@JerryTheKid, @BautiDeFi & @ohdatskate).

The head start here is not hypothetical: they have live contracts deployed at an identical address on Ethereum, Arbitrum, Optimism, Polygon, Base and BNB Smart Chain, a working indexer and GraphQL gateway, a frontend, a guardian governance model already enforcing a 3-day delay to add a new poster and instant removal of a bad one, and a public track record of reporting every dollar they've spent.

Nobody else has this running, and paying an unrelated team to rebuild it from scratch would cost more and take longer than funding the team that already operates it and has been reading real incidents like Kelp DAO's since before this grant existed. That head start is exactly why this budget is smaller than a from-scratch build would cost.

*Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.*

## Existing work

- **Live product & docs:** [thatsrekt.com](https://thatsrekt.com) and [thatsrekt.com/docs](https://thatsrekt.com/docs)
- **Code:** open source, MIT licensed, at [github.com/ThatsRekt/thatsRekt](https://github.com/ThatsRekt/thatsRekt) (indexers, GraphQL gateway, frontend, relay service)
- **Live alerts:** [Telegram channel](https://t.me/thatsrekt_alerts), roughly 200 subscribers
- **X:** [@ThatsRekt_](https://x.com/ThatsRekt_)

## Scope

**In scope**
- **Detection methodology.** Building out and formalizing the AI/ML scoring methodology that reads a vetted list of security-focused X accounts and scores whether a post is likely describing a real exploit, published so any whitelisted guardian can run it as part of their own detection stack and post directly on-chain themselves
- **Accuracy, published.** Tracking and publishing the classifier's false-positive rate, on the frontend and on-chain, on an ongoing basis
- **Open API.** An open, documented API for the alert feed, so any third party, including existing detection platforms like Hypernative or Blockaid, can pull structured incident data
- **Automated X posting.** Automated posting of confirmed alerts to thatsRekt's own X account, with each alert keyed to a stable, unique incident ID so an update never overwrites or duplicates a prior post
- **Broader coverage.** Broadening EVM chain and detector coverage and tuning the classifier to catch more real incidents and lower the false-positive rate over time
- **More guardians.** Onboarding at least two additional guardian teams running their own detectors, so posting isn't dependent on a single team
- **Their opex.** Funding the added annual opex those two guardians bring (relayer gas, AI inference, hosting), roughly $1,500-$2,000/year, for the grant period, on top of what the core team already covers

**Out of scope**
- **Auditing.** Becoming a general OPSEC or code-audit firm. thatsRekt aggregates and verifies public signals about active exploits, it does not audit contracts.
- **Monetizing.** Any token, fee, or paid tier. thatsRekt stays free and public good, same as it is today.
- **Executing on anyone's behalf.** Building a dedicated wallet plugin, or executing any transaction on anyone's behalf. thatsRekt publishes the data through its own posts and an open API; what a wallet, agent, or detection service does with it, including whether they integrate it, is on them.
- **A perfect classifier.** Achieving zero false positives. thatsRekt won't hit 0%, no detection system does. What it commits to instead, and what the private systems don't do, is publishing that rate openly, on the frontend and on-chain, so anyone can check the track record.

## Hard requirements

1. **Open source.** Stays fully open source under an OSI license (MIT today).
2. **On-chain verifiability.** Every alert and every guardian action (add, remove, vote) is verifiable on-chain by a stranger. No private, off-chain judgment calls that can't be audited after the fact.
3. **Published methodology.** A published, versioned methodology for how the classifier scores an X post as exploit-related, so guardians know what "true positive" means and can dispute a call with their vote.
4. **Published accuracy.** The false-positive rate is published on the frontend and on-chain, updated on a fixed cadence, not just claimed in a report.
5. **Stable incident IDs.** Every alert is addressable by a stable, unique incident ID. An update to a developing story never overwrites or duplicates a prior post.
6. **A life after the grant.** A public funding and maintenance plan that extends past this grant. This grant should not be the only thing keeping the network alive after month 12.
7. **No false certainty.** No claim, express or implied, that a flagged address is definitively malicious. Alerts are advisory signals for others to act on, not final judgments.

## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

### 1 - Detection engine and open feed - $18,000
- [ ] **Methodology published.** Published, versioned scoring methodology for how X posts get classified as likely-exploit vs noise, live in the repo
- [ ] **Classifier in production.** AI/ML scoring methodology live and published, with at least one guardian running it in production as part of their own detection stack, rather than relying on manual monitoring
- [ ] **Accuracy tracked.** False-positive rate tracked and published on the frontend and on-chain, on a fixed, ongoing cadence
- [ ] **API live.** Open, documented API live, with every alert keyed to a stable per-incident ID so an update never overwrites or duplicates a prior post
- [ ] **Auto-posting live.** Automated posting of confirmed alerts to thatsRekt's own X account live

### 2 - Two more guardians live - $10,000
- [ ] **Guardians onboarded.** At least 2 additional guardian teams onboarded, running their own detectors, and actively posting
- [ ] **Opex funded.** Their added annual opex (relayer gas, AI inference, hosting), roughly $1,500-$2,000/year on top of what the core team already covers, funded for the grant period and reported alongside the team's existing public expense reporting
- [ ] **History public.** Public page showing guardian add/remove history and the up/down-vote outcome for every alert posted

### 3 - Proven adoption - $17,000
- [ ] **A real integration.** At least one existing detection platform (Hypernative, Blockaid, or a comparable service) demonstrably consuming or cross-referencing thatsRekt's feed through the open API, verifiable publicly
- [ ] **Real reach.** Published, real engagement numbers for thatsRekt's own alert posts on X (impressions, reach, or reposts by known security accounts), showing alerts are actually reaching people, not just being posted
- [ ] **A real network.** At least 4 guardian teams total (current plus the 2 new ones plus at least 1 more) actively posting and voting over a sustained 3-month window
- [ ] **A track record.** A full quarter of published false-positive rate data, with the number and the methodology both public
- [ ] **A funded year 2.** 12 months of opex funded and publicly reported per thatsRekt's existing practice, with a year-2 funding plan published

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the grant is fully funded and stays open for 30 days. In that window, the thatsRekt core team submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

## [PENDING] Closing the Incentive Circle on Defi Protocol Quality.

- Type: RFP
- Funding goal: $40,000 USD
- Admin id: 16

### Summary

The customers for any DeFi quality initiative are the liquidity providers.  The purpose of this project is to bring the liquidity providers actively into the conversation because they are the people with power.  

A DeFi protocol will actively do the expensive tedious work of good OpSec and good process quality when it brings them money.  If a liquidity provider requires a certain quality label (eg Seal Cert) before they will deposit any funds into the protocol then we have closed the incentive loop.

In TradFi it is common to require a company be ISO 27001 certified before contracting with them.  The goal is to get something similar working for DeFi.

### Full details

What exactly gets built?  The output will be a marketing report.  It will contain the following sections.
    • What the customer wants and how they expect to ask for it.  Detailed description of the customers willing to require a quality certification and those that will not.
    • How we market the certification (eg: Seal Certs website).  What they expect to see
    • How to we find our customers and complete sales.  In other words how do we find new stable coin users who will  use DeFi and get them to require a DeFi quality certification on DeFi protocols before they deposit money to them.
    • What role do these customers see for themselves in updates on the DeFi quality certification updates.

Why does Ethereum security need it?  If successful, this initiative will significantly increase security of DeFI protocols on the Ethereum ecosystem blockchain.  This is because it will incentivize protocols to perform the best OpSec practices and maintain them because it is a requirement to get TVL on their protocol.    The biggest problem with OpSec today is that protocols don't bother doing the work.  This will solve that problem.

---

## [APPROVED] Securing Ethereum with Formal Verification

- Type: Grant
- Funding goal: $300,000 USD
- Admin id: 9, public page: https://fund.thedao.fund/initiative/securing-ethereum-with-formal-verification

### Summary

AI is making it faster to attack software, giving attackers a meaningful edge.

Formal verification is widely considered the strongest security guarantee in software correctness. 

This grant aims to increase formal verification adoption across the Ethereum ecosystem with TVL secured as its main success metric.

### Full details

## Why this matters

AI is making it faster to attack software, giving attackers a meaningful edge. The answer is to put AI on the defending side too: AI that writes machine-checked proofs that a contract's stated properties hold, with humans only checking the theorems. Formal verification is widely considered the strongest guarantee of software correctness, and it is the one place where AI output can be checked mechanically rather than trusted.

This grant creates an open-source framework for Solidity verification (Verity, built on Lean 4, with an AI proof-writing skill) and increases formal verification adoption across the Ethereum ecosystem. Success is measured by the TVL covered by formally verified properties.

The Ethereum Foundation has already pledged $100,000 USD of the $300,000 USD budget for the Verity product foundation. The remaining $200,000 USD finishes the product and pays for adoption, so every dollar donated here builds on money already committed.

| **Status** | Draft |
| --- | --- |
| **Budget** | $300,000 USD |
| **Proposal window** | 15 days, for finalizing the plan |
| **Indicative duration** | 12 months (Verity Labs sets the final timeline) |

## What this actually pays for

This is not a program to select public contracts and publish formal verifications of them. It pays for two connected things:

- **Product work:** continue the open-source Verity tooling, benchmark, documentation, developer onboarding, AI proof-writing skill, and deterministic Solidity-to-Verity transpilation work already defined in the Ethereum Foundation funded grant.
- **Adoption work:** make Verity usable by protocol teams in-house and formal audit firms in their own work. Success is led by the value covered by the verified properties.

The total program budget is $300,000 USD. It combines the $100,000 USD Ethereum Foundation pledge for the Verity product foundation with $200,000 USD raised through TheDAO Security Fund's Second Round.

## The recipient

The recipient is Verity Labs. This is a grant rather than an RFP because its team has spent the past few months doing unbounded formal-verification work with leading Ethereum protocols. Its public work covers 40+ protocols, among them popular names like Lido, Morpho, and Safe (see Existing work below).

This experience shows where real protocols need unbounded proofs, where modeling gaps block use, and what needs to become repeatable for developers and audit firms. The Ethereum Foundation has already funded part of Verity's product roadmap and everything is public.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

## Existing work

- Verity Labs: https://veritylabs.dev and the Verity product page https://veritylabs.dev/projects/verity
- Verity compiler, MIT licensed: https://github.com/lfglabs-dev/verity
- verity-benchmark, the AI proof-generation benchmark built with the Ethereum Foundation and ecosystem protocols: https://github.com/lfglabs-dev/verity-benchmark
- Technical docs, including the Solidity-to-Verity porting guide: https://veritylang.com
- Public verification case studies (Lido V3 vault solvency, Safe owner list invariants, Morpho, Balancer, 1inch, Pendle and others): https://veritylabs.dev/research
- Paper, "A Formally Verified Smart Contract Compiler in Lean 4", accepted at ETHReS 2026: https://veritylabs.dev/research/verity

## Scope

**In scope**

- Product work on Verity's compiler, Solidity coverage, reusable proof infrastructure, benchmark, documentation, developer onboarding, AI proof-writing skill, and a deterministic Solidity-to-Verity transpiler that reduces modeling gaps.
- Public releases that document supported workflows, trust assumptions, version pins, known limitations, and how teams and formal audit firms can use the tooling.
- Adoption through protocol teams using Verity in-house and formal audit firms using it in their own work.
- Measuring adoption primarily through the TVL of contracts whose stated properties are formally verified.

**Out of scope**

- Verifying the Solidity compiler itself.
- A proprietary product, hosted-only workflow, or exclusive access for a single provider.
- Counting users or github stars as the main measure of adoption. We consider real impact in TVL.

## Hard requirements

1. **Open to everyone.** Verity product code, benchmark artifacts, documentation, and CI are public under an OSI-approved license. No proprietary runtime, hosted service, account, or paid provider is needed to use the tooling or reproduce a proof.
2. **Reproducible.** A stranger can reproduce each headline product claim from a clean checkout, documented command, public CI, and version pins, without admitted proof gaps.
3. **TVL-led adoption.** Adoption evidence names the participating protocol team or formal audit firm, provides public confirmation of use, and gives the public TVL source and snapshot date for each value included in the aggregate.
4. **Clear scope on verified TVL.** Each reported verification states the code revision, properties proved, trust assumptions, and known limits in plain language.

## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with verity and fixed in the grant agreement. 

### 1 - Building the Verity product - $150,000

The product budget combines the $100,000 USD Ethereum Foundation pledge for the existing Verity roadmap with $50,000 USD from TheDAO Security Fund.

- [ ]  A public, versioned Verity release records the delivered compiler stabilization and bug fixes, Solidity feature coverage, reusable EVM proof infrastructure, and exact source revisions.
- [ ]  A deterministic Solidity-to-Verity transpiler is public. For its supported Solidity subset, it produces reproducible Verity output without an LLM in the translation path, documents unsupported patterns, and has public regression tests.
- [ ]  A public verity-benchmark release contains fixed implementations, formal specifications, editable Lean proof files, and target theorems, with checks that reject incomplete or admitted proofs.
- [ ]  Public developer material covers beginner onboarding, supported workflows, trust assumptions, version pins, known limitations, an AI proof-writing skill, and use by in-house teams and formal audit firms.
- [ ]  Public compiler and benchmark research materials are published, and developer onboarding includes a workshop or talk at EthCC, Devcon, or a similar venue.
- [ ]  A public maintenance plan names the maintainer, release process, and post-grant sustainability path.

### 2 - $1B TVL covered by Verity-verified properties - $50,000

This milestone uses $50,000 USD from TheDAO Security Fund.

- [ ]  At least $1 billion in TVL total (from at least 3 different protocols) is counted on a stated public snapshot date across contracts whose selected properties are formally verified with Verity, whether protocol teams use it in-house or formal audit firms use it in their own work.
- [ ]  The protocol team or formal audit firm publicly confirms its use of Verity for the stated contract revision and properties.
- [ ]  A public metrics page lists the counted systems, snapshot dates, TVL sources, aggregate covered TVL, and the limits of the measurement.

### 3 - $5B TVL covered by Verity-verified properties - $100,000

This is the final milestone and uses $100,000 USD from TheDAO Security Fund.

- [ ]  At least $5 billion in TVL (from at least 10 different protocols) is counted on a public snapshot date across contracts formally verified with Verity, whether used in-house by protocol teams or by formal audit firms.

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the grant is fully funded and stays open for 30 days. In that window, Verity Labs submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

Questions, pushback, better ideas? Post them below or talk to us on telegram https://t.me/+PHZekKhdjPAxOWU0

---

## [APPROVED] Community Fuzzing Tooling for Ethereum Ecosystem Projects

- Type: RFP
- Funding goal: $150,000 USD
- Admin id: 7, public page: https://fund.thedao.fund/initiative/community-fuzzing-tooling-for-ethereum-ecosystem-projects

### Summary

The Ethereum ecosystem is lacking a solution for scalable, continuous, and compute-intensive fuzzing campaigns for projects. For each project to subscribe to their own solution would be costly and could have diminishing returns over time to make it a worthwhile investment of time, money, and human capital. We are requesting proposals from applicants who have developed or can develop tools to orchestrate fuzzing at scale, assign compute resources efficiently, and flex these resources up and down in an agile manner so that any team can orchestrate their own fuzzing campaign for themselves. A self-serve model. This RFP would fund the construction and maintenance of such a tool.

### Full details

## Why Fuzzing?

Security review has shifted a great deal of effort onto LLM-assisted tooling over the last eighteen months. That shift has been productive and remains accessible to teams through frontier models and private tools, but it is also incomplete. They are weakest precisely where fuzzing is strongest, particularly on regression detection and avoidance as developers ship new or harden existing code.

## Current State

Many teams know the above, but very few run fuzzing continuously. The reasons are mostly operational:

- Compute: Meaningful fuzzing is measured in sustained core hours. Most teams cannot justify that as a standing line item for a single codebase, so it never gets budgeted.
- Time: Someone has to write harnesses that generate inputs structured enough to reach deep code rather than bouncing off input validation.
- Software: Teams that do try usually run a fuzzer in GitHub Actions or a similarly time-boxed CI runner, yielding a few minutes of fuzzing per commit. That is only enough to replay an existing corpus and generate suitable code coverage.

## What makes a strong applicant?

The strongest bidder is a team that has run continuous fuzzing at scale before, over months rather than for the duration of an audit, and can show the following evidence: campaigns sustained, coverage figures, bugs found and disclosed. Proposals should be explicit about:

- Coverage of languages and frameworks
- Compute: State the sustained core hours you can field and where they come from
- User Experience: How does the user access the tool? Is it via service request only? A CLI? A dedicated User Interface? Briefly describe the user flow as it will exist should the grant be awarded.

The proposal will likely be best served by a single grant recipient, but the RFP can certainly be considered for multiple participants if that best serves the needs of the ecosystem.

## Scope

### In scope

- A documented CLI or front-end UI
- Running continuous fuzzing campaigns across multiple tenants in a secure manner
- Ability to allocate compute across multiple projects and scale it up and down efficiently and on demand
- Capability to hand off harnesses, corpora, and knowledge to users
- Documentation so teams can maximally self-serve

### Out of scope

- Manual audits and code review. This program funds fuzzing infrastructure.
- Authorship of harnesses and tests
- Publishing exploit detail or proof-of-concept code for anything still unpatched
- A guaranteed bug count. Fuzzing finds what it finds; the commitment is to compute and process.
- Triage of findings
- Incident response
- Any other professional services

## Hard requirements

1. Aggregated results measured and published: Aggregate and abstracted statistics for coverage, findings, etc., updated at least quarterly on a public page. Bug counts alone are not an acceptable measure of a fuzzing program.
2. Siloed User Experience: Users may only see their own findings for security purposes. This must be available to be considered for the grant.
3. No user lock-in: Harnesses must build and run on standard open source fuzzing tooling. Every project keeps its harnesses, corpus, and documentation under an open license at no further cost, and must be able to keep running them without paying the grantee anything.

## Milestones (draft)

These milestones are a draft. Final milestones and payments are negotiated with the winning team and fixed in the grant agreement. If you think this can be improved, say so in your proposal. Amounts below are shown as a share of the awarded budget, with an indicative figure at a $150,000 award.

**A - Program stood up - 50% (indicatively $75,000)**
- Specs and timeline provided for tool to go live
- Intake form for grantor and grantee to gauge interest and sequencing is live
- Ability for first project/users to potentially onboard

**B - Ecosystem Adoption - 50% (indicatively $75,000)**
- Onboarding flows are available and open
- 7+ projects have self-onboarded and begun a campaign
- Publication of first aggregated and anonymized report to show baseline statistics for future QoQ reference

## Milestone review and acceptance

- Criteria with objective public evidence, such as a live coverage page, a published report, etc., are accepted on sight
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected vendor, agreed between TheDAO Security Fund and the vendor before work begins, and named in the grant agreement
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning vendor coordinates their payment

## Process

- The proposal window opens once the RFP is fully funded and stays open for 14 days
- Proposals include: team and track record with evidence of prior continuous fuzzing work, technical approach, language coverage, compute plan, a milestone plan with per-milestone budget, and full disclosures
- TheDAO Security Fund selects the vendor within 10 days of the window closing, weighing credibility, price, and strength of the proposed milestones
- Milestone deliveries are reviewed within 14 days; payment follows acceptance
- The first milestone can be paid up to 50% in advance so the vendor has funding to start
- If a milestone stalls, the vendor gets a 21-day deadline to complete it. If they miss it, unused funds become claimable by the donors who backed the RFP for 30 days; unclaimed funds go to TheDAO Security Fund for other initiatives

---

## [APPROVED] Decentralized, Privacy-Preserving EDR

- Type: Grant
- Funding goal: $300,000 USD
- Admin id: 6, public page: https://fund.thedao.fund/initiative/privacy-preserving-edr

### Summary

Endpoint Detection and Response is one of the highest-value security controls a team can run, and almost nobody in crypto runs it, because mainstream EDR sits in your kernel and streams telemetry to a central vendor. This grant funds an EDR crypto teams will actually adopt, user-space, self-hostable, privacy-preserving by construction, tuned for Web3 threats. Auditware is the recipient.

### Full details

| | |
|---|---|
| **Status** | Draft |
| **Budget** | $300,000 USD |
| **Proposal window** | 15 days, opening once the grant is fully funded |
| **Indicative duration** | 12 months (the team sets the final timeline) |

## Why this matters

Endpoint Detection and Response is one of the highest-value security controls a team can run, and almost nobody in crypto runs it. Why? Mainstream EDR (CrowdStrike, SentinelOne) sits in your operating system kernel and streams your telemetry to a central vendor. Users worry about the privacy of their data and device usage. Even security engineers refuse to install that on their own machines, and honestly, who can blame them? The result is a blind spot on the exact laptops that hold keys and approve transactions.

This grant funds an EDR that crypto teams will actually adopt: user-space, self-hostable, privacy-preserving by construction, tuned for Web3 threats, and endorsed as safe to roll out across a team.

## The recipient

This is a grant, and Auditware is the recipient. Full transparency on why: the concept was developed with them, they already built an internal user-space EDR prototype on open-source tooling in a few weeks, and they have committed to taking this on. We think they are the right team for it.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

## Existing work

- Auditware's internal user-space EDR prototype, built on open-source endpoint tooling in a few weeks
- Mature open-source endpoint instrumentation (osquery and similar) to build on

## Scope

**In scope**

- A user-space endpoint agent: self-hostable, no kernel privileges, no mandatory central vendor
- Telemetry encrypted so nobody can inspect it unless the data provably matches a detection rule
- A tamper-evident audit trail of detections and responses
- Web3-specific detectors: in-browser wallet invocation, outgoing crypto transactions, malicious dependency signatures, and more
- Configurable and extensible detectors: teams can easily implement and add private custom detectors for their team, or contribute to the open-source set
- An endorsement path, with an Ethereum security body confirming the agent is safe to install

**Out of scope**

- Kernel-level instrumentation. It gives deeper assurance, and it also needs OS-vendor approval and puts attack surface inside the user's kernel. Fine as future work.
- Replacing enterprise EDR in regulated environments. This is for crypto teams who run nothing today.

## Hard requirements

1. **Open source.** Agent, detectors and server components under an OSI-approved license, with no closed-source dependency for core function.
2. **Self-hostable.** A team can run the full stack without handing plaintext telemetry to anyone.
3. **Privacy by construction.** A documented cryptographic guarantee that raw telemetry stays unreadable unless a rule match is proven, plus the process for what gets revealed after a match.
4. **Security review.** A public third-party review of the agent itself. Installing it grants deep access, so the agent has to earn that trust.
5. **Reproducible install** that a non-expert can run.

## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

### A - Architecture, threat model, and privacy design - $40,000

- [ ] A published threat model: the endpoint attacks in scope and the residual risks left out
- [ ] The documented user-space architecture and cryptographic privacy design, with the guarantee stated precisely
- [ ] The detection-rule specification and the format new detectors are written in
- [ ] A public design write-up an outside engineer can evaluate the trust model from

### B - Working MVP - $110,000

- [ ] A self-hostable user-space agent on macOS, Windows, and Linux, installable from a documented, reproducible process
- [ ] The encrypted telemetry pipeline implementing the Milestone A privacy guarantee, with its tamper-evident audit trail
- [ ] The initial Web3 detectors, each with a test showing it fires on the intended behavior and stays quiet otherwise
- [ ] All code open source, with the public third-party security review published and its findings addressed

### C - Adoption, hardening, and endorsement - $150,000

**Tranche 1: Launch and endorsement - $50,000**

- [ ] The detector library expanded to at least 25 Web3 detectors, each with a firing test
- [ ] A recognized Ethereum security organization, or a named panel of recognized security engineers, publicly reviews the agent and states it is safe to install across a team
- [ ] A public website, install guide, and a recorded walkthrough a non-expert admin can follow

**Tranche 2: Adoption evidence - $100,000**

- [ ] At least 15 crypto organizations running the agent in production, confirmed publicly by those teams
- [ ] A published adoption-feedback report covering at least 10 evaluations, with the resulting fixes and detectors shipped
- [ ] Published case studies and a public metrics page: deployments, detectors shipped, detections in the field

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the grant is fully funded and stays open for 15 days. In that window, Auditware submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

Questions, pushback, better ideas? Post them below.

---

## [APPROVED] Source-Level Debugging for Solidity: ethdebug in solc

- Type: Grant
- Funding goal: $236,500 USD
- Admin id: 4, public page: https://fund.thedao.fund/initiative/source-level-debugging-for-solidity-ethdebug-in-solc

### Summary

solc does not emit the debug information debuggers need, so every tool reverse-engineers compiler behavior and breaks when the compiler changes. This funds implementing the ethdebug format directly in solc, with debug data that survives the full optimizer pipeline so it works on production builds.

### Full details

| | |
|---|---|
| **Status** | Draft |
| **Budget** | $236,500 USD |
| **Anchor backer** | $151,000 committed by Argot Collective; this grant raises the remaining $85,500 |
| **Proposal window** | None, grant already in progress |
| **Indicative duration** | 6 to 9 months for the remaining milestones |

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
- Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

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

These milestones are the full project plan, scoped with Argot and Walnut. Final milestones and payments for the co-funded portion are negotiated with the team and fixed in the grant agreement.

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

## Milestone review and acceptance

- Milestones 0 through 2 are already underway and reviewed under Argot's existing arrangement with Walnut. Their completion status is reported publicly, and payments from this grant begin only once milestones 0 through 2 are accepted.
- For the remaining milestones, machine-checkable criteria (CI green, merged or open upstream pull requests, published test results) are accepted automatically once the public evidence exists.
- Judgment-based criteria (whether coverage is complete, whether the walkthrough is credible) are signed off by Nicholas D'Andrea (ethdebug) and Nikola Matic (Solidity).
- The reviewer's fee comes out of the milestone payment or is pro bono. The team coordinates their payment.

## Process

- This is an already active grant that needs more funding to be completed, and work is already under way.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- If a milestone stalls past its expected deadline, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

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

---

Questions, pushback, better ideas? Post them below.

---

## [APPROVED] OPSEC Ratings Coalition to Build & Maintain an "L2Beat for OPSEC"

- Type: RFP
- Funding goal: $150,000 USD
- Admin id: 3, public page: https://fund.thedao.fund/initiative/opsec-ratings-coalition-to-build-maintain-an-l2beat-for-opse

### Summary

Fund a single coordinator to bring at least six OPSEC auditing firms together around one industry-agreed rating standard: an A / AA / AAA tier a team earns and renews yearly, with a six-month check-in and automatic suspension when its security posture changes. The firms already running OPSEC audits become the accredited raters, apply one shared scoring template inside their existing flow and publish tiers only, never a team's report or score. Rated teams pay a fixed fee into a membership body that owns the standard and the board once the coordinator hands off. A simple public board shows who is rated; teams with unacceptable OPSEC simply don't appear.

### Full details

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

---

## [APPROVED] Automated EIP Compliance Checks for Ethereum Clients

- Type: Grant
- Funding goal: $20,000 USD
- Admin id: 2, public page: https://fund.thedao.fund/initiative/automated-eip-compliance-checks-for-ethereum-clients

### Summary

Ethereum's client teams implement EIPs by reading specification text and writing code, and conformance test suites only catch the divergences somebody thought to write a test for. PRSpec uses LLM analysis to compare EIP specification text directly against client source code and flag semantic mismatches, and it has already surfaced a real cross-client inconsistency in how EIP-1559's base-fee burn is implemented. This grant funds turning it from a research tool into a self-hosted pre-release check running in the staging pipelines of the major execution clients.

### Full details

| | |
|---|---|
| **Status** | Draft |
| **Budget** | $20,000 USD |
| **Proposal window** | 15 days, opening once the grant is fully funded |
| **Indicative duration** | 6 months (the team sets the final timeline) |

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
- The proposal window is also an open challenge period. A challenger wins by credibly delivering this scope for less or proposing materially stronger milestones.
- Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

## Existing work

- [PRSpec](https://github.com/Fosurero/PRSpec): LLM-based differential analysis of EIP specs against client source; currently covers go-ethereum, Nethermind, Besu, and Reth across 10 EIPs, with 149 passing tests
- [execution-spec-tests (archived)](https://github.com/ethereum/execution-spec-tests) and [ethereum/tests](https://github.com/ethereum/tests): the conformance test suites client teams already run; PRSpec complements these, it does not replace them
- [execution-specs (live repo)](https://github.com/ethereum/execution-specs): the executable Python spec whose fork-to-fork diffs PRSpec builds on

## Scope

**In scope**

- Production packaging of the PRSpec CLI and Docker image for local, self-hosted deployment
- Integration documentation good enough that a client-team engineer can go from clean checkout to a first run without talking to the author
- Hands-on integration with at least two execution-layer client teams, tailored to their pipelines
- A documented triage workflow: finding severity, false-positive tracking, and how a team silences a known-noisy check
- Clear documentation of LLM inference options and costs (local models vs. API keys), since each team runs the tool on its own infrastructure

**Out of scope**

- Guaranteeing spec compliance. PRSpec is an LLM-assisted review layer that flags likely mismatches for human review.
- Replacing or duplicating execution-spec-tests or ethereum/tests
- Consensus-layer clients (execution layer only, matching PRSpec's current coverage)
- Perpetual maintenance beyond the grant period; the maintenance plan (hard requirement) covers how new EIPs and forks get added, but ongoing operation is each client team's choice

## Hard requirements

1. **Open source.** All code and documentation under an OSI-approved license, with no closed-source dependencies required to run the tool.
2. **Self-hosted by default.** Client teams run the tool entirely in their own environment; no client source code leaves their infrastructure unless they choose an external LLM API and that choice is documented. Support for local, open-weight models is explicitly highlighted to guarantee zero code leakage.
3. **Public evidence of adoption.** Client-team integrations count only when confirmed publicly by that team (a merged PR in their repo, a public statement, or a public CI run).
4. **Noise accountability.** A published false-positive/triage report per integrated client, because a CI check that cries wolf gets deleted.
5. **Maintenance plan.** A credible, documented process for adding new EIPs and forks to the tool's coverage after the grant.
6. **Reviewer from a client team.** Judgment calls are signed off by an engineer from an execution-layer client team with no ties to the recipient, named in the grant agreement before work begins.

## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

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

### 4 - Multi-client adoption - $4,000

- [ ] At least one additional major execution-layer client team running PRSpec as a recurring pre-release check, publicly confirmed by that team (any of the major clients: Nethermind, Geth, Besu, or Reth)
- [ ] A public adoption page listing which clients run PRSpec, which EIPs are covered, and links to each public confirmation
- [ ] At least one new EIP or fork added to coverage during the grant, demonstrating the extension process end to end
- [ ] Published maintenance plan and a recorded walkthrough or workshop for client teams to reference

### 5 - Majority client adoption - $6,000

- [ ] At least three execution-layer client teams running PRSpec as a recurring pre-release check, publicly confirmed by those teams (must include Nethermind and Geth)

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the grant is fully funded and stays open for 15 days. In that window, Safi El-Hassanine submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

Questions, pushback, better ideas? Post them below.

---

## [APPROVED] End-to-End Formally Verified Vyper Compiler

- Type: Grant
- Funding goal: $600,000 USD
- Admin id: 1, public page: https://fund.thedao.fund/initiative/end-to-end-formally-verified-vyper-compiler

### Summary

Vyper is the second most widely used EVM language, securing billions of dollars in production protocols like Curve, Yearn, and Lido, yet the correctness of its compiler rests on testing and auditing alone. This grant funds a machine-checked proof that Vyper compilation preserves the meaning of source programs, plus the infrastructure to re-verify every future release. No other serious smart-contract language, Solidity included, has an effort like this underway.

### Full details

| | |
|---|---|
| **Status** | Draft |
| **Budget** | $600,000 USD |
| **Proposal window** | 15 days, opening once the grant is fully funded |
| **Indicative duration** | 12 months (the team sets the final timeline) |

## Why this matters

- **Adoption.** Vyper is the second most widely used EVM language, securing billions of dollars in production protocols such as Curve, Yearn, and Lido. A verified Vyper compiler protects real value and increases public assurance in smart contract deployments.
- **Nobody else is doing this.** No other serious smart-contract language (Solidity included) has an effort underway toward formally verified compilation. This grant makes Vyper the only EVM language whose deployed bytecode carries machine-checked guarantees.
- **The compiler is built for it.** Venom, Vyper's LLVM-style SSA intermediate representation, gives the pipeline a clean, stage-by-stage structure that proofs can follow, while running a modern optimization pipeline more advanced than those covered by landmark verified compilers like CompCert. Verifying it means both a safer Vyper and an advance on the state of the art in compiler verification.

Developers, auditors, and verification tools reason about Vyper source code; Ethereum executes EVM bytecode. Everything in between is the compiler, and today its correctness rests on testing and auditing alone. In July 2023, miscompiled reentrancy locks let attackers drain tens of millions of dollars from Curve pools whose source code was correct.

This grant funds a machine-checked proof that Vyper compilation preserves the meaning of source programs, plus the infrastructure to re-verify every future production release.

In addition, an executable formal semantics lets developers prove end-to-end properties about Vyper source that carry through to deployed bytecode(!), which are not limited in expressivity as bounded model checkers are.

The end state:

- A **verified compilation mode** bundled with the official Vyper compiler and available as a --verified option; bytecode compiled with it provably matches the source semantics
- **Source-level proofs that reach the chain**: properties proven about Vyper source carry over to the deployed bytecode
- **Continuous verification**: each supported compiler release can be re-verified using the existing proof infrastructure

## The recipient

In the interest of full transparency:

- This grant was drafted together with the **Vyper core team**, builds directly on their open-source groundwork, and the Vyper core team is the recipient. The head start is real: an executable HOL4 semantics of a large Vyper subset that already passes the codegen section of the official test suite, in-progress proofs for the Vyper to Venom to bytecode pipeline, and a formal EVM semantics validated against the Execution Spec Tests (see Existing work).
- The proposal window is also an open challenge period. If another team can credibly deliver this scope for less, or propose materially stronger milestones, we want that proposal.
- We believe the price is fair: published estimates for comparable end-to-end compiler verification run well above this budget.
- The proposal should show a track record in mechanized verification and spell out the technical approach: proof assistant, relationship to the existing work, frontend strategy, and how users run the verified compiler.
- Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

## Existing work

- **vyper-hol**: executable formal semantics of a large Vyper subset in HOL4, passing the codegen section of the official Vyper test suite, plus in-progress proofs for the Vyper to Venom to bytecode pipeline (GPL-3.0)
- **Verifereum**: formal EVM semantics in HOL4, validated against the Ethereum Execution Spec Tests
- Proposers may build on this work or justify an alternative foundation in a mature proof assistant with a small trusted kernel (HOL4, Rocq, Isabelle/HOL, Lean)

## Scope

**In scope**

- Executable formal semantics of Vyper, maintained against current releases. Supported coverage should be full coverage of the Vyper language semantics with any exclusions documented.
- Machine-checked proofs for the full pipeline: Vyper source to Venom IR to EVM bytecode, including optimization passes and ABI encoding/decoding
- A user-facing **verified compilation mode** (a distinguished set of verified optimization passes), bundled with the Python compiler and available as a --verified option, on terms agreed with the Vyper maintainers
- Continuous verification in CI against pinned upstream compiler revisions
- Gas modeling: the source semantics quantifies over gas rather than fixing a cost model; tying this to the formal EVM gas model through the verified compiler makes concrete bounds (e.g. "this function executes within Y gas") provable about the compiled bytecode
- Public releases, documentation, and adoption work

**Out of scope**

- Correctness of user-written contracts. The proof guarantees the bytecode matches the source; source-level safety remains the author's job.
- Verification of the Python compiler implementation itself; the expected architecture is a verified compiler bundled with the Python compiler and available as a --verified option
- Perpetual re-verification after the grant period. That folds into normal compiler maintenance, which this infrastructure makes inexpensive.

## Hard requirements

1. **Open source.** All code, proofs, and documentation under an OSI-approved license, with no closed-source dependencies.
2. **Kernel-checked, no gaps.** Headline theorems check with zero admitted/cheated lemmas in their dependency graph, enforced by an automated check in public CI. Milestone payment depends on this check passing.
3. **Pinned targets.** Each verified release names the exact upstream Vyper commit, optimization settings, and EVM fork it covers.
4. **Assurance statement.** Each release ships a plain-language document: supported language subset (or complete coverage, if applicable), exclusions, covered passes, and the complete trusted computing base.
5. **Maintenance plan.** A credible plan for keeping proofs current across Vyper releases and EVM hard forks.
6. **Independent reviewer.** The technical reviewer for judgment calls has no affiliation with the selected team or with the existing codebases.

## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

### A - Formal semantics and frontend - $50,000

- [ ] All semantics definitions and proofs check from a clean checkout with a single documented command, in public CI
- [ ] Published test-parity report: the semantics passes the functional/codegen section of the official Vyper test suite at the pinned commit, every exclusion listed and justified
- [ ] Published frontend decision: a formalized parser/typechecker, or an explicit statement that the production frontend remains in the trusted base, with mitigations
- [ ] Public documentation of the semantics, sufficient for an outside researcher to state and prove properties of Vyper programs

### B - Verified frontend lowering - $125,000

- [ ] Named lowering-correctness theorems (statements, expressions, builtins, external-call dispatch) machine-checked with zero admitted lemmas, verified by the automated CI check
- [ ] ABI encode/decode correctness proven against the published ABI specification, covering static and dynamic types
- [ ] Updated assurance statement for the supported subset at this stage
- [ ] Expanded regression suite comparing verified-pipeline output with production-compiler output at the pinned commit, divergences reported publicly

### C - Verified optimization pipeline - $100,000

- [ ] Published list of every pass in the production pipeline, each marked verified or excluded; every verified pass has a machine-checked correctness theorem with zero admitted lemmas
- [ ] The composed verified pass set has a single machine-checked correctness theorem and is packaged as a distinct, documented compilation mode users can select
- [ ] CI automatically re-checks all proofs and output-parity against the pinned upstream revision, with a public status page or badge
- [ ] Soundness bugs found in the production optimizer are responsibly disclosed to the Vyper team, with each disclosure linked publicly once fixed

### D - End-to-end theorem and public release - $125,000

- [ ] A single end-to-end theorem, published in both machine-checked and human-readable form, verified in CI
- [ ] A public release outside users can run, with installation and usage instructions, distributed as agreed with the Vyper maintainers. The expected form is the verified compiler bundled with the Python compiler and available as a --verified option; the release documents how the verified compiler is executed and what that adds to the trusted base.
- [ ] Full assurance statement published: supported subset (if applicable), exclusions, covered passes, complete trusted computing base, proof assumptions
- [ ] The verified pipeline demonstrated on at least five representative real-world Vyper contracts, results published

### E - Adoption and ecosystem impact - $200,000

**Tranche 1: Launch - $75,000**

- [ ] Public project website explaining the verified compiler and its guarantees in language a non-specialist developer can follow
- [ ] User documentation plus at least one step-by-step tutorial from a Vyper contract to a verified-compilation artifact
- [ ] A recorded technical workshop or webinar for developers and auditors, publicly available
- [ ] A talk delivered at a major Ethereum or formal-methods event, and at least two published technical blog posts
- [ ] Public roadmap for verifying future Vyper releases (verification is expected to accompany each real Vyper release, not lag behind it), including hard-fork policy

**Tranche 2: Adoption - $25,000**

- [ ] At least one independent external integration: a new protocol team, audit firm, or tooling project using the verified pipeline, confirmed publicly by that party
- [ ] A published case study of a production contract, deployed on Ethereum mainnet or a major L2, whose bytecode is covered by the verified pipeline
- [ ] A public metrics page reporting, at minimum: downloads, on-chain deployments compiled with the verified mode, supported compiler versions, and downstream integrations

**Tranche 3: Continuous verification - $100,000**

- [ ] Continuous verification demonstrated across at least one new production Vyper release after the Milestone D release: proofs repaired, re-checked in CI, new assurance statement published

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the grant is fully funded and stays open for 15 days. In that window, the Vyper core team submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

Questions, pushback, better ideas? Post them below.

---

## [REJECTED] thatsRekt - onchain hack alerts for the public good.

- Type: Grant
- Funding goal: $40,000 USD
- Admin id: 15

### Summary

thatsRekt aggregates trusted security accounts on X, uses AI & ML to work out which posts are actually about a live exploit, and turns the true ones into structured, on-chain alert that anyone can read for free. 

https://thatsrekt.com/

This grant pays to fund the system's costs to keep running relayers, ETH on on-chain agents, detection systems (AI tiers..etc.) and decentralize the detection network (add more guardians; https://thatsrekt.com/guardians), make the feed something wallets and agents can act on programmatically not only a Telegram channel people scroll, and prove that real usage follows.

Beat private & costly detection systems in speed and false positive rates. Decentralized setup.

Grants: https://thatsrekt.com/donate

(if made through an ENS, it will be automatically displayed on the UI).

### Full details

Grant: thatsRekt Public Exploit Alert Network

Why this matters

When Kelp DAO's rsETH bridge got hit, @officer_secret flagged it on X 1 hour 15 minutes after the on-chain event. @peckshield had it under 2 hours. @certikAlert passed 2 hours. Hypernative, one of the expensive proprietary detection platforms teams pay real money for, was later than all three. The fastest, most reliable signal wasn't a machine learning model running in a vendor's black box, it was a handful of security people who know what they're looking at, posting to X the moment they see it.

Hypernative and Blockaid are great, complex, ML models, but are also private, and expensive, and even with all that machine learning they still throw a lot of false positives, without ever publishing what that rate actually is. Meanwhile the fastest signal is already public and free, it is just scattered across dozens of X accounts with no structure, no on-chain record, and no transparency about accuracy. thatsRekt exists to close that gap: it watches the trusted accounts, uses AI to decide whether a post is really about an exploit worth warning people about, and turns that into a structured, public, on-chain alert with its own accuracy tracked in the open. It is named after rekt.news on purpose, we like them a lot, but rekt.news writes the obituary after the fact. thatsRekt is trying to catch the exploit while it is still happening.

In one line: thatsRekt is an exploit detection aggregator that reads trusted X accounts and uses AI & ML to decide whether they're describing an ongoing hack the public should be warned about, and it publishes its own accuracy instead of hiding it.

What this actually pays for

thatsRekt already runs. The contracts are live at the same address across six EVM chains, the indexers and GraphQL gateway and frontend are built, and the team has been covering the roughly $1,500 to $2,000 a year it costs to keep the MVP running out of their own pocket, with all spending reported publicly. This grant does not fund a rebuild. It funds exactly two things the current budget doesn't stretch to:

Turning the AI classification step from something the core team eyeballs on its own into a published, versioned scoring methodology and reference pipeline that any guardian can run as part of their own detection stack, plus a tracked and published false-positive rate. Posting stays fully decentralized: any whitelisted guardian runs their own detection logic and posts directly on-chain themselves, nobody drafts an alert for someone else to confirm.
Onboarding two more guardian teams running their own detectors, which roughly doubles the network's current operating cost but means the feed no longer depends on one team's uptime and judgment.

We'll say the honest part plainly: right now about 200 people are subscribed to the Telegram alert channel (https://t.me/thatsrekt_alerts), and nobody is executing anything on-chain off the back of an alert yet, and guardians aren't really using the up/down-vote true-positive flagging either. This grant is what gets thatsRekt from "a good idea that runs on one team's spare change" to a small, transparent, multi-team network. Without funding, the team has timelined a shutdown within the next year.

The recipient

This grant goes to the thatsRekt core team, the people who designed and have been running the project since launch. The head start here is not hypothetical: they have live contracts deployed at an identical address on Ethereum, Arbitrum, Optimism, Polygon, Base and BNB Smart Chain, a working indexer and GraphQL gateway, a frontend, a guardian governance model already enforcing a 3-day delay to add a new poster and instant removal of a bad one, and a public track record of reporting every dollar they've spent. Nobody else has this running, and paying an unrelated team to rebuild it from scratch would cost more and take longer than funding the team that already operates it and has been reading real incidents like Kelp DAO's since before this grant existed. That head start is exactly why this budget is smaller than a from-scratch build would cost.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

Existing work
Live product and docs: https://thatsrekt.com and https://thatsrekt.com/docs
Open source, MIT licensed contracts and infrastructure: https://github.com/ThatsRekt/thatsRekt (indexers, GraphQL gateway, frontend, relay service)
Public expense reporting and donation address (thatsRekt.eth): https://thatsrekt.com/donate
Live Telegram alert channel, roughly 200 subscribers: https://t.me/thatsrekt_alerts
@ThatsRekt_ on X
Scope

In scope

Building out and formalizing the AI/ML pipeline that reads a vetted list of security-focused X accounts, scores whether a post is likely describing a real exploit. Anyone can apply to become a Guardian, who can run their own detector / plug into existing system and post on-chain directly.
Our UI reads on-chain state, does't limit Guardians in any way / covers False positives. A voting system classifies a post as FP when 2 or more guardians downvote it, which is then removed form the frontend.

Tracking and publishing the classifier's false-positive rate, on the frontend and on-chain, on an ongoing basis
Onboarding at least two additional guardian teams running their own detectors, so posting isn't dependent on a single team
Funding the added opex those two guardians bring (relayer gas, AI inference, hosting) for the grant period, on top of what the core team already covers

Out of scope

Becoming a general OPSEC or code-audit firm. thatsRekt aggregates and verifies public signals about active exploits, it does not audit contracts.
Any token, fee, or paid tier. thatsRekt stays free and public good, same as it is today.
Building a wallet/agent SDK or programmatic integrations. That's a real next step for thatsRekt, but it's not what this grant funds.
Achieving zero false positives. thatsRekt won't hit 0%, no detection system does. What it commits to instead, and what the private systems don't do, is publishing that rate openly, on the frontend and on-chain, so anyone can check the track record.
Executing trades, withdrawals, or circuit breakers on behalf of any third party. thatsRekt publishes the signal; what a wallet or agent does with it is on them.
Hard requirements
Stays fully open source under an OSI license (MIT today).
Every alert and every guardian action (add, remove, vote) is verifiable on-chain by a stranger. No private, off-chain judgment calls that can't be audited after the fact.
A published, versioned methodology for how the classifier scores an X post as exploit-related, so guardians and integrators know what "true positive" means and can dispute a call.
The false-positive rate is published on the frontend and on-chain, updated on a fixed cadence, not just claimed in a report.
A public funding and maintenance plan that extends past this grant. This grant should not be the only thing keeping the network alive after month 12.
No claim, express or implied, that a flagged address is definitively malicious. Alerts are advisory signals for others to act on, not final judgments.
Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

1 - Better detection engine - $15,000
 Published, versioned scoring methodology for how X posts get classified as likely-exploit vs noise, live in the repo AI/ML classifier live in production, feeding scored alert drafts to guardians rather than relying on manual monitoring. (we only have one template example for guardians to build a simple detector: https://github.com/ThatsRekt/thatsRekt/tree/main/example-otomato).
 False-positive rate tracked and published on the frontend and on-chain, on a fixed, ongoing cadence
2 - Two more guardians live - $10,000
 At least 2 additional guardian teams onboarded, running their own detectors, and actively posting
 Their added opex (relayer gas, AI inference, hosting) funded for the grant period and reported alongside the team's existing public expense reporting
 Public page showing guardian add/remove history and the up/down-vote outcome for every alert posted
3 - Proven adoption - $15,000
 At least 4 guardian teams total (current plus the 2 new ones plus at least 1 more) actively posting and voting over a sustained 3-month window
 A full quarter of published false-positive rate data, with the number and the methodology both public
 At least one publicly documented instance of an outside party (a wallet's blocklist, another security account, a protocol's incident writeup) citing a thatsRekt alert as a source
 12 months of opex funded and publicly reported per thatsRekt's existing practice, with a year-2 funding plan published
Milestone review and acceptance
Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.
Process
The proposal window opens once the grant is fully funded and stays open for 30 days. In that window, the thatsRekt core team submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
Milestone deliveries are reviewed within 14 days; payment follows acceptance.
The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

## [REJECTED] Fund Echidna Development Through 2027

- Type: Grant
- Funding goal: $48,000 USD
- Admin id: 14

### Summary

Fund Gustavo Grieco for six active development months of Echidna research and development during 2027 at $8,000 per month. The months may be non-consecutive so work can align with finalized EVM upgrade specifications, client implementations, and test vectors. The work follows Echidna's 2026–2027 roadmap: keep EVM execution current, improve campaign and worker architecture, strengthen symbolic verification, turn agent control into a dependable workflow and optimize execution performance. At minimum, the period should produce three tagged maintenance or minor releases, two roadmap feature releases, and three technical posts.

### Full details

# Grant: Fund Echidna Development Through 2027

| | |
|---|---|
| **Status** | Draft |
| **Budget** | $48,000 USD |
| **Proposal window** | 30 days, for finalizing the plan |
| **Indicative duration** | 6 active development months during 2027 |

## Why this matters

Smart contracts can pass large unit test suites and still fail after an unexpected sequence of calls, actors, prices, timestamps, upgrades, or token behaviors. Echidna attacks that gap with stateless/stateful property-based testing. It generates transaction sequences from a contract ABI and searches for inputs that falsify user-defined properties or Solidity assertions.

Echidna already combines state-of-the-art coverage guidance, corpus mutation, source integration, automatic test minimization, Foundry reproducers, hevm cheatcodes, and optional symbolic execution. Its next challenge is reliability at the seams: EVM behavior changes, campaign and worker coordination, symbolic-execution edge cases, agent control and improved performance. Those are the areas that determine whether auditors can trust a long-running campaign and reproduce what it found.

The budget assumes $8,000 for each dedicated development month. That rate covers maintainer time, dedicated VPS capacity for large campaigns, and access to frontier LLM agents for MCP experiments. Six months therefore costs $48,000.

## What this actually pays for

This grant pays for focused maintainer time, not a rewrite and not a protocol audit. The work includes:

- EVM, Solidity, Foundry, crytic-compile, hevm, Slither, SMT solver configuration, scfuzzbench localized changes, packaging, and operating-system compatibility
- Correctness fixes, crash fixes, regressions, performance work, and better reproducers
- Continued development of the MCP integration so agents can inspect and direct live fuzzing campaigns
- Improvements to optional symbolic execution for verification, exploration, and counterexample generation
- Create or contribute to a SKILL prompt for making sure agents are fully using Echidna's capabilities. 
- Dedicated VPS and frontier-model access used for large-scale fuzzing and agent experiments
- Tagged releases, changelogs, examples, and technical posts that make the work usable outside the maintainer's machine

The six-month budget is deliberately simple: six dedicated months at $8,000 each. We expect steady public releases and technical write-ups, but acceptance is based on roadmap outcomes and public evidence. At minimum, the period should produce three tagged maintenance or minor releases, two roadmap feature releases, and three technical posts.

## The recipient

The recipient is Gustavo Grieco, an Echidna maintainer, working in the public [Echidna repository](https://github.com/crytic/echidna).

A grant is justified because the recipient has the decisive head start. The work touches Echidna's Haskell engine, release process, hevm and Slither integrations, symbolic execution, Foundry compatibility, and the existing MCP preview. A new vendor would first have to learn years of implementation details and EVM edge cases before doing useful work. That would cost more than extending the existing codebase.

Every applicant, including any expected recipient, must disclose their relationships to the teams, codebases, and firms named in this initiative.

## Existing work

The [2026–2027 roadmap discussion](https://github.com/crytic/echidna/issues/1612) is the maintainer's current planning thread for the next phase of Echidna, as well for users to provide feedback and prioritization of the goals. The surrounding open issues make the pressure points concrete: campaign handling and worker interactions, work distribution, symbolic-mode memory behavior, EVM precompile support. The [Echidna releases](https://github.com/crytic/echidna/releases) show an active maintenance cadence across compatibility fixes, EVM behavior, Foundry workflows, symbolic execution, and agent integration.

The [Echidna repository](https://github.com/crytic/echidna) already provides ABI-guided property fuzzing, corpus and coverage guidance, source-aware output, automatic minimization, CI integration, optimization mode, on-chain state fetching, Foundry test generation, hevm cheatcode support, and optional symbolic execution. Recent 2.3 releases added optional symbolic verification, symbolic assistance for fuzzing, multiple SMT solvers, Foundry reproducers, and an experimental MCP interface that can report campaign state, coverage, target metadata, corpus operations, and guidance commands.

The [public fuzzing campaigns list](https://github.com/perimetersec/public-fuzzing-campaigns-list) provides adoption evidence from real testing work. Recon Invariant Testing Extension and scfuzzbench are also relevant external users or integration targets for the 2027 releases.

This grant covers six active development months during 2027. The months may be non-consecutive so work can align with finalized EVM upgrade specifications, client implementations, and test vectors. Each funded month is identified in the public work log. Work already completed or funded for an earlier period does not count toward these milestones.

## Scope

**In scope**

- Six active development months of Echidna research and development during 2027; the months may be non-consecutive to align with finalized EVM upgrades and related implementation work
- EVM and toolchain compatibility, including required updates in hevm, Slither, new Foundry cheatcodes, and build integration
- At least three tagged maintenance or minor releases with public changelogs and regression tests, covering roadmap reliability and compatibility work
- At least two tagged roadmap feature releases, with the pair delivering material improvements across campaign architecture, agent workflows, and optional symbolic verification
- Symbolic-execution work for verification, exploration, or counterexample discovery, including memory and timeout robustness, with bounds and unsupported cases reported plainly
- Dedicated VPS and frontier-model usage for reproducible fuzzing and agent experiments
- At least three public technical posts, examples, or deep dives
- Contributions in a public SKILL prompt to explain Echidna features to agents.
- Dedicated support for users that use the tool for long and complex fuzzing campaigns or verifications, using telegram/discord/github issues.

**Out of scope**

- Rewriting Echidna in another language
- Building a general autonomous auditor or claiming that an LLM replaces a security engineer
- Writing a complete fuzzing harness or invariant suite for one protocol
- Performing an audit or formal-verification engagement for a specific protocol
- Supporting non-EVM chains except through the normal EVM-compatible stack

## Hard requirements

1. **Open source.** All grant-funded code, tests, documentation, and examples are published under AGPLv3 or another OSI-approved license compatible with the repository.
2. **Public development.** Work lands through public issues, pull requests, tagged releases, changelogs, and technical posts.
3. **Six funded months.** The grant funds six active development months during 2027. The months may be non-consecutive so work can align with finalized EVM upgrade specifications, client implementations, and test vectors. Each funded month is identified in the public work log. The recipient discloses any other funding for the same period and deliverables, and earlier work (e.g. from 2026) cannot be counted again. If an expected EVM upgrade is not finalized during the grant period, that development time is applied to other in-scope roadmap, compatibility, testing, symbolic execution, agent integration, performance, or maintenance work. No milestone depends on an Ethereum upgrade shipping on a specific date.
4. **Roadmap delivery.** The grant produces at least three tagged maintenance or minor releases, two roadmap feature releases, and three technical posts. Each feature release includes public release notes explaining the user-visible improvements and linking to the tests, reproducer, benchmark, demonstration, or documentation that supports them. Closing a ticket is supporting evidence, not an acceptance criterion by itself.
5. **Current EVM support.** Relevant finalized EVM and toolchain changes during the work period are covered by public regression tests.
6. **Honest agent and verification output.** Agent controls are documented. Symbolic results state the mode, solver, bounds, timeout status, unsupported operations, and caveats. Incomplete analysis is never reported as verified.
7. **Reproducible releases.** Release artifacts are tied to public source tags, and supported installation paths are tested in CI.
8. **Post-grant maintenance.** The recipient commits to continue maintaining Echidna after the funded period, including release ownership, issue triage, security-report handling, and user support through the project's public channels. This maintenance continues even without follow-on funding, but the pace may be slower because the maintainer may need to prioritize other paid or professional work. Before final acceptance, the recipient publishes a short public note documenting this maintenance commitment and the expected support and release model after the grant ends.

## Milestones (draft)

These milestones are a draft. Final milestones and payments get negotiated with the winning team and fixed in the grant agreement. If you think this draft is wrong, tell us how in your proposal... improving it is part of winning.

### 1 - EVM fidelity and campaign reliability - $16,000

- [ ] Two funded development months are identified in the public work log, with links to the releases, pull requests, tests, documentation, and other public work produced during those months
- [ ] At least one tagged minor or maintenance release ships with a changelog and supported installation artifacts
- [ ] The release notes contain a plain-language summary of the EVM, toolchain, performance, or campaign-reliability improvements delivered, with public links to the tests, reproducer, benchmark, or demonstration that supports each material claim
- [ ] At least one public reproducible example demonstrates a compatibility or reliability improvement delivered under the milestone, such as a previously failing contract, workflow, campaign, or EVM behavior working with the funded release
- [ ] One technical post explains a maintenance, compatibility, performance, or reproducer improvement delivered under the milestone

### 2 - Campaign architecture, verification, and machine interface - $16,000

- [ ] By the end of the fourth funded month, at least one tagged roadmap feature release ships from a public source tag with release notes explaining the user-visible changes
- [ ] The release delivers improvements in at least two of these areas: campaign or worker architecture, symbolic verification, agent or MCP workflows, or execution performance. Each claimed improvement has a public test, reproducer, benchmark, demonstration, or documented workflow that a reviewer can inspect
- [ ] At least one public reproducible example demonstrates a symbolic-verification, campaign-control, or agent-guided workflow that was not practical or reliable before the funded work, including the command or configuration used and the observed result
- [ ] A second tagged minor or maintenance release ships by the end of the fourth funded month
- [ ] At least two technical posts have been published by the end of the fourth funded month

### 3 - Roadmap completion, adoption, and final handoff - $16,000

- [ ] A third tagged minor or maintenance release ships by the end of the sixth funded month
- [ ] A second tagged roadmap feature release ships by the end of the sixth funded month, with public notes explaining the user-visible improvements and linking to the tests, reproducer, benchmark, demonstration, or documentation that supports them
- [ ] At least three technical posts are published across the full grant period, including one practical example of agent-guided fuzzing or symbolic verification and one post explaining a reliability or architecture improvement
- [ ] At least one public technical post documents the use of Echidna for fuzzing and/or symbolic verification on a well-known open-source project, including the properties or harness used, the approach taken, results, limitations, and links needed to reproduce the work
- [ ] The same case study includes a public upstream pull request to that project that adds or demonstrates the Echidna fuzzing or verification approach. The pull request may be a draft or proof of concept, but it must contain enough code and instructions for a reviewer to reproduce the approach
- [ ] A public, versioned SKILL prompt for Echidna exists, either created under this grant or materially improved from existing public sources. It documents how an agent should use Echidna's main capabilities, including property design, stateful fuzzing, corpus and reproducers, symbolic verification, and agent or MCP workflows, with at least one end-to-end usage example

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the grant is fully funded and stays open for 30 days. In that window, Gustavo Grieco submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

Questions, pushback, better ideas? Post them below.

---

## [REJECTED] Scaling Colibri Adoption Across the Blockchain Ecosystem

- Type: RFP
- Funding goal: $300,000 USD
- Admin id: 13

### Summary

The companion Colibri Grant builds the technical core, brings verification, PAP, and the open transaction-security foundation to production maturity, and proves them through initial reference integrations.
This RFP takes the next step: broad adoption. It funds a large-scale application adoption program, the reusable infrastructure required to extend Colibri to many more L1 and L2 ecosystems, and additional developer environments such as Go and C++. The objective is to make trustless data access, practical read privacy, and local transaction simulation available across a much larger part of the blockchain ecosystem.

### Full details

From reference integrations to broad adoption
Colibri changes the application trust model by allowing blockchain data to be verified locally instead of treating an RPC response as trusted truth. PAP adds practical privacy for blockchain reads, and local transaction simulation allows applications to evaluate transactions on verified state before users sign them.
The companion Grant establishes and hardens these capabilities and demonstrates them through a limited number of reference integrations. This RFP is about scale: bringing the resulting technology into many more applications, networks, and developer environments.
Grant: build the core and prove it works.   |   RFP: take it into the wider ecosystem.
Why this is an RFP
The work covered here is deliberately suitable for open bidding. Once the Colibri core, APIs, proof formats, privacy interfaces, transaction-simulation interfaces, and test requirements are available, qualified teams can build integrations against them.
Different teams may bring experience with wallets, DeFi, games, L2s, alternative L1s, language ecosystems, or developer tooling. The purpose of the RFP is to use that broader ecosystem capacity to expand adoption without making corpus.core the only team able to carry out the work.
The RFP does not fund commercial Colibri infrastructure or services. In particular, vRPC and commercial prover services are outside this initiative.
Objective
The RFP expands Colibri along three adoption axes:
Application adoption - integrate trustless data access, PAP, and where useful local transaction simulation into a broad set of wallets, DeFi applications, other dApps, games, agents, and related applications.
Network expansion - make Colibri extensible across many more L1 and L2 ecosystems, with explicit verification capabilities and a defined verification fallback where the required native proofs are not available.
Developer environments - add the bindings and platform support needed by the applications and ecosystems adopting Colibri.
Scope
1. Application Ecosystem Adoption
Replacing a conventional RPC connection with the Colibri client is intentionally lightweight. For an application using a compatible interface, a basic verification integration should normally be measured in days rather than weeks. This makes broad adoption realistic.
The main effort is therefore not the amount of code required for each basic integration. It is identifying suitable projects, onboarding their teams, supporting integration and testing, resolving recurring issues in shared tooling, and carrying integrations through to a usable or release-ready state.
The program should target 20-30 real application integrations beyond the reference integrations funded under the companion Grant, covering several application categories.
wallets;
DeFi applications;
other consumer and professional dApps;
games and blockchain-enabled applications;
agents and automated applications;
browser, mobile, or embedded applications where relevant.
Integration depth
Not every application needs the same Colibri capabilities. Integrations should use the capabilities that make sense for the actual product rather than adding features only to satisfy a checklist.
Trustless data access: use Colibri in place of a trusted RPC path so relevant blockchain data is verified locally.
PAP: enable practical read privacy using the PAP capabilities provided by the Colibri core. Standard PAP configurations should be straightforward to enable.
Adaptive PAP: where the application benefits from dynamic privacy choices, integrate application-specific privacy policies, routing, or user controls.
Transaction simulation and TSA foundation: integrate local simulation on verified state and expose the resulting transaction effects, warnings, or policy information in the application's transaction or signing UI.
Transaction simulation is primarily an application and UI integration task in this RFP. Advanced commercial TSA components, proprietary rule sets, DSLMs, model weights, training data, and other commercial security intelligence are not RFP deliverables.
Adoption program requirements
20-30 application integrations beyond the Grant-funded reference integrations;
coverage of at least four distinct application categories;
a meaningful subset using PAP, including selected integrations that demonstrate adaptive PAP rather than only a static privacy configuration;
a meaningful subset integrating local transaction simulation into the transaction/signing experience;
a mix of production, production-candidate, and technically complete upstream integrations;
reusable fixes, adapters, examples, and documentation derived from recurring integration work;
public reporting of completed integrations and the integration status that can be disclosed.
Acceptance must not depend entirely on a third party's release schedule. A technically complete integration, accepted upstream pull request, production candidate, or equivalent independently demonstrable result can therefore count where the implementing team has completed all work under its control.
2. Multi-Chain Expansion Framework
The goal of this workstream is not for TheDAOFund to pay the full integration cost of a list of individual chains. Well-funded ecosystems have their own reasons and budgets to support integration into Colibri.
Instead, TheDAOFund should fund the reusable public infrastructure that makes additional chain integrations faster, more consistent, and independently implementable. Individual ecosystems can then fund their own chain-specific work, either with corpus.core or with another qualified team.
TheDAOFund funds the ability to scale. Ecosystems fund their own economically viable integrations.
Verification Capability Model
Different L1 and L2 architectures provide different proof capabilities. Colibri must describe those differences explicitly instead of reducing them to a single 'verified' label.
define a machine-readable Verification Capability Model;
describe which data and security properties can be verified for a given network;
distinguish native verification, settlement-derived or partial verification, and verification using an explicit fallback;
expose the active verification mode and remaining assumptions to applications;
provide a common basis for documentation, testing, and UI trust indicators across chains.
Chain integration framework
standardize chain and consensus adapter interfaces where possible;
provide reusable L2 verification components for common settlement and proof patterns;
provide an integration SDK or equivalent developer tooling for adding further networks;
provide conformance tests, live-chain tests, test vectors, and compatibility checks;
document the process for adding and maintaining a network integration;
deliver one or two reference integrations that demonstrate the framework on materially different network architectures.
3. Verification Fallback Protocol
Some networks or requested data do not yet expose all proofs required for fully native stateless verification. Colibri needs an explicit fallback for those cases so that ecosystem coverage can grow without pretending that weaker verification has the same guarantees as native proofs.
The fallback should use a witness-based mechanism or equivalent design to provide an explicit, upgradeable verification path when native proofs are unavailable.
define the fallback protocol and its security assumptions;
integrate it with the Verification Capability Model;
ensure that applications can always identify when fallback verification is being used;
prevent silent downgrade from stronger verification to a weaker mode;
define how multiple witnesses or stronger witness models can be supported where appropriate;
provide a migration path from fallback verification to native verification when the underlying ecosystem gains the required proof capabilities;
provide a reference implementation, test vectors, and documentation.
The fallback is a bridge for ecosystems whose proof infrastructure is not yet sufficient. It is not a replacement for native cryptographic verification.
4. Ecosystem Expansion Fund
A small part of the RFP may be used to accelerate strategically useful chain integrations where direct ecosystem funding is not reasonably available, or where limited TheDAOFund funding unlocks substantially larger co-funding from the ecosystem.
Where a network has its own foundation, grants program, or integration budget, direct ecosystem co-funding should normally be expected. The RFP should not replace funding that the ecosystem itself can reasonably provide.
priority for integrations with clear public-good and ecosystem value;
preference for co-funded integrations where TheDAOFund funding has a clear leverage effect;
full upstream contribution of the RFP-funded open-source work;
no automatic entitlement for an ecosystem to have its full chain integration paid by TheDAOFund.
5. Developer Platform Expansion
Colibri already has a portable C core and bindings for several application environments. This workstream adds the developer environments needed to reach additional applications and ecosystems.
production-quality Go binding;
production-quality C++ binding;
one or more additional bindings or platform integrations where a concrete application or ecosystem need is demonstrated;
idiomatic APIs while preserving consistent verification semantics;
normal package distribution for the respective ecosystem;
examples, CI, integration tests, and documentation;
shared conformance tests to ensure that different bindings expose the same security properties.
Bindings required only for a specific commercial customer or a narrowly proprietary environment are not automatically in scope. RFP funding should be used where the developer environment has broader ecosystem value.
Cross-cutting integration tooling and conformance
Every workstream should leave the next integration easier than the previous one. The RFP therefore includes shared integration and conformance work across applications, chains, and bindings.
reproducible test vectors;
public CI and integration tests;
conformance test suites;
compatibility and capability metadata;
integration examples and templates;
documentation based on real integration experience;
automated checks that verify that an integration actually uses the expected local verification path;
PAP and transaction-simulation integration tests where applicable.
Open-source and commercial boundary
Source code, specifications, bindings, chain-integration tooling, verification fallback components, reference integrations, and test infrastructure funded directly by this RFP must be open source under an OSI-approved license.
The RFP does not make unrelated commercial Colibri technology public. vRPC, commercial prover services, managed infrastructure, advanced TSA capabilities, proprietary security intelligence, specialized rule sets, DSLMs, model assets, hosted services, enterprise features, and other commercial extensions are outside the RFP unless explicitly included in a separately defined funded deliverable.
Likewise, a chain ecosystem may separately pay for chain-specific engineering, support, infrastructure integration, maintenance, or other work beyond the reusable public-good components funded here.
Hard requirements
All source code and specifications directly funded by the RFP are released under an OSI-approved open-source license.
The work builds on the interfaces and core capabilities delivered by the companion Grant and does not duplicate Grant-funded development.
Verification guarantees and remaining trust assumptions are explicit. A weaker fallback must never be presented as equivalent to native verification.
Security-sensitive behavior must fail explicitly; there must be no silent downgrade of verification.
Acceptance is machine-checkable wherever possible through public CI, reproducible tests, live-chain tests, conformance tests, and integration tests.
Documentation must be sufficient for teams other than corpus.core or the original implementer to carry out further integrations.
Application adoption must produce real, independently demonstrable integrations rather than isolated demos.
RFP-funded work must improve the reusable integration path so that later applications, networks, and platforms become progressively easier to add.
Budget framework
The final funding goal should be set within the ranges below. The ranges reflect the different nature of the work and leave room for bidders to propose an efficient delivery plan.
RFP area
Working budget range
Application Adoption - 20-30 integrations
$100,000-$150,000
Multi-Chain Expansion Framework
$60,000-$80,000
Ecosystem Expansion Fund
$20,000-$30,000
Developer Platform Expansion
$30,000-$40,000
Total working range
$210,000-$300,000

The Verification Fallback Protocol and Verification Capability Model are part of the multi-chain expansion work. Depending on the final proposal, they may be contracted as a separate milestone without changing the overall scope.
The budget is not intended as a per-integration price list. In particular, individual chain ecosystems are expected to finance chain-specific work where they have their own funding capacity, while the RFP finances reusable public infrastructure and limited strategic co-funding.
Suggested milestone structure
Milestone 1 - Application Adoption Program
Run the broad application adoption program and deliver 20-30 integrations beyond the companion Grant's reference integrations, with trustless data access as the common foundation and PAP and transaction simulation used where they provide meaningful product value.
Budget range: $100,000-$150,000.
Milestone 2 - Multi-Chain Expansion Framework
Deliver the Verification Capability Model, reusable chain/L2 adapter architecture, integration tooling, conformance tests, documentation, and one or two reference network integrations.
Budget range: $60,000-$80,000.
Milestone 3 - Verification Fallback
Deliver the witness-based or equivalent explicit verification fallback, integrate it with the capability model, and demonstrate it on a network or data path where the required native proofs are not available.
This milestone is budgeted within the Multi-Chain Expansion Framework and may be separated contractually if useful.
Milestone 4 - Ecosystem Expansion Fund
Use limited RFP funding for strategically valuable network integrations where ecosystem funding is unavailable or where TheDAOFund participation unlocks meaningful co-funding.
Budget range: $20,000-$30,000.
Milestone 5 - Developer Platform Expansion
Deliver Go and C++ support plus additional bindings or platform integrations justified by concrete ecosystem adoption needs.
Budget range: $30,000-$40,000.
Relationship to the companion Grant
Grant: productionize the technical core, PAP, and the open transaction-security foundation; validate them through initial reference integrations.
RFP: take those capabilities into broad use across applications, networks, and developer environments.
The two initiatives should be reviewed together because the RFP deliberately builds on the architecture and reference work funded by the Grant. They should, however, have separate deliverables and no duplicate funding.
Expected outcome
At the end of the RFP, Colibri should have moved from a production-ready core with a small number of reference integrations to a broadly usable ecosystem technology.
Dozens of applications should be able to use locally verified blockchain data, with PAP and local transaction simulation integrated where appropriate. Adding a new L1 or L2 should follow a documented and testable process with explicit verification guarantees and a defined fallback where native proofs are not yet sufficient. Developers should be able to use Colibri from additional mainstream development environments without having to build their own bindings.
The RFP should also create leverage beyond its own budget: application integrations should become progressively cheaper, and well-funded chain ecosystems should be able to finance their own Colibri integrations on top of the reusable public infrastructure created here.

---

## [REJECTED] Colibri: Production Infrastructure for Trustless Ethereum Access

- Type: Grant
- Funding goal: $320,000 USD
- Admin id: 12

### Summary

Ethereum is designed to be trustless, but most wallets and dApps still depend on RPC providers as trusted sources of blockchain data.
This grant brings Colibri’s stateless verification architecture to production maturity and adoption: enabling applications to verify blockchain data locally, access it with adaptive privacy, and simulate and analyze transactions locally on verified state before signing. The goal is to make trustless access a practical default for wallets, dApps, browsers, mobile applications, and constrained devices.

### Full details

The problem: Ethereum is trustless. Its application layer often is not.
Ethereum gives users the ability to independently verify the state and rules of the network. But this property largely disappears at the application boundary.
Most wallets and dApps obtain balances, contract state, transaction data, logs, simulation results, and other critical information from RPC infrastructure. Applications typically trust these responses rather than verify them.
Ethereum provides verifiable truth, while applications frequently consume trusted answers.
Running a full node solves this problem, but is not practical for the environments where most users actually interact with Ethereum: mobile wallets, browsers, embedded applications, IoT devices, and lightweight applications. Traditional light clients reduce the resource requirements, but still require synchronization and continuous interaction with network infrastructure.
Colibri takes a different approach. Instead of synchronizing blockchain state or trusting an RPC provider, a stateless client requests the information it needs together with cryptographic evidence and verifies that evidence locally.
The RPC becomes a transport mechanism rather than a source of truth. Trust → Proof.
What already exists
Colibri is not a research proposal starting from zero. corpus.core has already built an open-source stateless client architecture implementing proof-based verification for Ethereum and EVM-compatible networks.
The architecture separates three core functions:
Execution verification proves that requested state, storage, transactions, receipts, or execution results belong to a specific execution state.
Consensus verification proves that the corresponding block is valid and belongs to the chain accepted by the client’s consensus verification.
Local execution allows operations such as eth_call and transaction simulation to execute locally against verified state.
Unlike conventional light clients, Colibri does not require continuous header synchronization or blockchain state storage. Verification happens when information is requested.
The verifier is designed to be small enough to embed directly into applications and is implemented in C with bindings for application environments including JavaScript/TypeScript, Kotlin, Swift and others.
The architecture supports different proof-delivery models, including local proving, remote proving, and verified RPC (vRPC), while keeping verification inside the application. The next step is to turn this architecture into broadly usable production infrastructure.
Grant objective
Make local verification a practical standard capability of Ethereum applications.
The work follows one continuous security model:
Verify → Protect → Act
1. Verify
Applications should be able to independently verify the blockchain information they consume instead of trusting the infrastructure delivering it.
2. Protect
Verification alone does not provide privacy. Blockchain requests can reveal addresses, assets, applications, contracts, and user intentions to infrastructure providers.
Colibri’s Pragmatic Adaptive Privacy (PAP) architecture introduces configurable privacy at both transport and content levels, allowing applications to select privacy mechanisms according to their threat model and resource constraints.
3. Act
Verified information should ultimately protect the user’s actions. Transactions can be executed locally against verified state before they are signed. Their effects can then be extracted into a structured representation, analyzed by deterministic rules and, optionally, interpreted by local models before being presented to users or application policy.
This creates a transaction security layer in which verified state and deterministic local simulation—not an RPC response or a language model—provide the factual basis for security decisions.
Open infrastructure and commercial extensions
The core infrastructure funded by this grant will be open source and available for integration by the Ethereum ecosystem. This includes the verification primitives, local transaction simulation on verified state, structured effect interfaces, baseline rule-based analysis, wallet-facing security interfaces, reference implementations, and the test infrastructure required to independently validate their behavior.
The grant does not require all technology built on top of these open primitives to be open source.
Advanced security intelligence, specialized rule sets and analyzers, domain-specific language models (DSLMs), model weights, training data and training infrastructure, hosted services, enterprise features, and other commercial extensions may be developed and licensed separately by corpus.core or by third parties.
This separation is intentional: the grant creates an open, independently verifiable foundation on which a sustainable ecosystem of both open-source and commercial security solutions can be built.
Scope
1. Production Verification Core
Harden the existing Colibri verification architecture for production use.
execution proof verification;
Ethereum consensus verification;
zk-based consensus verification;
L2 / settlement verification where supported by the respective architecture;
local verified execution;
proof formats and interfaces;
explicit verification and trust modes;
interoperability across supported bindings;
test vectors and live-chain testing;
performance and resource benchmarks;
public CI and reproducible testing.
The result is a production-ready verification primitive that wallets and applications can embed instead of treating RPC responses as trusted data.
2. Pragmatic Adaptive Privacy
Move the existing PAP architecture from prototype/design stage toward production use within Colibri. PAP treats privacy as an adaptive property rather than a binary one.
Applications can choose different levels of transport privacy and content privacy depending on their requirements.
implementation of PAP levels in the Colibri architecture;
transport privacy mechanisms;
content privacy mechanisms;
provider/request routing;
threat-model documentation;
privacy-level APIs;
integration with proof retrieval;
reference configurations for common application environments.
The goal is to make privacy compatible with practical proof-based blockchain access rather than requiring every application to adopt the most expensive privacy mechanism.
3. Verified Transaction Security
Build an open transaction-security foundation that analyzes a transaction locally before signing, based on cryptographically verified blockchain state.
Verified State → Local Simulation → Structured Effects → Rule-based Analysis → Optional Local Model → Wallet Policy / User
Deterministic simulation and effect extraction
Transactions are executed locally against verified state. The resulting state changes and transaction effects are converted into a structured, machine-readable representation, including asset transfers, approvals, contract interactions, and other security-relevant effects.
Rule-based security analysis
A deterministic rule engine evaluates the structured effects and identifies known risk patterns, unexpected behavior, and policy violations. This layer provides security decisions without depending on an AI model and exposes machine-readable results that wallets can use to block transactions, display warnings, or require additional confirmation.
Local explanation and advanced analysis interface
The open layer provides an interface through which local explanation and advanced analysis components can consume verified simulation results and rule-based findings. A reference integration will demonstrate how a local model can translate these structured results into understandable, context-aware explanations.
Language models are not a source of blockchain truth. Security-relevant facts originate from verified state and deterministic local execution, and core security policies remain enforceable without an AI model. Sensitive transaction information does not need to be transmitted to a hosted LLM.
Advanced DSLMs, model weights, training data, specialized analyzers, and commercial security intelligence are outside the open-source deliverables of this grant and may be licensed separately.
4. Adoption and Ecosystem Integration
Technology alone does not change Ethereum’s trust model. Applications have to use it. A substantial part of this grant is therefore dedicated specifically to adoption.
production integration support for wallets and dApps;
EIP-1193-compatible integration paths;
reference implementations;
developer SDK improvements;
integration documentation and examples;
integration testing;
technical support for ecosystem partners;
production pilots;
measurement and publication of adoption results.
Existing work with wallet and application ecosystems provides the starting point for these integrations. The objective is not merely to release another library, but to demonstrate that local verification can become part of normal Ethereum application architecture.
Milestones and budget
Milestone 1 — Production Verification Core
Budget: $80,000
Deliver a hardened and documented production version of the core verification architecture.
Deliverables:
Packages/libraries for various development platforms/languages 
The colibri.stateless client, ready to be integrated in projects
Prover and vRPC (verifiable RPC) as deployable infrastructure
Production verification paths and proof interfaces
Public tests, CI, live-chain test vectors and benchmarks
Explicit verification/trust modes and developer interfaces
Maintenance and release documentation
Acceptance: Public code, reproducible test vectors, live-chain tests, CI, and published benchmarks.
Milestone 2 — Pragmatic Adaptive Privacy
Budget: $60,000
Integrate the PAP model into the production Colibri architecture and provide usable privacy configurations for applications.
Deliverables:
Privacy-level APIs and supported transport/content privacy modes in colibri
PAP fully integrated in colibri.stateless client
Pragmatic privacy level 1 implementation, level 2 is prepared
Threat-model documentation
Integration with proof retrieval and provider routing
Working reference configurations
Acceptance: Public implementation, documented privacy properties, and working reference configurations.
Milestone 3 — Verified Transaction Security Foundation
Budget: $80,000
Deliver an open transaction-security foundation operating locally on verified blockchain state, without making advanced commercial TSA intelligence or DSLMs part of the open-source commitment.
Deliverables:
Local transaction simulation on verified state
Structured transaction-effect extraction
Baseline deterministic rule-based security analysis
Extensible rule and policy interface
Machine-readable risk/effect interface and wallet-facing block/warn/confirm policies
Open interface for local explanation and advanced analysis components
Reference local-model integration
Reproducible test vectors for normal, suspicious, and malicious transaction behavior
Acceptance: Public implementation and reproducible tests demonstrating the path from verified state through deterministic simulation and baseline rule analysis to wallet policy decisions and optional local explanation.
Milestone 4 — Adoption and Ecosystem Integration
Budget: $100,000
Move Colibri from production-ready infrastructure into real application environments.
Deliverables:
Reference integrations and EIP-1193-compatible integration paths, integration into 5 or more open source projects (wallets, DeFi apps, …)
SDK, documentation, examples and developer tooling
Technical integration support for ecosystem partners
Production pilots and integration testing
Published adoption report covering integrations, usage, lessons learned, and remaining barriers
Acceptance: Publicly demonstrable integrations and a published adoption report documenting achieved integrations and measurable deployment results.
Total funding requested
$320,000
Milestone
Budget
Production Verification Core
$80,000
Pragmatic Adaptive Privacy
$60,000
Verified Transaction Security Foundation
$80,000
Adoption & Ecosystem Integration
$100,000
Total
$320,000

Why corpus.core
This grant builds directly on technology already designed and implemented by corpus.core.
The existing Colibri codebase, proof architecture, specifications, bindings, prover architecture, PAP design, transaction-simulation work, and application integrations substantially reduce both technical risk and time to delivery.
The grant therefore funds the transition from an existing working architecture toward production infrastructure and ecosystem adoption rather than financing a new implementation from scratch.
Licensing and sustainability
The public-good layer funded by the grant will remain open source under an OSI-approved license. This gives wallets, dApps, researchers, and infrastructure providers a freely inspectable and independently verifiable foundation for trustless access and baseline transaction security.
corpus.core intends to sustain development through commercial technology built on top of that open foundation. Potential commercial layers include advanced TSA capabilities, specialized security analyzers and rule sets, DSLMs and associated model assets, hosted or managed services, enterprise integrations, and other value-added components.
This model keeps the verification and interoperability layer open while allowing corpus.core to build a sustainable business around advanced security capabilities and services.
Expected impact
The long-term goal is not to replace RPC infrastructure. It is to change its role.
Today: Application → trusted RPC → Ethereum
With stateless verification: Application → untrusted data/proof provider → local verification → Ethereum truth
RPC providers can continue doing what centralized infrastructure does well: operating reliable, highly available systems and efficiently retrieving blockchain data. They simply no longer need to be trusted to tell the truth.
If this model becomes widely adopted, independent verification moves from infrastructure operated by specialists to the wallets and applications users already run. Privacy can be selected according to the application’s threat model, and transaction decisions can be grounded in locally simulated effects on verified state.
Don’t trust. Verify.

Project references
Whitepaper: http://whitepaper.colibri-stateless.tech
PAP Whitepaper: http://privacy.colibri-stateless.tech
Specification: http://specification.colibri-stateless.tech
Repository: http://repository.colibri-stateless.tech

---

## [REJECTED] Colibri: Production Infrastructure for Trustless Ethereum Access

- Type: Grant
- Funding goal: $320,000 USD
- Admin id: 11

### Summary

Ethereum is designed to be trustless, but most wallets and dApps still depend on RPC providers as trusted sources of blockchain data.
This grant brings Colibri’s stateless verification architecture to production maturity and adoption: enabling applications to verify blockchain data locally, access it with adaptive privacy, and simulate and analyze transactions locally on verified state before signing. The goal is to make trustless access a practical default for wallets, dApps, browsers, mobile applications, and constrained devices.

### Full details

The problem: Ethereum is trustless. Its application layer often is not.
Ethereum gives users the ability to independently verify the state and rules of the network. But this property largely disappears at the application boundary.
Most wallets and dApps obtain balances, contract state, transaction data, logs, simulation results, and other critical information from RPC infrastructure. Applications typically trust these responses rather than verify them.
Ethereum provides verifiable truth, while applications frequently consume trusted answers.
Running a full node solves this problem, but is not practical for the environments where most users actually interact with Ethereum: mobile wallets, browsers, embedded applications, IoT devices, and lightweight applications. Traditional light clients reduce the resource requirements, but still require synchronization and continuous interaction with network infrastructure.
Colibri takes a different approach. Instead of synchronizing blockchain state or trusting an RPC provider, a stateless client requests the information it needs together with cryptographic evidence and verifies that evidence locally.
The RPC becomes a transport mechanism rather than a source of truth. Trust → Proof.
What already exists
Colibri is not a research proposal starting from zero. corpus.core has already built an open-source stateless client architecture implementing proof-based verification for Ethereum and EVM-compatible networks.
The architecture separates three core functions:
Execution verification proves that requested state, storage, transactions, receipts, or execution results belong to a specific execution state.
Consensus verification proves that the corresponding block is valid and belongs to the chain accepted by the client’s consensus verification.
Local execution allows operations such as eth_call and transaction simulation to execute locally against verified state.
Unlike conventional light clients, Colibri does not require continuous header synchronization or blockchain state storage. Verification happens when information is requested.
The verifier is designed to be small enough to embed directly into applications and is implemented in C with bindings for application environments including JavaScript/TypeScript, Kotlin, Swift and others.
The architecture supports different proof-delivery models, including local proving, remote proving, and verified RPC (vRPC), while keeping verification inside the application. The next step is to turn this architecture into broadly usable production infrastructure.
Grant objective
Make local verification a practical standard capability of Ethereum applications.
The work follows one continuous security model:
Verify → Protect → Act
1. Verify
Applications should be able to independently verify the blockchain information they consume instead of trusting the infrastructure delivering it.
2. Protect
Verification alone does not provide privacy. Blockchain requests can reveal addresses, assets, applications, contracts, and user intentions to infrastructure providers.
Colibri’s Pragmatic Adaptive Privacy (PAP) architecture introduces configurable privacy at both transport and content levels, allowing applications to select privacy mechanisms according to their threat model and resource constraints.
3. Act
Verified information should ultimately protect the user’s actions. Transactions can be executed locally against verified state before they are signed. Their effects can then be extracted into a structured representation, analyzed by deterministic rules and, optionally, interpreted by local models before being presented to users or application policy.
This creates a transaction security layer in which verified state and deterministic local simulation—not an RPC response or a language model—provide the factual basis for security decisions.
Open infrastructure and commercial extensions
The core infrastructure funded by this grant will be open source and available for integration by the Ethereum ecosystem. This includes the verification primitives, local transaction simulation on verified state, structured effect interfaces, baseline rule-based analysis, wallet-facing security interfaces, reference implementations, and the test infrastructure required to independently validate their behavior.
The grant does not require all technology built on top of these open primitives to be open source.
Advanced security intelligence, specialized rule sets and analyzers, domain-specific language models (DSLMs), model weights, training data and training infrastructure, hosted services, enterprise features, and other commercial extensions may be developed and licensed separately by corpus.core or by third parties.
This separation is intentional: the grant creates an open, independently verifiable foundation on which a sustainable ecosystem of both open-source and commercial security solutions can be built.
Scope
1. Production Verification Core
Harden the existing Colibri verification architecture for production use.
execution proof verification;
Ethereum consensus verification;
zk-based consensus verification;
L2 / settlement verification where supported by the respective architecture;
local verified execution;
proof formats and interfaces;
explicit verification and trust modes;
interoperability across supported bindings;
test vectors and live-chain testing;
performance and resource benchmarks;
public CI and reproducible testing.
The result is a production-ready verification primitive that wallets and applications can embed instead of treating RPC responses as trusted data.
2. Pragmatic Adaptive Privacy
Move the existing PAP architecture from prototype/design stage toward production use within Colibri. PAP treats privacy as an adaptive property rather than a binary one.
Applications can choose different levels of transport privacy and content privacy depending on their requirements.
implementation of PAP levels in the Colibri architecture;
transport privacy mechanisms;
content privacy mechanisms;
provider/request routing;
threat-model documentation;
privacy-level APIs;
integration with proof retrieval;
reference configurations for common application environments.
The goal is to make privacy compatible with practical proof-based blockchain access rather than requiring every application to adopt the most expensive privacy mechanism.
3. Verified Transaction Security
Build an open transaction-security foundation that analyzes a transaction locally before signing, based on cryptographically verified blockchain state.
Verified State → Local Simulation → Structured Effects → Rule-based Analysis → Optional Local Model → Wallet Policy / User
Deterministic simulation and effect extraction
Transactions are executed locally against verified state. The resulting state changes and transaction effects are converted into a structured, machine-readable representation, including asset transfers, approvals, contract interactions, and other security-relevant effects.
Rule-based security analysis
A deterministic rule engine evaluates the structured effects and identifies known risk patterns, unexpected behavior, and policy violations. This layer provides security decisions without depending on an AI model and exposes machine-readable results that wallets can use to block transactions, display warnings, or require additional confirmation.
Local explanation and advanced analysis interface
The open layer provides an interface through which local explanation and advanced analysis components can consume verified simulation results and rule-based findings. A reference integration will demonstrate how a local model can translate these structured results into understandable, context-aware explanations.
Language models are not a source of blockchain truth. Security-relevant facts originate from verified state and deterministic local execution, and core security policies remain enforceable without an AI model. Sensitive transaction information does not need to be transmitted to a hosted LLM.
Advanced DSLMs, model weights, training data, specialized analyzers, and commercial security intelligence are outside the open-source deliverables of this grant and may be licensed separately.
4. Adoption and Ecosystem Integration
Technology alone does not change Ethereum’s trust model. Applications have to use it. A substantial part of this grant is therefore dedicated specifically to adoption.
production integration support for wallets and dApps;
EIP-1193-compatible integration paths;
reference implementations;
developer SDK improvements;
integration documentation and examples;
integration testing;
technical support for ecosystem partners;
production pilots;
measurement and publication of adoption results.
Existing work with wallet and application ecosystems provides the starting point for these integrations. The objective is not merely to release another library, but to demonstrate that local verification can become part of normal Ethereum application architecture.
Milestones and budget
Milestone 1 — Production Verification Core
Budget: $80,000
Deliver a hardened and documented production version of the core verification architecture.
Deliverables:
Packages/libraries for various development platforms/languages 
The colibri.stateless client, ready to be integrated in projects
Prover and vRPC (verifiable RPC) as deployable infrastructure
Production verification paths and proof interfaces
Public tests, CI, live-chain test vectors and benchmarks
Explicit verification/trust modes and developer interfaces
Maintenance and release documentation
Acceptance: Public code, reproducible test vectors, live-chain tests, CI, and published benchmarks.
Milestone 2 — Pragmatic Adaptive Privacy
Budget: $60,000
Integrate the PAP model into the production Colibri architecture and provide usable privacy configurations for applications.
Deliverables:
Privacy-level APIs and supported transport/content privacy modes in colibri
PAP fully integrated in colibri.stateless client
Pragmatic privacy level 1 implementation, level 2 is prepared
Threat-model documentation
Integration with proof retrieval and provider routing
Working reference configurations
Acceptance: Public implementation, documented privacy properties, and working reference configurations.
Milestone 3 — Verified Transaction Security Foundation
Budget: $80,000
Deliver an open transaction-security foundation operating locally on verified blockchain state, without making advanced commercial TSA intelligence or DSLMs part of the open-source commitment.
Deliverables:
Local transaction simulation on verified state
Structured transaction-effect extraction
Baseline deterministic rule-based security analysis
Extensible rule and policy interface
Machine-readable risk/effect interface and wallet-facing block/warn/confirm policies
Open interface for local explanation and advanced analysis components
Reference local-model integration
Reproducible test vectors for normal, suspicious, and malicious transaction behavior
Acceptance: Public implementation and reproducible tests demonstrating the path from verified state through deterministic simulation and baseline rule analysis to wallet policy decisions and optional local explanation.
Milestone 4 — Adoption and Ecosystem Integration
Budget: $100,000
Move Colibri from production-ready infrastructure into real application environments.
Deliverables:
Reference integrations and EIP-1193-compatible integration paths, integration into 5 or more open source projects (wallets, DeFi apps, …)
SDK, documentation, examples and developer tooling
Technical integration support for ecosystem partners
Production pilots and integration testing
Published adoption report covering integrations, usage, lessons learned, and remaining barriers
Acceptance: Publicly demonstrable integrations and a published adoption report documenting achieved integrations and measurable deployment results.
Total funding requested
$320,000
Milestone
Budget
Production Verification Core
$80,000
Pragmatic Adaptive Privacy
$60,000
Verified Transaction Security Foundation
$80,000
Adoption & Ecosystem Integration
$100,000
Total
$320,000

Why corpus.core
This grant builds directly on technology already designed and implemented by corpus.core.
The existing Colibri codebase, proof architecture, specifications, bindings, prover architecture, PAP design, transaction-simulation work, and application integrations substantially reduce both technical risk and time to delivery.
The grant therefore funds the transition from an existing working architecture toward production infrastructure and ecosystem adoption rather than financing a new implementation from scratch.
Licensing and sustainability
The public-good layer funded by the grant will remain open source under an OSI-approved license. This gives wallets, dApps, researchers, and infrastructure providers a freely inspectable and independently verifiable foundation for trustless access and baseline transaction security.
corpus.core intends to sustain development through commercial technology built on top of that open foundation. Potential commercial layers include advanced TSA capabilities, specialized security analyzers and rule sets, DSLMs and associated model assets, hosted or managed services, enterprise integrations, and other value-added components.
This model keeps the verification and interoperability layer open while allowing corpus.core to build a sustainable business around advanced security capabilities and services.
Expected impact
The long-term goal is not to replace RPC infrastructure. It is to change its role.
Today: Application → trusted RPC → Ethereum
With stateless verification: Application → untrusted data/proof provider → local verification → Ethereum truth
RPC providers can continue doing what centralized infrastructure does well: operating reliable, highly available systems and efficiently retrieving blockchain data. They simply no longer need to be trusted to tell the truth.
If this model becomes widely adopted, independent verification moves from infrastructure operated by specialists to the wallets and applications users already run. Privacy can be selected according to the application’s threat model, and transaction decisions can be grounded in locally simulated effects on verified state.
Don’t trust. Verify.

Project references
Whitepaper: http://whitepaper.colibri-stateless.tech
PAP Whitepaper: http://privacy.colibri-stateless.tech
Specification: http://specification.colibri-stateless.tech
Repository: http://repository.colibri-stateless.tech

---

## [REJECTED] Securing Ethereum with Formal Verification

- Type: Grant
- Funding goal: $300,000 USD
- Admin id: 10

### Summary

AI is making it faster to attack software, giving attackers a meaningful edge. 

Formal verification is widely considered the strongest guarantee of software correctness.

 This grant aims to create an open-source framework for Solidity verification and increase formal verification adoption across the Ethereum ecosystem, with TVL secured as its main success metric.

### Full details

## What this actually pays for

This is not a program to select public contracts and publish formal verifications of them. It pays for two connected things:

- **Product work:** continue the open-source Verity tooling, benchmark, documentation, developer onboarding, and deterministic Solidity-to-Verity transpilation work already defined in the Ethereum Foundation funded grant.
- **Adoption work:** make Verity usable by protocol teams in-house and formal audit firms in their own work. Success is led by the value secured by the verified properties.

The total program budget is $300,000 USD. It combines $100,000 USD in existing Ethereum Foundation support for the Verity product foundation with a $200,000 USD request to TheDAO Security Fund.

## **Who we expect to do this**

The recipient is Verity Labs. This is a grant rather than an RFP because its team has spent the past few months doing unbounded formal-verification work with leading Ethereum protocols. Its public work includes +40 protocols among them popular names like Lido, Morpho, and Safe

This experience shows where real protocols need unbounded proofs, where modeling gaps block use, and what needs to become repeatable for developers and audit firms. The Ethereum Foundation has already funded part of Verity's product roadmap and everything is public

## Scope

**In scope**

- Product work on Verity's compiler, Solidity coverage, reusable proof infrastructure, benchmark, documentation, developer onboarding, and a deterministic Solidity-to-Verity transpiler that reduces modeling gaps.
- Public releases that document supported workflows, trust assumptions, version pins, known limitations, and how teams and formal audit firms can use the tooling.
- Adoption through protocol teams using Verity in-house and formal audit firms using it in their own work.
- Measuring adoption primarily through the TVL of contracts whose stated properties are formally verified.

**Out of scope**

- Verifying the Solidity compiler itself.
- A proprietary product, hosted-only workflow, or exclusive access for a single provider.
- Counting users or github stars as the main measure of adoption. We consider real impact into TVL and TVL only

## Hard requirements

1. **Open to everyone.** Verity product code, benchmark artifacts, documentation, and CI are public under an OSI-approved license. No proprietary runtime, hosted service, account, or paid provider is needed to use the tooling or reproduce a proof.
2. **Reproducible.** A stranger can reproduce each headline product claim from a clean checkout, documented command, public CI, and version pins, without admitted proof gaps.
3. **TVL-led adoption.** Adoption evidence names the participating protocol team or formal audit firm, provides public confirmation of use, and gives the public TVL source and snapshot date for each value included in the aggregate.
4. **Clear scope on verified TVL.** Each reported verification states the code revision, properties proved, trust assumptions, and known limits in plain language.

## Milestones (draft)

### 1 - Building the Verity product - $150,000

The product budget combines $100,000 USD in Ethereum Foundation support for the existing Verity roadmap with $50,000 USD requested from TheDAO Security Fund. The final grant agreement must distinguish completed Ethereum Foundation work from work still to be delivered under this initiative.

- [ ]  A public, versioned Verity release records the delivered compiler stabilization and bug fixes, Solidity feature coverage, reusable EVM proof infrastructure, and exact source revisions.
- [ ]  A deterministic Solidity-to-Verity transpiler is public. For its supported Solidity subset, it produces reproducible Verity output without an LLM in the translation path, documents unsupported patterns, and has public regression tests.
- [ ]  A public verity-benchmark release contains fixed implementations, formal specifications, editable Lean proof files, and target theorems, with checks that reject incomplete or admitted proofs.
- [ ]  Public developer material covers beginner onboarding, supported workflows, trust assumptions, version pins, known limitations, an AI proof-writing skill, and use by in-house teams and formal audit firms.
- [ ]  Public compiler and benchmark research materials are published, and developer onboarding includes a workshop or talk at EthCC, Devcon, or a similar venue.
- [ ]  A public maintenance plan names the maintainer, release process, and post-grant sustainability path.

### 2 - $1B TVL secured with Verity - $50,000

This milestone uses $50,000 USD requested from TheDAO Security Fund.

- [ ]  At least $1 billion in TVL is counted on a stated public snapshot date across contracts whose selected properties are formally verified with Verity, whether protocol teams use it in-house or formal audit firms use it in their own work.
- [ ]  The protocol team or formal audit firm publicly confirms its use of Verity for the stated contract revision and properties.
- [ ]  A public metrics page lists the counted systems, snapshot dates, TVL sources, aggregate verified TVL, and the limits of the measurement.

### 3 - $5B TVL secured with Verity - $100,000

This is the final milestone and uses $100,000 USD requested from TheDAO Security Fund.

- [ ]  At least $5 billion in TVL is counted on a public snapshot date across contracts formally verified with Verity, whether used in-house by protocol teams or by formal audit firms.

## Milestone review and acceptance

- Criteria with objective public evidence (a live page, a published report, a named party confirming) are accepted on sight.
- Judgment calls are signed off by an independent technical reviewer with no ties to the selected team, agreed between Giveth and the team before work begins and named in the grant agreement.
- The reviewer's fee comes out of the milestone payment, or is pro bono. The winning team coordinates their payment.

## Process

- The proposal window opens once the grant is fully funded and stays open for 30 days. In that window, Verity Labs submits their formal proposal: the final milestone plan, per-milestone budget (the draft above, or a stronger version), and full disclosures. The window is also an open challenge period: anyone who can credibly deliver the same scope for the same money or less may submit a challenge.
- Giveth reviews within 7 days of the window closing and fixes the final plan in the grant agreement.
- Milestone deliveries are reviewed within 14 days; payment follows acceptance.
- The first milestone can be paid up to 50% in advance so the team has funding to start. If more funds are needed mid-milestone, the team is expected to reach out to the ecosystem for a stop-gap loan.
- If a milestone stalls, the team gets a 21-day deadline to complete it. If they miss it, TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

---

Questions, pushback, better ideas? Post them below or talk to us on telegram https://t.me/+PHZekKhdjPAxOWU0

---

## [REJECTED] Secure EEZ smart contracts and protocol

- Type: RFP
- Funding goal: $250,000 USD
- Admin id: 8

### Summary

This initiative aims to maximize the security and reliability of the Ethereum Economic Zone (EEZ) smart contracts through independent review and advanced security techniques. The grant may support human-led security audits, AI-assisted auditing, formal verification, fuzzing, invariant testing, and other approaches that can identify vulnerabilities or provide stronger assurance of contract correctness. The goal is to make the EEZ contracts as robust as possible before they secure significant value and become critical infrastructure for cross-rollup interoperability.

### Full details

The Ethereum Economic Zone (EEZ) is fully decentralized and open infrastructure for trust-minimized interoperability and synchronous composability between Ethereum rollups. It is designed without centralized operators or trusted intermediaries, making the security and correctness of its smart contracts fundamental to the security of the system as a whole.

This grant initiative supports independent efforts to analyze, verify, and strengthen the security of the EEZ smart contracts. We welcome a broad range of approaches, including:

Independent human security audits and expert code reviews.
AI-assisted or AI-driven security analysis.
Formal verification of critical properties and protocol invariants.
Fuzzing, property-based testing, symbolic execution, and adversarial testing.
Economic and protocol-level security analysis, particularly around cross-rollup interactions.
Development of new security, verification, or testing tools applicable to EEZ.
Any other initiative that can uncover vulnerabilities or provide meaningful evidence of the correctness and robustness of the protocol.

Proposals may cover the complete system or focus on individual contracts, critical invariants, specific attack surfaces, or novel security methodologies.

Because EEZ is open and decentralized, its security should also benefit from open and independent scrutiny. The objective is to build security assurance through multiple complementary approaches rather than relying on a single audit or security provider. Whenever possible, the resulting findings, specifications, tests, verification artifacts, and security tooling should be made publicly available so they can benefit both EEZ and the broader Ethereum ecosystem.

---

## [ARCHIVED] Source-Level Debugging for Solidity: ethdebug in solc

- Type: Grant
- Funding goal: $236,438 USD
- Admin id: 5

### Summary

solc does not emit the debug information debuggers need, so every tool reverse-engineers compiler behavior and breaks when the compiler changes. This funds implementing the ethdebug format directly in solc, with debug data that survives the full optimizer pipeline so it works on production builds.

### Full details

> **NOTE: This is a real RFP we are working on but the final formatting is still open for discussion. We would love your feedback on the format presented here and are open to suggested improvements.**

| | |
|:--|:--|
| **Status** | Draft |
| **Budget** | $236,438 |
| **Sponsor funding** | $150,938 committed by Argot Collective |
| **Proposal window** | None, pure grant. |
| **Indicative duration** | 6 to 9 months for the remaining milestones (proposers set their own timeline) |

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
- If a milestone stalls, and is delayed past the expected deadline, eventually the team will get a 21-day deadline to complete it. TheDAO Security Fund reclaims the unspent funds and puts them toward other Ethereum security initiatives.

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

Questions, pushback, better ideas? Post them below.
