# TheDAO Security Fund — RFP board

[![CI](https://github.com/Giveth/thedao-rfps/actions/workflows/ci.yml/badge.svg)](https://github.com/Giveth/thedao-rfps/actions/workflows/ci.yml)

Public board of Ethereum-security initiatives (RFPs). Sponsors pledge,
anyone donates on-chain, TheDAO completes the funding gap.

## Run it

    ./run.sh

Then open http://127.0.0.1:4482 — admin panel at /admin, password in `.env`.

## How money flows

- Every approved RFP has its **own 3-of-5 Gnosis Safe**, deployed before
  approval: the Approve button first asks the admin's wallet for the deploy
  transaction (canonical Safe v1.4.1 factory; the server holds no keys and
  no funds), the server verifies owners, threshold, singleton, and fallback
  handler at the Safe's CREATE2 address, and only then does the initiative
  go live. The server never approves an initiative without a verified Safe.
- Donations are ERC-20 transfers (or plain ETH sends) straight from the
  donor's wallet to the RFP's Safe. Accepted tokens — USDC, USDT, DAI, USDS,
  crvUSD, BOLD, fxUSD, EURC, ZCHF — are re-verified against mainnet
  (decimals + symbol) at startup; non-USD tokens are priced by Chainlink
  feeds with staleness checks.
- A donation is only credited after the server reads the Transfer log (or
  the tx itself for ETH) from mainnet, `MIN_CONFIRMATIONS` blocks deep.
  Amounts come from the chain, never from the browser.
- A background scanner watches every RFP Safe, so exchange withdrawals and
  card purchases are credited automatically with no tx hash pasting.

## Optional integrations (all off until configured in `.env`)

- `AI_SEARCH_API_KEY` — "Show top matches": a donor describes what they want
  to fund and an LLM (any OpenAI-compatible API; default DeepSeek) floats
  the best-fitting initiatives to the top, client-side only.
- `ONRAMP_API_KEY` + `ONRAMP_PROVIDER` (transak/moonpay) — card checkout tab
  that delivers USDC straight to the RFP's Safe.
- `OPERATIONAL_SIGNERS` — the 5 checksummed addresses that own every RFP
  Safe; no Safe address is assigned until set. Each initiative freezes the
  set it was assigned with, so rotating signers never moves an address.

## Tests

    .venv/bin/python -m unittest discover tests
    (RFPS_SKIP_LIVE=1 to skip the live-mainnet checks)

CI runs the same suite on Python 3.10 and 3.12, byte-compiles every module,
shellchecks the scripts, and boots the app under gunicorn to check `/healthz`
before anything ships. A green push to `main` deploys itself to the server and
rolls back on its own if the new revision does not come up healthy — see
**DEPLOY.md**. The live-mainnet token verification that CI skips runs weekly
in `.github/workflows/live-chain.yml`.

## Voting

Round voting (badge holders + community signal) is future scope; the schema
and page copy leave room for it.
