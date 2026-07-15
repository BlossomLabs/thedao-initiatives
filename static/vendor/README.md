# Vendored third-party JavaScript

The app is otherwise dependency-free (hand-encoded calldata, no build step).
The one vendored file here is the WalletConnect provider, self-hosted so it
loads under the strict `script-src 'self'` CSP instead of from a CDN.

## walletconnect-ethereum-provider-2.21.1.min.js

- Package: `@walletconnect/ethereum-provider`
- Version: 2.21.1 (pinned)
- Source: https://unpkg.com/@walletconnect/ethereum-provider@2.21.1/dist/index.umd.js
- Size: 1,097,925 bytes
- SHA-256: `5dca1487dc9de21a42e56a966cf15a377270f06c5dc3fb9c1e1f9beb488ecd24`
- UMD global: `window["@walletconnect/ethereum-provider"].EthereumProvider`

It is loaded **lazily and only when WalletConnect is enabled** (a
`WALLETCONNECT_PROJECT_ID` is set in `.env`). Default deployments never fetch
it. It exposes a standard EIP-1193 provider, so it flows through exactly the
same donation code (hand-encoded transfer calldata) and the same server-side
on-chain verification as an injected wallet — WalletConnect is only a
transport, it cannot bypass any money-path check.

To upgrade: download the new pinned version, update the filename + hash here
and the `WC_BUNDLE` name in `templates/base.html`, and re-verify the connect
flow in a browser.
