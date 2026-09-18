---
title: Provider-Independent, Client-Verified ENS Resolution
type: rfp
goal: 150000
summary: Today a wallet or gateway resolves an ENS name with one call to one RPC
  provider and trusts the answer; the correct record is on the chain and nothing
  checks it. This RFP suggests a library that asks two independent sources,
  verifies against a block header, and flags disagreement, plus a public test
  suite that any .eth gateway operator can run to prove they resolve and serve
  names correctly, so more than one company can serve .eth sites. It is anchored
  on the April 2026 eth.limo registrar hijack, where one operator's DNSSEC setup
  was the only thing between 2 million .eth sites and phishing pages. Half the
  budget pays only on adoption by named wallets, dapps, and gateway operators.
duration: 9
---
## Why this matters

Today, when a user types alice.eth, the wallet or gateway sends one eth_call to one RPC provider and shows whatever comes back. The correct record is on the chain. Nothing between the user and the chain checks it.

- Wallet path: user types a name, wallet asks one provider (usually Infura), provider answers, wallet trusts it.
- Browser path: user types alice.eth.limo, the request passes through eth.limo's registrar, DNS, servers, RPC, and CDN, each trusted alone.

With this RFP, the wallet or gateway uses a library that asks two independent sources, checks the onchain answer against a block header, and refuses or warns when the sources disagree. A hijacked or lying provider gets caught instead of trusted. A second gateway operator, passing the same public tests as the first, means the browser path no longer depends on one company.

Everything else built on names assumes this step is right: private lookups, curated registries, contract provenance. If one hijacked account can fake it, nothing on top of it holds.

What it looks like when the one company fails:

- On 17 April 2026 an attacker impersonated an eth.limo team member, talked the registrar EasyDNS into an account recovery, and held eth.limo's DNS for about five hours. eth.limo is the gateway through which around 2 million .eth websites reach ordinary browsers. DNSSEC validation rejected the attacker's answers and eth.limo reports no user impact. Post-mortem: https://discuss.ens.domains/t/eth-limo-dns-hijack-post-mortem/22079
- On 14 April 2026 attackers took over the cow.fi registration itself and served a counterfeit CoW Swap interface. The contracts were untouched; users signed malicious transactions anyway. Post-mortem: https://x.com/CoWSwap/status/2044925168892735985
- In November 2025 a compromise at the registrar NameSilo stripped DNSSEC from the Aerodrome and Velodrome domains before redirecting them. The Block reports user losses above $700,000.

DNSSEC saved eth.limo because one operator had turned it on, kept the signing key off the registrar, and the attacker did not remove the DS record in time. Aerodrome shows what happens when the attacker does. Two million names inherit one company's DNS configuration as their last line of defence.

The onchain binding from name to content was correct in all three incidents. No wallet or dapp we know of checks it against a second source.

This RFP covers the binding from name to content commitment or address. Verifying that the frontend bytes a browser loads match that commitment is separate work (WEBCAT, Sigsum, and related transparency-log approaches) and is a handoff, not part of this scope. Until that piece exists, the first page load through a gateway stays unprotected even when resolution is verified.

## In scope

- A multi-path ENS resolution library with quorum or disagreement handling, usable from at least a JavaScript/TypeScript environment
- Client-side verification of forward resolution (name to address, name to contenthash) against a block header or light-client proof
- A public threat model for the full resolution path: registrar, DNS, CDN, gateway operator, RPC provider
- A public gateway test suite and hardening playbook for .eth gateway operators
- A documented handoff to frontend verification: what the library outputs, and how a frontend-integrity tool consumes it
- Integration support for the first adopters, and a maintenance plan for after the grant

## What this pays for:

- A resolution library wallets, dapps, and gateways can adopt as a drop-in: at least two independent paths, verification against a block header or light-client proof, and defined behaviour when paths disagree.
- A written threat model covering registrar, DNS, CDN, gateway, and RPC-provider failure, stating which chokepoints the library removes and which it leaves in place.
- A public test suite that any .eth gateway operator can run to prove they resolve and serve names correctly, plus a hardening playbook (DNSSEC, registry lock, key handling), so operators become interchangeable and no user is tied to one.
- Adoption by named wallets, dapps, and gateway operators, with public evidence.

