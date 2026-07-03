# TheDAO Security Fund — RFP board

Public board of security RFPs. Sponsors pledge, anyone donates mainnet
stablecoins (verified on-chain), TheDAO completes the gap.

## Run it

    ./run.sh

Then open http://127.0.0.1:4482 — admin panel at /admin, password in `.env`.

## How money flows

- Donations are ERC-20 stablecoin transfers straight from the donor's wallet
  to the treasury (`0xD5Cf05f24727C83976652E3586c0e26DD39884e9`, set in config.py / .env `TREASURY_ADDRESS`). The server never holds funds and has no keys.
- The treasury address is resolved via the ENSv2 Universal Resolver AND
  cross-checked against an independent resolver; donations are disabled if
  the two ever disagree.
- Accepted tokens (USDC, USDT, DAI, USDS, crvUSD, BOLD, fxUSD) are re-verified
  against mainnet (decimals + symbol) at startup.
- A donation is only credited after the server reads the Transfer log from
  the transaction receipt on mainnet. Amounts come from the chain, never from
  the browser.

## Tests

    .venv/bin/python -m unittest discover tests
    (RFPS_SKIP_LIVE=1 to skip the live-mainnet checks)

## Voting

Round voting (badge holders + community signal) is future scope; the schema
and page copy leave room for it.
