---
title: Production-Ready Local-First Safe UI
type: rfp
goal: 120000
summary: This RFP funds a production-ready, local-first Safe multisig UI, deployed
  to IPFS with reproducible builds, that anyone can run with nothing but an RPC
  endpoint and a wallet. It is an independent way to execute transactions if Safe
  for any reason becomes unreachable, and a tool to cross-check every hash before
  signers approve.
duration: 15
---
## Why this matters

A Safe is a contract on Ethereum. Its owners and threshold are on-chain, and anyone can execute a transaction once it carries enough owner signatures to meet the threshold. In the standard flow, everything before that step happens off-chain, through the hosted Safe{Wallet} frontend that Safe Labs operates and the Safe Transaction Service behind it. Self-hosting that stack means running the Client Gateway, the Transaction Service and a tracing archive node for internal-transaction indexing, so few teams do.

In July 2024, WazirX lost roughly $235M from a Safe multisig managed through Liminal Custody, whose interface showed a routine transfer while the signatures authorized a malicious contract upgrade. In October 2024, malware on the computers of Radiant Capital's signers showed a clean transaction while their hardware wallets received different calldata; the signers signed blind instead of checking the domain and message hash on the device, and lost roughly $50M. In February 2025, malicious JavaScript in the hosted Safe{Wallet} frontend showed Bybit's signers one transaction while their hardware wallets signed another, and roughly $1.5B left the Safe. These incidents are different manifestations of the same underlying problem: the software presenting a transaction to a signer cannot be treated as a trusted part of the signing boundary.

Assume Safe's hosted frontend and Transaction Service disappear tomorrow. A non-technical multisig signer should still be able to:

- open this UI from a local copy or the IPFS release
- connect a hardware wallet
- rebuild the transaction from the Safe's on-chain state (owners, threshold, nonce, contract version) and the parameters they were sent, then recompute its hashes locally
- verify exactly what they are signing
- exchange signatures with the other owners through ordinary files or links
- execute the transaction using only a JSON-RPC endpoint

No Safe account, Safe backend, project-operated server, indexer or technical help required. That is Vitalik's walkaway test.

## In scope

This RFP pays for finishing, hardening and maintaining a local-first Safe UI with minimal dependencies and trivial deployment. Optimise for the least technical signer rather than the developer running the UI. Deliverables:

- Ethereum Mainnet, Safe contract versions v1.3.0 and v1.4.1 at minimum
- Production hardening of an existing codebase, or a fresh build
- The full lifecycle against one standard JSON-RPC endpoint: load a Safe from chain state, propose, sign, exchange signatures, execute, manage owners and threshold, arbitrary contract calls
- Signature exchange without a server: signed transaction packages exported and imported through ordinary files or shareable links, with nested Safe (EIP-1271) support and approveHash as the on-chain alternative
- Verification: enter or import a transaction's full SafeTx parameters and recompute the EIP-712 domain hash, message hash and safeTxHash locally, with calldata decoded offline from a bundled selector database or a user-supplied ABI
- Hardware wallet signing on Ledger and Trezor at minimum, over WebUSB or WebHID or through a vendor library bundled with the app
- A command-line tool or local API that returns the hashes and decoded calldata for a given Safe address, chain ID and transaction parameters, for scripts and AI agents
- Reproducible IPFS builds with fixed import settings, an ENS name whose contenthash resolves to the current release, and docs for running locally and verifying a build
- 12 months of maintenance after the first tagged release (expected within 3 months of funding), and a business plan for the years after

## Out of scope

- Full Safe{Wallet} parity (Safe Apps, swaps, staking, onramps)
- Hosted backends or indexers, including a team-run web server for this UI (the IPFS and ENS release is in scope)
- Chains beyond Ethereum Mainnet
- Mobile apps
- New smart contracts

## Existing work

