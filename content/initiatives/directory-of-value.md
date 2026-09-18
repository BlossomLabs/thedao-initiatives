---
title: Directory of Value
type: rfp
goal: 185000
summary: Before a security researcher can analyze a protocol, they have to find it,
  and today there is no neutral way to enumerate the contracts that actually hold
  value. Directory of Value is a permissionless registry where anyone can identify
  a contract as valuable, plus an open indexing layer that exposes every entry as
  data a researcher or an automated agent can query in full. It records
  identification without imposing judgment, and no single gatekeeper decides who
  appears. This RFP funds the specification, implementation, audit, deployment,
  and adoption of that directory.
duration: 12
---
## Why this matters

Before a security researcher can analyze a protocol, the researcher has to find it: know it is deployed, know it is live, know it actually holds or moves value. That sounds like the trivial part. It is not, and it has no good answer today.

We hit this ourselves. With funding from the [last QF security round](https://qf.giveth.io/project/tool-against-price-manipulation-attacks-in-defi-on-evm) we [modernized FlashSyn](https://github.com/quantstamp/flashsyn), an academic tool that synthesizes price-manipulation and flash-loan exploits so whitehats find them before attackers do. We made it faster, protocolized how it runs, and secured the compute to scan protocols en masse. Then we did not know what to scan. We wrote our own discovery pipeline that pattern-matched on-chain bytecode and chased contract-to-contract references... a hack for something that deserves to be a project on its own, and clearly imperfect. We fell back to ranking DeFi Llama by total value locked and scraping their adapters repo for addresses.

The same wall shows up every time the ecosystem talks about automated security at scale. The ideal is to run an advanced tool over every deployed contract; that is out of reach, because there are too many and the compute does not exist. It came up in TheDAO badgeholder security group and was agreed to be an obstacle. But the set of contracts that somebody has identified as valuable is a strict subset, and it is plausibly small enough to scan in full. Nobody can enumerate that subset today.

A neutral, machine-readable directory where anyone can identify a contract as valuable, so no researcher has to ask where to look.

## In scope

- A public, versioned protocol specification
- A registry (on-chain preferred, otherwise infrastructure meeting the hard requirements below) where anyone identifies a contract or account on Ethereum mainnet as valuable, with a short self-declared description and a canonical chain-qualified address
- An open indexing layer exposing every entry as machine-readable data, with no gatekept API. Anyone can run the indexer
- A spam-deterrence and sustainability mechanism, including expiry, reassessment, or decay, so the directory does not rot
- An optional expandability layer letting third parties attach their own data or signed attestations without altering the neutral base
- Write-path and read-path integrations that put the directory where people already work
- A path to covering other EVM chains beyond mainnet

## What this pays for:

This RFP pays for Directory of Value running in production:

- Milestone 1: Research and Specification. A public specification: data model (how an entry identifies a mainnet contract), write protocol, read interface, required properties, and delivery plan. Reads matter most; one use case must work end to end: Alice, a security researcher, sends her agent to find valuable protocols in scope for her tool, with enough information to act on. Design partners validate the data model and read use cases.
- Milestone 2: Protocol Writes. Every write path from Milestone 1 implemented, covering at minimum the MVP: anyone can identify a contract as valuable.
- Milestone 3: Protocol Reads and Indexing. Everything needed to read and browse the directory, including the agent-facing interface from Milestone 1.
- Milestone 4: Audit. A security-focused initiative deserves real scrutiny: at least the protocol logic (for example, spam resistance) and write paths, by a reviewer independent of the implementers.
- Milestone 5: Code Finalization and Deployment. The implementers bring the code fully to spec, fix audit findings, and deploy to production, after which the protocol can fully survive under CROPS.
- Milestone 6: Stewardship and Adoption. Once deployed, someone has to drive adoption including evangelism, tooling integration on the write path (Foundry and Hardhat plugins), and the read path (an MCP server and agent-framework and security-tool adapters).

The MVP bar is deliberately tiny: Alice marks a mainnet contract as valuable; when Bob queries the directory, it is on the list, enumerable in full. Proposals should go deeper and expand the project to the right scope.

## Out of scope

- Judging, scoring, ranking, or blessing contracts
- A polished human dashboard. A minimal reference reader is fine; the product is the machine-readable directory
- Curating the "correct" list of valuable contracts on anyone's behalf
- Backfilling the full history of the chain

## Existing work

The winning team is expected to reuse existing standards unless it has a good argument against it; some candidates are as follows:

- **[Ethereum Attestation Service (EAS)](https://attest.org)**: a permissionless, tokenless attestation primitive with expiry, revocation, and chaining.
- **[Open Labels Initiative (OLI)](https://github.com/openlabelsinitiative/OLI)**: a permissionless, EAS-based pool of address labels co-driven by Grow the Pie.
- **[ERC-8257](https://eips.ethereum.org/EIPS/eip-8257)** and **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)**: permissionless registries where anyone publishes a self-attested record (creator address bound at registration, metadata URI, content hash).
- **[ERC-7484](https://eips.ethereum.org/EIPS/eip-7484)** and **[ERC-7512](https://eips.ethereum.org/EIPS/eip-7512)**: security attestations consumers query before acting, and an on-chain audit representation authored by security firms themselves.
- **[ERC-7930](https://eips.ethereum.org/EIPS/eip-7930)** and **[CAIP-10](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-10.md)**: canonical chain-qualified addresses, which let the directory live on one chain while unambiguously pointing at contracts on another.
- **[EIP-1820](https://eips.ethereum.org/EIPS/eip-1820)** and **[ERC-6224](https://eips.ethereum.org/EIPS/eip-6224)** show the registry-about-contracts pattern, but neither is a neutral global directory of contracts that hold value.

Existing tools do not solve this problem, though they may appear similar. [DeFi Llama](https://defillama.com) tracks the protocols its own team chooses, behind an API, with total value locked as the unit rather than "worth securing". [L2Beat](https://l2beat.com) judges whole layer-2 systems, and judgment cannot be produced accurately at this scale. [CoinGecko](https://www.coingecko.com) and [CoinMarketCap](https://coinmarketcap.com) are token directories, and tokens are a subset. [Etherscan](https://etherscan.io) and [Blockscout](https://www.blockscout.com) are applications, better as a front end than as the record. [Sourcify](https://sourcify.dev) verifies source code, which should never be a precondition for calling a contract valuable.

## Who we expect to do this

Nobody is pre-selected. Once the RFP is fully funded there is an open bidding process, and the winner gets picked through the process below.

The skills required differ from milestone to milestone. The RFP can be answered by a team from a single organization or by teams from multiple organizations. Both are fine. The reviewers will select the proposal whose team has the highest chance of succeeding.

- **Milestones 1, 2, 3, and 5 (specification, writes, reads and indexing, finalization and deployment):** a team with protocol research and implementation experience, such as a research group, an auditing company, or another project that has shipped comparable systems. Milestones 2, 3, and 5 are ideally handled by the same group, the implementers. Milestone 1 can be delivered by a different, independent team.
- **Milestone 4 (audit):** an independent auditor, ideally not affiliated with the team that wrote the code.
- **Milestone 6 (stewardship and adoption):** can take many forms. It can be a dedicated, single-handed effort, or it can be bundled with other public-good and evangelism work for another existing project.

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

### A - Research and Specification - $29,000

- [ ] A public, versioned specification covering the data model, how an entry identifies a contract on Ethereum mainnet (chain-qualified addressing), the write (submission) protocol, and the read (indexing and query) interface, including the agent-driven read use case
- [ ] A definition of what can be identified as valuable. Smart contracts are the minimum. The specification must also consider delegated externally owned accounts (EIP-7702) and any other notion of a value-bearing entity in the Ethereum ecosystem, and state which are in scope and how each is addressed
- [ ] A proposed end-to-end architecture that is a superset of the MVP bar, with the host and infrastructure choice justified against the open properties (the hard requirements above)
- [ ] Within the specification, an explicit treatment of: how entries are submitted (writes); how the directory is read and queried; where the system is hosted and what serves as the data layer; AI, LLM, and agent integration; extensibility for third-party data and opinions; spam deterrence and abuse protection; security considerations; target use cases; and whether a design-partner evaluation is warranted
- [ ] An assessment of which existing standards (EAS, ERC-8257/8004, ERC-7512, ERC-7930/CAIP-10) are reused or built upon, and how each is reused or built upon
- [ ] Documented consultations with design partners on the data model and the read use cases
- [ ] The versioned specification is published publicly, addresses each topic above, and the design-partner consultations and their outcomes are documented

### B - Protocol Writes - $25,000

- [ ] Every write path from the specification implemented. The MVP write path (anyone can identify a mainnet contract as valuable under the defined protocol, permissionlessly) is the floor, not the target: if the specification stipulates more write paths, all of them are delivered
- [ ] Demonstrably functional code, adhering to the Milestone 1 specification, ready for audit and production deployment
- [ ] The code is open-source with a passing test suite, and an independent party can submit an identification on a public deployment and see it recorded

### C - Protocol Reads and Indexing - $29,000

- [ ] An open indexer plus the agent-facing read interface (for example, an MCP server or SDK) that exposes the full set of entries as data a researcher or an agent can enumerate and query, with no gatekept API
- [ ] Two end-to-end demonstrations: a user lists the directory and finds valuable contracts, and an agent browses the directory through the read interface, finds valuable in-scope contracts, and returns the full list
- [ ] Demonstrably functional code, adhering to the Milestone 1 specification, ready for audit and production deployment

### D - Audit - $30,000

- [ ] An audit covering at least the protocol logic (for example, spam resistance) and the write paths, by a reviewer independent of the implementers
- [ ] A public audit report which is available, covers at least the protocol logic and write paths

### E - Finalization and Deployment - $10,000

- [ ] Audit findings resolved and the code brought fully in line with the Milestone 1 specification
- [ ] The protocol deployed in production, able to survive under CROPS with no single point of control
- [ ] Documentation and tooling for a third party to stand up their own indexer
- [ ] Any other educational materials for users and integrators published
- [ ] Each audit finding has a documented resolution, the protocol is live at a public address or endpoint

### F - Stewardship and Adoption - $62,000 (adoption milestone)

- [ ] A documented plan for stewardship is published (with appropriate governance or handoff if necessary) for its ongoing upkeep beyond the grant
- [ ] Directory of Value is presented or discussed at 3 public Ethereum-ecosystem venues (conferences, community calls, meetups, or podcasts) during the grant period, each with public evidence (a recording, published slides, or a program listing)
- [ ] At least 2 third-party integrations shipped (for example, Foundry and Hardhat plugins, MCP server, agent-framework adapters, block explorer or other frontend integrations, wallet plugins)
- [ ] The optional expandability layer live: third parties attach their own data or attestations to an entry, without touching the neutral base
- [ ] At least 2 parties are running a publicly accessible indexer and read interface
- [ ] At least 500 distinct contracts have been identified in the directory, verifiable by counting entries in the public entry set
- [ ] At least $5 billion in aggregate TVL (or another defined value metric) is captured by contracts identified in the directory, verifiable by cross-referencing entries against public on-chain data or a TVL aggregator
