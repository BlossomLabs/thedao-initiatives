# Public launch checklist

Everything that changes when the board moves from this Mac to a real domain.
(Audited July 2026 against ETHSkills frontend-ux; items marked DONE already ship.)

## Before DNS goes live
- [ ] Host: any Python host with a persistent disk for `rfps.db` (small VPS,
      Render, Railway). Serve behind HTTPS with a real WSGI server
      (gunicorn) instead of the Flask dev server.
- [ ] `.env` on the server: `SITE_URL=https://rfps.thedao.fund/`,
      `COOKIE_SECURE=1`, `TRUST_PROXY=1` (behind the host's proxy),
      `BIND_HOST=127.0.0.1` (proxy terminates TLS), a fresh `ADMIN_PASSWORD`.
- [ ] Production RPC key (`RPC_URL=` Alchemy/Infura/dRPC) so the scanner and
      verification stop depending on public endpoints.

## Payments
- [ ] Stripe fiat-to-crypto onramp application (see docs/card-donations-research.md).
      Decision needed first: Giveth or General Magic owns the Stripe account.
      Then: build the session endpoint + set `ONRAMP_PROVIDER=stripe`.
      CSP needs `js.stripe.com` if the embedded widget is used.
- [ ] WalletConnect project ID + integration, so mobile donors and desktop
      users without extensions can connect any wallet by QR. Today only
      injected (extension / in-wallet browser) wallets work.

## dApp UX (ETHSkills audit)
- [x] DONE: button loading states + double-submission guard
- [x] DONE: EIP-6963 multi-wallet discovery + picker; accountsChanged /
      chainChanged listeners
- [x] DONE: USD context everywhere, live token conversion line, $-prefixed input
- [x] DONE: ENS display (forward-verified), address copy buttons, explorer links
- [x] DONE: human-readable wallet errors (rejection, gas, pending request)
- [x] DONE: OG / Twitter cards (per-RFP title + summary, 1200x630 image)
- [ ] Share a staging URL in Discord/Twitter and eyeball the preview card
- [ ] Consider a nicer OG image with the fund name typeset (current one is
      the logo centered on brand blue; replace `static/og-image.png` anytime)

## After launch
- [ ] Verify each RFP Safe on Etherscan (name tag "TheDAO RFP: <slug>")
- [ ] Point a status monitor at `/healthz`
- [ ] Backups: nightly copy of `rfps.db` + `uploads/` off the host
