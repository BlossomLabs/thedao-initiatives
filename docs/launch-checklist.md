# Public launch checklist

Everything that changes when the board moves from a laptop to a real domain.
(Audited July 2026 against ETHSkills frontend-ux; items marked DONE already ship.)

## Before DNS goes live
- [x] DONE: hosted on Deno Deploy (root `/`, entrypoint `server.ts`; see README,
      Deploy). The old Python VPS at fund.thedao.fund is deprecated.
- [x] DONE: production env from `.env.example`: `VITE_SITE_URL`, `ADMIN_ADDRESSES`,
      `OPERATIONAL_SIGNERS`, `SAFE_API_KEY`, `PINATA_JWT`.
- [x] DONE: production RPC (`VITE_RPC_URL` / `ALCHEMY_API_KEY`) so verification and
      the balance reads stop depending on public endpoints.

## Payments (unified card flow, decided July 2026; see card-donations-research.md)
Order matters: public deployment first, then accounts, then build.
- [ ] Entity check: which org has US registration (for Stripe) and which has
      charity docs (for Onramper/Transak). May be two different accounts.
- [ ] Stripe onramp application (~48h review); ask compliance in the
      application: "we fund the purchasing user's own embedded wallet" (clean
      own-wallet use). CSP needs js.stripe.com.
- [ ] Onramper partner application (non-US card routing, KYB docs).
- [ ] Embedded-wallet vendor: pick Privy / Web3Auth / Magic (research +
      recommendation is Claude's job), then sign up for API keys.
- [ ] Build (Claude): embedded-wallet login, USDC permit flow (amount-capped,
      ~30-day deadline), the tiny immutable forwarder contract (spender that
      can only move funds to registered RFP Safes; PC reviews; deployed from
      the admin wallet like the Safes; Sepolia first), gas-only watcher.
- [x] DONE: WalletConnect integrated (wagmi connector, on when
      `VITE_WALLETCONNECT_PROJECT_ID` is set). Mobile donors + extension-less
      desktop connect any wallet by QR. Keep the site domain in the project's
      Allowlist in the Reown dashboard.
- [ ] .wei / .gwei name display (wei.domains + the ownerless gwei.domains
      fork). Separate contracts from the ENS registry, so reverse display
      needs their resolver or API; ENS names already show everywhere.

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
      the logo centered on brand blue; replace `public/og-image.png` anytime)

## After launch
- [ ] Verify each RFP Safe on Etherscan (name tag "TheDAO RFP: <slug>")
- [ ] Point a status monitor at `/healthz`
- [x] DONE: nothing on disk to back up: Deno KV is platform-managed and
      uploads are pinned on IPFS (Pinata).
