# Card donations: provider research v2 (July 2026)

Method: deep-research run, 104 agents, 22 sources fetched, 95 claims extracted,
25 top claims sent to 3-vote adversarial verification. 8 claims fully confirmed
(3-0), 0 refuted, 17 left unverified because the account's monthly spend limit
cut the run short. Unverified claims below are quoted from primary pages that
WERE fetched and read; they lack only the adversarial re-check. Labels:
[VERIFIED 3-0] and [SOURCED, unconfirmed].

The goal, unchanged: a donor pays $25 to $1000 by card, minimal identity
friction, USDC lands on Ethereum mainnet at the RFP's own Safe, scanner
credits it, we custody nothing.

## Headline reversals from v1

**1. The Stripe direct-to-Safe plan has a likely ToS deal-breaker.**
Stripe's onramp legal terms (stripe.com/legal/crypto-onramp, read by two
independent research agents) say the destination wallet must be solely owned
by the purchasing end user, purchases must be for personal use, and users may
not buy "on behalf of any other person or entity" [SOURCED, unconfirmed].
Locking the destination to TheDAO's Safe is precisely a purchase delivered to
someone else. The technical capability exists and is confirmed
(wallet_addresses + lock_wallet_address, destination network/currency arrays
that "Users cannot override" [VERIFIED 3-0]), because platforms normally lock
to the USER's own wallet. Our use is off-label until Stripe says otherwise.
Also confirmed: there is no KYC-free tier at any size. Every buyer passes at
least L0 (name, phone, email, address), though L0 needs no ID document or
selfie [VERIFIED 3-0]. Application review is fast, about 48 hours
[VERIFIED 3-0], and there are hints of EU expansion (an EU KYC guide exists)
[SOURCED, unconfirmed].

**2. Transak is the donations-native choice.** Its partner terms were read
directly: registered charitable organizations are eligible partners, and
accepting donations is an expressly contemplated permitted use
[SOURCED, unconfirmed]. Technically it hard-locks everything we need:
walletAddress + disableWalletAddressForm=true (donor cannot edit),
network=ethereum, cryptoCurrencyCode=USDC [SOURCED, unconfirmed]. Giveth has
integrated Transak before. The cost: donors do real KYC (ID for US and most
regions) and fees run 3.5 to 5.5%.

## The table

| Provider | Coverage | Donor friction at $50 | Fees | Lock addr+mainnet+USDC | Donations in ToS | Entity to apply | Status |
|---|---|---|---|---|---|---|---|
| Stripe onramp | US (EU hints) | Card + L0: name/phone/email/address, no ID doc [VERIFIED] | 1.5% + spread | Yes, hard [VERIFIED] | LIKELY NO: own-wallet + personal-use clauses [SOURCED] | US entity | Ask Stripe compliance; do not assume |
| Transak | Global incl US | Full ID KYC | 3.5-5.5% | Yes, hard incl no-edit [SOURCED] | YES, expressly [SOURCED] | Charity OK; Giveth fits | Non-US primary candidate |
| Coinbase Onramp | US-centric | Guest checkout KILLED June 30 2026; account needed; headless Apple Pay API on web (Feb 2026) may be lighter | 0% on USDC for CDP apps | Yes | Own-wallet language likely, unchecked | US entity, CDP | US candidate IF headless Apple Pay works account-free; verify |
| MoonPay | Global | Full ID KYC | 3.5-5.5% | Yes | Unchecked | KYB: corp docs + director/UBO personal KYC [SOURCED] | No edge over Transak, heavier onboarding |
| Ramp Network | EU-strong | ID KYC | 3-4% | userAddress pre-set; hard-lock unconfirmed [SOURCED] | Unchecked | EU entity friendly | Non-US runner-up |
| Mt Pelerin | Non-US only (US excluded) | KYC-less regime EXCLUDES card payments; cards require ID [SOURCED] | 2.5-3.8% + CHF 1.20 min | Yes | Swiss, donation-friendly | Swiss association fits | Out for cards; interesting for bank-transfer donations later |
| Onramper (aggregator) | 130+ countries | Inherits routed provider's KYC | No end-user markup; rev-share model [SOURCED] | Pass-through, unconfirmed | Unchecked | Partner KYB | Non-US alternative: one integration, success-rate routing |
| Guardarian | Global | Full KYC even at $25 (field-tested by Griff) | 3-5% | Weak, paste-prone | Unchecked | Light | Rejected in field test |
| Daimo Pay | Multi | No card rails at all (bank/exchange/app deposits) [SOURCED] | Low | n/a | n/a | n/a | Out: no cards |
| ZKP2P | P2P (Venmo, Revolut) | No KYC by design, but donor needs the payment app | Low | Unconfirmed | Gray | None | Watch list; niche crypto-adjacent donors |
| The Giving Block / Endaoment | US tax-deductible | None (fiat) | 3-5% + platform | Indirect via grants | Yes | Needs 501c3 relationship | Doesn't fit per-RFP Safes |
| Plain Stripe Checkout (fiat) | Global cards | Zero crypto friction | 2.9% + 30c | No; weekly ops conversion | Yes (normal payments) | US entity | Reserve: best UX, worst ops |

## Recommendation

**Two-button design stands** (donor picks US card / non-US card, IP only
pre-selects). Aggregator routing is what Onramper sells, and their no-markup
rev-share model [SOURCED] makes fee-stacking a non-issue, so if we ever want
one integration instead of two, Onramper is the way. But the pairing to pursue:

- **Non-US card: Transak, decided.** Donations expressly permitted, charity
  partners accepted, hard locks, Giveth precedent. Giveth applies for the
  partner key. Donor ID KYC is the price of admission everywhere outside the
  US anyway.
- **US card: conditional on one email.** Apply to Stripe (48h review) and ask
  compliance the exact question: "card purchases of USDC delivered to a
  nonprofit's published donation Safe, is that permissible on the onramp?"
  If yes, Stripe wins on fees (1.5%) and friction (no ID doc). If no,
  fall back in order: (1) Coinbase CDP headless Apple Pay web flow with 0%
  USDC fees, pending verification that it works without a Coinbase account
  and allows third-party destinations; (2) Transak for US too (one provider
  everywhere, simplest); (3) plain Stripe fiat Checkout with weekly ops
  conversion.

## Still open (verification cut short by the spend limit)

1. Stripe compliance answer on donation destinations. Ask in the application.
2. Coinbase headless Apple Pay: account-free? third-party destination allowed?
3. Onramper: can the integrator hard-lock destination address through to every
   routed provider, and what does partner onboarding require?
4. Transak US donor KYC tiers at $50 vs $500 exactly.

## Sources (primary pages fetched and read)

docs.stripe.com/crypto/onramp · docs.stripe.com/api/crypto/onramp_sessions/create ·
docs.stripe.com/crypto/onramp/kyc-integration-guide · stripe.com/legal/crypto-onramp ·
docs.transak.com/docs/query-parameters · transak.com/partner-terms-of-service ·
docs.rampnetwork.com/configuration · developers.mtpelerin.com (kyc-and-kyc-less,
pricing-and-limits) · support.moonpay.com (KYB article) ·
docs.cdp.coinbase.com/onramp FAQ · coinbase.com/developer-platform (headless
onramps, zero-fee USDC) · daimo.com · docs.peer.xyz (zkp2p) ·
docs.onramper.com + knowledge.onramper.com (ranking, routing, pricing)
