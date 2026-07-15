# Fiat donations for Giveth: research brief for product
### From Griff, July 2026. Based on a verified deep-research pass done for TheDAO RFP board.

## Executive summary

- **The goal:** a normal person on giveth.io adds projects to a cart, pays once
  with a credit card, Apple Pay, or Google Pay, and each project receives its
  donation in crypto. No seed phrases, no exchanges, no ID upload for small
  US donations.
- **The recommended architecture:** every fiat donor gets an embedded wallet
  created behind a Google or email login, built on **Turnkey**. The card
  payment buys USDC into THAT wallet, and the wallet then pays each project in
  the cart through the existing DonationHandler contract. The donor consents
  once; everything else is automatic.
- **Why Turnkey:** multi-chain from day one (Bitcoin, Solana, and anything on
  either signing curve, which fits Giveth's roadmap), and its policy engine
  lets us restrict a donor's key so it can only ever sign the two donation
  transactions for their cart. That policy engine is what makes delayed
  execution safe without modifying any contracts.
- **Why the wallet in the middle is required, in one sentence:** every
  card-to-crypto provider delivers one purchase to exactly one address, so a
  cart that splits one charge across five projects is only possible if the
  money lands in the donor's own wallet first and fans out from there.
- **There is a second, legal reason:** Stripe's onramp terms require the
  purchased crypto to land in a wallet the buyer owns. Delivering a purchase
  straight to a project's address violates that. The embedded wallet satisfies
  it exactly.
- **Provider picks:** Stripe onramp for US cards (1.5% fee, and the low tier
  needs only name, phone, email, and address, no ID document). Onramper for
  everyone else (an aggregator across 130+ countries that routes each donor to
  whichever provider is most likely to accept their card, with no extra markup;
  they earn a revenue share from the providers). Transak as the fallback: its
  partner terms expressly permit donations and expressly accept charitable
  organizations, and Giveth has integrated Transak before.
- **A product gift hiding inside this:** every fiat donor walks away owning a
  real wallet tied to their login. That wallet can receive GIVbacks. Fiat
  donors stop being second-class and become onboarded crypto users.

## The donor's journey (what we would build)

1. Donor fills a cart on giveth.io, clicks checkout, picks card as the
   payment method.
2. Signs in with Google (or email). An embedded wallet is created that they
   own through that login. They never see a seed phrase.
3. They choose US card or non-US card (the site pre-selects a guess from IP,
   but the donor can override; lots of crypto users are on VPNs).
   US goes to Stripe's checkout, non-US goes to Onramper's.
4. Before paying, they consent once. That consent creates a Turnkey policy on
   their wallet: Giveth's automation may have the donor's key sign exactly two
   transactions, an approve to the DonationHandler for the cart amount and the
   DonationHandler multiSend with this exact cart payload, and nothing else.
   The policy engine enforces the templates.
5. They pay. When the USDC lands in their wallet (minutes usually, sometimes
   longer if the provider reviews the payment), the automation has the donor's
   key sign and broadcast those two transactions at that moment, with a fresh
   nonce and current gas. Gas comes from a tiny ETH dust the watcher sends
   first, or an EIP-7702 batch with a Giveth paymaster (team's choice).
6. On-chain it is identical to a normal cart checkout: same approve, same
   multiSend, same DonationHandler events. GIVbacks, donation tracking, and
   receipts work with zero backend changes.

## What it costs and what the donor experiences

- **US donors (Stripe):** 1.5% plus spread. First-time donors fill name,
  phone, email, address. No ID document, no selfie at the low tier. Larger
  amounts can escalate to ID.
- **Non-US donors (Onramper routing):** roughly 3 to 5.5% depending on the
  routed provider, and most countries do require a one-time ID verification
  with that provider. This is regulation, not a vendor choice; no serious
  provider skips it outside the US.
- **Chain choice matters for the split step:** on Ethereum mainnet each
  project payout costs real gas; on an L2 it is pennies. Stripe delivers USDC
  to Base, Optimism, and Polygon among others. Recommendation: run the fiat
  flow on ONE chain where Giveth projects broadly have addresses, and let the
  PM pick it early because everything downstream depends on it.

## Why not the simpler-sounding options

- **Direct delivery to a project address:** breaks on carts (one purchase, one
  address), likely violates Stripe's own-wallet terms, and welds Giveth to
  each provider's third-party-address policy forever.
- **Plain fiat processing (normal Stripe Checkout):** best possible donor UX,
  but Giveth would hold fiat and convert manually, which creates weekly
  treasury operations, custody questions, and per-project attribution work.
  Keep as a reserve idea, no more.
- **The Giving Block / Endaoment style processors:** built for US 501c3
  granting, do not fit per-project onchain delivery or non-US coverage.

## Decisions the PM owns

1. Which chain the fiat flow delivers on (drives gas cost, project address
   coverage, GIVbacks mechanics).
2. Embedded wallet vendor: Turnkey is the working choice (multi-chain plus the
   policy engine). PM validates pricing at Giveth volumes and one non-negotiable
   configuration: each donor must be the root authority of their own Turnkey
   sub-organization via passkey or email, with Giveth holding only a
   policy-scoped automation role. That keeps wallets genuinely donor-owned,
   which the Stripe terms require. If Giveth's API key were the root instead,
   this becomes custody with extra steps.
3. Which entity signs up where: Stripe requires a US or supported-country
   entity; Onramper and Transak run standard business onboarding and Transak
   accepts charities expressly.
4. Fee display: show the provider fee inside the cart total or before checkout
   (donors hate surprises more than they hate fees).
5. Refund and stuck-funds policy: if the split fails after settlement, funds
   sit safely in the donor's own recoverable wallet; decide the follow-up
   email and support flow.
6. Whether GIVbacks flow to the embedded wallet automatically (recommended;
   it is the retention hook).

## How this plugs into the existing cart (DonationHandler)

The DonationHandler contract does not change. That is the headline. Today a
cart donor approves the DonationHandler, then calls its multi-send, which
pulls the funds and distributes to every project while emitting the events
the backend already indexes. The fiat flow produces exactly those two
transactions from the donor's embedded wallet, just delayed until the card
money arrives.

How the delay works safely: the donor does not pre-sign raw transactions at
checkout (a raw signed transaction freezes its nonce and gas fields and can
go stale while waiting). Instead their checkout consent creates a Turnkey
policy that authorizes signing those two exact transactions later. When funds
settle, they are signed fresh and broadcast. Same consent-once semantics,
none of the staleness.

One thing we explicitly rejected: adding an admin key to the DonationHandler
that can pull funds out of donor wallets. Every donor who ever approved the
contract would become drainable by one compromised key. The delayed-signing
design gets the same outcome with the donor's own key doing the signing under
a policy it cannot exceed.

## Risks and gotchas, honestly

- Provider approvals take days to weeks and need a live domain, real terms of
  service, and privacy policy. Start applications early.
- Chargebacks are the provider's problem in the onramp model (that is what
  their fee buys), but expect them to scrutinize the integration for fraud
  exposure during onboarding.
- Some US states (New York especially) restrict which assets can be onramped;
  USDC coverage is broad but verify per state during the Stripe application.
- The parked-funds failure mode: money settles into the donor wallet but the
  split does not run (expired signature, service outage). Funds are never
  lost, the donor owns the wallet through their login, but the product needs
  a "finish your donation" email and a support script.
- Do not build against Coinbase's guest checkout guides: that product was
  discontinued June 30, 2026. Their replacement (headless Apple Pay API on
  web, zero-fee USDC for integrated apps) is worth a look as a future US
  add-on, unverified as of this writing.

## Appendix for AIs (paste this into prompts when working on this project)

CONTEXT BLOCK, verified July 2026, sources listed at the end.

Facts with high confidence (adversarially verified against primary docs):
- Stripe fiat-to-crypto onramp: sessions are created server-side (POST
  /v1/crypto/onramp_sessions, returns client_secret, embedded widget or hosted
  redirect). Parameters wallet_addresses plus lock_wallet_address hard-lock
  the destination; destination_networks and destination_currencies arrays
  cannot be overridden by the user. Supported networks include ethereum,
  base, optimism, polygon, solana; currencies include usdc. Every buyer
  passes at least KYC tier L0 (name, phone, email, address); L0 requires no
  ID document or selfie. There is no KYC-free tier. Applications are reviewed
  in about 48 hours. Fee: 1.5% per stablecoin transaction plus spread.
- Coinbase Onramp guest checkout (no-account debit/Apple Pay) was
  discontinued June 30, 2026. Replacement direction: headless onramp APIs,
  Apple Pay on web, 0% USDC onramp fees for integrated apps, but account and
  destination policies need verification.

Facts sourced from primary pages, not yet adversarially verified:
- Stripe onramp legal terms (stripe.com/legal/crypto-onramp): destination
  wallet must be solely owned by the purchasing end user, personal use only,
  no purchases on behalf of another person or entity, US-resident individuals
  18 plus. This is why direct-to-project delivery is off the table.
- Transak (docs.transak.com query-parameters, partner terms): walletAddress
  plus disableWalletAddressForm=true locks the destination; network and
  cryptoCurrencyCode lock chain and asset; partner terms expressly permit
  donations as a use case and accept registered charitable organizations as
  partners.
- Onramper (docs.onramper.com, knowledge base): aggregates 30 plus onramps
  across 130 plus countries, routes per-user on success rate, fees, and KYC
  friction, charges no integration fee and no end-user markup (revenue share
  from providers).
- Mt Pelerin: KYC-less tier excludes card payments entirely, and US persons
  are excluded; not usable for this flow.
- MoonPay partner onboarding requires corporate docs plus personal KYC of
  directors and 25%+ owners.
- EIP-2612 permit: the deadline is chosen by the message builder, so a 30-day
  validity is normal; permits use sequential nonces per owner; USDC on
  mainnet and major L2s supports permit; permits cost no gas to sign, which
  matters because fresh embedded wallets hold no ETH.

Turnkey and DonationHandler integration facts:
- Turnkey is key-management infrastructure: keys live in secure enclaves,
  organized as sub-organizations; a policy engine constrains what each API
  credential can have a key sign. Supports secp256k1 and ed25519, so
  Ethereum, Bitcoin, and Solana are all covered.
- Required configuration: donor is root authority of their own sub-org
  (passkey or email auth); Giveth automation holds a policy-scoped role
  limited to signing approve(DonationHandler, amount) and
  donationHandler multiSend(cart payload) transaction templates.
- Execution at settlement: watcher detects USDC arrival, automation signs
  both txs fresh (current nonce and gas) and broadcasts. Gas strategy:
  dust the wallet with ETH first, or EIP-7702 batching with a paymaster
  (7702 is live post-Pectra).
- Do NOT modify DonationHandler to add admin pull rights over user
  approvals; that creates a drainable honeypot across all past approvers.
- Pre-signing raw transactions at checkout and broadcasting later is
  technically possible but fragile (fixed nonce and gas fields go stale);
  policy-authorized signing at settlement is the robust equivalent.

Architecture decided for TheDAO RFP board (context, adapted above for Giveth):
- Embedded wallet per donor (donor-owned keys behind social login; the
  operator never controls keys and never custodies funds).
- Onramp funds the donor wallet: Stripe for US cards, Onramper otherwise,
  donor-selected with IP as a default hint only.
- Donor signs one amount-capped USDC permit, deadline about 30 days, whose
  spender is a small immutable contract that can only transfer to registered
  recipient addresses (for Giveth: verified project addresses).
- A gas-only watcher key executes the split when funds settle. It cannot
  redirect funds. On-chain arrival at project addresses is the source of
  truth for crediting, GIVbacks, and receipts.
- The cart is why direct onramp delivery cannot work: one purchase settles to
  one address, and only a donor-owned intermediate wallet allows fan-out.

Constraints to preserve in any design: no custody by Giveth, no private keys
on servers that can redirect funds, per-project onchain attribution, KYC
handled entirely by the payment provider, donor can always recover parked
funds through their login.

Primary sources: docs.stripe.com/crypto/onramp ·
docs.stripe.com/api/crypto/onramp_sessions/create ·
docs.stripe.com/crypto/onramp/kyc-integration-guide ·
stripe.com/legal/crypto-onramp · docs.transak.com/docs/query-parameters ·
transak.com/partner-terms-of-service · docs.rampnetwork.com/configuration ·
developers.mtpelerin.com · support.moonpay.com (KYB) ·
docs.cdp.coinbase.com/onramp FAQ · coinbase.com/developer-platform ·
docs.onramper.com · knowledge.onramper.com