- [localsafe.eth](https://github.com/Cyfrin/localsafe.eth) (Cyfrin, MIT), live at [localsafe.eth.limo](https://localsafe.eth.limo). Its README calls it "still a project in early development": Safe v1.4.1 only, no transaction history; last release v0.3.1, June 18, 2026.
- [Eternal Safe](https://github.com/eternalsafe/wallet) (GPL-3.0), a Safe{Wallet} fork (app v1.26.2) that needs only an RPC URL. Received a Safe Grants Program grant; maintained by Devan Non; signature "smart links" are encoded rather than encrypted; v1.4.1 by default.
- [Safe's own monorepo](https://github.com/safe-global/safe-wallet-monorepo) (GPL-3.0). Self-hosting it means the [Client Gateway](https://github.com/safe-global/safe-client-gateway), the [Transaction Service](https://github.com/safe-global/safe-transaction-service) and a tracing archive node ([Safe docs](https://docs.safe.global/core-api/api-overview)).
- Hash-verification tools: [safe-tx-hashes-util](https://github.com/pcaversaccio/safe-tx-hashes-util), [OpenZeppelin Safe Utils](https://github.com/OpenZeppelin/safe-utils), [Cyfrin safe-hash](https://tools.cyfrin.io/safe-hash). They verify hashes only.

A bid built on another codebase should show it meets these hard requirements with fewer runtime dependencies.

## Who we expect to do this

Nobody is pre-selected. Teams that have already shipped Safe frontends or signing tools, including the people behind localsafe.eth and Eternal Safe, will be judged on that record, and the budget is $120,000 either way. Safe contributors are welcome to bid or to co-fund.

Co-drafted by Griff Green and pcaversaccio, both Curators of TheDAO Security Fund. pcaversaccio maintains [safe-tx-hashes-util](https://github.com/pcaversaccio/safe-tx-hashes-util), listed above.

## Hard requirements

1. **Open source.** An OSI-approved license, MIT or GPL-3.0 expected, and a public repository from the first commit of funded work.
2. **RPC only, nothing project-operated.** Every flow works against a standard JSON-RPC endpoint. Runtime dependencies are minimised, with no dependency on a hosted SaaS, proprietary API, mandatory backend, indexer, telemetry service, analytics provider or project-operated infrastructure, and no analytics or telemetry in the UI.
3. **Signature exchange without a server.** Signed transaction packages export and import through ordinary files or shareable links. Imported signatures are checked against the transaction's safeTxHash and the Safe's current owner set before they are accepted: signature recovery for EOA owners, an isValidSignature call for contract owners. Off-chain signatures work for nested Safes through EIP-1271, and on-chain approval through approveHash is supported as an alternative.
4. **Hardware wallets.** Ledger and Trezor at minimum, over WebUSB or WebHID or through a bundled vendor library. Before signing, the UI shows the EIP-712 domain hash, message hash and safeTxHash. The device shows the domain hash and the message hash, and the signer matches those against the UI and an independent hash tool. Vendor libraries are bundled and served with the app, with no popup, iframe or metadata fetched from a vendor's servers and no separate bridge daemon to install.
5. **Undecodable calldata stays unverified.** Calldata the UI cannot decode is shown as raw bytes with an unverified label, never as safe to sign.
6. **Verifiable builds.** Reproducible from a tagged commit to the published IPFS CID with fixed import settings, by an unaffiliated user without the team's infrastructure; the ENS contenthash resolves to the current release.
7. **Trivial deployment.** Open a local copy or the IPFS release, connect a hardware wallet, and work. Nothing to install beyond that.
8. **A maintenance and business plan in the proposal.** Who maintains the UI for the 12 months after the first tagged release, and how it is paid for after that.
9. **Public evidence for every milestone.** Recordings, transaction hashes, CIDs, test runs and named parties confirming, all published.

## Milestones (draft)

### A - Complete lifecycle without Safe infrastructure - $45,000

- [ ] A public repository under an OSI-approved license with a tagged release, and a published recording of the complete lifecycle on a v1.3.0 Safe and on a v1.4.1 Safe on Mainnet, using only the local or IPFS UI, one named public JSON-RPC endpoint and hardware wallets, with the browser's network panel showing no other network requests and a Mainnet transaction hash for each
- [ ] A published recording on a 2-of-3 Mainnet Safe: signer 1 constructs and exports the transaction; signer 2 imports it from a file or link, verifies the hashes on a Ledger, signs and exports the package again; signer 3 imports that package, verifies on a Trezor and signs; an independent machine imports the final package and executes; transaction hash published; no machine contacts the Safe Transaction Service
- [ ] A published recording of off-chain Safe signatures created, exported, imported, validated and used without the Transaction Service, including a nested Safe signing through EIP-1271
- [ ] A recorded recovery test: an operator unaffiliated with the team, starting from only the Safe address, a JSON-RPC endpoint and the exported artifacts, obtains the UI from the tagged source or the IPFS release and executes a previously signed transaction; transaction hash published
- [ ] Published automated tests, passing in public CI, for a stale nonce, two transactions competing for one nonce, an already-executed transaction, a cancelled or replaced transaction, and an imported signature that belongs to a different transaction
- [ ] A published command-line tool or local API that prints the three hashes and decoded calldata for a given Safe address, chain ID and transaction parameters, with a published example matching at least 1 of the hash tools under Existing work
- [ ] A scripted build that reproduces the published IPFS CID from the tagged commit with fixed import settings (CID version, chunker, raw leaves), with the release page listing every runtime dependency, confirmed in public by at least 3 named unaffiliated parties without access to the team's infrastructure, and an ENS name whose contenthash resolves to that CID
- [ ] A published security review of transaction construction, EIP-712 hashing, signature import and validation, and execution, by a reviewer with no ties to the team, paid from this milestone, findings and fixes public

### B - Adoption - $40,000 (adoption milestone)

- [ ] At least 20 named teams state in public that they keep this UI as a backup for their Safe, each statement linked from a public page
- [ ] The public page carrying those statements shows the current release, its CID, and the names of the parties who confirmed the CID

### C - 12 months of maintenance - $20,000

- [ ] At least 2 maintenance releases in the 12 months after the first tagged release, tracking Safe contract and dependency changes, each CID confirmed in public by at least 1 party unaffiliated with the team
- [ ] A public issue tracker where every reported issue has a public response within 14 days
- [ ] A public handoff doc naming the maintainers, who controls the release keys and the ENS name, and what a forker needs to carry it on

### D - Business model executed - $15,000 (adoption milestone)

- [ ] Public evidence that the business model from the proposal has earned at least $20,000: on-chain payments, or published invoices confirmed by the paying customers

## Links

- https://github.com/Cyfrin/localsafe.eth
- https://localsafe.eth.limo
- https://github.com/eternalsafe/wallet
- https://github.com/pcaversaccio/safe-tx-hashes-util