The browser-native path, in which a browser treats ENS as a resolution root without any gateway, is owned by browser vendors. Bidders should say how their work makes that path easier; building it is out of scope.

## Out of scope

- Building a browser-native ENS resolution root (browser vendors own this)
- Verifying that loaded frontend bytes match a content commitment
- Operating a gateway, an RPC service, or a registrar
- Private name resolution (PIR or homomorphic-encryption based lookups)

## Existing work

- ENS resolution specifications and CCIP-Read (ENSIP-10): https://docs.ens.domains
- eth.limo, the gateway whose post-mortem anchors this RFP, and comparable .eth gateways
- Helios and other Ethereum light clients that produce verifiable state proofs. We expect bidders to build on one of these, not to build chain verification themselves.
- WEBCAT and Sigsum, for the frontend-integrity handoff (out of scope here)

## Who we expect to do this

Nobody is pre-selected. Once the RFP is fully funded there will be an open bidding process, and the winner gets picked through the process below.

A strong bidder has shipped resolution or light-client code that wallets already run, and can name the wallet or dapp teams that will integrate the result. Bidders who operate a gateway or an RPC service are welcome, and must say how the library stays independent of their own service.

## Hard requirements

1. Open source. All delivered code is released under an OSI-approved licence, in a public repository, from the first milestone onward.
2. No single provider required. The library works with any RPC provider, any gateway, and any light client that implements the documented interface. No vendor's service is required, and the default configuration names at least two unaffiliated paths.
3. Verification, not trust. Forward resolution is checked against a block header or light-client proof. A resolver answer alone is never treated as authentic.
4. Defined disagreement behaviour. The specification states what the library does when independent paths return different results: what it returns, what it logs, and what the calling application sees.
5. Published threat model. The threat model names each chokepoint on the resolution path and states, for each, whether the delivered work removes it or leaves it in place.
6. Handoff documented. The library's output format and the interface to frontend-integrity tooling are specified in a public document.
7. Public acceptance evidence. Every milestone criterion is provable from a public page, repository, CI run, or a named party confirming in writing.
8. Maintenance plan. The final milestone includes a named maintainer and their reason to continue, published in the repository.

## Milestones (draft)

### A - Threat model and specification - $25,000

- [ ] The threat model is published in the public repository, covering registrar, DNS, CDN, gateway operator, and RPC provider failure, with the eth.limo, CoW Swap, and Aerodrome incidents mapped to it
- [ ] The library specification is published, including the multi-path interface, the verification method, the disagreement behaviour, and the handoff interface to frontend verification
- [ ] At least 3 wallet, dapp, or gateway teams have reviewed the specification, each named in the repository with a link to their review

### B - Verified resolution library - $50,000

- [ ] The library is released under an OSI-approved licence with forward resolution (address and contenthash) verified against a block header or light-client proof
- [ ] Two unaffiliated resolution paths are supported and disagreement handling is implemented, shown by a passing public CI run that injects a wrong answer on one path
- [ ] An independent security review of the library is published, with every finding rated high or critical fixed and the fix linked

### C - Gateway tests and a second operator - $25,000

- [ ] The gateway test suite and hardening playbook are published in the repository
- [ ] At least 2 independent .eth gateway operators pass the test suite, each listed on a public page with the passing run

### D - Adoption by wallets and dapps - $50,000 (adoption milestone)

- [ ] At least 2 wallets or dapps with public users resolve ENS names through the library in a shipped release, each listed on a public page with the release notes or merged pull request
- [ ] A public metrics page is live showing integrations, gateway operators passing the test suite, and library versions in use
- [ ] The maintainer and maintenance plan are published in the repository, and the final report on adoption and remaining chokepoints is public
