# Card donations: provider research (July 2026)

The goal: a US donor with a credit or debit card gives $25 to $500 to an RFP in
under a minute, without uploading an ID, and the money arrives as USDC on
Ethereum mainnet at that RFP's own Safe, where the scanner credits it
automatically. No custody by us, no keys on the server.

## The verdict: Stripe fiat-to-crypto onramp

Stripe wins on every axis that matters for donations:

- **Friction.** Stripe handles KYC end to end and does NOT require detailed
  identity for low-value transactions. A $25 donor types a card number like
  any online purchase. This is the only major onramp where that is true for
  US users today.
- **Fees: 1.5%** per stablecoin transaction. Everyone else charges 3.5 to 5.5%.
- **Exact fit for our flow.** Onramp sessions are created server-side with
  `wallet_address` (the RFP's Safe, validated by Stripe) and
  `destination_network: ["ethereum"]` which the donor CANNOT override, with
  USDC as the currency. No pasting, no Base accidents, no ToS gray zone:
  third-party destination addresses are an explicit, supported parameter.
- **Trust.** Donors type card numbers into Stripe checkouts every week.
- US-only for now, which matches where card donors and the ID complaint live.
  Non-US donors overwhelmingly have crypto already; they use the wallet flow.

**What it needs:** a Stripe account with the crypto onramp product enabled
(an application; Stripe reviews the use case), owned by a US or
Stripe-supported entity. TheDAO's Marshall Islands entity will not pass
Stripe onboarding, so the account likely belongs to Giveth or General Magic
as the site operator. THIS IS THE ONE OPEN QUESTION.

Integration notes (for the build, once an account exists):
- Server: POST /v1/crypto/onramp_sessions per donation click, passing the
  RFP's Safe address + network lock + suggested amount; render the hosted or
  embedded widget.
- CSP must allow js.stripe.com for the embedded version (or use the hosted
  redirect and change nothing).
- The scanner already credits whatever arrives at the Safe, so no new
  crediting code is needed. Stripe webhooks can be added later for nicer
  "your card payment is on the way" status.
- Restrictions to verify in the application: New York has asset-level
  restrictions (confirm USDC-on-Ethereum is clean there, it appears to be).

## The field (why not the others)

| Option | Donor friction (US, $25) | Fees | Mainnet to our address | Killer problem |
|---|---|---|---|---|
| **Stripe onramp** | Card only, no ID at low value | **1.5%** | Locked server-side | Needs US entity + product approval |
| Coinbase Onramp | Full Coinbase account | ~0-3.5% | Yes | **Guest checkout deprecated June 30, 2026**; account wall for new users |
| Transak / MoonPay | Full ID KYC upload | 3.5-5.5% | Yes (partner key) | The exact ID-for-$25 experience Griff rejected |
| Guardarian (removed) | Full KYC + manual address paste | ~3-5% | Paste-prone, network drift | Already failed the field test |
| Ramp Network | ID KYC for US | ~3-4% | Yes | Same ID wall |
| Meso | Lighter, risk-based KYC | promo 0%, ~2-3% | Debit-focused | Small player, still per-user onboarding; fallback candidate |
| Onramper (aggregator) | Inherits each provider's KYC | varies | Yes | Aggregates the same ID walls |
| The Giving Block / Endaoment | None (fiat donation) | ~3-5% + platform | Indirect | Requires US 501c3 relationship; money flows via granting, not per-RFP Safes |
| Plain Stripe Checkout (fiat) | **Zero crypto friction at all** | 2.9%+30c | No: ops converts manually | Manual conversion + attribution each week; breaks automatic on-chain crediting |

## Fallback ladder

1. Stripe onramp application fails or stalls → **Meso** (closest to KYC-light)
   or Coinbase Onramp as a "Pay with Coinbase" button for the huge base of
   existing Coinbase users (zero-fee USDC for account holders).
2. If direct-to-address card payments prove impossible entity-wise → plain
   Stripe Checkout fiat donations with a weekly ops job: convert the Stripe
   balance to USDC, send to each RFP's Safe per the Stripe metadata, where
   the scanner credits it. Worse ops, best possible donor UX.

## Decision needed from Griff

Which entity applies for the Stripe account (Giveth? General Magic?), and who
owns that relationship. Everything else is build work that slots into the
existing `ONRAMP_PROVIDER` config.
