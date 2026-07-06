# Fiat donations for Giveth: research brief for product
### From Griff, July 2026. Based on a verified deep-research pass done for TheDAO RFP board.

## Executive summary

- **The goal:** a normal person on giveth.io adds projects to a cart, pays once
  with a credit card, Apple Pay, or Google Pay, and each project receives its
  donation in crypto. No seed phrases, no exchanges, no ID upload for small
  US donations.
- **The recommended architecture:** every fiat donor gets an embedded wallet
  created behind a Google or email login (Privy, Web3Auth, or Magic). The card
  payment buys USDC into THAT wallet, and the wallet then pays each project in
  the cart. The donor signs once; everything else is automatic.
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
4. Before paying, they approve one signature: "up to $X of USDC may go from my
   wallet to these projects." The signature is free (no gas needed) and stays
   valid about 30 days, so slow card settlements are fine.
5. They pay. When the USDC lands in their wallet (minutes usually, sometimes
   longer if the provider reviews the payment), an automatic service executes
   the split to every project in the cart. The signature it uses can ONLY send
   to registered Giveth project addresses; the service holds no funds and its
   key cannot steal or redirect anything.
6. Each project sees a normal on-chain donation. GIVbacks and donation
   tracking work exactly as they do for crypto donors.

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
2. Embedded wallet vendor: Privy vs Web3Auth vs Magic (pricing at Giveth's
   volumes, login methods, key recovery UX).
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

Architecture decided for TheDAO RFP board (reuse for Giveth):
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
